/**
 * Tool: vsl_execute_action (T1.6.3).
 *
 * Выполняет действие над элементом VSL.
 * Поддерживаемые действия: click, type, scroll, select, и др.
 *
 * Flow:
 *  1. Валидация аргументов (action, target_id)
 *  2. Проверка snapshot и доступности браузера
 *  3. Ленивая навигация: если браузер не на URL из snapshot → автоматически навигировать
 *  4. Поиск элемента по target_id в текущем snapshot
 *  5. Выполнение действия через BrowserManager
 *  6. Возврат результата
 *
 * Lazy Navigation (DEC-028):
 *  Если агент прочитал страницу через HTTP-путь (vsl_read_page без браузера),
 *  а затем вызывает vsl_execute_action, система автоматически запускает Playwright
 *  и переходит на URL из snapshot. Это позволяет выполнять действия на страницах,
 *  изначально прочитанных через HTTP-путь (быстрое чтение структуры).
 */

import type { BrowserManager, PlaywrightFrame } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { SnapshotInput, VslObject } from '@thinkingos/vsl-sdk';

import { computeToolMetrics } from '../utils/metrics.js';
import { extractDomTree, iframeFrameRegistry } from './getSnapshot.js';
import { injectVslIdsIntoDom } from '../utils/injectVslIds.js';
import { filterDiffByDetailLevel, filterObjectsByDetailLevel } from '../utils/detailLevelFilter.js';
import { replaceIdsInDocument, replaceIdsInDiff } from '../utils/idMapper.js';
import { computeScrollable, computeVisibleWindow, filterDiffByViewport, filterObjectsByViewport, type ScrollableInfo, type ScrollContext } from '../utils/viewportFilter.js';

/** Поддерживаемые действия. */
const VALID_ACTIONS = [
  'click',
  'type',
  'fill', // alias for type — convenience for LLM agents
  'clear',
  'scroll',
  'select',
  'hover',
  'focus',
  'blur',
  'check',
  'uncheck',
  'press',
  'download',
  'upload',
  'drag',
  'drop',
  'submit',
  'reset',
  'open',
  'close',
  'expand',
  'collapse',
  'wait',
  'go_back',
  'go_forward',
  'refresh',
] as const;

/** Аргументы vsl_execute_action. */
export interface ExecuteActionArgs {
  action: string;
  target_id: string;
  value?: string;
  /**
   * Если true, возвращает обновлённое состояние страницы (diff/snapshot) после действия.
   * Полезно для агентов, чтобы видеть изменения без отдельного вызова vsl_get_snapshot.
   * Default: true — всегда возвращать состояние для экономии ходов агента.
   */
  return_state?: boolean;
  /** Таймаут ожидания завершения скачивания в мс (только для действия download; по умолчанию из config). */
  timeout?: number;
  /** Путь для сохранения файла (только для действия download; относительные пути разрешаются в downloadsPath с проверкой path traversal). */
  save_path?: string;
}
/** Результат vsl_execute_action. */
export interface ExecuteActionResult {
  status: 'success' | 'error';
  data?: {
    action: string;
    target_id: string;
    success: boolean;
    download?: { downloadId: string; filename: string; url: string; status: 'completed' | 'cancelled' | 'failed'; path?: string };
    upload?: { selector: string; files: string[]; success: boolean };
    /** Обновлённое состояние страницы (если return_state=true). */
    state?: {
      /** Diff с момента предыдущего snapshot (добавленные/изменённые/удалённые элементы). */
      diff?: unknown;
      /** Полный snapshot (если был первый вызов или URL изменился). */
      snapshot?: unknown;
      /** Ошибка извлечения состояния (если getStateAfterAction упал). */
      error?: string;
    };
    /** Флаг: произошла ли навигация после действия (например, press Enter на форме). */
    navigated?: boolean;
    /** Новый URL после навигации (если navigated=true). */
    newUrl?: string;
  };
  error?: string;
  /** Предупреждение о проблемах при извлечении состояния страницы. */
  warning?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
}

/** Результат получения состояния страницы после действия. */
export interface StateAfterAction {
  diff?: unknown;
  snapshot?: unknown;
  error?: string;
  /** Метаданные скролла (единый пайплайн отдачи, АС[3]). */
  scrollable?: ScrollableInfo;
}

/**
 * Получает обновлённое состояние страницы после действия.
 * Используется для return_state параметра.
 */
export async function getStateAfterAction(
  session: ServerSession,
  browser: BrowserManager,
  url: string,
  sessionId: string,
): Promise<StateAfterAction> {
  try {
    // Извлечь обновлённый DOM. Общий хелпер: прямая передача функции в
    // evaluate + разворачивание обёртки (без разворачивания SDK падает
    // с "reading 'aria-hidden'"). Viewport уже внутри обёртки — отдельный
    // evaluate-вызов не нужен.
    const extraction = await extractDomTree(browser, sessionId);
    // Обновить snapshot в сессии (scroll — для единого пайплайна отдачи, АС[3])
    const input: SnapshotInput = {
      viewport: extraction.viewport,
      url,
      title: '',
      timestamp: new Date().toISOString(),
      scroll: extraction.scroll,
    };
    session.snapshotFromElements(extraction.elements, input);
    // Полный документ — для инжекта data-vsl-id во ВСЕ элементы DOM
    const fullDoc = session.getSnapshot();
    // Inject data-vsl-id attributes into DOM for subsequent actions
    await injectVslIdsIntoDom(browser, fullDoc.objects, new Map(), sessionId);
    // Единый пайплайн отдачи (АС[3]): вьюпорт-фильтр по абсолютным
    // координатам + скролл-контексту, затем дефолтный detail_level 'medium'
    // (у тула нет параметра детализации).
    const scrollContext = session.getScrollContext();
    const win = computeVisibleWindow(fullDoc.canvas.viewport, scrollContext);
    const scrollable = computeScrollable(fullDoc.canvas.viewport, scrollContext);
    // Дифф фильтруется по видимому окну отдельно (структура changes)
    const diff = session.getDiff();
    const filteredDiff = diff
      ? filterDiffByDetailLevel(
          filterDiffByViewport(diff, fullDoc, session.getPreviousSnapshot(), win),
          fullDoc,
          'medium',
        )
      : diff;
    const viewportFiltered = filterObjectsByViewport(fullDoc.objects, win);
    const filteredObjects = filterObjectsByDetailLevel(viewportFiltered, 'medium');
    const snapshot = { ...fullDoc, objects: filteredObjects };
    // Заменяем длинные ID на короткие для выдачи LLM (rw3_output_integration)
    const reverseIdMap = session.getReverseIdMap();
    const finalSnapshot = replaceIdsInDocument(snapshot, reverseIdMap);
    const finalDiff = filteredDiff ? replaceIdsInDiff(filteredDiff, reverseIdMap) : filteredDiff;
    return { diff: finalDiff, snapshot: finalSnapshot, scrollable };
  } catch (error) {
    // Если не удалось получить состояние, возвращаем ошибку
    const errorMessage = `Failed to get state after action: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[vsl_execute_action]', errorMessage, error);
    return { error: errorMessage };
  }
}

/**
 * Серверный фолбэк скролл-контекста (браузер вернул невалидные данные):
 * старый контекст + дельта с клампом по размерам документа и вьюпорта.
 */
function serverSideScrollFallback(
  prev: ScrollContext | null,
  dx: number,
  dy: number,
  viewport?: { width: number; height: number },
): ScrollContext {
  const width = prev?.width ?? 0;
  const height = prev?.height ?? 0;
  const maxX = Math.max(0, width - (viewport?.width ?? 0));
  const maxY = Math.max(0, height - (viewport?.height ?? 0));
  return {
    x: Math.min(Math.max(0, (prev?.x ?? 0) + dx), maxX),
    y: Math.min(Math.max(0, (prev?.y ?? 0) + dy), maxY),
    width,
    height,
  };
}

/**
 * Скролл из кэша: состояние после действия scroll собирается из полного
 * документа сессии БЕЗ ре-экстракции — вьюпорт-фильтр по новому
 * скролл-контексту + дефолтная детализация 'medium' + метаданные скролла.
 */
function buildScrollStateFromCache(
  session: ServerSession,
  scrollContext: ScrollContext,
): StateAfterAction {
  try {
    const fullDoc = session.getSnapshot();
    const viewport = fullDoc.canvas?.viewport;
    // Нет данных о вьюпорте — отдаём документ без вьюпорт-фильтрации.
    if (!viewport || typeof viewport.width !== 'number' || typeof viewport.height !== 'number') {
      return { snapshot: fullDoc };
    }
    const win = computeVisibleWindow(viewport, scrollContext);
    const scrollable = computeScrollable(viewport, scrollContext);
    const viewportFiltered = filterObjectsByViewport(fullDoc.objects ?? [], win);
    const filteredObjects = filterObjectsByDetailLevel(viewportFiltered, 'medium');
    const snapshot = { ...fullDoc, objects: filteredObjects };
    // Заменяем длинные ID на короткие для выдачи LLM (rw3_output_integration)
    const reverseIdMap = session.getReverseIdMap();
    const finalSnapshot = replaceIdsInDocument(snapshot, reverseIdMap);
    return { snapshot: finalSnapshot, scrollable };
  } catch (error) {
    const errorMessage = `Failed to build scroll state from cache: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[vsl_execute_action]', errorMessage, error);
    return { error: errorMessage };
  }
}

/**
 * Обработчик vsl_execute_action.
 *
 * @param args - Аргументы инструмента
 * @param browser - Browser Manager
 * @param session - Server Session
 */
export async function handleExecuteAction(
  args: ExecuteActionArgs,
  browser: BrowserManager,
  session: ServerSession,
  sessionId: string,
): Promise<ExecuteActionResult> {
  const startTime = Date.now();

  try {
    // 1. Валидация аргументов
    if (!args.action || typeof args.action !== 'string') {
      return {
        status: 'error',
        error: 'action is required',
      };
    }

    if (!args.target_id || typeof args.target_id !== 'string') {
      return {
        status: 'error',
        error: 'target_id is required',
      };
    }

    // Проверяем, что действие валидно
    if (!VALID_ACTIONS.includes(args.action as (typeof VALID_ACTIONS)[number])) {
      return {
        status: 'error',
        error: `Unknown action: ${args.action}. Valid actions: ${VALID_ACTIONS.join(', ')}`,
      };
    }

    // Валидация return_state (DEC-030)
    if (args.return_state !== undefined && typeof args.return_state !== 'boolean') {
      return {
        status: 'error',
        error: 'return_state must be a boolean (true or false)',
      };
    }

    // Валидация value для scroll (DEC-030 + expand scroll API)
    if (args.action === 'scroll' && args.value !== undefined) {
      const SCROLL_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
      const parts = args.value.trim().split(':');
      const dir = parts[0] ?? '';
      const amountPart = parts[1];
      if (!SCROLL_DIRECTIONS.has(dir)) {
        return {
          status: 'error',
          error: `Invalid scroll direction: "${dir}". Valid: up, down, left, right. Optional amount: "down:300"`,
        };
      }
      if (parts.length > 2) {
        return {
          status: 'error',
          error: 'Invalid scroll value format. Use "dir" or "dir:amount" (e.g. "down:300")',
        };
      }
      if (amountPart !== undefined && !/^\d+(?:\.\d+)?$/.test(amountPart)) {
        return {
          status: 'error',
          error: `Invalid scroll amount: "${amountPart}". Must be a positive number`,
        };
      }
    }

    // Валидация value для type/fill/select (DEC-030)
    if ((args.action === 'type' || args.action === 'fill' || args.action === 'select') && args.value !== undefined) {
      if (typeof args.value !== 'string') {
        return {
          status: 'error',
          error: 'value must be a string for ' + args.action + ' action',
        };
      }
    }

    // 2. Проверяем, что есть snapshot
    if (!session.hasSnapshot()) {
      return {
        status: 'error',
        error: 'No snapshot available. Call vsl_get_snapshot first.',
      };
    }

    // 3. Проверяем доступность браузера
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error: 'Playwright is not installed. Install it with: npm install playwright',
      };
    }
    
    // 4. Ленивая навигация: если браузер не на URL из snapshot → автоматически навигировать
    const snapshot = session.getSnapshot();
    const snapshotUrl = snapshot.canvas.url;
    
    // Сохраняем URL перед выполнением действия для детекции навигации
    const urlBeforeAction = await browser.evaluate(() => window.location.href, sessionId);
    
    if (snapshotUrl) {
      const currentUrl = urlBeforeAction;
      
      if (currentUrl !== snapshotUrl) {
        // Автоматическая навигация на URL из snapshot
        await browser.navigate(snapshotUrl, sessionId);
      }
    }
    // Выполняем действие в try-catch для обработки навигации
    let actionError: Error | null = null;
    let page: Awaited<ReturnType<BrowserManager['getPage']>> = null!;
    try {

    // 5. TODO: Найти элемент по target_id в VSL snapshot
    //    Сейчас используем target_id как CSS selector
    //    В будущем: маппинг VSL id → DOM selector через snapshot

    // Проверка наличия data-vsl-id атрибутов в DOM
    // Если атрибутов нет (например, после vsl_read_page без браузера),
    // автоматически создаём snapshot для инжекта data-vsl-id
    const hasVslIds = await browser.evaluate(() => {
      return document.querySelector('[data-vsl-id]') !== null;
    }, sessionId);

    if (!hasVslIds) {
      // Автоматическое создание snapshot (общий хелпер с разворачиванием обёртки)
      const extraction = await extractDomTree(browser, sessionId);
      const input: SnapshotInput = {
        viewport: extraction.viewport,
        url: snapshotUrl || '',
        title: '',
        timestamp: new Date().toISOString(),
        // Метаданные скролла для единого пайплайна отдачи (АС[3])
        scroll: extraction.scroll,
      };
      session.snapshotFromElements(extraction.elements, input);
    }

    // Frame routing: проверяем frame prefix (формат iframe_N:localId) В args.target_id
    // ВАЖНО: проверяем prefix ДО резолва ID, потому что idMap содержит ключи с префиксом
    let targetFrame: PlaywrightFrame | null = null;
    let localShortId = args.target_id;
    const frameMatch = args.target_id.match(/^iframe_(\d+):(.+)$/);
    if (frameMatch) {
      const frameIndex = parseInt(frameMatch[1]!, 10);
      localShortId = frameMatch[2]!;
      // URL-based frame matching: используем iframeFrameRegistry из getSnapshot
      const frameUrl = iframeFrameRegistry.get(frameIndex);
      if (!frameUrl) {
        return {
          status: 'error',
          error: `Frame iframe_${frameIndex} not found in registry. Call vsl_get_snapshot first.`,
        };
      }
      const frames = await browser.getFrames(sessionId);
      // Partial URL match (same algorithm as getSnapshot.ts) — handles redirects/parameters
      targetFrame = frames.find(f => {
        const u = f.url();
        return u === frameUrl || u.includes(frameUrl) || frameUrl.includes(u);
      }) || null;
      if (!targetFrame) {
        return {
          status: 'error',
          error: `Frame with URL "${frameUrl}" not found. Available frames: ${frames.map(f => f.url()).join(', ')}`,
        };
      }
    }

    // Резолв короткого ID в длинный через idMap (rw4_action_integration)
    // Для iframe элементов используем ПОЛНЫЙ target_id (с префиксом iframe_N:),
    // потому что idMap хранит ключи с префиксом (iframe_0:spn_0 → span_0_0_0)
    const idMap = session.getIdMap();
    const resolvedId = idMap.get(args.target_id) || localShortId;
    const localId = resolvedId;

    const selector = `[data-vsl-id="${localId}"], #${localId}, .${localId}`;

    // 5. Выполняем действие
    page = await browser.getPage(sessionId);
    // Frame routing: используем targetFrame если задан, иначе main page
    // PlaywrightFrame и PlaywrightPage оба поддерживают locator API
    const target = targetFrame || page;

    // CRITICAL-2: Валидация элемента перед действием
    // Проверяем существование элемента и совпадение tag
    // Graceful degradation: если evaluate недоступен (в тестах), пропускаем валидацию
    // Пропускаем для действий, не требующих элемента: press, scroll, refresh
    const actionsRequiringElement = ['click', 'fill', 'type', 'check', 'uncheck', 'upload', 'select', 'hover', 'focus', 'blur', 'clear'];
    if (actionsRequiringElement.includes(args.action)) {
      try {
        const expectedTag = resolvedId.match(/^([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*)_/)?.[1] || '';
        const elementValidation = await target.evaluate(({ sel, expectedTag }: { sel: string; expectedTag: string }) => {
          const el = document.querySelector(sel);
          if (!el) return { exists: false, valid: false, actualTag: '' };
          const actualTag = el.tagName.toLowerCase();
          return { exists: true, valid: actualTag === expectedTag, actualTag };
        }, { sel: selector, expectedTag });

        if (!elementValidation.exists) {
          // Элемент не найден — переинжектируем data-vsl-id
          const extraction = await extractDomTree(browser, sessionId);
          const input: SnapshotInput = {
            viewport: extraction.viewport,
            url: snapshotUrl || '',
            title: '',
            timestamp: new Date().toISOString(),
            scroll: extraction.scroll,
          };
          session.snapshotFromElements(extraction.elements, input);
          await injectVslIdsIntoDom(browser, extraction.elements as VslObject[], new Map(), sessionId);
          // Повторная проверка после переинжекта
          const revalidation = await target.evaluate(({ sel, expectedTag }: { sel: string; expectedTag: string }) => {
            const el = document.querySelector(sel);
            if (!el) return { exists: false, valid: false, actualTag: '' };
            const actualTag = el.tagName.toLowerCase();
            return { exists: true, valid: actualTag === expectedTag, actualTag };
          }, { sel: selector, expectedTag });
          if (!revalidation.exists) {
            return {
              status: 'error',
              error: `Element not found after re-injection: ${args.target_id} (selector: ${selector})`,
            };
          }
          if (!revalidation.valid) {
            return {
              status: 'error',
              error: `Tag mismatch after re-injection: expected ${expectedTag}, got ${revalidation.actualTag} for ${args.target_id}`,
            };
          }
        } else if (!elementValidation.valid) {
          // Элемент найден, но tag не совпадает — переинжектируем
          const extraction = await extractDomTree(browser, sessionId);
          const input: SnapshotInput = {
            viewport: extraction.viewport,
            url: snapshotUrl || '',
            title: '',
            timestamp: new Date().toISOString(),
            scroll: extraction.scroll,
          };
          session.snapshotFromElements(extraction.elements, input);
          await injectVslIdsIntoDom(browser, extraction.elements as VslObject[], new Map(), sessionId);
          // Повторная проверка после переинжекта
          const revalidation = await target.evaluate(({ sel, expectedTag }: { sel: string; expectedTag: string }) => {
            const el = document.querySelector(sel);
            if (!el) return { exists: false, valid: false, actualTag: '' };
            const actualTag = el.tagName.toLowerCase();
            return { exists: true, valid: actualTag === expectedTag, actualTag };
          }, { sel: selector, expectedTag });
          if (!revalidation.valid) {
            return {
              status: 'error',
              error: `Tag mismatch after re-injection: expected ${expectedTag}, got ${revalidation.actualTag} for ${args.target_id}`,
            };
          }
        }
      } catch (validationError) {
        // Graceful degradation: если evaluate недоступен (в тестах), пропускаем валидацию
        console.warn(`[VSL] Element validation skipped (target.evaluate not available): ${validationError}`);
      }
    }


    
    switch (args.action) {
      case 'click': {
        // Positional mapping fallback (reCAPTCHA 3x3 grid support):
        // 1. Try standard locator (data-vsl-id, #id, .class)
        // 2. If fails → find element in snapshot by ID, get rect
        // 3. Use elementFromPoint at rect center to find actual DOM element
        // 4. Click the found element
        try {
          // Strategy 1: Standard locator
          // Проверка существования элемента перед click (MEDIUM-3)
          const clickElementCount = await target.locator(selector).count();
          if (clickElementCount === 0) {
            return {
              status: 'error',
              error: `Element not found for click: ${args.target_id} (selector: ${selector})`,
            };
          }
          await target.locator(selector).click({ timeout: 1000 });
        } catch (locatorError) {
          // Strategy 2: Positional mapping fallback
          console.warn(`[VSL] Standard locator failed for ${args.target_id}, trying positional mapping fallback`);
          
          // Find element in snapshot by ID
          const snapshotDoc = session.getSnapshot();
          const snapshotObjects = snapshotDoc.objects ?? [];
          
          // Recursive search for element by ID
          function findObjectById(objects: unknown[], targetId: string): unknown | null {
            for (const obj of objects) {
              const o = obj as { id?: string; rect?: { x: number; y: number; width: number; height: number }; ch?: unknown[] };
              if (o.id === targetId) return o;
              if (o.ch && Array.isArray(o.ch)) {
                const found = findObjectById(o.ch, targetId);
                if (found) return found;
              }
            }
            return null;
          }
          
          const snapshotObj = findObjectById(snapshotObjects, localId) as { rect?: { x: number; y: number; width: number; height: number } } | null;
          
          if (!snapshotObj || !snapshotObj.rect) {
            console.error(`[VSL] Positional mapping failed: element ${localId} not found in snapshot or has no rect`);
            throw locatorError; // Re-throw original error
          }
          
          const rect = snapshotObj.rect;
          const centerX = rect.x + rect.width / 2;
          const centerY = rect.y + rect.height / 2;
          
          // Use elementFromPoint to find actual DOM element at rect center
          const elementFound = await target.evaluate(
            ([x, y]: [number, number]) => {
              const el = document.elementFromPoint(x, y);
              if (el) {
                (el as HTMLElement).click();
                return true;
              }
              return false;
            },
            [centerX, centerY] as [number, number]
          );
          
          if (!elementFound) {
            console.error(`[VSL] Positional mapping failed: no element found at (${centerX}, ${centerY})`);
            throw locatorError; // Re-throw original error
          }
          
          console.log(`[VSL] Positional mapping succeeded: clicked element at (${centerX}, ${centerY}) for ${args.target_id}`);
        }
        
        // Ждём стабилизации DOM после клика
        await page.waitForTimeout(100);
        break;
      }


      case 'fill':
      case 'type':
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for type action',
          };
        }
        // Используем Playwright locator API для поддержки frame routing
        // Проверка существования элемента перед fill (MEDIUM-3)
        const fillElementCount = await target.locator(selector).count();
        if (fillElementCount === 0) {
          return {
            status: 'error',
            error: `Element not found for fill: ${args.target_id} (selector: ${selector})`,
          };
        }
        await target.locator(selector).fill(args.value, { timeout: 1000 });
        break;

      case 'scroll': {
        const DEFAULT_SCROLL_AMOUNT = 500;
        const scrollValue = args.value || 'down';
        const scrollParts = scrollValue.trim().split(':');
        const scrollDir = scrollParts[0];
        const scrollAmount = scrollParts[1] !== undefined ? Number(scrollParts[1]) : DEFAULT_SCROLL_AMOUNT;
        const dx = scrollDir === 'left' ? -scrollAmount : scrollDir === 'right' ? scrollAmount : 0;
        const dy = scrollDir === 'up' ? -scrollAmount : scrollDir === 'down' ? scrollAmount : 0;
        // Скролл выполняется в браузере (нужен для скриншотов и последующих
        // действий), но ответ собирается ИЗ КЭША без ре-экстракции.
        await browser.evaluate(({ dx, dy }: { dx: number; dy: number }) => {
          window.scrollBy(dx, dy);
        }, sessionId, { dx, dy });
        await page.waitForTimeout(50);

        // Новый скролл-контекст: один лёгкий evaluate читает реальный скролл;
        // при невалидном результате — серверный фолбэк по дельте.
        const prevScroll = session.getScrollContext();
        let newScroll: ScrollContext | null = null;
        try {
          const raw = await browser.evaluate(() => ({
            x: window.scrollX,
            y: window.scrollY,
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          }), sessionId);
          const r = raw as ScrollContext | null;
          if (
            r !== null && typeof r === 'object' &&
            typeof r.x === 'number' && typeof r.y === 'number' &&
            typeof r.width === 'number' && typeof r.height === 'number'
          ) {
            newScroll = r;
          }
        } catch {
          // Чтение скролла не удалось — используется серверный фолбэк.
        }
        if (!newScroll) {
          newScroll = serverSideScrollFallback(prevScroll, dx, dy, session.getSnapshot().canvas?.viewport);
        }
        session.setScrollContext(newScroll);

        const scrollResult: ExecuteActionResult = {
          status: 'success',
          data: {
            action: args.action,
            target_id: args.target_id,
            success: true,
          },
        };

        // Состояние после скролла фильтруется из полного документа по новому
        // скролл-контексту без ре-экстракции. Дифф не отдаётся: контент
        // страницы при скролле не меняется.
        if (args.return_state !== false) {
          const state = buildScrollStateFromCache(session, newScroll);
          if (scrollResult.data) {
            scrollResult.data.state = state;
            if (state.error) {
              scrollResult.warning = `State extraction failed: ${state.error}`;
            }
          }
        }

        scrollResult.metadata = computeToolMetrics(scrollResult.data, startTime);
        return scrollResult;
      }

      case 'select':
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for select action',
          };
        }
        // Frame-aware: используем target.evaluate или browser.evaluate
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, ({ sel, val }: { sel: string; val: string }) => {
            const el = document.querySelector(sel) as HTMLSelectElement;
            if (el) el.value = val;
          }, sessionId, { sel: selector, val: args.value });
        } else {
          await browser.evaluate(({ sel, val }: { sel: string; val: string }) => {
            const el = document.querySelector(sel) as HTMLSelectElement;
            if (el) el.value = val;
          }, sessionId, { sel: selector, val: args.value });
        }
        break;

      case 'hover':
        // Frame-aware hover
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              const event = new MouseEvent('mouseover', { bubbles: true });
              el.dispatchEvent(event);
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              const event = new MouseEvent('mouseover', { bubbles: true });
              el.dispatchEvent(event);
            }
          }, sessionId, selector);
        }
        break;
      case 'blur':
        // Frame-aware blur
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement;
            if (el) el.blur();
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement;
            if (el) el.blur();
          }, sessionId, selector);
        }
        break;

      case 'focus':
        // Frame-aware focus
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement;
            if (el) el.focus();
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement;
            if (el) el.focus();
          }, sessionId, selector);
        }
        break;
      case 'press': {
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for press action (key name, e.g. "Enter", "Tab", "Escape")',
          };
        }
        await page.keyboard.press(args.value, { delay: 0 });
        await page.waitForTimeout(50);
        break;
      }


      case 'download': {
        // Реальное скачивание через Playwright (Фаза 3: перенос из удалённого тула vsl_download).
        // value — прямое скачивание по URL (<a download> + клик),
        // иначе — клик по элементу (кнопка/ссылка для скачивания).
        const downloadsBefore = browser.getDownloads();

        // Frame-aware download: используем evaluateInFrame если targetFrame задан
        if (args.value) {
          if (targetFrame) {
            await browser.evaluateInFrame(targetFrame, (url: string) => {
              const a = document.createElement('a');
              a.href = url;
              a.download = '';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }, sessionId, args.value);
          } else {
            await browser.evaluate((url: string) => {
              const a = document.createElement('a');
              a.href = url;
              a.download = '';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }, sessionId, args.value);
          }
        } else {
          if (targetFrame) {
            await browser.evaluateInFrame(targetFrame, (sel: string) => {
              const el = document.querySelector(sel);
              if (el) (el as HTMLElement).click();
            }, sessionId, selector);
          } else {
            await browser.evaluate((sel: string) => {
              const el = document.querySelector(sel);
              if (el) (el as HTMLElement).click();
            }, sessionId, selector);
          }
        }

        // Ждём регистрации загрузки в activeDownloads (context.on('download'))
        const pollDeadline = Date.now() + 5000;
        let newDownload: { downloadId: string; filename: string; url: string } | undefined;
        while (!newDownload && Date.now() <pollDeadline) {
          newDownload = browser.getDownloads().find(
            d => !downloadsBefore.some(b => b.downloadId === d.downloadId),
          );
          if (!newDownload) {
            await browser.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 50)), sessionId);
          }
        }

        if (!newDownload) {
          return {
            status: 'error',
            error: 'Download not detected after click (timeout 5000ms). The page may navigate instead of downloading.',
          };
        }

        // Ожидаем завершение загрузки и опционально сохраняем файл
        // (проверка path traversal для относительных путей — внутри browser.saveDownload)
        const downloadInfo = await browser.waitForDownload(newDownload.downloadId, args.timeout);
        if (args.save_path) {
          await browser.saveDownload(downloadInfo.downloadId, args.save_path);
        }

        const result: ExecuteActionResult = {
          status: 'success',
          data: {
            action: args.action,
            target_id: args.target_id,
            success: downloadInfo.status === 'completed',
            download: {
              downloadId: downloadInfo.downloadId,
              filename: downloadInfo.filename,
              url: downloadInfo.url,
              status: downloadInfo.status,
              path: args.save_path ?? downloadInfo.path ?? undefined,
            },
          },
        };

        // Добавить состояние страницы, если запрошено
        if (args.return_state !== false) {
          try {
            // Используем page.url() вместо browser.evaluate(), чтобы избежать 'Execution context was destroyed'
            const currentUrl = page.url();
            const state = await getStateAfterAction(session, browser, currentUrl as string, sessionId);
            if (result.data) {
              result.data.state = state;
              if (state.error) {
                result.warning = `State extraction failed: ${state.error}`;
              }
            }
          } catch (stateError) {
            // Если получение состояния упало (например, из-за навигации), возвращаем warning
            result.warning = `State extraction failed: ${stateError instanceof Error ? stateError.message : String(stateError)}`;
          }
        }

        result.metadata = computeToolMetrics(result.data, startTime);
        return result;
      }

      case 'upload': {
        // Загрузка файлов в <input type="file">
        // value содержит путь(и) к файлу(ам), разделённые запятой
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for upload action (file path(s), comma-separated)',
          };
        }
        const filePaths = args.value.split(',').map(p => p.trim()).filter(Boolean);
        if (filePaths.length === 0) {
          return {
            status: 'error',
            error: 'value must contain at least one file path',
          };
        }
        // Frame-aware upload: используем locator API для поддержки iframe
        // PlaywrightFrame и PlaywrightPage оба поддерживают locator().setInputFiles()
        // Проверка существования элемента перед upload (MEDIUM-3)
        const uploadElementCount = await target.locator(selector).count();
        if (uploadElementCount === 0) {
          return {
            status: 'error',
            error: `Element not found for upload: ${args.target_id} (selector: ${selector})`,
          };
        }
        await target.locator(selector).setInputFiles(filePaths.length === 1 ? filePaths[0]! : filePaths, { timeout: 1000 });
        const result: ExecuteActionResult = {
          status: 'success',
          data: {
            action: args.action,
            target_id: args.target_id,
            success: true,
            upload: {
              selector,
              files: filePaths,
              success: true,
            },
          },
        };

        // Добавить состояние страницы, если запрошено
        if (args.return_state !== false) {
          const currentUrl = await browser.evaluate(() => window.location.href, sessionId);
          const state = await getStateAfterAction(session, browser, currentUrl as string, sessionId);
          if (result.data) {
            result.data.state = state;
            if (state.error) {
              result.warning = `State extraction failed: ${state.error}`;
            }
          }
        }

        result.metadata = computeToolMetrics(result.data, startTime);
        return result;
      }

      case 'clear': {
        // Очистка текстового поля (input/textarea)
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
            if (el) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
            if (el) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'drag': {
        // Drag-and-drop: target_id = source, value = destination ID
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for drag action (destination element ID)',
          };
        }
        // Резолвим destination ID через idMap
        const destIdMap = session.getIdMap();
        const destResolvedId = destIdMap.get(args.value) || args.value;
        const destSelector = `[data-vsl-id="${destResolvedId}"], #${destResolvedId}, .${destResolvedId}`;
        
        // Frame-aware drag: используем evaluateInFrame если targetFrame задан
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, ({ srcSel, dstSel }: { srcSel: string; dstSel: string }) => {
            const source = document.querySelector(srcSel);
            const destination = document.querySelector(dstSel);
            if (source && destination) {
              const dispatchDragEvent = (el: Element, type: string) => {
                if (typeof DragEvent === 'function') {
                  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
                } else {
                  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
                }
              };
              dispatchDragEvent(source, 'dragstart');
              dispatchDragEvent(destination, 'dragenter');
              dispatchDragEvent(destination, 'dragover');
              dispatchDragEvent(destination, 'drop');
              dispatchDragEvent(source, 'dragend');
            }
          }, sessionId, { srcSel: selector, dstSel: destSelector });
        } else {
          await browser.evaluate(({ srcSel, dstSel }: { srcSel: string; dstSel: string }) => {
            const source = document.querySelector(srcSel);
            const destination = document.querySelector(dstSel);
            if (source && destination) {
              const dispatchDragEvent = (el: Element, type: string) => {
                if (typeof DragEvent === 'function') {
                  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
                } else {
                  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
                }
              };
              dispatchDragEvent(source, 'dragstart');
              dispatchDragEvent(destination, 'dragenter');
              dispatchDragEvent(destination, 'dragover');
              dispatchDragEvent(destination, 'drop');
              dispatchDragEvent(source, 'dragend');
            }
          }, sessionId, { srcSel: selector, dstSel: destSelector });
        }
        break;
      }

      case 'drop': {
        // Drop на целевой элемент
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              const dispatchDragEvent = (el: Element, type: string) => {
                if (typeof DragEvent === 'function') {
                  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
                } else {
                  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
                }
              };
              dispatchDragEvent(el, 'dragover');
              dispatchDragEvent(el, 'drop');
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              const dispatchDragEvent = (el: Element, type: string) => {
                if (typeof DragEvent === 'function') {
                  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
                } else {
                  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
                }
              };
              dispatchDragEvent(el, 'dragover');
              dispatchDragEvent(el, 'drop');
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'submit': {
        // Отправка формы
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const form = document.querySelector(sel) as HTMLFormElement;
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const form = document.querySelector(sel) as HTMLFormElement;
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'reset': {
        // Сброс формы
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const form = document.querySelector(sel) as HTMLFormElement;
            if (form) {
              form.reset();
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const form = document.querySelector(sel) as HTMLFormElement;
            if (form) {
              form.reset();
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'open': {
        // Открытие dialog/details
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel);
            if (typeof HTMLDialogElement !== 'undefined' && el instanceof HTMLDialogElement) {
              el.showModal();
            } else if (el instanceof HTMLDetailsElement) {
              el.open = true;
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (typeof HTMLDialogElement !== 'undefined' && el instanceof HTMLDialogElement) {
              el.showModal();
            } else if (el instanceof HTMLDetailsElement) {
              el.open = true;
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'close': {
        // Закрытие dialog/details
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel);
            if (typeof HTMLDialogElement !== 'undefined' && el instanceof HTMLDialogElement) {
              el.close();
            } else if (el instanceof HTMLDetailsElement) {
              el.open = false;
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (typeof HTMLDialogElement !== 'undefined' && el instanceof HTMLDialogElement) {
              el.close();
            } else if (el instanceof HTMLDetailsElement) {
              el.open = false;
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'expand': {
        // Раскрытие details/aria-expanded
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              if (el instanceof HTMLDetailsElement) {
                el.open = true;
              } else if (el.hasAttribute('aria-expanded')) {
                el.setAttribute('aria-expanded', 'true');
              }
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              if (el instanceof HTMLDetailsElement) {
                el.open = true;
              } else if (el.hasAttribute('aria-expanded')) {
                el.setAttribute('aria-expanded', 'true');
              }
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'collapse': {
        // Сворачивание details/aria-expanded
        if (targetFrame) {
          await browser.evaluateInFrame(targetFrame, (sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              if (el instanceof HTMLDetailsElement) {
                el.open = false;
              } else if (el.hasAttribute('aria-expanded')) {
                el.setAttribute('aria-expanded', 'false');
              }
            }
          }, sessionId, selector);
        } else {
          await browser.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              if (el instanceof HTMLDetailsElement) {
                el.open = false;
              } else if (el.hasAttribute('aria-expanded')) {
                el.setAttribute('aria-expanded', 'false');
              }
            }
          }, sessionId, selector);
        }
        break;
      }

      case 'wait': {
        // Ожидание условия (селектор или "idle")
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for wait action (selector or "idle")',
          };
        }
        const timeout = args.timeout || 5000;
        const condition = args.value;
        
        if (condition === 'idle') {
          // Ожидание загрузки документа
          await page.waitForLoadState('domcontentloaded', { timeout });
        } else {
          // Ожидание появления элемента по CSS-селектору
          await page.waitForSelector(condition, { timeout, state: 'attached' });
        }
        break;
      }

      case 'go_back': {
        // Навигация назад в истории
        await page.goBack({ timeout: args.timeout || 5000 });
        break;
      }

      case 'go_forward': {
        // Навигация вперёд в истории
        await page.goForward({ timeout: args.timeout || 5000 });
        break;
      }

      case 'refresh': {
        // Перезагрузка страницы
        await page.reload({ timeout: args.timeout || 5000 });
        break;
      }

      case 'check':
      case 'uncheck': {
        // Check/uncheck для checkbox и radio элементов
        const shouldBeChecked = args.action === 'check';
        if (shouldBeChecked) {
          await target.locator(selector).check({ timeout: 1000 });
        } else {
          await target.locator(selector).uncheck({ timeout: 1000 });
        }
        break;
      }

      default:
        return {
          status: 'error',
          error: `Action ${args.action} is not yet implemented`,
        };
    }
    } catch (error) {
      // Если действие вызвало навигацию (например, press Enter на форме),
      // это не ошибка — просто фиксируем навигацию
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('Execution context was destroyed') || errorMsg.includes('navigation')) {
        actionError = error instanceof Error ? error : new Error(errorMsg);
      } else {
        // Другая ошибка — пробрасываем
        throw error;
      }
    }

    const result: ExecuteActionResult = {
      status: 'success',
      data: {
        action: args.action,
        target_id: args.target_id,
        success: true,
      },
    };

    // Возвращать состояние страницы только если return_state !== false
    // По умолчанию return_state=true (для экономии ходов агента)
    if (args.return_state !== false) {
      try {
        // Детекция навигации: если URL изменился или действие вызвало 'Execution context was destroyed'
        // Используем page.url() вместо browser.evaluate(), чтобы избежать 'Execution context was destroyed'
        const urlAfterAction = page.url();
        const navigationOccurred = urlAfterAction && urlAfterAction !== urlBeforeAction;
        const contextDestroyed = actionError && actionError.message.includes('Execution context was destroyed');
        
        if (navigationOccurred || contextDestroyed) {
          // Навигация произошла — ждём завершения загрузки новой страницы
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
            // Дополнительная задержка для стабилизации DOM
            await page.waitForTimeout(200);
          } catch (waitError) {
            console.warn('[vsl_execute_action] Navigation detected but waitForLoadState failed:', waitError);
          }
        } else {
          // Навигации не было — ждём стабилизации DOM
          try {
            await browser.evaluate(() => {
              return new Promise<void>((resolve) => {
                setTimeout(resolve, 100);
              });
            }, sessionId);
          } catch (evalError) {
            console.warn('[vsl_execute_action] DOM stabilization evaluate failed:', evalError);
          }
        }
        
        const currentUrl = urlAfterAction || urlBeforeAction;
        // Добавляем флаг навигации ДО state extraction, чтобы не потерялся при ошибке
        if ((navigationOccurred || contextDestroyed) && result.data) {
          result.data.navigated = true;
          result.data.newUrl = urlAfterAction;
        }
        try {
          const state = await getStateAfterAction(session, browser, currentUrl as string, sessionId);
          if (result.data) {
            result.data.state = state;
            if (state.error) {
              result.warning = `State extraction failed: ${state.error}`;
            }
          }
        } catch (stateError) {
          // Если получение состояния упало (например, из-за навигации), возвращаем warning
          result.warning = `State extraction failed: ${stateError instanceof Error ? stateError.message : String(stateError)}`;
        }
      } catch (stateError) {
        // Если получение состояния упало (например, из-за навигации), возвращаем warning
        result.warning = `State extraction failed: ${stateError instanceof Error ? stateError.message : String(stateError)}`;
        // Всё равно пытаемся определить навигацию через page.url()
        try {
          const urlAfterAction = page.url();
          if (urlAfterAction && urlAfterAction !== urlBeforeAction && result.data) {
            result.data.navigated = true;
            result.data.newUrl = urlAfterAction;
          }
        } catch {
          // Игнорируем ошибки при получении URL
        }
      }
    }

    result.metadata = computeToolMetrics(result.data, startTime);
    return result;
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_execute_action failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}