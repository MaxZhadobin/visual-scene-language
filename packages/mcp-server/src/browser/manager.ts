/**
 * Browser Manager — управление headless browser (Playwright).
 *
 * Playwright — optional peer dependency. Если не установлен,
 * tools, требующие браузер (vsl_get_snapshot, vsl_execute_action, etc.),
 * возвращают ошибку с инструкцией по установке.
 *
 * Lifecycle:
 *  - launch() — запуск браузера (lazy, при первом запросе)
 *  - getPage() — получение/создание страницы
 *  - close() — закрытие браузера
 */

import path from 'node:path';
import os from 'node:os';
import type { BrowserConfig } from '../config/loader.js';

/** Тип для Playwright Browser (динамический импорт). */
interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  newContext(options?: Record<string, unknown>): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

/** Тип для Playwright BrowserContext (динамический импорт). */
interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
  on(event: string, listener: (download: PlaywrightDownload) => void): void;
}

/** Тип для Playwright Download (динамический импорт). */
interface PlaywrightDownload {
  url(): string;
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
  cancel(): Promise<void>;
  failure(): Promise<string | null>;
  path(): Promise<string | null>;
}

/** Тип для Playwright Page (динамический импорт). */
interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  screenshot(options?: { type?: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
  close(): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<string[]>;
  $eval(selector: string, fn: string | ((el: Element) => unknown)): Promise<unknown>;
  context(): PlaywrightBrowserContext;
}

/** Тип для Playwright Chromium. */
interface PlaywrightChromium {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
}

/** Тип для Playwright module. */
interface PlaywrightModule {
  chromium: PlaywrightChromium;
}

/**
 * Browser Manager — обёртка над Playwright.
 * Lazy initialization: браузер запускается при первом запросе.
 */
export class BrowserManager {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightBrowserContext | null = null;
  private page: PlaywrightPage | null = null;
  private playwright: PlaywrightModule | null = null;
  private readonly config: BrowserConfig;
  /** Активные загрузки: downloadId -> PlaywrightDownload. */
  private readonly activeDownloads = new Map<string, PlaywrightDownload>();

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  /**
   * Загружает Playwright (динамический импорт).
   * Если Playwright не установлен, возвращает null.
   */
  private async loadPlaywright(): Promise<PlaywrightModule | null> {
    if (this.playwright) return this.playwright;

    try {
      // Динамический импорт — Playwright optional peer dependency
      const pw = await import('playwright');
      this.playwright = pw as unknown as PlaywrightModule;
      return this.playwright;
    } catch {
      return null;
    }
  }

  /**
   * Запускает браузер (lazy, при первом вызове).
   * Создаёт BrowserContext с настройками для download.
   * @throws Error если Playwright не установлен
   */
  async launch(): Promise<void> {
    if (this.browser) return;

    const pw = await this.loadPlaywright();
    if (!pw) {
      throw new Error(
        'Playwright is not installed. Install it with: npm install playwright\n' +
        'Or use vsl_read_page with mode="http" for static pages (no browser required).',
      );
    }

    this.browser = await pw.chromium.launch({
      headless: this.config.headless,
    });

    // Создаём BrowserContext с настройками для download
    const contextOptions: Record<string, unknown> = {
      acceptDownloads: this.config.acceptDownloads ?? true,
    };

    if (this.config.downloadsPath) {
      contextOptions.downloadsPath = this.config.downloadsPath;
    }

    this.context = await this.browser.newContext(contextOptions);
  }

  /**
   * Возвращает страницу (создаёт новую из context, если нет).
   * @throws Error если браузер не запущен
   */
  async getPage(): Promise<PlaywrightPage> {
    if (!this.browser) {
      await this.launch();
    }
    if (!this.browser || !this.context) {
      throw new Error('Browser not available');
    }

    if (!this.page) {
      this.page = await this.context.newPage();
      // Подписываемся на download events
      this.context.on('download', (download: PlaywrightDownload) => {
        const downloadId = `download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.activeDownloads.set(downloadId, download);
      });
    }

    return this.page;
  }

  /**
   * Переходит по URL.
   */
  async navigate(url: string): Promise<void> {
    const page = await this.getPage();
    await page.goto(url, {
      timeout: this.config.navigationTimeout,
      waitUntil: 'networkidle',
    });
  }

  /**
   * Получает HTML-контент текущей страницы.
   */
  async getContent(): Promise<string> {
    const page = await this.getPage();
    return page.content();
  }

  /**
   * Выполняет JavaScript в контексте страницы.
   */
  async evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    const page = await this.getPage();
    return page.evaluate(fn, ...args);
  }

  /**
   * Делает скриншот страницы.
   */
  async screenshot(options?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer> {
    const page = await this.getPage();
    return page.screenshot({ type: 'png', fullPage: options?.fullPage, clip: options?.clip });
  }

  /**
   * Проверяет, установлен ли Playwright.
   */
  async isAvailable(): Promise<boolean> {
    const pw = await this.loadPlaywright();
    return pw !== null;
  }

  /**
   * Ожидает завершения загрузки по downloadId.
   * @param downloadId - ID загрузки (из activeDownloads)
   * @param timeout - Таймаут в мс (по умолчанию из config.downloadTimeout)
   * @returns Информация о завершённой загрузке
   */
  async waitForDownload(downloadId: string, timeout?: number): Promise<{
    downloadId: string;
    filename: string;
    url: string;
    status: 'completed' | 'failed' | 'cancelled';
    path: string | null;
  }> {
    const download = this.activeDownloads.get(downloadId);
    if (!download) {
      throw new Error(`Download not found: ${downloadId}`);
    }

    const waitTimeout = timeout ?? this.config.downloadTimeout ?? 60000;

    try {
      // Ожидаем завершения загрузки
      await Promise.race([
        download.path(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Download timeout')), waitTimeout)
        ),
      ]);

      const failure = await download.failure();
      if (failure) {
        return {
          downloadId,
          filename: download.suggestedFilename(),
          url: download.url(),
          status: 'failed',
          path: null,
        };
      }

      const path = await download.path();
      return {
        downloadId,
        filename: download.suggestedFilename(),
        url: download.url(),
        status: 'completed',
        path,
      };
    } catch {
      return {
        downloadId,
        filename: download.suggestedFilename(),
        url: download.url(),
        status: 'failed',
        path: null,
      };
    }
  }

  /**
   * Возвращает список активных загрузок.
   */
  getDownloads(): Array<{ downloadId: string; filename: string; url: string }> {
    return Array.from(this.activeDownloads.entries()).map(([downloadId, download]) => ({
      downloadId,
      filename: download.suggestedFilename(),
      url: download.url(),
    }));
  }

  /**
   * Сохраняет загрузку в указанный путь.
   * @param downloadId - ID загрузки
   * @param savePath - Путь для сохранения
   */
  async saveDownload(downloadId: string, savePath: string): Promise<void> {
    const download = this.activeDownloads.get(downloadId);
    if (!download) {
      throw new Error(`Download not found: ${downloadId}`);
    }

    // Path traversal protection: resolve to absolute and check within downloadsPath
    const resolvedBase = path.resolve(this.config.downloadsPath.replace(/^~/, os.homedir()));
    const resolvedSave = path.resolve(resolvedBase, savePath);
    if (!resolvedSave.startsWith(resolvedBase + path.sep) && resolvedSave !== resolvedBase) {
      throw new Error(`Path traversal detected: save_path '${savePath}' escapes downloads directory '${resolvedBase}'`);
    }

    await download.saveAs(resolvedSave);
  }

  /**
   * Отменяет загрузку.
   * @param downloadId - ID загрузки
   */
  async cancelDownload(downloadId: string): Promise<void> {
    const download = this.activeDownloads.get(downloadId);
    if (!download) {
      throw new Error(`Download not found: ${downloadId}`);
    }
    await download.cancel();
    this.activeDownloads.delete(downloadId);
  }

  /**
   * Очищает завершённые загрузки из activeDownloads.
   */
  clearDownloads(): void {
    this.activeDownloads.clear();
  }

  /**
   * Закрывает браузер и очищает ресурсы.
   */
  async close(): Promise<void> {
    // Очищаем активные загрузки
    this.activeDownloads.clear();

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.page = null;
  }
}