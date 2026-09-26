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
import { extractDomTreeInBrowser } from './getSnapshot.js';
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
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
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
    try {
      const elements = await browser.evaluate(extractDomTreeInBrowser);
      const viewport = await browser.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      const input: SnapshotInput = {
        viewport: viewport as { width: number; height: number },
        url: args.url,
        title: title as string,
        timestamp: new Date().toISOString(),
      };
      session.snapshotFromElements(elements as unknown[], input);
      snapshot = session.getSnapshot();
    } catch {
      // Snapshot extraction is best-effort
    }

    const data = {
      url: args.url,
      title: title as string,
      snapshot,
    };

    return {
      status: 'success',
      data,
      metadata: computeToolMetrics(data, startTime),
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_navigate failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}