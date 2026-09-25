/**
 * Tool: vsl_download (T1.6.3, dev_10).
 *
 * Управляет скачиванием файлов через Playwright BrowserContext.
 * Поддерживает два режима:
 *  1. Клик по элементу (target_id) — инициирует download через Playwright
 *  2. Прямое скачивание по URL (value) — создаёт <a download> и кликает
 *
 * Flow:
 *  1. Валидация аргументов (target_id ИЛИ value)
 *  2. Проверка snapshot и доступности браузера
 *  3. Ленивая навигация: если браузер не на URL из snapshot → автоматически навигировать
 *  4. Инициация загрузки (клик или прямой URL)
 *  5. Ожидание завершения загрузки (waitForDownload)
 *  6. Возврат результата с downloadId, filename, url, status, path
 */

import path from 'node:path';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

/** Аргументы vsl_download. */
export interface DownloadArgs {
  /** ID элемента для клика (кнопка/ссылка для скачивания). */
  target_id?: string;
  /** URL для прямого скачивания. */
  value?: string;
  /** Таймаут ожидания загрузки в мс (по умолчанию из config). */
  timeout?: number;
  /** Путь для сохранения файла (опционально). */
  save_path?: string;
}

/** Результат vsl_download. */
export interface DownloadResult {
  status: 'success' | 'error';
  data?: {
    downloadId: string;
    filename: string;
    url: string;
    status: 'completed' | 'failed' | 'cancelled' | 'pending';
    path: string | null;
  };
  error?: string;
}

/**
 * Обработчик vsl_download.
 *
 * @param args - Аргументы инструмента
 * @param browser - Browser Manager
 * @param session - Server Session
 */
export async function handleDownload(
  args: DownloadArgs,
  browser: BrowserManager,
  session: ServerSession,
): Promise<DownloadResult> {
  try {
    // 1. Валидация аргументов: нужен либо target_id, либо value
    if (!args.target_id && !args.value) {
      return {
        status: 'error',
        error: 'Either target_id (element to click) or value (URL to download) is required',
      };
    }

    // 2. Проверяем, что есть snapshot (для target_id)
    if (args.target_id && !session.hasSnapshot()) {
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
    if (session.hasSnapshot()) {
      const snapshot = session.getSnapshot();
      const snapshotUrl = snapshot.canvas.url;
      
      if (snapshotUrl) {
        const currentUrl = await browser.evaluate(() => window.location.href);
        
        if (currentUrl !== snapshotUrl) {
          // Автоматическая навигация на URL из snapshot
          await browser.navigate(snapshotUrl);
        }
      }
    }

    // 5. Инициация загрузки
    let downloadUrl: string;
    
    if (args.value) {
      // Прямое скачивание по URL
      downloadUrl = args.value;
      await browser.evaluate((url: string) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, args.value);
    } else if (args.target_id) {
      // Клик по элементу (кнопка/ссылка для скачивания)
      const selector = `[data-vsl-id="${args.target_id}"], #${args.target_id}, .${args.target_id}`;
      
      // Получаем URL элемента (если это <a> с href) и кликаем для инициирования download
      downloadUrl = await browser.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLAnchorElement | HTMLButtonElement;
        if (el) {
          let url = '';
          if (el instanceof HTMLAnchorElement && el.href) {
            url = el.href;
          }
          // Кликаем по элементу для инициирования download event через Playwright
          el.click();
          return url;
        }
        return '';
      }, selector);
      
      // Если URL не получен из элемента, используем текущий URL страницы
      if (!downloadUrl) {
        downloadUrl = await browser.evaluate(() => window.location.href);
      }
    } else {
      return {
        status: 'error',
        error: 'Invalid arguments: provide either target_id or value',
      };
    }

    // 6. Ожидание завершения загрузки
    // Получаем список активных загрузок
    const downloads = browser.getDownloads();
    
    if (downloads.length === 0) {
      // Загрузка не была инициирована (возможно, элемент не существует или не вызывает download)
      return {
        status: 'error',
        error: 'Download was not initiated. Check if the element triggers a file download.',
      };
    }

    // Берём последнюю загрузку (самую новую)
    const latestDownload = downloads[downloads.length - 1];
    const downloadId = latestDownload.downloadId;

    // Ожидаем завершения загрузки
    const timeout = args.timeout;
    const result = await browser.waitForDownload(downloadId, timeout);

    // 7. Если указан save_path — сохраняем файл
    if (args.save_path && result.status === 'completed') {
      // Path traversal protection: validate save_path before saving
      const resolvedBase = path.resolve((await import('node:os')).homedir(), '.vsl', 'downloads');
      const resolvedSave = path.resolve(resolvedBase, args.save_path);
      if (!resolvedSave.startsWith(resolvedBase + path.sep) && resolvedSave !== resolvedBase) {
        return {
          status: 'error',
          error: `Path traversal detected: save_path '${args.save_path}' escapes downloads directory`,
        };
      }
      await browser.saveDownload(downloadId, args.save_path);
      result.path = args.save_path;
    }

    return {
      status: 'success',
      data: {
        downloadId: result.downloadId,
        filename: result.filename,
        url: result.url,
        status: result.status,
        path: result.path,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_download failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}