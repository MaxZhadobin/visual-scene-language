/**
 * Tool: vsl_read_page (T1.6.6, M1.6).
 *
 * Гибридное чтение веб-страниц с автоматической стратегией:
 * HTTP-first для статических страниц, автоматическое переключение на рендер для SPA.
 *
 * Flow:
 *  1. HTTP-first: extractViaHttp() — fetch HTML, проверка на SPA-маркеры
 *  2. Если SPA обнаружена — автоматическое переключение на рендер через BrowserManager
 *  3. Сохранение в ServerSession для диффов на повторных чтениях (оба пути)
 *  4. Возврат результата с метаданными (mode, hasDiff, etc.)
 *
 * Архитектура: HTTP-логика вынесена в httpExtractor.ts (M1.6, DEC-024).
 * Агент НЕ выбирает режим — нет параметра `mode` (DEC-024).
 */

import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';
import { computeToolMetrics } from '../utils/metrics.js';
import { extractViaHttp, detectSpa, applyReadableFilter, extractTextContent, extractTitle, countWords } from './httpExtractor.js';

/** Уровни детализации snapshot (DEC-027). */
export type DetailLevel = 'low' | 'medium' | 'high';

/** Аргументы vsl_read_page. */
export interface ReadPageArgs {
  url: string;
  readable?: boolean;
  /**
   * Уровень детализации snapshot (default: 'medium').
   * - 'low': только интерактивные элементы (кнопки, ссылки, инпуты)
   * - 'medium': интерактивные + контейнеры
   * - 'high': все объекты (полный DOM)
   */
  detail_level?: DetailLevel;
}

/** Результат vsl_read_page. */
export interface ReadPageResult {
  status: 'success' | 'error';
  data?: {
    url: string;
    mode: 'http' | 'render';
    content: string;
    vslDocument?: unknown;
    /** Полный snapshot страницы из session. */
    snapshot?: unknown;
    /** Diff с предыдущим snapshot (если был). */
    diff?: unknown;
    hasDiff: boolean;
    metadata: {
      title?: string;
      wordCount?: number;
      isSpa: boolean;
      readableApplied: boolean;
      /** Применённый уровень детализации snapshot. */
      detail_level?: DetailLevel;
      /** Размер VSL snapshot в байтах. */
      vsl_size_bytes?: number;
      /** Приблизительное количество токенов в VSL snapshot. */
      vsl_estimated_tokens?: number;
      /** Количество объектов в VSL snapshot. */
      vsl_object_count?: number;
    };
  };
  error?: string;
  /** Метрики производительности (DEC-029). */
  tool_metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
}

/**
 * Обработчик vsl_read_page.
 *
 * @param args - Аргументы инструмента (url, readable)
 * @param browser - Browser Manager
 * @param session - Server Session
 * @param config - Конфигурация сервера
 */
export async function handleReadPage(
  args: ReadPageArgs,
  browser: BrowserManager,
  session: ServerSession,
  _config: McpServerConfig,
): Promise<ReadPageResult> {
  const startTime = Date.now();

  // Валидация параметров (DEC-030)
  if (!args.url || typeof args.url !== 'string' || args.url.trim() === '') {
    return {
      status: 'error',
      error: 'url is required and must be a non-empty string',
    };
  }

  if (args.detail_level !== undefined && typeof args.detail_level !== 'string') {
    return {
      status: 'error',
      error: 'detail_level must be a string (low, medium, or high)',
    };
  }

  const validDetailLevels: DetailLevel[] = ['low', 'medium', 'high'];
  if (args.detail_level !== undefined && !validDetailLevels.includes(args.detail_level as DetailLevel)) {
    return {
      status: 'error',
      error: 'Invalid detail_level: ' + args.detail_level + '. Valid values: ' + validDetailLevels.join(', '),
    };
  }

  if (args.readable !== undefined && typeof args.readable !== 'boolean') {
    return {
      status: 'error',
      error: 'readable must be a boolean (true or false)',
    };
  }
  const detailLevel = (args.detail_level || 'medium') as DetailLevel;
  try {
    const readable = args.readable ?? false;

    // 1. HTTP-first: пытаемся получить контент через extractViaHttp
    let detectedMode: 'http' | 'render' = 'http';
    let httpResult: Awaited<ReturnType<typeof extractViaHttp>> | null = null;

    try {
      httpResult = await extractViaHttp(args.url, { readable });

      if (httpResult.isSpa) {
        // SPA обнаружена — переключаемся на render-режим
        detectedMode = 'render';
      }
    } catch {
      // При ошибке fetch — пробуем render
      detectedMode = 'render';
    }
    if (detectedMode === 'render') {
      const isAvailable = await browser.isAvailable();
      if (!isAvailable) {
        return {
          status: 'error',
          error:
            'Playwright is not installed. Install it with: npm install playwright\n' +
            'Static pages can still be read via HTTP path (no browser required).',
        };
      }

      // Навигация по URL
      await browser.navigate(args.url);

      // Извлечение HTML после рендера
      const html = await browser.getContent();

      // Проверка на SPA (после рендера — более точная)
      const isSpa = detectSpa(html);

      // Извлечение VSL-документа через evaluate()
      const vslDocument = await extractVslFromPage(browser);

      // Сохранение в session для диффов
      const hadPreviousSnapshot = session.hasSnapshot();
      session.setSnapshot(vslDocument as never);
      const hasDiff = hadPreviousSnapshot;

      // Readable-режим: фильтрация шума
      const readableHtml = readable ? applyReadableFilter(html) : html;
      const content = extractTextContent(readableHtml);

      // Получить snapshot и diff из session, применить фильтрацию по detail_level (DEC-027)
      const rawSnapshot = session.getSnapshot() as Record<string, unknown> | undefined;
      const rawDiff = hasDiff ? session.getDiff() : undefined;
      const fullSnapshot = rawSnapshot ? applyDetailLevelFilter(rawSnapshot, detailLevel) : undefined;
      const fullDiff = rawDiff ? applyDetailLevelFilter(rawDiff, detailLevel) : undefined;

      const data = {
        url: args.url,
        mode: 'render' as const,
        content,
        vslDocument,
        snapshot: fullSnapshot,
        diff: fullDiff,
        hasDiff,
        metadata: {
          title: extractTitle(html),
          wordCount: countWords(content),
          isSpa,
          readableApplied: readable,
          detail_level: detailLevel,
          ...computeVslMetrics(fullSnapshot),
        },
      };

      return {
        status: 'success',
        data,
        tool_metadata: computeToolMetrics(data, startTime),
      };
    }

    // 3. HTTP-режим: возврат результата из extractViaHttp
    if (!httpResult) {
      throw new Error('HTTP extraction failed unexpectedly');
    }

    // Сохранение VSL в session для диффов (аналогично render-пути)
    const hadPreviousSnapshot = session.hasSnapshot();
    session.setSnapshot(httpResult.vslDocument as never);
    const hasDiff = hadPreviousSnapshot;

    // Получить snapshot и diff из session, применить фильтрацию по detail_level (DEC-027)
    const rawSnapshot = session.getSnapshot() as Record<string, unknown> | undefined;
    const rawDiff = hasDiff ? session.getDiff() : undefined;
    const fullSnapshot = rawSnapshot ? applyDetailLevelFilter(rawSnapshot, detailLevel) : undefined;
    const fullDiff = rawDiff ? applyDetailLevelFilter(rawDiff, detailLevel) : undefined;

    const data = {
      url: args.url,
      mode: 'http' as const,
      content: httpResult.textContent,
      vslDocument: httpResult.vslDocument,
      snapshot: fullSnapshot,
      diff: fullDiff,
      hasDiff,
      metadata: {
        title: httpResult.title,
        wordCount: httpResult.wordCount,
        isSpa: httpResult.isSpa,
        readableApplied: httpResult.readableApplied,
        detail_level: detailLevel,
        ...computeVslMetrics(fullSnapshot),
      },
    };

    return {
      status: 'success',
      data,
      tool_metadata: computeToolMetrics(data, startTime),
    };
  } catch (error) {
    const stack = error instanceof Error ? error.stack : String(error);
    console.error('vsl_read_page error:', stack);
    return {
      status: 'error',
      error: `vsl_read_page failed: ${error instanceof Error ? error.message : String(error)}\nStack: ${stack}`,
    };
  }
}


/**
 * Извлекает VSL-документ из текущей страницы через evaluate().
 */
async function extractVslFromPage(browser: BrowserManager): Promise<unknown> {
  let domTree: Record<string, unknown> | null = null;
  
  try {
    domTree = await browser.evaluate(() => {
      const extractElement = (el: Element): Record<string, unknown> => {
        const rect = el.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(el);
        
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          text: el.textContent?.trim().substring(0, 100) || undefined,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          role: el.getAttribute('role') || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          ariaHidden: el.getAttribute('aria-hidden') || undefined,
          display: computedStyle.display,
          visibility: computedStyle.visibility,
          children: Array.from(el.children)
            .filter((child) => {
              const style = window.getComputedStyle(child);
              return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map(extractElement),
        };
      };
      
      return extractElement(document.documentElement);
    }) as Record<string, unknown> | null;
  } catch (error) {
    console.error('extractVslFromPage: browser.evaluate failed:', error);
    domTree = null;
  }
  
  // Fallback если domTree null или malformed
  if (!domTree || typeof domTree !== 'object') {
    domTree = {
      tag: 'html',
      rect: { x: 0, y: 0, width: 1280, height: 800 },
      children: [],
    };
  }
  
  // Безопасное извлечение viewport размеров
  const rect = domTree.rect as Record<string, number> | undefined;
  const viewportWidth = rect?.width ?? 1280;
  const viewportHeight = rect?.height ?? 800;
  
  // Построение VSL-документа (упрощённая версия, аналогично getSnapshot)
  return {
    vsl_version: '1.0.0',
    canvas: {
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
        unit: 'px',
      },
      background: '#ffffff',
      scale: 1,
      orientation: 'landscape',
      timestamp: new Date().toISOString(),
    },
    objects: [
      {
        id: 'root_0',
        t: 'container',
        p: [0, 0],
        s: [1280, 800],
        raw_dom: domTree,
      },
    ],
  };
}
/**
 * Применяет фильтрацию объектов VSL по уровню детализации (DEC-027).
 * - 'low': только интерактивные элементы (кнопки, ссылки, инпуты)
 * - 'medium': интерактивные + контейнеры
 * - 'high': все объекты (без фильтрации)
 */
function applyDetailLevelFilter(
  document: Record<string, unknown>,
  level: DetailLevel,
): Record<string, unknown> {
  if (level === 'high') return document;

  const objects = document.objects as Array<Record<string, unknown>> | undefined;
  if (!objects || !Array.isArray(objects)) return document;

  const INTERACTIVE_TYPES = new Set([
    'button', 'link', 'input', 'select', 'checkbox', 'radio',
    'textarea', 'file', 'submit', 'reset',
  ]);

  const CONTAINER_TYPES = new Set([
    'div', 'section', 'article', 'nav', 'header', 'footer',
    'main', 'aside', 'form', 'fieldset',
  ]);

  function filterRecursive(obj: Record<string, unknown>): Record<string, unknown> | null {
    const type = (obj.t || obj.type || '') as string;

    if (level === 'low') {
      // Только интерактивные элементы
      if (!INTERACTIVE_TYPES.has(type)) {
        // Проверяем детей — если есть интерактивные дети, возвращаем контейнер
        const children = obj.ch || obj.children;
        if (children && Array.isArray(children) && children.length > 0) {
          const filteredChildren = children
            .map(filterRecursive)
            .filter((child): child is Record<string, unknown> => child !== null);
          if (filteredChildren.length > 0) {
            return { ...obj, ch: filteredChildren };
          }
        }
        return null;
      }
      return obj;
    }

    if (level === 'medium') {
      // Интерактивные + контейнеры
      if (INTERACTIVE_TYPES.has(type) || CONTAINER_TYPES.has(type)) {
        const children = obj.ch || obj.children;
        if (children && Array.isArray(children) && children.length > 0) {
          const filteredChildren = children
            .map(filterRecursive)
            .filter((child): child is Record<string, unknown> => child !== null);
          return { ...obj, ch: filteredChildren };
        }
        return obj;
      }
      // Проверяем детей
      const children = obj.ch || obj.children;
      if (children && Array.isArray(children) && children.length > 0) {
        const filteredChildren = children
          .map(filterRecursive)
          .filter((child): child is Record<string, unknown> => child !== null);
        if (filteredChildren.length > 0) {
          return { ...obj, ch: filteredChildren };
        }
      }
      return null;
    }

    return obj;
  }

  const filteredObjects = objects
    .map(filterRecursive)
    .filter((obj): obj is Record<string, unknown> => obj !== null);

  return { ...document, objects: filteredObjects };
}

/**
 * Вычисляет метрики VSL snapshot для включения в ответ.
 */
function computeVslMetrics(snapshot: Record<string, unknown> | undefined): {
  vsl_size_bytes?: number;
  vsl_estimated_tokens?: number;
  vsl_object_count?: number;
} {
  if (!snapshot) return {};

  try {
    const jsonStr = JSON.stringify(snapshot);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf-8');
    const estimatedTokens = Math.ceil(sizeBytes / 4);

    // Подсчёт количества объектов
    const objects = snapshot.objects as Array<Record<string, unknown>> | undefined;
    let objectCount = 0;
    if (objects && Array.isArray(objects)) {
      function countRecursive(obj: Record<string, unknown>): number {
        let count = 1;
        const children = obj.ch || obj.children;
        if (children && Array.isArray(children)) {
          for (const child of children) {
            if (child && typeof child === 'object') {
              count += countRecursive(child as Record<string, unknown>);
            }
          }
        }
        return count;
      }
      for (const obj of objects) {
        objectCount += countRecursive(obj);
      }
    }

    return {
      vsl_size_bytes: sizeBytes,
      vsl_estimated_tokens: estimatedTokens,
      vsl_object_count: objectCount,
    };
  } catch {
    return {};
  }
}
