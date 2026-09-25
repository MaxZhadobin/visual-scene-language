/**
 * Tool: vsl_get_snapshot (T1.6.3).
 *
 * Получает текущий VSL snapshot страницы.
 * Если URL указан — переходит по нему, затем делает snapshot.
 * Если URL не указан — использует текущую страницу в браузере.
 *
 * Flow:
 *  1. Навигация по URL (если указан)
 *  2. Извлечение DOM-дерева через evaluate()
 *  3. Сегментация → VslDocument (через SDK)
 *  4. Сохранение в ServerSession
 *  5. Возврат VSL JSON
 */

import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';

/** Аргументы vsl_get_snapshot. */
export interface GetSnapshotArgs {
  url?: string;
}

/** Результат vsl_get_snapshot. */
export interface GetSnapshotResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

/**
 * Обработчик vsl_get_snapshot.
 *
 * @param args - Аргументы инструмента (url опционально)
 * @param browser - Browser Manager
 * @param session - Server Session
 * @param config - Конфигурация сервера
 */
export async function handleGetSnapshot(
  args: GetSnapshotArgs,
  browser: BrowserManager,
  session: ServerSession,
  _config: McpServerConfig,
): Promise<GetSnapshotResult> {
  try {
    // 1. Навигация по URL (если указан)
    if (args.url) {
      await browser.navigate(args.url);
    }

    // 2. Проверяем, что браузер доступен
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error:
          'Playwright is not installed. Install it with: npm install playwright\n' +
          'Or use vsl_read_page with mode="http" for static pages.',
      };
    }

    // 3. Извлекаем DOM-дерево через evaluate()
    //    Используем SDK: extractDomTree (запускается в контексте страницы)
    const domTree = await browser.evaluate(() => {
      // Эта функция выполняется в браузере
      // Возвращаем упрощённое DOM-дерево для VSL
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

    // 4. TODO: Вызвать SDK функции для сегментации и построения VslDocument
    //    extractDomTree → segmentTree → buildVslDocument
    //    Пока возвращаем сырое DOM-дерево как placeholder

    const vslDocument = {
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

    // 5. Сохраняем в ServerSession
    session.setSnapshot(vslDocument as never);

    return {
      status: 'success',
      data: vslDocument,
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}