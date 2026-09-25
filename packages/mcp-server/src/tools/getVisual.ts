/**
 * Tool: vsl_get_visual (T1.6.3).
 *
 * Получает visual fragment для элемента.
 * Возвращает base64 WebP изображение элемента.
 *
 * Flow:
 *  1. Валидация element_id
 *  2. Поиск элемента по ID через BrowserManager
 *  3. Скриншот элемента
 *  4. Конвертация в base64 WebP
 *  5. Возврат изображения
 */

import type { BrowserManager } from '../browser/manager.js';

/** Аргументы vsl_get_visual. */
export interface GetVisualArgs {
  element_id: string;
}

/** Результат vsl_get_visual. */
export interface GetVisualResult {
  status: 'success' | 'error';
  data?: {
    element_id: string;
    image: string; // base64
    mediaType: string;
  };
  error?: string;
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
): Promise<GetVisualResult> {
  try {
    // 1. Валидация element_id
    if (!args.element_id || typeof args.element_id !== 'string') {
      return {
        status: 'error',
        error: 'element_id is required',
      };
    }

    // 2. Проверяем доступность браузера
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error: 'Playwright is not installed. Install it with: npm install playwright',
      };
    }

    // 3. Ищем элемент и делаем скриншот
    //    Используем CSS selector для поиска элемента
    const selector = `[data-vsl-id="${args.element_id}"], #${args.element_id}, .${args.element_id}`;

    // Проверяем, что элемент существует
    const elementExists = await browser.evaluate((sel: string) => {
      return document.querySelector(sel) !== null;
    }, selector);

    if (!elementExists) {
      return {
        status: 'error',
        error: `Element not found: ${args.element_id}`,
      };
    }

    // 4. Делаем скриншот элемента
    //    Playwright Page.screenshot() с clip для элемента
    const page = await browser.getPage();

    // Получаем координаты элемента
    const rect = await browser.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);

    if (!rect) {
      return {
        status: 'error',
        error: `Could not get bounding box for element: ${args.element_id}`,
      };
    }

    // Делаем скриншот с clip
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      clip: rect as { x: number; y: number; width: number; height: number },
    });

    // 5. Конвертация в base64
    const base64Image = screenshotBuffer.toString('base64');

    return {
      status: 'success',
      data: {
        element_id: args.element_id,
        image: base64Image,
        mediaType: 'image/png',
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_visual failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}