/**
 * Tool: vsl_get_snapshot (T1.6.3, M1.7).
 *
 * Извлекает VSL snapshot из текущей страницы браузера.
 *
 * Flow:
 *  1. Проверка доступности браузера
 *  2. Извлечение DOM-дерева через browser.evaluate(extractDomTreeInBrowser)
 *  3. Передача в ServerSession.snapshotFromElements() → SDK pipeline:
 *     segmentTree → buildVslDocument → cache → diff
 *  4. Запись data-vsl-id атрибутов в DOM для execute_action
 *  5. Возврат VSL JSON (полный документ или diff)
 */

import type { BrowserManager, PlaywrightFrame } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';
import type { VslDocument, VslObject, SnapshotInput, SnapshotResult } from '@thinkingos/vsl-sdk';
import { isVslDiff } from '@thinkingos/vsl-sdk';
import { injectVslIdsIntoDom, injectVslIdsIntoFrame, type SemanticMap, type SemanticAttributes } from '../utils/injectVslIds.js';
import { replaceIdsInDocument, replaceIdsInDiff } from '../utils/idMapper.js';
import { filterDiffByDetailLevel, filterObjectsByDetailLevel, type DetailLevel } from '../utils/detailLevelFilter.js';
import { computeScrollable, computeVisibleWindow, filterDiffByViewport, filterObjectsByViewport, type ScrollableInfo, type ScrollContext } from '../utils/viewportFilter.js';

/** TTL кэша snapshot по умолчанию (5 секунд). */
const DEFAULT_SNAPSHOT_TTL_MS = 5000;

/** Запись кэша snapshot. */
interface SnapshotCacheEntry {
  /** ПОЛНЫЙ документ (все объекты, без фильтрации) — фильтруется при отдаче (АС[5]). */
  fullDocument: VslDocument;
  /** Скролл-контекст на момент создания снапшота (для вьюпорт-фильтра из кэша). */
  scrollContext: ScrollContext | null;
  timestamp: number;
  url: string;
}

/** Кэш snapshot (ключ: URL; detail_level НЕ входит в ключ — фильтрация на отдаче, АС[5]). */
const snapshotCache = new Map<string, SnapshotCacheEntry>();

/**
 * Iframe frame registry: маппинг iframe_N → frame URL.
 * Заполняется при создании snapshot (getSnapshot) и используется executeAction
 * для URL-based frame matching вместо index-based (который ломается из-за
 * разного порядка querySelectorAll vs page.frames()).
 */
export const iframeFrameRegistry = new Map<number, string>();


/** Аргументы vsl_get_snapshot. */
export interface GetSnapshotArgs {
  url?: string;
  /**
   * Уровень детализации snapshot (default: 'medium').
   * - 'low': только интерактивные элементы (кнопки, ссылки, инпуты)
   * - 'medium': интерактивные + контейнеры
   * - 'high': все объекты (полный DOM)
   */
  detail_level?: DetailLevel;
  /**
   * TTL кэша в миллисекундах (default: 5000 = 5s).
   * Если snapshot был получен менее TTL назад, возвращается из кэша.
   * Установите 0 для отключения кэширования.
   */
  ttl?: number;
  /**
   * Полный режим: возвращает ПОЛНЫЙ документ, минуя вьюпорт-фильтр, детализацию
   * и дифф-фёрст логику (заменяет удалённый тул vsl_get_full_json).
   * Используйте при потере контекста, когда нужна полная картина страницы.
   */
  full?: boolean;
}

/** Результат vsl_get_snapshot. */
export interface GetSnapshotResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: SnapshotMetadata;
}

/** Метрики snapshot (DEC-029). */
export interface SnapshotMetadata {
  /** Размер JSON в байтах. */
  json_size_bytes: number;
  /** Приблизительное количество токенов (size / 4). */
  estimated_tokens: number;
  /** Количество объектов в snapshot (shown). */
  object_count: number;
  /** Общее количество объектов в полном документе (total). Формат shown/total. */
  total_objects_count?: number;
  /** Timestamp генерации snapshot (ISO 8601). */
  timestamp: string;
  /** Время выполнения в миллисекундах. */
  execution_time_ms: number;
  /** Метаданные скролла: есть ли контент сверху/снизу видимого окна (АС[3]). */
  scrollable?: ScrollableInfo;
  /** Warning для graceful degradation (defense-in-depth). */
  warning?: string;
}


/**
 * Рекурсивно подсчитывает количество объектов в дереве VSL.
 */
function countObjects(objects: VslObject[]): number {
  let count = 0;
  for (const obj of objects) {
    count++;
    if (obj.ch && obj.ch.length > 0) {
      count += countObjects(obj.ch);
    }
  }
  return count;
}

/**
 * Build semantic map from extracted elements for fallback selectors.
 * Maps indexPath (e.g., '0_2_1') to semantic attributes (role, aria-label, aria-labelledby).
 * Used by injectVslIds when indexPath navigation fails (reCAPTCHA, hCaptcha support).
 */
function buildSemanticMap(elements: unknown[]): SemanticMap {
  const map: SemanticMap = new Map();
  
  function visit(el: unknown): void {
    // Null/undefined check — защита от malformed элементов из DOM/сериализации
    if (!el || typeof el !== 'object') return;

    const elem = el as {
      indexPath?: number[];
      role?: string;
      ariaLabel?: string;
      ariaLabelledBy?: string;
      children?: unknown[];
    };
    
    if (!elem.indexPath) return;
    
    // Only store if at least one semantic attribute is present
    if (elem.role || elem.ariaLabel || elem.ariaLabelledBy) {
      const key = elem.indexPath.join('_');
      const semantic: SemanticAttributes = {};
      if (elem.role) semantic.role = elem.role;
      if (elem.ariaLabel) semantic.ariaLabel = elem.ariaLabel;
      if (elem.ariaLabelledBy) semantic.ariaLabelledBy = elem.ariaLabelledBy;
      map.set(key, semantic);
    }
    
    // Recurse into children
    if (elem.children && Array.isArray(elem.children)) {
      for (const child of elem.children) {
        // Null/undefined check для каждого ребёнка
        if (!child || typeof child !== 'object') continue;
        visit(child);
      }
    }
  }
  
  for (const el of elements) {
    visit(el);
  }
  
  return map;
}


/**
 * Извлекает DOM-дерево в формате ExtractedElement[] (SDK-совместимый).
 * Выполняется в браузерном контексте через Playwright evaluate().
 * Экспортируется для использования в других tools (executeAction с return_state).
 */
export function extractDomTreeInBrowser(): unknown[] {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // Интерфейсы (копия из SDK для типизации в browser context)
  interface Rect { x: number; y: number; width: number; height: number; }
  interface ElementCss {
    cursor?: string; position?: string; top?: string; bottom?: string;
    display?: string; gap?: string; fontWeight?: string; fontSize?: string;
    opacity?: string; pointerEvents?: string; overflow?: string; height?: string;
  }
  interface ExtractedElement {
    tag: string; indexPath: number[]; rect: Rect; text: string | null;
    attributes: Record<string, string>; css?: ElementCss; children: ExtractedElement[];
    // Semantic attributes for fallback selectors (reCAPTCHA, hCaptcha, dynamic iframes)
    role?: string;
    ariaLabel?: string;
    ariaLabelledBy?: string;
  }

  const NON_RENDERABLE_TAGS = new Set([
    'script', 'style', 'link', 'meta', 'noscript', 'template', 'head', 'title', 'base',
  ]);

  function viewOf(el: Element): Window | null {
    return el.ownerDocument.defaultView;
  }

  function isDisplayNone(el: Element): boolean {
    return viewOf(el)?.getComputedStyle(el).display === 'none';
  }

  function isVisibilityHidden(el: Element): boolean {
    return viewOf(el)?.getComputedStyle(el).visibility === 'hidden';
  }

  const TEXT_NODE_TYPE = 3;

  function ownText(el: Element): string {
    let raw = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === TEXT_NODE_TYPE) {
        raw += node.textContent ?? '';
      }
    }
    return raw.replace(/\s+/g, ' ').trim();
  }

  function extractAttributes(el: Element): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      attributes[attr.name] = attr.value;
    }
    return attributes;
  }

  const CSS_PROPERTIES: Array<[keyof ElementCss, string]> = [
    ['cursor', 'cursor'], ['position', 'position'], ['top', 'top'], ['bottom', 'bottom'],
    ['display', 'display'], ['gap', 'gap'], ['fontWeight', 'font-weight'],
    ['fontSize', 'font-size'], ['opacity', 'opacity'], ['pointerEvents', 'pointer-events'],
    ['overflow', 'overflow'], ['height', 'height'],
  ];

  function captureCss(el: Element): ElementCss {
    const view = viewOf(el);
    if (view === null) return {};
    const style = view.getComputedStyle(el);
    const css: ElementCss = {};
    for (const [key, property] of CSS_PROPERTIES) {
      const value = style.getPropertyValue(property);
      if (value !== '') css[key] = value;
    }
    return css;
  }

  function toRect(rect: DOMRect): Rect {
    // Абсолютные координаты страницы: компенсируем текущий скролл.
    // Кэш хранит страница-релятивные координаты, видимый прямоугольник
    // вычисляется на отдаче как [scroll, scroll+viewport] (единый пайплайн).
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }

  function hasZeroBox(rect: Rect): boolean {
    return rect.width <= 0 || rect.height <= 0;
  }

  function collectVisibleChildren(parent: Element, parentPath: readonly number[]): ExtractedElement[] {
    const result: ExtractedElement[] = [];
    Array.from(parent.children).forEach((child, index) => {
      const path = [...parentPath, index];
      const tag = child.tagName.toLowerCase();

      if (NON_RENDERABLE_TAGS.has(tag) || isDisplayNone(child)) {
        return;
      }

      const rect = toRect(child.getBoundingClientRect());

      if (isVisibilityHidden(child) || hasZeroBox(rect)) {
        result.push(...collectVisibleChildren(child, path));
        return;
      }

      const attributes = extractAttributes(child);
      const css = captureCss(child);

      // Skip aria-hidden elements (matches segmentTree behavior)
      if (attributes?.['aria-hidden'] === 'true') {
        return;
      }

      // Skip pointer-invisible elements (matches segmentTree behavior)
      if (css.opacity === '0' && css.pointerEvents === 'none') {
        return;
      }

      // Полный snapshot: offscreen элементы НЕ отсекаются при извлечении.
      // Фильтрация по viewport выполняется на этапе отдачи в LLM (единый пайплайн).

      const children = collectVisibleChildren(child, path);

      // Generate VSL ID from tag and indexPath, inject data-vsl-id directly into DOM
      const vslId = `${tag}_${path.join('_')}`;
      child.setAttribute('data-vsl-id', vslId);

      result.push({
        tag,
        indexPath: path,
        rect,
        text: ownText(child) || null,
        attributes,
        css,
        children,
        // Semantic attributes for fallback selectors
        role: attributes['role'],
        ariaLabel: attributes['aria-label'],
        ariaLabelledBy: attributes['aria-labelledby'],
      });
    });
    return result;
  }

  const body = document.body;
  if (!body) return [];
  const elements = collectVisibleChildren(body, []);

  // Возвращаем элементы (уже в абсолютных координатах) + метаданные страницы
  return [{
    __type: 'extraction_result',
    elements,
    viewport: { width: viewportWidth, height: viewportHeight },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      width: document.documentElement ? document.documentElement.scrollWidth : 0,
      height: document.documentElement ? document.documentElement.scrollHeight : 0,
    },
  }];
}

/**
 * Извлекает информацию обо всех iframe элементах на странице.
 * Выполняется в браузерном контексте через Playwright evaluate().
 * Возвращает массив объектов с URL и bounding rect каждого iframe.
 */
export function extractIframesInBrowser(): unknown[] {
  interface IframeInfo {
    url: string;
    rect: { x: number; y: number; width: number; height: number };
    name: string;
    id: string;
  }

  const iframes: IframeInfo[] = [];
  const iframeElements = document.querySelectorAll('iframe');

  for (const iframe of Array.from(iframeElements)) {
    const rect = iframe.getBoundingClientRect();
    // Пропускаем невидимые iframe (width/height = 0)
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    // Получаем URL iframe (может быть relative или absolute)
    let url = iframe.src || '';
    try {
      // Преобразуем relative URL в absolute
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        url = new URL(url, window.location.href).href;
      }
    } catch {
      // Если не удалось преобразовать — используем как есть
    }

    iframes.push({
      url,
      rect: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      name: iframe.name || '',
      id: iframe.id || '',
    });
  }

  return iframes;
}

/**
 * Извлекает DOM-дерево из конкретного iframe через Playwright frame API.
 * Использует browser.evaluateInFrame() для выполнения extractDomTreeInBrowser()
 * в контексте iframe (каждый iframe имеет свой window и document).
 * @param browser - Browser Manager
 * @param frame - Playwright Frame (из page.frames() или page.frame())
 * @returns DomExtractionResult с элементами, viewport и scroll iframe
 */
export async function extractDomTreeFromFrame(
  browser: BrowserManager,
  frame: PlaywrightFrame,
): Promise<DomExtractionResult> {
  const extractionResult = await browser.evaluateInFrame(
    frame as never,
    extractDomTreeInBrowser,
  ) as Array<{ __type: string } & DomExtractionResult>;

  const extraction = Array.isArray(extractionResult) ? extractionResult[0] : undefined;
  if (!extraction || !Array.isArray(extraction.elements)) {
    throw new Error('Failed to extract DOM tree from iframe: empty result');
  }
  return extraction;
}

/** Развёрнутый результат извлечения DOM в браузере. */
export interface DomExtractionResult {
  elements: unknown[];
  viewport: { width: number; height: number };
  scroll: { x: number; y: number; width: number; height: number };
}

/**
 * Извлекает DOM-дерево в браузере и РАЗВОРАЧИВАЕТ обёртку результата.
 *
 * Важные детали:
 *  - extractDomTreeInBrowser передаётся в evaluate НАПРЯМУЮ —
 *    стрелка-wrapper не сериализуется в браузерный контекст
 *    (внешняя функция там не определена).
 *  - Извлечение возвращает обёртку [{ __type, elements, viewport, scroll }].
 *    Потребители ОБЯЗАНЫ передавать в snapshotFromElements именно `elements`,
 *    иначе SDK segmentTree получит объект-обёртку без поля attributes и упадёт
 *    с "Cannot read properties of undefined (reading 'aria-hidden')".
 */
export async function extractDomTree(browser: BrowserManager, sessionId: string): Promise<DomExtractionResult> {
  const extractionResult = await browser.evaluate(
    extractDomTreeInBrowser,
    sessionId,
  ) as Array<{ __type: string } & DomExtractionResult>;

  const extraction = Array.isArray(extractionResult) ? extractionResult[0] : undefined;
  if (!extraction || !Array.isArray(extraction.elements)) {
    throw new Error('Failed to extract DOM tree: empty result');
  }

  // Валидация: фильтруем элементы без поля attributes (могут возникнуть
  // при ошибке сериализации через browser.evaluate() или edge cases в DOM).
  const invalidCount = countMalformedElements(extraction.elements);
  if (invalidCount > 0) {
    console.warn(`[VSL] Filtering ${invalidCount} malformed elements (missing attributes) from DOM extraction`);
    extraction.elements = filterMalformedElements(extraction.elements);
  }

  return extraction;
}

/**
 * Рекурсивно подсчитает элементы без поля attributes (для логирования).
 */
function countMalformedElements(elements: readonly unknown[]): number {
  let count = 0;
  for (const el of elements) {
    if (!el || typeof el !== 'object' || !('attributes' in (el as Record<string, unknown>))) {
      count++;
    }
    const children = (el as Record<string, unknown>)?.children;
    if (Array.isArray(children)) {
      count += countMalformedElements(children);
    }
  }
  return count;
}

/**
 * Рекурсивно фильтрует элементы без поля attributes.
 * Некорректные элементы пропускаются (graceful degradation).
 */
function filterMalformedElements(elements: readonly unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const el of elements) {
    if (!el || typeof el !== 'object' || !('attributes' in (el as Record<string, unknown>))) {
      continue;
    }
    const clean = { ...(el as Record<string, unknown>) };
    const children = clean.children;
    if (Array.isArray(children)) {
      clean.children = filterMalformedElements(children);
    }
    result.push(clean);
  }
  return result;
}

/**
 * Обработчик vsl_get_snapshot.
 *
 * Использует SDK pipeline через ServerSession.snapshotFromElements().
 * MCP сервер не вызывает segmentTree/buildVslDocument напрямую —
 * всю работу делает SDK.
 *
 * @param args - Аргументы инструмента (url опционально)
 * @param browser - Browser Manager
 * @param session - Server Session (обёртка над VslSnapshotSession из SDK)
 * @param _config - Конфигурация сервера
 */
export async function handleGetSnapshot(
  args: GetSnapshotArgs,
  browser: BrowserManager,
  session: ServerSession,
  _config: McpServerConfig,
  sessionId: string,
  ): Promise<GetSnapshotResult> {
  const startTime = Date.now();
  const detailLevel = args.detail_level || 'medium';
  const ttl = args.ttl ?? DEFAULT_SNAPSHOT_TTL_MS;

  // Валидация параметров (DEC-030)
  const VALID_DETAIL_LEVELS: DetailLevel[] = ['low', 'medium', 'high'];
  if (args.detail_level !== undefined && !VALID_DETAIL_LEVELS.includes(args.detail_level)) {
    return {
      status: 'error',
      error: 'Invalid detail_level: ' + args.detail_level + '. Valid values: ' + VALID_DETAIL_LEVELS.join(', '),
    };
  }

  if (args.ttl !== undefined && (typeof args.ttl !== 'number' || args.ttl < 0)) {
    return {
      status: 'error',
      error: 'Invalid ttl: ' + args.ttl + '. Must be a non-negative number (milliseconds).',
    };
  }

  try {
    // 0. Проверяем кэш snapshot (если TTL > 0).
    //    Кэш хранит ПОЛНЫЙ документ (ключ без detailLevel, АС[5]):
    //    повторный вызов с другой детализацией перефильтровывается
    //    из кэша через единый пайплайн БЕЗ обращения к браузеру.
    if (ttl > 0) {
      const cacheKey = args.url || 'current';
      const cached = snapshotCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) <ttl) {
        const scrollable = computeScrollable(cached.fullDocument.canvas.viewport, cached.scrollContext);
        // full=true — полный документ без вьюпорт/детализации фильтров (замена удалённого тула)
        const filteredObjects = args.full
          ? cached.fullDocument.objects
          : filterObjectsByDetailLevel(
              filterObjectsByViewport(
                cached.fullDocument.objects,
                computeVisibleWindow(cached.fullDocument.canvas.viewport, cached.scrollContext),
              ),
              detailLevel,
            );
        const filteredResult = { ...cached.fullDocument, objects: filteredObjects };

        const executionTimeMs = Date.now() - startTime;
        const resultJson = JSON.stringify(filteredResult);
        const jsonSizeBytes = Buffer.byteLength(resultJson, 'utf-8');
        const estimatedTokens = Math.ceil(jsonSizeBytes / 4);
        const objectCount = countObjects(filteredObjects);
        const totalObjectsCount = countObjects(cached.fullDocument.objects);

        return {
          status: 'success',
          data: filteredResult,
          metadata: {
            json_size_bytes: jsonSizeBytes,
            estimated_tokens: estimatedTokens,
            object_count: objectCount,
            total_objects_count: totalObjectsCount,
            timestamp: new Date().toISOString(),
            execution_time_ms: executionTimeMs,
            scrollable,
          },
        };
      }
    }

    // 1. Навигация по URL (если указан)
    if (args.url) {
      await browser.navigate(args.url, sessionId);
    }

    // 2. Проверяем, что браузер доступен
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error:
          'Playwright is not installed. Install it with: npm install playwright',
      };
    }

    // 3. Извлекаем полное DOM-дерево (без viewport culling).
    //    Общий хелпер передаёт функцию в evaluate напрямую и разворачивает
    //    обёртку результата (ошибка обработки — во внешнем try/catch).
    const extraction = await extractDomTree(browser, sessionId);
    const extractedElements = extraction.elements;
    const viewport = extraction.viewport;
    const url = args.url || (await browser.evaluate(() => window.location.href, sessionId)) as string;
    const title = await browser.evaluate(() => document.title, sessionId);

    // 3.1. Build semantic map for fallback selectors (reCAPTCHA, hCaptcha support)
    //    Maps indexPath → semantic attributes (role, aria-label, aria-labelledby)
    //    Used by injectVslIds when indexPath navigation fails
    //    Defense-in-depth: если buildSemanticMap падает — продолжаем без semantic map
    let semanticMap: SemanticMap = new Map();
    let snapshotWarning: string | undefined;
    try {
      semanticMap = buildSemanticMap(extractedElements);
    } catch (error) {
      const msg = `buildSemanticMap failed (graceful degradation): ${error instanceof Error ? error.message : String(error)}`;
      console.error('[VSL]', msg, error);
      snapshotWarning = msg;
    }

    // 3.5. Iframe support (M2.1): извлекаем iframe элементы и их DOM.
    //    Для каждого iframe создаём sub-VslDocument и добавляем как iframe-объект.
    //    Best-effort: если результат не массив (например, в тестах), пропускаем iframe extraction.
    const iframeElementsRaw = await browser.evaluate(extractIframesInBrowser, sessionId);
    const iframeElements = Array.isArray(iframeElementsRaw) ? iframeElementsRaw as Array<{
      url: string;
      rect: { x: number; y: number; width: number; height: number };
      name: string;
      id: string;
    }> : [];
    // Debug logging for iframe extraction
    if (iframeElements.length > 0) {
      console.error(`[VSL] Found ${iframeElements.length} iframe elements:`);
      for (const iframe of iframeElements) {
        console.error(`  - URL: ${iframe.url}, name: ${iframe.name}, id: ${iframe.id}`);
      }
    }

    // Собираем sub-VslDocuments для каждого iframe
    const iframeSubDocs: Array<{
      url: string;
      rect: { x: number; y: number; width: number; height: number };
      doc: VslDocument;
      frame: PlaywrightFrame;
    }> = [];
    for (const iframeInfo of iframeElements) {
      if (!iframeInfo.url) continue;
      try {
        // Находим Playwright frame по URL с partial match (URL может отличаться из-за редиректов/параметров)
        const allFrames = await browser.getFrames(sessionId);
        const frame = allFrames.find(f => {
          const frameUrl = f.url();
          return frameUrl === iframeInfo.url ||
                 frameUrl.includes(iframeInfo.url) ||
                 iframeInfo.url.includes(frameUrl);
        });
        if (!frame) {
          console.warn(`[VSL] No Playwright frame found for iframe URL: ${iframeInfo.url}`);
          console.error(`[VSL] Available frames:`, allFrames.map(f => f.url()));
          continue;
        }
        console.error(`[VSL] ✅ Matched Playwright frame for iframe: ${iframeInfo.url} → ${frame.url()}`);

        // Извлекаем DOM из iframe
        const iframeExtraction = await extractDomTreeFromFrame(browser, frame);
        const iframeViewport = iframeExtraction.viewport;

        // Создаём sub-VslDocument для iframe через SDK pipeline
        const { segmentTree, buildVslDocument } = await import('@thinkingos/vsl-sdk');
        const segmented = segmentTree(iframeExtraction.elements as never);
        const iframeDoc = buildVslDocument(segmented, {
          viewport: iframeViewport,
          timestamp: new Date().toISOString(),
          url: iframeInfo.url,
          title: `iframe: ${iframeInfo.name || iframeInfo.id || iframeInfo.url}`,
        });
        iframeSubDocs.push({
          url: iframeInfo.url,
          rect: iframeInfo.rect,
          doc: iframeDoc,
          frame, // сохраняем PlaywrightFrame для injectVslIdsIntoFrame
        });
        // Сохраняем маппинг iframe_N → frame URL для executeAction (URL-based matching)
        iframeFrameRegistry.set(iframeSubDocs.length - 1, iframeInfo.url);
        console.error(`[VSL] ✅ Successfully extracted DOM from iframe: ${iframeInfo.url} (${iframeDoc.objects.length} objects)`);
      } catch (error) {
        // Best-effort: ошибки iframe не блокируют основной snapshot
        console.warn(`[VSL] ❌ Failed to extract iframe ${iframeInfo.url}:`, error);
      }
    }

    // 5. Формируем SnapshotInput и передаём в SDK через ServerSession
    //    (scroll — метаданные скролла для единого пайплайна отдачи, АС[3])
    const input: SnapshotInput = {
      viewport: viewport as { width: number; height: number },
      url,
      title: title as string,
      timestamp: new Date().toISOString(),
      scroll: extraction.scroll,
    };

    // 6. SDK pipeline: segmentTree → buildVslDocument → cache → diff
    //    Первый вызов возвращает VslDocument, последующие — VslDiff.
    const result: SnapshotResult = session.snapshotFromElements(
      extractedElements as never,
      input,
    );

    // 7. Определяем текущий документ для записи VSL ID в DOM
    const currentDoc: VslDocument = isVslDiff(result)
      ? session.getSnapshot()
      : result;

    // 7.2. Iframe support (M2.1): добавляем iframe-объекты в основной документ.
    //    Каждый iframe представляется как VslObject с полем iframe: { url, frameId, vsl }.
    //    Координаты (p, s) берутся из rect iframe элемента в parent DOM.
    if (iframeSubDocs.length > 0) {
      console.error(`[VSL] Adding ${iframeSubDocs.length} iframe objects to snapshot`);
      const iframeObjects = iframeSubDocs.map((iframeInfo, index) => ({
        id: `iframe_${index}`,
        t: 'iframe' as const,
        p: [iframeInfo.rect.x, iframeInfo.rect.y] as [number, number],
        s: [iframeInfo.rect.width, iframeInfo.rect.height] as [number, number],
        iframe: {
          url: iframeInfo.url,
          frameId: index,
          vsl: iframeInfo.doc,
        },
      }));
      currentDoc.objects.push(...iframeObjects);
      // Перестраиваем reverseIdMap после добавления iframe объектов,
      // чтобы iframe элементы попали в карту для replaceIdsInDocument()
      session.rebuildIdMaps();
      // Inject data-vsl-id into each iframe's DOM for execute_action support (M2.1)
      for (const iframeInfo of iframeSubDocs) {
        await injectVslIdsIntoFrame(browser, iframeInfo.frame, iframeInfo.doc.objects, semanticMap);
      }
    }

    // 7.5. Inject data-vsl-id attributes into DOM for execute_action
    // Shared utility ensures consistent injection across getSnapshot, navigate, executeAction
    // Defense-in-depth: если injection падает — продолжаем без data-vsl-id (snapshot валиден)
    try {
      await injectVslIdsIntoDom(browser, currentDoc.objects, semanticMap, sessionId);
    } catch (error) {
      const msg = `injectVslIdsIntoDom failed (graceful degradation): ${error instanceof Error ? error.message : String(error)}`;
      console.error('[VSL]', msg, error);
      snapshotWarning = snapshotWarning ? `${snapshotWarning}; ${msg}` : msg;
    }
    // 9. Единый пайплайн отдачи (АС[3]): вьюпорт-фильтр по абсолютным
    //    координатам + скролл-контексту, затем detail_level (DEC-027).
    const scrollContext = session.getScrollContext();
    const win = computeVisibleWindow(currentDoc.canvas.viewport, scrollContext);
    const scrollable = computeScrollable(currentDoc.canvas.viewport, scrollContext);
    const viewportFiltered = filterObjectsByViewport(currentDoc.objects, win);
    const filteredObjects = args.full
      ? currentDoc.objects
      : filterObjectsByDetailLevel(viewportFiltered, detailLevel);

    // 10. Формируем результат: документ — с отфильтрованными объектами;
    //     дифф фильтруется по видимому окну отдельно (структура changes).
    //     Баг идентичных веток исправлен: дифф больше не получает objects документа.
    //     full=true обходит дифф-фёрст: отдаём полный документ целиком.
    const filteredResult: SnapshotResult = isVslDiff(result) && !args.full
      ? filterDiffByDetailLevel(
          filterDiffByViewport(result, currentDoc, session.getPreviousSnapshot(), win),
          currentDoc,
          detailLevel,
        )
      : { ...currentDoc, objects: filteredObjects };

    // 10.5. Заменяем длинные ID на короткие для выдачи LLM (rw3_output_integration)
    // Получаем обратную карту longId→shortId из сессии
    const reverseIdMap = session.getReverseIdMap();
    const finalResult: SnapshotResult = isVslDiff(filteredResult)
      ? replaceIdsInDiff(filteredResult, reverseIdMap)
      : replaceIdsInDocument(filteredResult as VslDocument, reverseIdMap);

    // 11. Вычисляем метрики (DEC-029)
    const executionTimeMs = Date.now() - startTime;
    const resultJson = JSON.stringify(finalResult);
    const jsonSizeBytes = Buffer.byteLength(resultJson, 'utf-8');
    const estimatedTokens = Math.ceil(jsonSizeBytes / 4);
    const objectCount = countObjects(filteredObjects);
    // shown/total: показано после пайплайна (вьюпорт + detail), total — полный документ
    const totalObjectsCount = countObjects(currentDoc.objects);

    const metadata: SnapshotMetadata = {
      json_size_bytes: jsonSizeBytes,
      estimated_tokens: estimatedTokens,
      object_count: objectCount,
      total_objects_count: totalObjectsCount,
      timestamp: new Date().toISOString(),
      execution_time_ms: executionTimeMs,
      scrollable,
      ...(snapshotWarning ? { warning: snapshotWarning } : {}),
    };

    // 12. Сохраняем ПОЛНЫЙ документ в кэш (если TTL > 0, АС[5]).
    //     Ключ без detailLevel: повторный вызов с другой детализацией
    //     перефильтруется из кэша без обращения к браузеру.
    if (ttl > 0) {
      const cacheKey = args.url || 'current';
      snapshotCache.set(cacheKey, {
        fullDocument: currentDoc,
        scrollContext: session.getScrollContext(),
        timestamp: Date.now(),
        url: args.url || 'current',
      });
    }

    return {
      status: 'success',
      data: finalResult,
      metadata,
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}