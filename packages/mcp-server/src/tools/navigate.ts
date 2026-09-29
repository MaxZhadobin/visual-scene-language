/**
 * Tool: vsl_navigate (T1.6.3).
 *
 * Переходит по URL. Загружает новую страницу и возвращает snapshot.
 *
 * Flow:
 *  1. Валидация URL
 *  2. Навигация через BrowserManager
 *  3. Извлечение snapshot из новой страницы
 *  4. Возврат результата с snapshot
 */

import { computeToolMetrics } from '../utils/metrics.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import { extractDomTree } from './getSnapshot.js';
import { injectVslIdsIntoDom } from '../utils/injectVslIds.js';
import { replaceIdsInDocument } from '../utils/idMapper.js';
import { filterObjectsByDetailLevel } from '../utils/detailLevelFilter.js';
import { computeScrollable, computeVisibleWindow, filterObjectsByViewport, type ScrollableInfo } from '../utils/viewportFilter.js';
import type { SnapshotInput } from '@thinkingos/vsl-sdk';

/** Аргументы vsl_navigate. */
export interface NavigateArgs {
  url: string;
}

/** Результат vsl_navigate. */
export interface NavigateResult {
  status: 'success' | 'error';
  data?: { url: string; title?: string; snapshot?: unknown };
  error?: string;
  /** Предупреждение о проблемах при извлечении snapshot. */
  warning?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string; scrollable?: ScrollableInfo };
}

/**
 * Обработчик vsl_navigate.
 *
 * @param args - Аргументы инструмента (url обязателен)
 * @param browser - Browser Manager
 * @param session - Server Session для сохранения snapshot
 */
export async function handleNavigate(
  args: NavigateArgs,
  browser: BrowserManager,
  session: ServerSession,
): Promise<NavigateResult> {
  const startTime = Date.now();

  try {
    // 1. Валидация URL
    if (!args.url || typeof args.url !== 'string') {
      return {
        status: 'error',
        error: 'URL is required',
      };
    }

    // Проверяем, что URL валидный
    try {
      new URL(args.url);
    } catch {
      return {
        status: 'error',
        error: `Invalid URL: ${args.url}`,
      };
    }

    // 2. Проверяем доступность браузера
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error:
          'Playwright is not installed. Install it with: npm install playwright',
      };
    }

    // 3. Навигация
    await browser.navigate(args.url);

    // 4. Получаем title страницы
    const title = await browser.evaluate(() => document.title);

    // 5. Извлекаем snapshot новой страницы
    let snapshot: unknown;
    let snapshotWarning: string | undefined;
    let scrollableMeta: ScrollableInfo | undefined;
    try {
      // Общий хелпер: прямая передача функции в evaluate + РАЗВОРАЧИВАНИЕ
      // обёртки результата. Без разворачивания SDK segmentTree получает
      // объект без attributes и падает с "reading 'aria-hidden'".
      const extraction = await extractDomTree(browser);
      const input: SnapshotInput = {
        viewport: extraction.viewport,
        url: args.url,
        title: title as string,
        timestamp: new Date().toISOString(),
        scroll: extraction.scroll,
      };
      session.snapshotFromElements(extraction.elements, input);
      // Inject data-vsl-id attributes into DOM for execute_action
      const currentDoc = session.getSnapshot();
      await injectVslIdsIntoDom(browser, currentDoc.objects);
      // Единый пайплайн отдачи (АС[3]): вьюпорт-фильтр + дефолтный
      // detail_level 'medium' (у тула нет параметра детализации).
      const scrollContext = session.getScrollContext();
      const win = computeVisibleWindow(currentDoc.canvas.viewport, scrollContext);
      scrollableMeta = computeScrollable(currentDoc.canvas.viewport, scrollContext);
      const viewportFiltered = filterObjectsByViewport(currentDoc.objects, win);
      const filteredObjects = filterObjectsByDetailLevel(viewportFiltered, 'medium');
      // Заменяем длинные ID на короткие для выдачи LLM (rw3_output_integration)
      const reverseIdMap = session.getReverseIdMap();
      snapshot = replaceIdsInDocument({ ...currentDoc, objects: filteredObjects }, reverseIdMap);
    } catch (error) {
      // Snapshot extraction failed — log error and add warning
      const errorMessage = `Failed to extract snapshot: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[vsl_navigate]', errorMessage, error);
      snapshotWarning = errorMessage;
    }

    const data = {
      url: args.url,
      title: title as string,
      snapshot,
    };

    const result: NavigateResult = {
      status: 'success',
      data,
      metadata: { ...computeToolMetrics(data, startTime), scrollable: scrollableMeta },
    };

    // Add warning if snapshot extraction failed
    if (snapshotWarning) {
      result.warning = snapshotWarning;
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_navigate failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}