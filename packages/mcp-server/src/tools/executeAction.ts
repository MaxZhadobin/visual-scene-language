/**
 * Tool: vsl_execute_action (T1.6.3).
 *
 * Выполняет действие над элементом VSL.
 * Поддерживаемые действия: click, type, scroll, select, и др.
 *
 * Flow:
 *  1. Валидация аргументов (action, target_id)
 *  2. Проверка snapshot и доступности браузера
 *  3. Ленивая навигация: если браузер не на URL из snapshot → автоматически навигировать
 *  4. Поиск элемента по target_id в текущем snapshot
 *  5. Выполнение действия через BrowserManager
 *  6. Возврат результата
 *
 * Lazy Navigation (DEC-028):
 *  Если агент прочитал страницу через HTTP-путь (vsl_read_page без браузера),
 *  а затем вызывает vsl_execute_action, система автоматически запускает Playwright
 *  и переходит на URL из snapshot. Это позволяет выполнять действия на страницах,
 *  изначально прочитанных через HTTP-путь (быстрое чтение структуры).
 */

import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { SnapshotInput } from '@thinkingos/vsl-sdk';

import { computeToolMetrics } from '../utils/metrics.js';
import { extractDomTreeInBrowser } from './getSnapshot.js';

/** Поддерживаемые действия. */
const VALID_ACTIONS = [
  'click',
  'type',
  'fill', // alias for type — convenience for LLM agents
  'scroll',
  'select',
  'hover',
  'focus',
  'blur',
  'check',
  'uncheck',
  'press',
  'download',
  'upload',
] as const;

/** Аргументы vsl_execute_action. */
export interface ExecuteActionArgs {
  action: string;
  target_id: string;
  value?: string;
  /**
   * Если true, возвращает обновлённое состояние страницы (diff/snapshot) после действия.
   * Полезно для агентов, чтобы видеть изменения без отдельного вызова vsl_get_snapshot.
   * Default: true — всегда возвращать состояние для экономии ходов агента.
   */
  return_state?: boolean;
}
/** Результат vsl_execute_action. */
export interface ExecuteActionResult {

  status: 'success' | 'error';
  data?: {
    action: string;
    target_id: string;
    success: boolean;
    download?: { downloadId: string; filename: string; url: string; status: 'pending' | 'completed' | 'cancelled' | 'failed' };
    upload?: { selector: string; files: string[]; success: boolean };
    /** Обновлённое состояние страницы (если return_state=true). */
    state?: {
      /** Diff с момента предыдущего snapshot (добавленные/изменённые/удалённые элементы). */
      diff?: unknown;
      /** Полный snapshot (если был первый вызов или URL изменился). */
      snapshot?: unknown;
    };
  };
  error?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
}

/**
 * Получает обновлённое состояние страницы после действия.
 * Используется для return_state параметра.
 */
async function getStateAfterAction(
  session: ServerSession,
  browser: BrowserManager,
  url: string,
): Promise<{ diff?: unknown; snapshot?: unknown } | undefined> {
  try {
    // Извлечь обновлённый DOM
    const elements = await browser.evaluate(extractDomTreeInBrowser);
    // Получить viewport для SnapshotInput
    const viewport = await browser.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    // Обновить snapshot в сессии
    const input: SnapshotInput = {
      viewport: viewport as { width: number; height: number },
      url,
      title: '',
      timestamp: new Date().toISOString(),
    };
    session.snapshotFromElements(elements as unknown[], input);
    // Получить diff с момента предыдущего snapshot
    const diff = session.getDiff();
    // Получить полный snapshot
    const snapshot = session.getSnapshot();
    return { diff, snapshot };
  } catch (error) {
    // Если не удалось получить состояние, возвращаем undefined
    console.warn('Failed to get state after action:', error);
    return undefined;
  }
}

/**
 * Обработчик vsl_execute_action.
 *
 * @param args - Аргументы инструмента
 * @param browser - Browser Manager
 * @param session - Server Session
 */
export async function handleExecuteAction(
  args: ExecuteActionArgs,
  browser: BrowserManager,
  session: ServerSession,
): Promise<ExecuteActionResult> {
  const startTime = Date.now();

  try {
    // 1. Валидация аргументов
    if (!args.action || typeof args.action !== 'string') {
      return {
        status: 'error',
        error: 'action is required',
      };
    }

    if (!args.target_id || typeof args.target_id !== 'string') {
      return {
        status: 'error',
        error: 'target_id is required',
      };
    }

    // Проверяем, что действие валидно
    if (!VALID_ACTIONS.includes(args.action as (typeof VALID_ACTIONS)[number])) {
      return {
        status: 'error',
        error: `Unknown action: ${args.action}. Valid actions: ${VALID_ACTIONS.join(', ')}`,
      };
    }

    // Валидация return_state (DEC-030)
    if (args.return_state !== undefined && typeof args.return_state !== 'boolean') {
      return {
        status: 'error',
        error: 'return_state must be a boolean (true or false)',
      };
    }

    // Валидация value для scroll (DEC-030)
    if (args.action === 'scroll' && args.value !== undefined) {
      const VALID_SCROLL_VALUES = ['up', 'down'];
      if (!VALID_SCROLL_VALUES.includes(args.value)) {
        return {
          status: 'error',
          error: 'Invalid scroll value: ' + args.value + '. Valid values: ' + VALID_SCROLL_VALUES.join(', '),
        };
      }
    }

    // Валидация value для type/fill/select (DEC-030)
    if ((args.action === 'type' || args.action === 'fill' || args.action === 'select') && args.value !== undefined) {
      if (typeof args.value !== 'string') {
        return {
          status: 'error',
          error: 'value must be a string for ' + args.action + ' action',
        };
      }
    }

    // 2. Проверяем, что есть snapshot
    if (!session.hasSnapshot()) {
      return {
        status: 'error',
        error: 'No snapshot available. Call vsl_get_snapshot first.',
      };
    }

    // 3. Проверяем доступность браузера
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error: 'Playwright is not installed. Install it with: npm install playwright',
      };
    }

    // 4. Ленивая навигация: если браузер не на URL из snapshot → автоматически навигировать
    const snapshot = session.getSnapshot();
    const snapshotUrl = snapshot.canvas.url;
    
    if (snapshotUrl) {
      const currentUrl = await browser.evaluate(() => window.location.href);
      
      if (currentUrl !== snapshotUrl) {
        // Автоматическая навигация на URL из snapshot
        await browser.navigate(snapshotUrl);
      }
    }

    // 5. TODO: Найти элемент по target_id в VSL snapshot
    //    Сейчас используем target_id как CSS selector
    //    В будущем: маппинг VSL id → DOM selector через snapshot

    // Проверка наличия data-vsl-id атрибутов в DOM
    // Если атрибутов нет (например, после vsl_read_page без браузера),
    // автоматически создаём snapshot для инжекта data-vsl-id
    const hasVslIds = await browser.evaluate(() => {
      return document.querySelector('[data-vsl-id]') !== null;
    });

    if (!hasVslIds) {
      // Автоматическое создание snapshot
      const elements = await browser.evaluate(extractDomTreeInBrowser);
      const viewport = await browser.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      const input: SnapshotInput = {
        viewport: viewport as { width: number; height: number },
        url: snapshotUrl || '',
        title: '',
        timestamp: new Date().toISOString(),
      };
      session.snapshotFromElements(elements as unknown[], input);
    }

    const selector = `[data-vsl-id="${args.target_id}"], #${args.target_id}, .${args.target_id}`;

    // 5. Выполняем действие
    switch (args.action) {
      case 'click':
        await browser.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) (el as HTMLElement).click();
        }, selector);
        break;

      case 'fill':
      case 'type':
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for type action',
          };
        }
        await browser.evaluate(({ sel, val }: { sel: string; val: string }) => {
          const el = document.querySelector(sel) as HTMLInputElement;
          if (el) {
            el.value = val;
            // Dispatch input+change events for React compatibility (AC[2]):
            // React controlled components update only via events, not direct .value changes
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { sel: selector, val: args.value });
        break;

      case 'scroll':
        await browser.evaluate((val: string) => {
          if (val === 'down') {
            window.scrollBy(0, 500);
          } else if (val === 'up') {
            window.scrollBy(0, -500);
          }
        }, args.value || 'down');
        break;

      case 'select':
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for select action',
          };
        }
        await browser.evaluate(({ sel, val }: { sel: string; val: string }) => {
          const el = document.querySelector(sel) as HTMLSelectElement;
          if (el) el.value = val;
        }, { sel: selector, val: args.value });
        break;

      case 'hover':
        await browser.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) {
            const event = new MouseEvent('mouseover', { bubbles: true });
            el.dispatchEvent(event);
          }
        }, selector);
        break;

      case 'focus':
        await browser.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (el) el.focus();
        }, selector);
        break;

      case 'blur':
        await browser.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (el) el.blur();
        }, selector);
        break;

      case 'download': {
        // Гибридный подход: target_id — клик по элементу, value — прямое скачивание по URL
        if (args.value) {
          // Прямое скачивание по URL (target_id опционален для этого режима)
          const downloadId = await browser.evaluate((url: string) => {
            const a = document.createElement('a');
            a.href = url;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            const id = `download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            return id;
          }, args.value);
          const filename = args.value.split('/').pop() || 'download';
          const result: ExecuteActionResult = {
            status: 'success',
            data: {
              action: args.action,
              target_id: args.target_id,
              success: true,
              download: {
                downloadId,
                filename,
                url: args.value,
                status: 'pending',
              },
            },
          };

          // Добавить состояние страницы, если запрошено
          if (args.return_state !== false) {
            try {
              const currentUrl = await browser.evaluate(() => window.location.href);
              const state = await getStateAfterAction(session, browser, currentUrl as string);
              if (state && result.data) {
                result.data.state = state;
              }
            } catch {
              // Gracefully ignore getStateAfterAction errors
            }
          }

          result.metadata = computeToolMetrics(result.data, startTime);
          return result;
        }
        // Клик по элементу (кнопка/ссылка для скачивания)
        await browser.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) (el as HTMLElement).click();
        }, selector);
        break;
      }

      case 'upload': {
        // Загрузка файлов в <input type="file">
        // value содержит путь(и) к файлу(ам), разделённые запятой
        if (!args.value) {
          return {
            status: 'error',
            error: 'value is required for upload action (file path(s), comma-separated)',
          };
        }
        const filePaths = args.value.split(',').map(p => p.trim()).filter(Boolean);
        if (filePaths.length === 0) {
          return {
            status: 'error',
            error: 'value must contain at least one file path',
          };
        }
        await browser.uploadFile(selector, filePaths);
        const result: ExecuteActionResult = {
          status: 'success',
          data: {
            action: args.action,
            target_id: args.target_id,
            success: true,
            upload: {
              selector,
              files: filePaths,
              success: true,
            },
          },
        };

        // Добавить состояние страницы, если запрошено
        if (args.return_state !== false) {
          try {
            const currentUrl = await browser.evaluate(() => window.location.href);
            const state = await getStateAfterAction(session, browser, currentUrl as string);
            if (state && result.data) {
              result.data.state = state;
            }
          } catch {
            // Gracefully ignore getStateAfterAction errors
          }
        }

        result.metadata = computeToolMetrics(result.data, startTime);
        return result;
      }

      default:
        return {
          status: 'error',
          error: `Action ${args.action} is not yet implemented`,
        };
    }

    const result: ExecuteActionResult = {
      status: 'success',
      data: {
        action: args.action,
        target_id: args.target_id,
        success: true,
      },
    };

    // Всегда возвращать состояние страницы (return_state=true по умолчанию)
    try {
      const currentUrl = await browser.evaluate(() => window.location.href);
      const state = await getStateAfterAction(session, browser, currentUrl as string);
      if (state && result.data) {
        result.data.state = state;
      }
    } catch {
      // Gracefully ignore getStateAfterAction errors
    }

    result.metadata = computeToolMetrics(result.data, startTime);
    return result;
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_execute_action failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}