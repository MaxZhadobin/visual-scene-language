# План доработки: Поддержка скачивания файлов в VSL

## 1. Обзор проблемы

**Текущее состояние:**
- BrowserManager запускает Playwright без настройки `acceptDownloads: true`
- При клике на кнопку скачивания появляется диалог сохранения файла, который агент не может обработать
- Нет механизмов для отслеживания, ожидания и получения скачанных файлов
- SDK (Action Executor) не содержит действия `download` — LLM-агент не может инициировать скачивание

**Цель:**
Полноценная поддержка скачивания файлов на всех уровнях VSL:
- **SDK (Action Model + Executor)** — действие `download` в Action Model, исполнение в браузере
- **MCP Server** — Playwright контекст с `acceptDownloads: true`, tool `vsl_download`
- **LLM Prompt** — модель знает о действии `download` и умеет его выбирать

---

## 2. Изменения в SDK

### 2.1. Action Model — добавить `download` в VALID_ACTIONS (`src/llm/actions.ts`)

**Текущий список (строки 19-46): 23 действия.**

**Добавить `download` в §7.2 Расширенные:**

export const VALID_ACTIONS = [
  // §7.1 Базовые (10)
  'click',
  'type',
  'clear',
  'scroll',
  'hover',
  'focus',
  'blur',
  'select',
  'check',
  'uncheck',
  // §7.2 Расширенные (10) — БЫЛО 9, СТАЛО 10
  'drag',
  'drop',
  'submit',
  'reset',
  'open',
  'close',
  'expand',
  'collapse',
  'wait',
  'download',   // ← НОВОЕ
  // §7.3 Навигационные (4)
  'navigate',
  'go_back',
  'go_forward',
  'refresh',
] as const;
**Обновить `TARGET_ACTIONS` (строки 55-73):**

`download` — действие с целью (клик по элементу-ссылке/кнопке скачивания), поэтому добавить в TARGET_ACTIONS:

export const TARGET_ACTIONS: ReadonlySet<string> = new Set([
  'click',
  'type',
  'clear',
  'hover',
  'focus',
  'blur',
  'select',
  'check',
  'uncheck',
  'drag',
  'drop',
  'submit',
  'reset',
  'open',
  'close',
  'expand',
  'collapse',
  'download',   // ← НОВОЕ: target_id = элемент-триггер скачивания
]);
**Валидация `validateAction`** — изменений не требует: `download` — target-действие, target_id будет проверен автоматически через TARGET_ACTIONS.

---

### 2.2. Action Executor — обработка `download` (`src/executor/actionExecutor.ts`)

**Контекст:** SDK работает в двух средах:
1. **Browser extension** (content script) — прямой доступ к DOM, нет Playwright API
2. **Node.js** (тесты, standalone) — нет DOM, нет браузера

В browser extension скачивание происходит через клик по элементу + перехват через `chrome.downloads` API (extension background). Executor работает в content script и может только кликнуть по элементу-триггеру.

**Добавить в switch statement (после `case 'collapse':`, перед `case 'wait':`):**

case 'download': {
  // download = клик по элементу-триггеру скачивания.
  // В browser extension: background script перехватывает загрузку через
  // chrome.downloads.onCreated (acceptDownloads настраивается в extension manifest).
  // В Node.js/jsdom: просто клик, загрузка не происходит (тесты мокают).
  //
  // Семантика: target_id — элемент с атрибутом download, ссылка на файл,
  // или кнопка, инициирующая скачивание через JS.
  // value — опциональный filename override (атрибут HTML download="filename").
  const target = resolveTargetOf(action, options);
  
  // Если элемент — <a> с атрибутом download, устанавливаем value как filename
  if (action.value && target instanceof HTMLAnchorElement) {
    target.setAttribute('download', action.value);
  }
  
  clickElement(target);
  break;
}
**Обновить ActionResult** (`src/executor/types.ts`):

export interface ActionResult {
  success: boolean;
  action: string;
  targetId?: string;
  error?: string;
  
  // НОВОЕ: информация о скачивании (если action='download' и success=true)
  download?: {
    /** true — скачивание инициировано (клик выполнен). */
    initiated: boolean;
    /** URL источника (из href элемента, если <a>). */
    url?: string;
    /** Предлагаемое имя файла (из download атрибута или URL). */
    filename?: string;
  };
}
**Обновить `executeAction`** — после успешного `download` заполнить поле `download`:

case 'download': {
  const target = resolveTargetOf(action, options);
  
  if (action.value && target instanceof HTMLAnchorElement) {
    target.setAttribute('download', action.value);
  }
  
  clickElement(target);
  
  // Заполняем download-метаданные в echo
  const url = target instanceof HTMLAnchorElement ? target.href : undefined;
  const filename = action.value ?? (target instanceof HTMLAnchorElement 
    ? target.getAttribute('download') ?? undefined 
    : undefined);
  echo.download = {
    initiated: true,
    ...(url ? { url } : {}),
    ...(filename ? { filename } : {}),
  };
  break;
}
---

### 2.3. LLM Prompt — добавить `download` в PARAMETER_CONVENTIONS (`src/llm/prompt.ts`)

**Обновить PARAMETER_CONVENTIONS (строки 54-64):**

const PARAMETER_CONVENTIONS = [
  '- click, hover, focus, blur, clear, check, uncheck, open, close, expand, collapse — target_id;',
  '- type — target_id + value (text to type);',
  '- select — target_id + value (option);',
  '- scroll — value: "up" | "down" (optional amount: "down:300");',
  '- drag — target_id: source element, value: destination element id;',
  '- submit, reset — target_id: form id;',
  '- wait — value: condition (e.g. a selector or "idle");',
  '- navigate — value: URL;',
  '- download — target_id: element that triggers download (link/button); optional value: filename override;',
  '- go_back, go_forward, refresh — no parameters.',
].join('\n');
**JSON Schema** (`src/llm/schema.ts`) — обновляется автоматически, т.к. `enum: [...VALID_ACTIONS]` берёт из `actions.ts`.

**Few-shot примеры** (`src/llm/prompt.ts`) — опционально добавить 4-й пример:

{
  title: 'Example 4 — download a file',
  vsl: '{"vsl_version":"1.0.0","objects":[{"id":"main_0","t":"main","ch":[{"id":"link_0_0","t":"link","txt":"Скачать отчёт (PDF)","act":["click","download"]}]}]}',
  goal: 'Скачать отчёт в формате PDF',
  action: '{"action":"download","target_id":"link_0_0","value":null,"reasoning":"Ссылка «Скачать отчёт» инициирует загрузку PDF-файла"}',
},
---

### 2.4. Тесты SDK

#### 2.4.1. Unit-тесты Action Executor (`src/executor/actionExecutor.test.ts`)

describe('download action', () => {
  it('should click download trigger element', async () => {
    document.body.innerHTML = '<a id="dl" href="/file.pdf" download>Скачать</a>';
    const result = await executeAction(
      { action: 'download', target_id: 'tag_a::0' },
      { root: document.body }
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe('download');
    expect(result.download?.initiated).toBe(true);
    expect(result.download?.url).toContain('/file.pdf');
  });

  it('should set download attribute when value is provided', async () => {
    document.body.innerHTML = '<a id="dl" href="/file.pdf">Скачать</a>';
    const result = await executeAction(
      { action: 'download', target_id: 'tag_a::0', value: 'report.pdf' },
      { root: document.body }
    );
    expect(result.success).toBe(true);
    expect(result.download?.filename).toBe('report.pdf');
    const anchor = document.querySelector('a');
    expect(anchor?.getAttribute('download')).toBe('report.pdf');
  });

  it('should fail without target_id', async () => {
    const result = await executeAction(
      { action: 'download' },
      { root: document.body }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires a string target_id');
  });

  it('should fail if target element not found', async () => {
    document.body.innerHTML = '<div>no links here</div>';
    const result = await executeAction(
      { action: 'download', target_id: 'tag_a::999' },
      { root: document.body }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
#### 2.4.2. Unit-тесты валидации (`src/llm/actions.test.ts`)

describe('download action validation', () => {
  it('should accept download with valid target_id', () => {
    const validIds = new Set(['link_0']);
    const result = validateAction(
      { action: 'download', target_id: 'link_0' },
      validIds
    );
    expect(result.action).toBe('download');
    expect(result.target_id).toBe('link_0');
  });

  it('should reject download without target_id', () => {
    const validIds = new Set(['link_0']);
    expect(() => validateAction(
      { action: 'download' },
      validIds
    )).toThrow('requires a string target_id');
  });

  it('should reject download with unknown target_id', () => {
    const validIds = new Set(['link_0']);
    expect(() => validateAction(
      { action: 'download', target_id: 'nonexistent' },
      validIds
    )).toThrow('not found in VSL JSON');
  });
});
#### 2.4.3. Тесты промпта (`src/llm/prompt.test.ts`)

describe('system prompt includes download', () => {
  it('should list download in allowed actions', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('download');
  });

  it('should describe download parameter conventions', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('download — target_id');
  });
});
---

### 2.5. Обновить экспорт SDK (`src/index.ts`)

Текущий экспорт `ActionResult` уже покрывается. Новых типов для экспорта нет — `download` поле внутри `ActionResult` уже экспортируется.

Однако, если в будущем добавится отдельный `DownloadResult` тип — добавить в секцию M1.4:

// ——— M1.4: Action Executor (T1.4.1–T1.4.3) ———

export { executeAction } from './executor/actionExecutor';
export { resolveTarget } from './executor/resolveTarget';
export { ActionExecutionError } from './executor/types';
export type { ActionResult, ExecutorOptions } from './executor/types';
// ActionResult.download — новое поле, уже покрывается существующим экспортом
---

## 3. Изменения в MCP Server

### 3.1. Конфигурация (`packages/mcp-server/src/config/loader.ts`)

**Добавить в `BrowserConfig`:**

export interface BrowserConfig {
  headless: boolean;
  navigationTimeout: number;
  renderTimeout: number;
  
  // НОВОЕ: Настройки скачивания
  downloadsPath?: string;        // Путь для сохранения файлов (по умолчанию: os.tmpdir()/vsl-downloads)
  downloadTimeout?: number;      // Таймаут ожидания скачивания (мс, по умолчанию: 30000)
  acceptDownloads?: boolean;     // Включить авто-приём загрузок (по умолчанию: true)
}
**Добавить в defaults:**

const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  navigationTimeout: 30000,
  renderTimeout: 10000,
  downloadsPath: join(os.tmpdir(), 'vsl-downloads'),
  downloadTimeout: 30000,
  acceptDownloads: true,
};
**Добавить env vars:**

downloadsPath: process.env.VSL_DOWNLOADS_PATH || fileConfig.browser?.downloadsPath || DEFAULT_BROWSER_CONFIG.downloadsPath,
downloadTimeout: process.env.VSL_DOWNLOAD_TIMEOUT ? parseInt(process.env.VSL_DOWNLOAD_TIMEOUT, 10) : (fileConfig.browser?.downloadTimeout ?? DEFAULT_BROWSER_CONFIG.downloadTimeout),
acceptDownloads: process.env.VSL_ACCEPT_DOWNLOADS ? process.env.VSL_ACCEPT_DOWNLOADS === 'true' : (fileConfig.browser?.acceptDownloads ?? DEFAULT_BROWSER_CONFIG.acceptDownloads),
---

### 3.2. BrowserManager (`packages/mcp-server/src/browser/manager.ts`)

#### 3.2.1. Расширить Playwright интерфейсы

/** Тип для Playwright Download (динамический импорт). */
interface PlaywrightDownload {
  uuid(): string;
  suggestedFilename(): string;
  path(): Promise<string | null>;
  url(): string;
  saveAs(path: string): Promise<void>;
  cancel(): Promise<void>;
  failure(): Promise<string | null>;
}

/** Расширить PlaywrightPage. */
interface PlaywrightPage {
  // ... существующие методы ...
  waitForDownload(options?: { timeout?: number }): Promise<PlaywrightDownload>;
  on(event: 'download', listener: (download: PlaywrightDownload) => void): void;
}

/** Расширить PlaywrightBrowser. */
interface PlaywrightBrowser {
  newContext(options?: { acceptDownloads?: boolean; downloadsPath?: string }): Promise<PlaywrightContext>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

/** Тип для Playwright BrowserContext. */
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
#### 3.2.2. Изменить запуск браузера

export class BrowserManager {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;  // НОВОЕ
  private page: PlaywrightPage | null = null;
  private playwright: PlaywrightModule | null = null;
  private readonly config: BrowserConfig;
  
  // НОВОЕ: Хранилище активных загрузок
  private activeDownloads: Map<string, PlaywrightDownload> = new Map();

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
    
    // НОВОЕ: Создать контекст с настройками загрузок
    this.context = await this.browser.newContext({
      acceptDownloads: this.config.acceptDownloads ?? true,
      downloadsPath: this.config.downloadsPath,
    });
  }

  async getPage(): Promise<PlaywrightPage> {
    if (!this.browser) {
      await this.launch();
    }
    if (!this.browser || !this.context) {
      throw new Error('Browser not available');
    }

    if (!this.page) {
      this.page = await this.context.newPage();  // context вместо browser
    }

    return this.page;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
    this.activeDownloads.clear();
  }
}
#### 3.2.3. Добавить методы для работы с загрузками

async waitForDownload(timeout?: number): Promise<{
  uuid: string;
  filename: string;
  url: string;
  path: string | null;
}> {
  const page = await this.getPage();
  const downloadTimeout = timeout ?? this.config.downloadTimeout ?? 30000;
  
  const download = await page.waitForDownload({ timeout: downloadTimeout });
  const uuid = download.uuid();
  this.activeDownloads.set(uuid, download);
  
  const failure = await download.failure();
  if (failure) {
    throw new Error(`Download failed: ${failure}`);
  }
  
  const path = await download.path();
  
  return {
    uuid,
    filename: download.suggestedFilename(),
    url: download.url(),
    path,
  };
}

getDownloads(): Array<{
  uuid: string;
  filename: string;
  url: string;
}> {
  return Array.from(this.activeDownloads.entries()).map(([uuid, dl]) => ({
    uuid,
    filename: dl.suggestedFilename(),
    url: dl.url(),
  }));
}

async saveDownload(uuid: string, destinationPath: string): Promise<void> {
  const download = this.activeDownloads.get(uuid);
  if (!download) {
    throw new Error(`Download not found: ${uuid}`);
  }
  await download.saveAs(destinationPath);
}

async cancelDownload(uuid: string): Promise<void> {
  const download = this.activeDownloads.get(uuid);
  if (!download) {
    throw new Error(`Download not found: ${uuid}`);
  }
  await download.cancel();
  this.activeDownloads.delete(uuid);
}

clearDownloads(): void {
  this.activeDownloads.clear();
}
---

### 3.3. Обновить `vsl_execute_action` (`packages/mcp-server/src/tools/executeAction.ts`)

**Добавить `download` в VALID_ACTIONS:**

const VALID_ACTIONS = [
  'click',
  'type',
  'scroll',
  'select',
  'hover',
  'focus',
  'blur',
  'check',
  'uncheck',
  'press',
  'download',   // ← НОВОЕ
] as const;
**Добавить case в switch:**

case 'download':
  // Клик по элементу-триггеру + ожидание загрузки через BrowserManager
  await browser.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (el) (el as HTMLElement).click();
  }, selector);
  break;
---

### 3.4. Новый MCP Tool: `vsl_download` (`packages/mcp-server/src/tools/download.ts`)

**Создать новый файл `download.ts`:**

import type { BrowserManager } from '../browser/manager.js';

export type DownloadMode = 'wait' | 'list' | 'save' | 'cancel' | 'clear';

export interface DownloadArgs {
  mode: DownloadMode;
  timeout?: number;
  uuid?: string;
  destination_path?: string;
}

export interface DownloadResult {
  status: 'success' | 'error';
  mode: DownloadMode;
  data?: unknown;
  error?: string;
}

export async function handleDownload(
  args: DownloadArgs,
  browser: BrowserManager,
): Promise<DownloadResult> {
  try {
    if (!args.mode || typeof args.mode !== 'string') {
      return { status: 'error', mode: args.mode || 'wait', error: 'mode is required' };
    }

    const validModes: DownloadMode[] = ['wait', 'list', 'save', 'cancel', 'clear'];
    if (!validModes.includes(args.mode)) {
      return {
        status: 'error',
        mode: args.mode,
        error: `Invalid mode: ${args.mode}. Valid modes: ${validModes.join(', ')}`,
      };
    }

    switch (args.mode) {
      case 'wait': {
        const download = await browser.waitForDownload(args.timeout);
        return { status: 'success', mode: 'wait', data: download };
      }
      case 'list': {
        const downloads = browser.getDownloads();
        return { status: 'success', mode: 'list', data: { downloads, count: downloads.length } };
      }
      case 'save': {
        if (!args.uuid) return { status: 'error', mode: 'save', error: 'uuid is required' };
        if (!args.destination_path) return { status: 'error', mode: 'save', error: 'destination_path is required' };
        await browser.saveDownload(args.uuid, args.destination_path);
        return { status: 'success', mode: 'save', data: { uuid: args.uuid, saved_to: args.destination_path } };
      }
      case 'cancel': {
        if (!args.uuid) return { status: 'error', mode: 'cancel', error: 'uuid is required' };
        await browser.cancelDownload(args.uuid);
        return { status: 'success', mode: 'cancel', data: { uuid: args.uuid, cancelled: true } };
      }
      case 'clear': {
        browser.clearDownloads();
        return { status: 'success', mode: 'clear', data: { cleared: true } };
      }
      default:
        return { status: 'error', mode: args.mode, error: `Mode ${args.mode} is not implemented` };
    }
  } catch (error) {
    return {
      status: 'error',
      mode: args.mode,
      error: `vsl_download failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
---

### 3.5. Регистрация нового tool (`packages/mcp-server/src/tools/index.ts`)

**Добавить импорт:**

import { handleDownload } from './download.js';
**Добавить в VSL_TOOLS массив:**

{
  name: 'vsl_download',
  description: 'Управление скачиванием файлов. Режимы: wait (ожидать завершение загрузки после клика), list (список загрузок), save (сохранить файл), cancel (отменить загрузку), clear (очистить список). Пример: {mode:"wait", timeout:30000} — ожидает скачивание после клика на кнопку. {mode:"list"} — показывает все загрузки. {mode:"save", uuid:"abc123", destination_path:"/path/to/file.pdf"} — сохраняет файл.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['wait', 'list', 'save', 'cancel', 'clear'],
        description: 'Режим работы',
      },
      timeout: {
        type: 'number',
        description: 'Таймаут ожидания загрузки (мс) для mode=wait',
      },
      uuid: {
        type: 'string',
        description: 'UUID загрузки для mode=save или mode=cancel',
      },
      destination_path: {
        type: 'string',
        description: 'Путь сохранения файла для mode=save',
      },
    },
    required: ['mode'],
  },
},
**Добавить в switch statement:**

case 'vsl_download':
  result = await handleDownload(args as never, browser);
  break;
---

### 3.6. Тесты MCP Server

#### 3.6.1. Unit-тесты BrowserManager (`packages/mcp-server/src/browser/manager.test.ts`)

describe('BrowserManager - Download Support', () => {
  it('should create context with acceptDownloads: true', async () => {
    const manager = new BrowserManager({
      headless: true,
      navigationTimeout: 30000,
      renderTimeout: 10000,
      acceptDownloads: true,
      downloadsPath: '/tmp/test-downloads',
    });
    await manager.launch();
    // Проверить, что context создан с правильными настройками (мок Playwright)
  });
  
  it('should wait for download and return metadata', async () => { /* ... */ });
  it('should list active downloads', async () => { /* ... */ });
  it('should save download to specified path', async () => { /* ... */ });
  it('should cancel download', async () => { /* ... */ });
});
#### 3.6.2. Unit-тесты handleDownload (`packages/mcp-server/src/tools/download.test.ts`)

describe('handleDownload', () => {
  it('should wait for download', async () => { /* ... */ });
  it('should list downloads', async () => { /* ... */ });
  it('should require uuid for save mode', async () => { /* ... */ });
  it('should require destination_path for save mode', async () => { /* ... */ });
});
#### 3.6.3. Integration-тесты (`packages/mcp-server/src/integration/download.integration.test.ts`)

describe('Download Integration', () => {
  it('should download file after clicking button', async () => {
    // 1. Navigate → 2. Snapshot → 3. Click download → 4. Wait → 5. Save → 6. Verify
  });
});
---

## 4. Примеры использования

### 4.1. Через SDK (browser extension)

import { executeAction } from '@vsl/sdk';

// LLM-агент выбирает действие download
const result = await executeAction(
  { action: 'download', target_id: 'link_0_0', reasoning: 'Скачать PDF-отчёт' },
  { root: document.body }
);

// result: { success: true, action: 'download', targetId: 'link_0_0', download: { initiated: true, url: '...', filename: '...' } }
### 4.2. Через MCP (агент → MCP-сервер → Playwright)

// 1. Перейти на страницу
await vsl_navigate({ url: 'https://example.com/files' });

// 2. Получить snapshot
const snapshot = await vsl_get_snapshot({});

// 3. Кликнуть по кнопке скачивания
await vsl_execute_action({ action: 'click', target_id: 'btn_download' });

// 4. Ожидать завершение загрузки
const download = await vsl_download({ mode: 'wait', timeout: 30000 });
// → { uuid: "abc123", filename: "report.pdf", url: "...", path: "/tmp/vsl-downloads/report.pdf" }

// 5. Сохранить в нужное место
await vsl_download({ mode: 'save', uuid: download.data.uuid, destination_path: '/home/user/report.pdf' });
### 4.3. LLM-агент выбирает download через Action Model

// LLM получает VSL JSON с элементом:
// { "id": "link_0", "t": "link", "txt": "Скачать отчёт", "act": ["click", "download"] }

// LLM возвращает:
{
  "action": "download",
  "target_id": "link_0",
  "value": null,
  "reasoning": "Ссылка «Скачать отчёт» инициирует загрузку PDF"
}
---

## 5. Конфигурация

### 5.1. Environment variables

VSL_DOWNLOADS_PATH="/path/to/downloads"
VSL_DOWNLOAD_TIMEOUT=60000
VSL_ACCEPT_DOWNLOADS=true
### 5.2. Config file (`~/.vsl/config.json`)

{
  "browser": {
    "headless": true,
    "navigationTimeout": 30000,
    "renderTimeout": 10000,
    "downloadsPath": "/custom/path/downloads",
    "downloadTimeout": 60000,
    "acceptDownloads": true
  }
}
---

## 6. Порядок реализации

| # | Этап | Файлы | Описание |
|---|------|-------|----------|
| 1 | **SDK: Action Model** | `src/llm/actions.ts` | Добавить `download` в VALID_ACTIONS и TARGET_ACTIONS |
| 2 | **SDK: Action Executor** | `src/executor/actionExecutor.ts`, `src/executor/types.ts` | Обработка `download`, обновление ActionResult |
| 3 | **SDK: LLM Prompt** | `src/llm/prompt.ts` | Добавить `download` в PARAMETER_CONVENTIONS, optional few-shot |
| 4 | **SDK: Тесты** | `src/executor/actionExecutor.test.ts`, `src/llm/actions.test.ts`, `src/llm/prompt.test.ts` | Unit-тесты SDK |
| 5 | **MCP: Конфигурация** | `packages/mcp-server/src/config/loader.ts` | Добавить downloadsPath, downloadTimeout, acceptDownloads |
| 6 | **MCP: BrowserManager** | `packages/mcp-server/src/browser/manager.ts` | Context с acceptDownloads, методы waitForDownload/getDownloads/saveDownload/cancelDownload |
| 7 | **MCP: executeAction** | `packages/mcp-server/src/tools/executeAction.ts` | Добавить `download` в VALID_ACTIONS и switch |
| 8 | **MCP: vsl_download tool** | `packages/mcp-server/src/tools/download.ts`, `packages/mcp-server/src/tools/index.ts` | Новый tool + регистрация |
| 9 | **MCP: Тесты** | `packages/mcp-server/src/browser/manager.test.ts`, `packages/mcp-server/src/tools/download.test.ts` | Unit + integration тесты MCP |

---

## 7. Обратная совместимость

- Все новые поля в конфигурации опциональны
- `acceptDownloads: true` по умолчанию — загрузки автоматически принимаются
- Существующие 23 действия в SDK не изменяются — `download` добавляется как 24-е
- Существующие MCP tools не изменяются — `vsl_download` добавляется как 10-й
- `ActionResult.download` — опциональное поле, не ломает существующий код

---

## 8. Ограничения

1. **SDK (browser extension):** `download` = клик по элементу-триггеру. Реальное сохранение файла управляется extension background через `chrome.downloads` API.
2. **MCP Server:** Требует установленный Playwright. В headless mode некоторые сайты могут блокировать скачивание.
3. **Размер файлов:** Очень большие файлы могут превысить таймаут или доступную память.
4. **CORS:** Для кросс-доменных загрузок могут потребоваться дополнительные настройки.

---

## 9. Будущие улучшения

- [ ] Поддержка прогресса загрузки (download.on('progress'))
- [ ] Фильтрация загрузок по типу файла
- [ ] Автоматическая очистка старых загрузок
- [ ] Поддержка множественных одновременных загрузок
- [ ] Интеграция с антивирусом / проверка файлов
- [ ] Поддержка авторизованных загрузок (cookies, headers)