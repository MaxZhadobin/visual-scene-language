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
}

/** Результат vsl_execute_action. */
export interface ExecuteActionResult {
  status: 'success' | 'error';
  data?: { action: string; target_id: string; success: boolean; download?: { downloadId: string; filename: string; url: string; status: 'pending' | 'completed' | 'cancelled' | 'failed' }; upload?: { selector: string; files: string[]; success: boolean } };
  error?: string;
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
          return {
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
        return {
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
      }

      default:
        return {
          status: 'error',
          error: `Action ${args.action} is not yet implemented`,
        };
    }

    return {
      status: 'success',
      data: {
        action: args.action,
        target_id: args.target_id,
        success: true,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_execute_action failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}