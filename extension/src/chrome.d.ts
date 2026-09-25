/**
 * Минимальные ambient-типы Chrome Extension API (MV3), используемые extension/.
 *
 * @types/chrome НЕ добавляется (решение dc_6: без новых зависимостей) —
 * объявляем только используемое подмножество API. Типы нужны читателю и IDE:
 * гейты extension не тайпчекают (S6 — только src, tsconfig.json), сборка —
 * esbuild через tsup без тайпчека (extension/tsup.config.ts).
 *
 * Файл — ambient-декларации без import/export (script, не module):
 * подхватывается редактором автоматически, в бандлы не попадает.
 * Конкретные формы сообщений типизированы в protocol.ts.
 */

interface ChromeEvent<T extends (...args: never[]) => unknown> {
  addListener(callback: T): void;
}

/** Сообщение — JSON-объект с дискриминантом type; конкретика в protocol.ts. */
interface ChromeMessage {
  type: string;
}

interface ChromeSendMessage {
  (message: unknown): Promise<unknown>;
}

/** sender сообщения onMessage: вкладка-источник (для сообщений из content). */
interface ChromeSender {
  tab?: ChromeTab;
}

/**
 * Колбэк onMessage: синхронный ответ — sendResponse сразу; асинхронный —
 * вернуть true (канал остаётся открытым до sendResponse).
 */
interface ChromeOnMessageCallback {
  (
    message: ChromeMessage,
    sender: ChromeSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | void;
}

interface ChromeRuntime {
  onMessage: ChromeEvent<ChromeOnMessageCallback>;
  sendMessage: ChromeSendMessage;
}

interface ChromeTab {
  id?: number;
  windowId?: number;
}

interface ChromeTabQueryInfo {
  active?: boolean;
  currentWindow?: boolean;
}

interface ChromeCaptureVisibleTabOptions {
  format: 'png' | 'jpeg';
  quality?: number;
}

interface ChromeTabs {
  query(queryInfo: ChromeTabQueryInfo): Promise<ChromeTab[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  /** Скриншот видимой области вкладки (T1.5.5); требует <all_urls> host permission. */
  captureVisibleTab(windowId: number, options: ChromeCaptureVisibleTabOptions): Promise<string>;
}

interface ChromeStorageChangeEvent {
  (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    areaName: string,
  ): void;
}

interface ChromeStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged: ChromeEvent<ChromeStorageChangeEvent>;
}

interface ChromeStorage {
  local: ChromeStorageArea;
}

declare const chrome: {
  runtime: ChromeRuntime;
  tabs: ChromeTabs;
  storage: ChromeStorage;
};