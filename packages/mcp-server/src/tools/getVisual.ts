/**
 * Tool: vsl_get_visual (T1.6.3).
 *
 * Получает visual fragment для элемента.
 * Возвращает MCP-compliant ImageContent (type: 'image', data: base64, mimeType).
 *
 * Flow:
 *  1. Валидация element_id
 *  2. Поиск элемента по ID через BrowserManager
 *  3. Скриншот элемента
 *  4. Конвертация в base64 PNG
 *  5. Возврат MCP ImageContent
 */

import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import { computeToolMetrics } from '../utils/metrics.js';
import { handleGetSnapshot } from './getSnapshot.js';

/** Аргументы vsl_get_visual. */
export interface GetVisualArgs {
  element_id: string;
  /**
   * Если true, автоматически обновляет snapshot перед поиском элемента.
   * Полезно после навигации или действий, которые изменяют DOM.
   * Default: false.
   */
  auto_refresh?: boolean;
  /**
   * Если true (default), автоматически прокручивает страницу к элементу,
   * если он находится вне текущего viewport. Полезно для извлечения
   * скриншотов элементов на длинных страницах.
   * Default: true.
   */
  auto_scroll?: boolean;
}

/** MCP-compliant результат vsl_get_visual. */
export interface GetVisualResult {
  /** MCP content array с image и/или text content blocks. */
  content: Array<
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'text'; text: string }
  >;
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
  /** Информация о выполненном автоскролле (если auto_scroll=true и элемент был вне viewport). */
  scroll_info?: {
    /** true если был выполнен автоскролл к элементу. */
    scrolled: boolean;
    /** Новый scroll offset страницы после скролла. */
    scroll_offset?: { x: number; y: number };
  };
}

/** MCP error result. */
export interface GetVisualErrorResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  /** Возможные причины ошибки (для улучшенной диагностики). */
  possible_causes?: string[];
  /** Предложения по исправлению. */
  suggestions?: string[];
}

/**
 * Обработчик vsl_get_visual.
 *
 * @param args - Аргументы инструмента
 * @param browser - Browser Manager
 */
export async function handleGetVisual(
  args: GetVisualArgs,
  browser: BrowserManager,
  session?: ServerSession,
  ): Promise<GetVisualResult | GetVisualErrorResult> {
  const startTime = Date.now();

  try {
    // 1. Валидация element_id
    if (!args.element_id || typeof args.element_id !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: element_id is required' }],
        isError: true,
      };
    }

    // Валидация auto_refresh (DEC-030)
    if (args.auto_refresh !== undefined && typeof args.auto_refresh !== 'boolean') {
      return {
        content: [{ type: 'text', text: 'Error: auto_refresh must be a boolean (true or false)' }],
        isError: true,
      };
    }

    // Валидация auto_scroll
    if (args.auto_scroll !== undefined && typeof args.auto_scroll !== 'boolean') {
      return {
        content: [{ type: 'text', text: 'Error: auto_scroll must be a boolean (true or false)' }],
        isError: true,
      };
    }

    // 2. Проверяем доступность браузера
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        content: [{ type: 'text', text: 'Error: Playwright is not installed. Install it with: npm install playwright' }],
        isError: true,
        possible_causes: ['Playwright не установлен'],
        suggestions: ['Run: npm install playwright', 'Or: npm install -g playwright'],
      };
    }

    // 3. Special case: root_0 — screenshot entire page
    if (args.element_id === 'root_0') {
      const page = await browser.getPage();
      const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
      const base64Image = screenshotBuffer.toString('base64');
      const result: GetVisualResult = {
        content: [
          { type: 'image', data: base64Image, mimeType: 'image/png' },
          { type: 'text', text: `Full page screenshot (${args.element_id})` },
        ],
        metadata: computeToolMetrics({ type: 'full_page', element_id: args.element_id }, startTime),
      };
      return result;
    }

    // 4. Ищем элемент и делаем скриншот
    //    Используем CSS selector для поиска элемента
    // Резолв короткого ID в длинный через idMap (rw4_action_integration)
    const idMap = session?.getIdMap() ?? new Map();
    const resolvedId = idMap.get(args.element_id) || args.element_id;
    const selector = `[data-vsl-id="${resolvedId}"], #${resolvedId}, [id="${resolvedId}"]`;

    // Проверяем, что элемент существует
    let elementExists = await browser.evaluate((sel: string) => {
      return document.querySelector(sel) !== null;
    }, selector);

    // Auto-refresh: если элемент не найден и auto_refresh=true, обновляем snapshot
    if (!elementExists && args.auto_refresh && session) {
      // Вызываем handleGetSnapshot для обновления DOM и data-vsl-id атрибутов
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handleGetSnapshot({}, browser, session, { downloadsPath: '' } as any);
      // Повторно проверяем наличие элемента
      elementExists = await browser.evaluate((sel: string) => {
        return document.querySelector(sel) !== null;
      }, selector);
    }

    if (!elementExists) {
      const suggestions = [
        'Call vsl_get_snapshot to refresh DOM IDs',
        'Use auto_refresh: true parameter to automatically refresh before search',
        'Element may have been removed from DOM after navigation or action',
        'DOM structure changed — IDs are index-based and may have shifted',
      ];
      return {
        content: [{ type: 'text', text: `Error: Element not found: ${args.element_id}. Note: vsl_get_visual works with IDs from vsl_get_snapshot (browser DOM), not vsl_read_page (semantic IDs).` }],
        isError: true,
        possible_causes: [
          'Snapshot is outdated — DOM changed after navigation or action',
          'Element was removed from DOM',
          'Using semantic ID from vsl_read_page instead of browser DOM ID from vsl_get_snapshot',
        ],
        suggestions,
      };
    }

    // Делаем скриншот элемента
    //    Playwright Page.screenshot() с clip для элемента
    const page = await browser.getPage();

    // Auto-scroll: проверяем видимость элемента и прокручиваем к нему если нужно
    // auto_scroll default = true (обратно-совместимо: старое поведение без скролла при auto_scroll: false)
    const autoScroll = args.auto_scroll !== false;
    let scrolled = false;
    let scrollOffset: { x: number; y: number } | undefined;

    if (autoScroll) {
      // Проверяем видимость элемента и скроллим если нужно
      const scrollResult = await browser.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return { needsScroll: false, scrolled: false };

        const rect = el.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Элемент виден если его bounding box полностью внутри viewport
        const isVisible = 
          rect.top >= 0 && 
          rect.left >= 0 && 
          rect.bottom <= viewportHeight && 
          rect.right <= viewportWidth;

        if (isVisible) {
          return { needsScroll: false, scrolled: false };
        }

        // Скроллим к элементу
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        return { needsScroll: true, scrolled: true };
      }, selector);

      if (scrollResult.scrolled) {
        scrolled = true;
        // Ждём завершения скролла (requestAnimationFrame x2 для надёжности)
        await browser.evaluate(() => {
          return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
        });
        // Получаем новый scroll offset
        scrollOffset = await browser.evaluate(() => {
          return { x: window.scrollX, y: window.scrollY };
        });
      }
    }

    // Получаем координаты элемента с учётом scroll offset
    const rect = await browser.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // Добавляем scroll offset для корректного clip
      return {
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        width: r.width,
        height: r.height
      };
    }, selector);

    if (!rect) {
      return {
        content: [{ type: 'text', text: `Error: Could not get bounding box for element: ${args.element_id}` }],
        isError: true,
      };
    }

    // Делаем скриншот с clip (координаты теперь относительно всей страницы)
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      clip: rect as { x: number; y: number; width: number; height: number },
    });

    // 5. Конвертация в base64
    const base64Image = screenshotBuffer.toString('base64');

    const metricsData = { type: 'element', element_id: args.element_id, width: rect.width, height: rect.height };
    const result: GetVisualResult = {
      content: [
        { type: 'image', data: base64Image, mimeType: 'image/png' },
        { type: 'text', text: `Screenshot of element: ${args.element_id}` },
      ],
      metadata: computeToolMetrics(metricsData, startTime),
    };

    // Добавляем scroll_info если был выполнен автоскролл
    if (scrolled) {
      result.scroll_info = {
        scrolled: true,
        scroll_offset: scrollOffset,
      };
    }

    return result;
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: vsl_get_visual failed: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}