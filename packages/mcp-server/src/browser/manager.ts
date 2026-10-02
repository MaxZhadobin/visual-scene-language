/**
 * Browser Manager — управление headless browser (Playwright).
 *
 * Playwright — optional peer dependency. Если не установлен,
 * tools, требующие браузер (vsl_get_snapshot, vsl_execute_action, etc.),
 * возвращают ошибку с инструкцией по установке.
 *
 * Lifecycle:
 *  - launch() — запуск браузера (lazy, при первом запросе)
 *  - getPage(sessionId) — получение/создание страницы для сессии
 *  - close() — закрытие браузера
 */

import path from 'node:path';
import os from 'node:os';
import type { BrowserConfig } from '../config/loader.js';

/** Тип для Playwright Browser (динамический импорт). */
interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  newContext(options?: Record<string, unknown>): Promise<PlaywrightBrowserContext>;
  contexts(): PlaywrightBrowserContext[];
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

/** Тип для Playwright FileChooser (динамический импорт). */
interface PlaywrightFileChooser {
  setFiles(files: string | string[]): Promise<void>;
}

/** Тип для Playwright Frame (динамический импорт). */
export interface PlaywrightFrame {
  url(): string;
  name(): string;
  parentFrame(): PlaywrightFrame | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
  locator(selector: string): PlaywrightLocator;
}

/** Тип для Playwright Locator (динамический импорт). */
interface PlaywrightLocator {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  selectOption(value: string, options?: { timeout?: number }): Promise<string[]>;
  setInputFiles(files: string | string[], options?: { timeout?: number }): Promise<void>;
  count(): Promise<number>;
  check(options?: { timeout?: number }): Promise<void>;
  uncheck(options?: { timeout?: number }): Promise<void>;
}

/** Тип для Playwright Page (динамический импорт). */
interface PlaywrightPage {
  url(): string;
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
  screenshot(options?: { type?: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
  close(): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number; state?: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state?: string, options?: { timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  keyboard: { press(key: string, options?: { delay?: number }): Promise<void> };
  mouse: { click(x: number, y: number, options?: { delay?: number }): Promise<void>; move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> };
  selectOption(selector: string, value: string): Promise<string[]>;
  setInputFiles(selector: string, files: string | string[]): Promise<void>;
  waitForEvent(event: string, optionsOrPredicate?: { timeout?: number } | ((arg: unknown) => boolean)): Promise<PlaywrightFileChooser>;
  $eval(selector: string, fn: string | ((el: Element) => unknown)): Promise<unknown>;
  context(): PlaywrightBrowserContext;
  frames(): PlaywrightFrame[];
  frame(urlOrName: string | RegExp): PlaywrightFrame | null;
  locator(selector: string): PlaywrightLocator;
  goBack(options?: { timeout?: number }): Promise<void>;
  goForward(options?: { timeout?: number }): Promise<void>;
  reload(options?: { timeout?: number }): Promise<void>;
}

/** Тип для Playwright Chromium. */
interface PlaywrightChromium {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  connectOverCDP(options?: { endpointURL: string }): Promise<PlaywrightBrowser>;
  launchPersistentContext(userDataDir: string, options?: Record<string, unknown>): Promise<PlaywrightBrowserContext>;
}

/** Тип для Playwright module. */
interface PlaywrightModule {
  chromium: PlaywrightChromium;
}

/**
 * Browser Manager — обёртка над Playwright.
 * Lazy initialization: браузер запускается при первом запросе.
 * Управляет несколькими страницами (по одной для каждой сессии).
 */
export class BrowserManager {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightBrowserContext | null = null;
  private pages: Map<string, PlaywrightPage> = new Map();
  private playwright: PlaywrightModule | null = null;
  private readonly config: BrowserConfig;
  /** Флаг: браузер подключён через CDP (не закрывать при close()). */
  private connectedViaCDP: boolean = false;
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
      // Динамический импорт playwright-extra с stealth plugin
      const pwExtra = await import('playwright-extra');
      const stealthModule = await import('puppeteer-extra-plugin-stealth');
      const stealth = stealthModule.default ?? stealthModule;

      // Применяем stealth plugin к chromium
      const chromium = pwExtra.chromium;
      chromium.use(stealth());

      this.playwright = { chromium } as unknown as PlaywrightModule;
      return this.playwright;
    } catch {
      // Fallback на обычный playwright если playwright-extra не установлен
      try {
        const pw = await import('playwright');
        this.playwright = pw as unknown as PlaywrightModule;
        return this.playwright;
      } catch {
        return null;
      }
    }
  }

  /**
   * Запускает браузер (lazy, при первом вызове).
   * Логика для множественных агентов:
   * 1. Если cdpPort задан → пробуем connectOverCDP (подключиться к уже запущенному браузеру)
   * 2. Если connectOverCDP упал (браузер не запущен) → запускаем launchPersistentContext с --remote-debugging-port
   * 3. Если cdpPort НЕ задан → просто launchPersistentContext без CDP
   * @throws Error если Playwright не установлен
   */
  async launch(): Promise<void> {
    // Проверка: уже запущен
    if (this.browser || this.context) return;

    const pw = await this.loadPlaywright();
    if (!pw) {
      throw new Error(
        'Playwright is not installed. Install it with: npm install playwright',
      );
    }

    // Если cdpPort задан → сначала пробуем подключиться к уже запущенному браузеру
    if (this.config.cdpPort) {
      try {
        this.browser = await pw.chromium.connectOverCDP({
          endpointURL: `http://localhost:${this.config.cdpPort}`,
        });
        this.connectedViaCDP = true;

        // Получить существующий context из CDP браузера
        const contexts = this.browser.contexts();
        if (contexts.length > 0 && contexts[0]) {
          this.context = contexts[0];
        } else {
          const contextOptions: Record<string, unknown> = {
            acceptDownloads: this.config.acceptDownloads ?? true,
          };
          if (this.config.downloadsPath) {
            contextOptions.downloadsPath = this.config.downloadsPath;
          }
          this.context = await this.browser.newContext(contextOptions);
        }
        return;
      } catch {
        // Браузер не запущен → перейдём к launchPersistentContext ниже
      }
    }

    // Запускаем persistent context
    const userDataDir = this.config.userDataDir ?? path.join(os.homedir(), '.vsl', 'browser-profile');
    const persistentOptions: Record<string, unknown> = {
      headless: this.config.headless,
      acceptDownloads: this.config.acceptDownloads ?? true,
    };
    if (this.config.downloadsPath) {
      persistentOptions.downloadsPath = this.config.downloadsPath;
    }

    // Если cdpPort задан → добавляем --remote-debugging-port для подключения последующих агентов
    if (this.config.cdpPort) {
      persistentOptions.args = [`--remote-debugging-port=${this.config.cdpPort}`];
    }

    this.context = await pw.chromium.launchPersistentContext(
      userDataDir,
      persistentOptions,
    );
    // Для persistent context browser объект не нужен — context уже создан
    this.browser = null;
  }

  /**
   * Возвращает страницу для указанной сессии (создаёт новую из context, если нет).
   * @param sessionId - ID сессии для изоляции страниц
   * @throws Error если браузер не запущен
   */
  async getPage(sessionId: string): Promise<PlaywrightPage> {
    // Для persistent context browser может быть null, но context уже создан
    if (!this.browser && !this.context) {
      await this.launch();
    }
    if (!this.context) {
      throw new Error('Browser not available');
    }

    let page = this.pages.get(sessionId);
    if (!page) {
      page = await this.context.newPage();
      this.pages.set(sessionId, page);
      // Подписываемся на download events для каждой новой страницы
      this.context.on('download', (download: PlaywrightDownload) => {
        const downloadId = `download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.activeDownloads.set(downloadId, download);
      });
    }

    return page;
  }

  /**
   * Переходит по URL.
   * @param url - URL для навигации
   * @param sessionId - ID сессии для получения правильной страницы
   */
  async navigate(url: string, sessionId: string): Promise<void> {
    const page = await this.getPage(sessionId);
    await page.goto(url, {
      timeout: this.config.navigationTimeout,
      waitUntil: 'domcontentloaded',
    });
  }

  /**
   * Получает HTML-контент текущей страницы.
   * @param sessionId - ID сессии
   */
  async getContent(sessionId: string): Promise<string> {
    const page = await this.getPage(sessionId);
    return page.content();
  }

  /**
   * Возвращает все фреймы на странице (включая iframe).
   * @param sessionId - ID сессии
   */
  async getFrames(sessionId: string): Promise<PlaywrightFrame[]> {
    const page = await this.getPage(sessionId);
    return page.frames();
  }

  /**
   * Находит фрейм по URL или имени.
   * @param urlOrName - URL или имя фрейма
   * @param sessionId - ID сессии
   */
  async getFrame(urlOrName: string | RegExp, sessionId: string): Promise<PlaywrightFrame | null> {
    const page = await this.getPage(sessionId);
    return page.frame(urlOrName);
  }

  /**
   * Выполняет JavaScript в контексте конкретного фрейма.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluateInFrame<T>(frame: PlaywrightFrame, fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T> {
    return frame.evaluate(fn, ...args);
  }

  /**
   * Возвращает Playwright Locator для элемента в фрейме.
   */
  async locatorInFrame(frame: PlaywrightFrame, selector: string): Promise<PlaywrightLocator> {
    return frame.locator(selector);
  }

  /**
   * Выполняет JavaScript в контексте страницы.
   * @param fn - Функция или строка кода для выполнения
   * @param sessionId - ID сессии
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate<T>(fn: string | ((...args: any[]) => T), sessionId: string, ...args: any[]): Promise<T> {
    const page = await this.getPage(sessionId);
    return page.evaluate(fn, ...args);
  }

  /**
   * Делает скриншот страницы.
   * @param options - Опции скриншота
   * @param sessionId - ID сессии (опционально, по умолчанию 'default')
   */
  async screenshot(options?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }, sessionId?: string): Promise<Buffer> {
    const page = await this.getPage(sessionId ?? 'default');
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

    // Для абсолютных путей — используем напрямую (пользователь явно указал путь)
    // Для относительных путей — разрешаем относительно downloadsPath с path traversal проверкой
    const isAbsolute = savePath.startsWith('/');
    if (isAbsolute) {
      await download.saveAs(savePath);
    } else {
      const downloadsPath = this.config.downloadsPath ?? os.tmpdir();
      const resolvedBase = path.resolve(downloadsPath.replace(/^~/, os.homedir()));
      const resolvedSave = path.resolve(resolvedBase, savePath);
      if (!resolvedSave.startsWith(resolvedBase + path.sep) && resolvedSave !== resolvedBase) {
        throw new Error(`Path traversal detected: save_path '${savePath}' escapes downloads directory '${resolvedBase}'`);
      }
      await download.saveAs(resolvedSave);
    }
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
   * Загружает файлы в <input type="file"> по CSS-селектору.
   * Использует Playwright page.setInputFiles().
   * Валидирует пути: абсолютные используются напрямую, относительные разрешаются
   * относительно CWD с path traversal проверкой.
   * @param selector - CSS-селектор input[type=file] элемента
   * @param filePaths - Массив путей к файлам (абсолютные или относительные)
   * @param sessionId - ID сессии
   * @throws Error если путь выходит за допустимые границы или файл не существует
   */
  async uploadFile(selector: string, filePaths: string[], sessionId: string): Promise<void> {
    const page = await this.getPage(sessionId);
    if (filePaths.length === 0) {
      throw new Error('filePaths must contain at least one file path');
    }

    // Валидация и разрешение путей
    const resolvedPaths: string[] = [];
    for (const filePath of filePaths) {
      const isAbsolute = path.isAbsolute(filePath);
      if (isAbsolute) {
        // Абсолютные пути — используем напрямую (пользователь явно указал)
        resolvedPaths.push(filePath);
      } else {
        // Относительные пути — разрешаем относительно CWD
        const resolved = path.resolve(process.cwd(), filePath);
        // Path traversal: проверяем что путь не выходит за CWD
        const cwd = path.resolve(process.cwd());
        if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
          throw new Error(`Path traversal detected: file path '${filePath}' resolves outside working directory '${cwd}'`);
        }
        resolvedPaths.push(resolved);
      }
    }

    // Устанавливаем файлы через Playwright
    await page.setInputFiles(selector, resolvedPaths.length === 1 ? resolvedPaths[0]! : resolvedPaths);
  }

  /**
   * Ожидает появления file chooser dialog (для кастомных file picker'ов).
   * Возвращает FileChooser, через который можно установить файлы.
   * @param sessionId - ID сессии
   * @param timeout - Таймаут ожидания в мс (по умолчанию из config.downloadTimeout)
   * @returns PlaywrightFileChooser для установки файлов
   */
  async waitForFileChooser(sessionId: string, timeout?: number): Promise<PlaywrightFileChooser> {
    const page = await this.getPage(sessionId);
    const waitTimeout = timeout ?? this.config.downloadTimeout ?? 60000;
    const fileChooser = await page.waitForEvent('filechooser', { timeout: waitTimeout });
    return fileChooser;
  }

  /**
   * Закрывает браузер и очищает ресурсы.
   * Если браузер подключён через CDP — закрывает только context,
   * сам браузер не закрывается (сохраняет сессию пользователя).
   */
  async close(): Promise<void> {
    // Очищаем активные загрузки
    this.activeDownloads.clear();

    // Закрываем все страницы
    for (const page of this.pages.values()) {
      try {
        await page.close();
      } catch (error) {
        console.error('[BrowserManager] Error closing page:', error);
      }
    }
    this.pages.clear();

    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      // При CDP подключении — НЕ закрываем browser (сохраняем сессию пользователя)
      if (this.browser && !this.connectedViaCDP) {
        await this.browser.close();
        this.browser = null;
      } else if (this.connectedViaCDP) {
        // Только обнуляем ссылку, не закрываем
        this.browser = null;
      }
    } catch (error) {
      // Логируем ошибку, но не пробрасываем — предотвращает падение процесса
      // и разрыв MCP соединения (MCP error -32000: Connection closed)
      console.error('[BrowserManager] Error during close():', error);
      // Принудительно обнуляем ссылки даже при ошибке
      this.context = null;
      this.browser = null;
    }

    this.connectedViaCDP = false;
  }
}