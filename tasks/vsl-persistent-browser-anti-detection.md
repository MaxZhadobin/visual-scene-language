# Задача: Persistent Browser с антибот-защитой для VSL

## Scope (область применения)

**Эта задача касается ТОЛЬКО MCP Server (Playwright).**

Chrome Extension **НЕ требует** этих изменений:
- Extension работает внутри реального Chrome пользователя
- Cookies, localStorage, fingerprint, история — уже есть (реальный браузер)
- `navigator.webdriver` не устанавливается (не автоматизация)
- Антиботы не детектят автоматизацию, потому что её нет

## Проблема

VSL MCP Server использует Playwright `chromium.launch()` + `browser.newContext()` без сохранения состояния. Каждый запуск создаёт чистый (ephemeral) браузер:
- ❌ Cookies не сохраняются → нужно логиниться заново
- ❌ localStorage/sessionStorage не сохраняются
- ❌ Fingerprint плавает между сессиями
- ❌ История браузера отсутствует
- ❌ `navigator.webdriver = true` → антиботы мгновенно детектят автоматизацию
- ❌ `AutomationControlled` flag включён → дополнительные палево

## Текущий код VSL (что нужно изменить)

### Файл: `packages/mcp-server/src/browser/manager.ts`

**Текущий код запуска браузера (строки 116-140):**

async launch(): Promise<void> {
  if (this.browser) return;

  const pw = await this.loadPlaywright();
  if (!pw) {
    throw new Error(
      'Playwright is not installed. Install it with: npm install playwright',
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
**Проблема:** Используется `chromium.launch()` + `browser.newContext()` — создаётся ephemeral контекст, который не сохраняет cookies/localStorage между запусками.

### Файл: `packages/mcp-server/src/config/loader.ts`

**Текущий интерфейс BrowserConfig (строки 36-49):**

export interface BrowserConfig {
  /** Headless mode (по умолчанию true). */
  headless: boolean;
  /** Timeout для навигации (мс, по умолчанию 30000). */
  navigationTimeout: number;
  /** Timeout для рендеринга (мс, по умолчанию 10000). */
  renderTimeout: number;
  /** Путь для сохранения загруженных файлов (по умолчанию ~/.vsl/downloads). */
  downloadsPath?: string;
  /** Timeout для ожидания завершения загрузки (мс, по умолчанию 60000). */
  downloadTimeout?: number;
  /** Разрешить скачивание файлов (по умолчанию true). */
  acceptDownloads?: boolean;
}
**Проблема:** Нет полей для `userDataDir` и `cdpPort`, которые нужны для persistent browser.

## Решение: Persistent Browser + CDP + Stealth

### Архитектура

┌─────────────────────────────────────────────────────────────┐
│  Chromium (один процесс)                                    │
│  userDataDir: ~/.vsl/profile                                │
│  CDP Port: 9222                                             │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Agent 1     │  │ Agent 2     │  │ Agent 3     │        │
│  │ Tab: github │  │ Tab: google │  │ Tab: stack  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  Все агенты работают с одним профилем:                      │
│  ✅ Cookies сохраняются                                     │
│  ✅ Fingerprint стабильный                                  │
│  ✅ История + кэш                                           │
│  ✅ Stealth plugin убирает webdriver flag                   │
└─────────────────────────────────────────────────────────────┘
### Компоненты решения

#### 1. Persistent Context (userDataDir)

**Что:** Использовать `chromium.launchPersistentContext()` вместо `chromium.launch()` + `newContext()`

**Зачем:**
- Cookies + localStorage сохраняются автоматически в директорию профиля
- Fingerprint стабильный (тот же профиль = тот же отпечаток)
- История браузера, кэш, Service Workers — всё сохраняется
- Выглядит как реальный Chrome (антиботы видят "человека")

**Как:**
const context = await chromium.launchPersistentContext('~/.vsl/profile', {
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=9222',
  ],
});
#### 2. CDP (Chrome DevTools Protocol) для множественных агентов

**Что:** Открывать CDP port при запуске, позволять последующим запускам подключаться через `connectOverCDP()`

**Зачем:**
- Первый запуск → запускает браузер с userDataDir
- Второй, третий, N-ный запуск → подключаются к УЖЕ ЗАПУЩЕННОМУ браузеру
- Каждый агент открывает свои вкладки, но все работают с одним профилем
- Аналогия: как обычный Chrome на компе — один процесс, много вкладок

**Как:**
// Первый запуск (запускает браузер)
const context = await chromium.launchPersistentContext('~/.vsl/profile', {
  args: ['--remote-debugging-port=9222'],
});

// Последующие запуски (подключаются к уже запущенному)
const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const context = contexts[0]; // Тот самый persistent context
const page = await context.newPage();
#### 3. Stealth Plugin (обход антибот-защиты)

**Что:** Использовать `playwright-extra` + `puppeteer-extra-plugin-stealth`

**Зачем:**
- Убирает `navigator.webdriver = true` → антиботы не видят автоматизацию
- Добавляет фейковые `navigator.plugins` (в реальном Chrome есть PDF Viewer, Google Translate)
- Добавляет `window.chrome` (отсутствует в чистом Playwright)
- Синхронизирует `navigator.languages` с Accept-Language заголовком
- Маскирует WebGL vendor/renderer

**Установка:**
npm install playwright-extra puppeteer-extra-plugin-stealth
**Как:**
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const context = await chromium.launchPersistentContext('~/.vsl/profile', {
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=9222',
  ],
});
#### 4. Launch Args (дополнительная маскировка)

**Что:** Добавить специфические аргументы запуска Chromium

**Зачем:**
- `--disable-blink-features=AutomationControlled` → убирает внутренний флаг Chromium об автоматизации
- `--remote-debugging-port=9222` → открывает CDP port для подключения других агентов

**Как:**
const context = await chromium.launchPersistentContext('~/.vsl/profile', {
  args: [
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=9222',
  ],
});
## Детали реализации

### Изменение 1: Обновить `BrowserConfig` в `config/loader.ts`

**Файл:** `packages/mcp-server/src/config/loader.ts`

**Текущий код (строки 36-49):**
export interface BrowserConfig {
  /** Headless mode (по умолчанию true). */
  headless: boolean;
  /** Timeout для навигации (мс, по умолчанию 30000). */
  navigationTimeout: number;
  /** Timeout для рендеринга (мс, по умолчанию 10000). */
  renderTimeout: number;
  /** Путь для сохранения загруженных файлов (по умолчанию ~/.vsl/downloads). */
  downloadsPath?: string;
  /** Timeout для ожидания завершения загрузки (мс, по умолчанию 60000). */
  downloadTimeout?: number;
  /** Разрешить скачивание файлов (по умолчанию true). */
  acceptDownloads?: boolean;
}
**Новый код:**
export interface BrowserConfig {
  /** Headless mode (по умолчанию true). */
  headless: boolean;
  /** Timeout для навигации (мс, по умолчанию 30000). */
  navigationTimeout: number;
  /** Timeout для рендеринга (мс, по умолчанию 10000). */
  renderTimeout: number;
  /** Путь для сохранения загруженных файлов (по умолчанию ~/.vsl/downloads). */
  downloadsPath?: string;
  /** Timeout для ожидания завершения загрузки (мс, по умолчанию 60000). */
  downloadTimeout?: number;
  /** Разрешить скачивание файлов (по умолчанию true). */
  acceptDownloads?: boolean;
  /** Директория для persistent browser profile (по умолчанию ~/.vsl/profile). */
  userDataDir?: string;
  /** Порт для CDP (Chrome DevTools Protocol), для подключения множественных агентов (по умолчанию 9222). */
  cdpPort?: number;
}
**Также обновить `DEFAULT_BROWSER_CONFIG` (строки 75-82):**

const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  navigationTimeout: 30000,
  renderTimeout: 10000,
  downloadsPath: join(homedir(), '.vsl', 'downloads'),
  downloadTimeout: 60000,
  acceptDownloads: true,
  userDataDir: join(homedir(), '.vsl', 'profile'),  // ← НОВОЕ
  cdpPort: 9222,                                      // ← НОВОЕ
};
**Также обновить `loadConfig()` (строки 122-146) — добавить загрузку новых полей:**

const browser: BrowserConfig = {
  // ... существующие поля ...
  userDataDir:
    process.env.VSL_USER_DATA_DIR ||
    fileConfig.browser?.userDataDir ||
    DEFAULT_BROWSER_CONFIG.userDataDir,
  cdpPort:
    process.env.VSL_CDP_PORT
      ? parseInt(process.env.VSL_CDP_PORT, 10)
      : (fileConfig.browser?.cdpPort ?? DEFAULT_BROWSER_CONFIG.cdpPort),
};
### Изменение 2: Переписать `BrowserManager.launch()` в `browser/manager.ts`

**Файл:** `packages/mcp-server/src/browser/manager.ts`

**Текущий код (строки 116-140):**
async launch(): Promise<void> {
  if (this.browser) return;

  const pw = await this.loadPlaywright();
  if (!pw) {
    throw new Error(
      'Playwright is not installed. Install it with: npm install playwright',
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
**Новый код:**
async launch(): Promise<void> {
  if (this.browser || this.context) return;

  const CDP_PORT = this.config.cdpPort ?? 9222;

  // Пробуем подключиться к уже запущенному браузеру через CDP
  try {
    const pw = await this.loadPlaywright();
    if (!pw) {
      throw new Error(
        'Playwright is not installed. Install it with: npm install playwright',
      );
    }

    this.browser = await pw.chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    const contexts = this.browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      console.log(`[BrowserManager] Connected to existing browser via CDP (port ${CDP_PORT})`);
      return;
    }
  } catch (e) {
    // Браузер не запущен — запускаем новый
    console.log(`[BrowserManager] No browser found on CDP port ${CDP_PORT}, launching new one`);
  }

  // Запускаем новый браузер с persistent context
  const pw = await this.loadPlaywright();
  if (!pw) {
    throw new Error(
      'Playwright is not installed. Install it with: npm install playwright',
    );
  }

  // Используем playwright-extra с stealth plugin
  const { chromium } = await import('playwright-extra');
  const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
  chromium.use(stealth());

  const userDataDir = this.config.userDataDir ?? join(homedir(), '.vsl', 'profile');

  this.context = await chromium.launchPersistentContext(userDataDir, {
    headless: this.config.headless,
    acceptDownloads: this.config.acceptDownloads ?? true,
    args: [
      '--disable-blink-features=AutomationControlled',
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  });

  this.browser = this.context.browser();
  console.log(`[BrowserManager] Browser launched with userDataDir: ${userDataDir}, CDP port: ${CDP_PORT}`);
}
### Изменение 3: Обновить `BrowserManager.close()` в `browser/manager.ts`

**Текущий код (строки 381-405):**
async close(): Promise<void> {
  // Очищаем активные загрузки
  this.activeDownloads.clear();

  try {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
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

  this.page = null;
}
**Новый код:**
async close(): Promise<void> {
  // Очищаем активные загрузки
  this.activeDownloads.clear();

  try {
    // Если подключались через CDP → НЕ закрываем браузер (он может использоваться другими агентами)
    // Если запускали сами → закрываем как обычно
    if (this.connectedViaCDP) {
      // Только отключаемся, не закрываем браузер
      console.log('[BrowserManager] Disconnecting from browser (CDP mode, browser stays alive)');
      if (this.browser) {
        await this.browser.close(); // Это только отключает, не закрывает браузер
        this.browser = null;
      }
    } else {
      // Закрываем браузер полностью
      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }
  } catch (error) {
    // Логируем ошибку, но не пробрасываем — предотвращает падение процесса
    // и разрыв MCP соединения (MCP error -32000: Connection closed)
    console.error('[BrowserManager] Error during close():', error);
    // Принудительно обнуляем ссылки даже при ошибке
    this.context = null;
    this.browser = null;
  }

  this.page = null;
}
**Дополнительно:** Добавить поле `connectedViaCDP` в класс `BrowserManager`:

export class BrowserManager {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightBrowserContext | null = null;
  private page: PlaywrightPage | null = null;
  private playwright: PlaywrightModule | null = null;
  private readonly config: BrowserConfig;
  private connectedViaCDP = false;  // ← НОВОЕ: флаг, указывающий что подключились через CDP
  /** Активные загрузки: downloadId -> PlaywrightDownload. */
  private readonly activeDownloads = new Map<string, PlaywrightDownload>();

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  // ... остальные методы ...
}
И обновить `launch()` чтобы устанавливать этот флаг:

async launch(): Promise<void> {
  if (this.browser || this.context) return;

  const CDP_PORT = this.config.cdpPort ?? 9222;

  // Пробуем подключиться к уже запущенному браузеру через CDP
  try {
    const pw = await this.loadPlaywright();
    if (!pw) {
      throw new Error(
        'Playwright is not installed. Install it with: npm install playwright',
      );
    }

    this.browser = await pw.chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    const contexts = this.browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      this.connectedViaCDP = true;  // ← Устанавливаем флаг
      console.log(`[BrowserManager] Connected to existing browser via CDP (port ${CDP_PORT})`);
      return;
    }
  } catch (e) {
    // Браузер не запущен — запускаем новый
    console.log(`[BrowserManager] No browser found on CDP port ${CDP_PORT}, launching new one`);
  }

  // Запускаем новый браузер с persistent context
  // ... (остальной код) ...
  this.connectedViaCDP = false;  // ← Запускали сами
}
### Изменение 4: Обновить типы в `browser/manager.ts`

**Текущий код (строки 67-75):**
/** Тип для Playwright Chromium. */
interface PlaywrightChromium {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
}

/** Тип для Playwright module. */
interface PlaywrightModule {
  chromium: PlaywrightChromium;
}
**Новый код:**
/** Тип для Playwright Chromium. */
interface PlaywrightChromium {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  connectOverCDP(endpointURL: string): Promise<PlaywrightBrowser>;
  launchPersistentContext(
    userDataDir: string,
    options?: {
      headless?: boolean;
      acceptDownloads?: boolean;
      args?: string[];
    }
  ): Promise<PlaywrightBrowserContext>;
}

/** Тип для Playwright module. */
interface PlaywrightModule {
  chromium: PlaywrightChromium;
}
### Изменение 5: Обновить `package.json`

**Файл:** `packages/mcp-server/package.json`

**Добавить зависимости:**
{
  "dependencies": {
    "playwright-extra": "^4.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2"
  }
}
**Команда установки:**
cd packages/mcp-server
npm install playwright-extra puppeteer-extra-plugin-stealth
### Изменение 6: Обновить документацию

**Файл:** `packages/mcp-server/README.md`

**Добавить раздел:**

## Persistent Browser (сохранение cookies и сессий)

VSL MCP Server использует persistent browser profile для сохранения cookies, localStorage и истории браузера между запусками.

### Как это работает

1. **Первый запуск** VSL MCP Server запускает Chromium с `userDataDir` (по умолчанию `~/.vsl/profile`)
2. **Последующие запуски** подключаются к уже запущенному браузеру через CDP (Chrome DevTools Protocol)
3. **Множество агентов** могут работать с одним браузером, открывая свои вкладки

### Конфигурация

По умолчанию:
- `userDataDir`: `~/.vsl/profile` (директория для профиля браузера)
- `cdpPort`: `9222` (порт для CDP)

Через `.vsl/config.json`:
{
  "browser": {
    "userDataDir": "~/.vsl/profile",
    "cdpPort": 9222
  }
}
Через environment variables:
export VSL_USER_DATA_DIR=~/.vsl/profile
export VSL_CDP_PORT=9222
### Антибот-защита

VSL использует stealth plugin для обхода антибот-защиты:
- Убирает `navigator.webdriver = true`
- Добавляет фейковые `navigator.plugins`
- Добавляет `window.chrome`
- Маскирует WebGL fingerprint

Это позволяет работать с сайтами, которые детектят автоматизацию (Cloudflare, DataDome и др.).
## Пошаговый план реализации

### Шаг 1: Установить зависимости
cd packages/mcp-server
npm install playwright-extra puppeteer-extra-plugin-stealth
### Шаг 2: Обновить `BrowserConfig` в `config/loader.ts`
- Добавить поля `userDataDir?: string` и `cdpPort?: number`
- Обновить `DEFAULT_BROWSER_CONFIG`
- Обновить `loadConfig()` для загрузки новых полей из env/config file

### Шаг 3: Обновить типы в `browser/manager.ts`
- Добавить `connectOverCDP()` и `launchPersistentContext()` в `PlaywrightChromium`

### Шаг 4: Переписать `BrowserManager.launch()` в `browser/manager.ts`
- Сначала пробовать подключиться через CDP (`connectOverCDP`)
- Если не получилось — запускать новый браузер с `launchPersistentContext`
- Использовать `playwright-extra` + stealth plugin
- Добавить launch args: `--disable-blink-features=AutomationControlled`, `--remote-debugging-port`
- Устанавливать флаг `connectedViaCDP`

### Шаг 5: Обновить `BrowserManager.close()` в `browser/manager.ts`
- Если подключались через CDP → НЕ закрывать браузер (он может использоваться другими агентами)
- Если запускали сами → закрывать как обычно

### Шаг 6: Обновить документацию
- Добавить раздел про persistent browser в README
- Примеры конфига с `userDataDir` и `cdpPort`
- Объяснить архитектуру с CDP

### Шаг 7: Тестирование
- Запустить VSL MCP Server → проверить, что создаётся `~/.vsl/profile`
- Залогиниться на каком-нибудь сайте → проверить, что cookies сохраняются
- Перезапустить VSL → проверить, что авторизация сохраняется
- Запустить второй VSL MCP Server → проверить, что подключается через CDP к первому
- Проверить на сайте с антиботом (например, Cloudflare) → проверить, что не триггерит капчу

## Ожидаемые результаты

✅ **Cookies сохраняются** — после перезапуска браузера авторизация сохраняется
✅ **Fingerprint стабильный** — антиботы видят "человека", а не бота
✅ **Множество агентов** — несколько MCP-серверов могут работать с одним браузером
✅ **Антибот-защита обходится** — stealth plugin убирает основные палево
✅ **Работает из коробки** — пользователь ничего не настраивает, всё работает по умолчанию

## Риски и ограничения

⚠️ **Первый запуск медленнее** — создаётся директория профиля (~100-200ms)
⚠️ **Профиль может разрастаться** — кэш, история, cookies накапливаются (нужна периодическая очистка)
⚠️ **Нельзя запустить два независимых процесса с одним userDataDir** — но это решается через CDP
⚠️ **Stealth plugin не идеален** — продвинутые антиботы (Kasada, DataDome) могут всё равно детектить, но шанс бана значительно ниже

## Альтернативы (почему не выбрали)

### storageState (JSON-файл с cookies)
- ❌ Fingerprint плавает между сессиями → антиботы видят несоответствие
- ❌ Не сохраняет историю, кэш, расширения
- ✅ Можно создавать множество изолированных контекстов параллельно
- **Не подходит** — хуже для антибот-защиты

### Чистый Playwright без persistence (текущее поведение)
- ❌ Cookies не сохраняются
- ❌ Fingerprint плавает
- ❌ `webdriver = true` → мгновенный бан
- **Не подходит** — полностью бесполезно для работы с реальными сайтами

## Дополнительные улучшения (будущее)

### Human-like actions (уже в планах)
- Плавное движение мыши (Fitts's law, jitter)
- Человеческие задержки перед кликом (200-800ms)
- Человеческий скролл (инерция, overshoot)
- Вариативные задержки между клавишами при вводе текста

### Периодическая очистка профиля
- Скрипт для очистки кэша (раз в неделю)
- Удаление старых cookies (раз в месяц)
- Сохранение размера профиля в разумных пределах

### Расширения для специфических задач
- MetaMask (для крипто-сайтов)
- uBlock Origin (для блокировки рекламы)
- Custom extensions (для специфических сценариев)

## Ссылки

- [Playwright Persistent Context](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [playwright-extra](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra)
- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- [Cloudflare Anti-Bot Detection](https://www.cloudflare.com/products/bot-management/)