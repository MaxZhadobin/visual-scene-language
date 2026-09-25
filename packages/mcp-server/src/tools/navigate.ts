/**
 * Tool: vsl_navigate (T1.6.3).
 *
 * Переходит по URL. Загружает новую страницу и возвращает успех/неудачу.
 *
 * Flow:
 *  1. Валидация URL
 *  2. Навигация через BrowserManager
 *  3. Возврат результата
 */

import type { BrowserManager } from '../browser/manager.js';

/** Аргументы vsl_navigate. */
export interface NavigateArgs {
  url: string;
}

/** Результат vsl_navigate. */
export interface NavigateResult {
  status: 'success' | 'error';
  data?: { url: string; title?: string };
  error?: string;
}

/**
 * Обработчик vsl_navigate.
 *
 * @param args - Аргументы инструмента (url обязателен)
 * @param browser - Browser Manager
 */
export async function handleNavigate(
  args: NavigateArgs,
  browser: BrowserManager,
): Promise<NavigateResult> {
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

    return {
      status: 'success',
      data: {
        url: args.url,
        title: title as string,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_navigate failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}