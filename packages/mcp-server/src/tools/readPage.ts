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
import { extractViaHttp, detectSpa, applyReadableFilter, extractTextContent, extractTitle, countWords } from './httpExtractor.js';

/** Аргументы vsl_read_page. */
export interface ReadPageArgs {
  url: string;
  readable?: boolean;
}

/** Результат vsl_read_page. */
export interface ReadPageResult {
  status: 'success' | 'error';
  data?: {
    url: string;
    mode: 'http' | 'render';
    content: string;
    vslDocument?: unknown;
    hasDiff: boolean;
    metadata: {
      title?: string;
      wordCount?: number;
      isSpa: boolean;
      readableApplied: boolean;
    };
  };
  error?: string;
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

    // 2. Render-режим: рендер через браузер (если SPA или ошибка HTTP)
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

      return {
        status: 'success',
        data: {
          url: args.url,
          mode: 'render',
          content,
          vslDocument,
          hasDiff,
          metadata: {
            title: extractTitle(html),
            wordCount: countWords(content),
            isSpa,
            readableApplied: readable,
          },
        },
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

    return {
      status: 'success',
      data: {
        url: args.url,
        mode: 'http',
        content: httpResult.textContent,
        vslDocument: httpResult.vslDocument,
        hasDiff,
        metadata: {
          title: httpResult.title,
          wordCount: httpResult.wordCount,
          isSpa: httpResult.isSpa,
          readableApplied: httpResult.readableApplied,
        },
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_read_page failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}


/**
 * Извлекает VSL-документ из текущей страницы через evaluate().
 */
async function extractVslFromPage(browser: BrowserManager): Promise<unknown> {
  const domTree = await browser.evaluate(() => {
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
  });

  // Построение VSL-документа (упрощённая версия, аналогично getSnapshot)
  return {
    vsl_version: '1.0.0',
    canvas: {
      viewport: {
        width: (domTree as Record<string, unknown>).rect
          ? ((domTree as Record<string, unknown>).rect as Record<string, number>).width
          : 1280,
        height: (domTree as Record<string, unknown>).rect
          ? ((domTree as Record<string, unknown>).rect as Record<string, number>).height
          : 800,
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
