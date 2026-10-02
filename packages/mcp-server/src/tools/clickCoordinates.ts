/**
 * Tool: vsl_click_coordinates.
 *
 * Выполняет множественные клики по координатам относительно целевого элемента.
 * Поддерживает задержки между кликами.
 * Возвращает diff + snapshot + screenshot после всех кликов.
 *
 * Flow:
 *  1. Валидация аргументов (target_id, clicks)
 *  2. Проверка snapshot и доступности браузера
 *  3. Frame routing: определение целевого фрейма через iframeFrameRegistry
 *  4. Получение bounding box элемента (через snapshot rect или evaluate)
 *  5. Последовательное выполнение кликов по абсолютным координатам
 *  6. Возврат diff + snapshot (через getStateAfterAction) + screenshot
 */

import type { BrowserManager, PlaywrightFrame } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import { computeToolMetrics } from '../utils/metrics.js';
import { iframeFrameRegistry } from './getSnapshot.js';
import { getStateAfterAction } from './executeAction.js';

/** Единичный клик по координатам. */
export interface Click {
  /** X координата относительно левого верхнего угла элемента (pixels). */
  x: number;
  /** Y координата относительно левого верхнего угла элемента (pixels). */
  y: number;
  /** Опциональная задержка после клика (мс). */
  delay_after_ms?: number;
}

/** Аргументы vsl_click_coordinates. */
export interface ClickCoordinatesArgs {
  /** ID элемента (например, "iframe_2" для reCAPTCHA challenge iframe). */
  target_id: string;
  /** Массив кликов по координатам. */
  clicks: Click[];
  /**
   * Если true (default), возвращает diff + snapshot + screenshot после всех кликов.
   */
  return_state?: boolean;
}

/** Результат vsl_click_coordinates. */
export interface ClickCoordinatesResult {
  status: 'success' | 'error';
  data?: {
    actions_completed: number;
    /** Diff с момента предыдущего snapshot. */
    diff?: unknown;
    /** Обновлённый snapshot. */
    snapshot?: unknown;
    /** Скриншот после кликов (base64 PNG). */
    screenshot?: {
      type: 'image';
      data: string;
      mimeType: string;
    };
    /** Метаданные скролла. */
    scrollable?: unknown;
  };
  error?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: {
    json_size_bytes: number;
    estimated_tokens: number;
    execution_time_ms: number;
    timestamp: string;
  };
}

/**
 * Обработчик vsl_click_coordinates.
 *
 * @param args - Аргументы инструмента
 * @param browser - Browser Manager
 * @param session - Server Session
 */
export async function handleClickCoordinates(
  args: ClickCoordinatesArgs,
  browser: BrowserManager,
  session: ServerSession,
  sessionId: string,
): Promise<ClickCoordinatesResult> {
  const startTime = Date.now();

  try {
    // 1. Валидация аргументов
    if (!args.target_id || typeof args.target_id !== 'string') {
      return { status: 'error', error: 'target_id is required' };
    }
    if (!args.clicks || !Array.isArray(args.clicks) || args.clicks.length === 0) {
      return { status: 'error', error: 'clicks array is required and must not be empty' };
    }

    // Валидация каждого клика
    for (let i = 0; i <args.clicks.length; i++) {
      const click = args.clicks[i]!;
      if (typeof click.x !== 'number' || typeof click.y !== 'number') {
        return { status: 'error', error: `clicks[${i}]: x and y must be numbers` };
      }
      if (click.delay_after_ms !== undefined && typeof click.delay_after_ms !== 'number') {
        return { status: 'error', error: `clicks[${i}]: delay_after_ms must be a number` };
      }
    }

    // Валидация return_state
    if (args.return_state !== undefined && typeof args.return_state !== 'boolean') {
      return { status: 'error', error: 'return_state must be a boolean (true or false)' };
    }

    // 2. Проверка snapshot
    if (!session.hasSnapshot()) {
      return {
        status: 'error',
        error: 'No snapshot available. Call vsl_get_snapshot first.',
      };
    }

    // 3. Проверка доступности браузера
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error: 'Playwright is not installed. Install it with: npm install playwright',
      };
    }

    const page = await browser.getPage(sessionId);

    // 4. Frame routing: определяем целевой фрейм
    let targetFrame: PlaywrightFrame | null = null;
    const frameMatch = args.target_id.match(/^iframe_(\d+):(.+)$/);
    if (frameMatch) {
      const frameIndex = parseInt(frameMatch[1]!, 10);
      const frameUrl = iframeFrameRegistry.get(frameIndex);
      if (!frameUrl) {
        return {
          status: 'error',
          error: `Frame iframe_${frameIndex} not found in registry. Call vsl_get_snapshot first.`,
        };
      }
      const frames = await browser.getFrames(sessionId);
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

    // Резолв короткого ID — snapshot уже содержит короткие ID после replaceIdsInDocument,
    // Резолв короткого ID в длинный через idMap (shortId → longId).
    // session.getSnapshot() возвращает документ с длинными ID (оригинальными из SDK),
    // но агент передаёт короткий ID (например, 'a_0').
    // Используем idMap для преобразования короткого ID в длинный перед поиском.
    const idMap = session.getIdMap();
    const longId = idMap.get(args.target_id);
    if (!longId) {
      return {
        status: 'error',
        error: `Short ID "${args.target_id}" not found in idMap. Available short IDs: ${Array.from(idMap.keys()).join(', ')}`,
      };
    }

    const snapshotDoc = session.getSnapshot();
    const snapshotObjects = snapshotDoc.objects ?? [];

    // Рекурсивный поиск элемента по длинному ID в snapshot
    function findObjectById(objects: unknown[], targetId: string): unknown | null {
      for (const obj of objects) {
        const o = obj as { id?: string; p?: number[]; s?: number[]; ch?: unknown[] };
        if (o.id === targetId) return o;
        if (o.ch && Array.isArray(o.ch)) {
          const found = findObjectById(o.ch, targetId);
          if (found) return found;
        }
      }
      return null;
    }

    const snapshotObj = findObjectById(snapshotObjects, longId) as {
      p?: number[];
      s?: number[];
    } | null;

    if (!snapshotObj || !snapshotObj.p || !snapshotObj.s) {
      return {
        status: 'error',
        error: `Element "${args.target_id}" (resolved: ${longId}) not found in snapshot or has no position/size. Call vsl_get_snapshot first.`,
      };
    }
    
    // Конвертируем p (центр) и s (размер) в rect формат
    const elementRect = {
      x: snapshotObj.p![0]! - snapshotObj.s![0]! / 2,
      y: snapshotObj.p![1]! - snapshotObj.s![1]! / 2,
      width: snapshotObj.s![0]!,
      height: snapshotObj.s![1]!,
    };
    // 6. Выполняем множественные клики по координатам
    //    Координаты относительные к элементу → конвертируем в абсолютные
    //    Frame routing: используем targetFrame если задан, иначе main page
    //    ВАЖНО: используем реальный mouse.click() через CDP, а не программный element.click()
    //    Это критично для reCAPTCHA/hCaptcha, которые детектят программные клики.
    let actionsCompleted = 0;
    for (const click of args.clicks) {
      const absoluteX = elementRect.x + click.x;
      const absoluteY = elementRect.y + click.y;

      // Реальный клик мыши через Playwright CDP (Chrome DevTools Protocol)
      // Генерирует нативные mouse events: mousedown → mouseup → click
      // Для iframe используем page.mouse (mouse API доступен только на Page, не на Frame)
      await page.mouse.click(absoluteX, absoluteY);
      actionsCompleted++;

      // Задержка после клика (если указана)
      if (click.delay_after_ms && click.delay_after_ms > 0) {
        await page.waitForTimeout(click.delay_after_ms);
      }
    }

    // Ждём стабилизации DOM после последнего клика
    await page.waitForTimeout(100);

    // 7. Возвращаем состояние после кликов (если return_state=true)
    const returnState = args.return_state !== false; // default: true
    const result: ClickCoordinatesResult = {
      status: 'success',
      data: {
        actions_completed: actionsCompleted,
      },
      metadata: computeToolMetrics(
        { actions_completed: actionsCompleted, target_id: args.target_id },
        startTime,
      ),
    };

    if (returnState) {
      // Получаем diff + snapshot через общий хелпер
      const currentUrl = await browser.evaluate(() => window.location.href, sessionId);
      const state = await getStateAfterAction(session, browser, currentUrl as string, sessionId);

      if (state.error) {
        result.data!.diff = undefined;
        result.data!.snapshot = undefined;
      } else {
        result.data!.diff = state.diff;
        result.data!.snapshot = state.snapshot;
        result.data!.scrollable = state.scrollable;
      }

      // Делаем скриншот страницы после кликов
      try {
        const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
        const base64Image = screenshotBuffer.toString('base64');
        result.data!.screenshot = {
          type: 'image',
          data: base64Image,
          mimeType: 'image/png',
        };
      } catch (screenshotError) {
        console.error('[vsl_click_coordinates] Screenshot failed:', screenshotError);
        // Не блокируем результат из-за ошибки скриншота
      }
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_click_coordinates failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}