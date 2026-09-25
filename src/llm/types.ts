/**
 * Типы LLM Integration (M1.3, ROADMAP.md T1.3.1–T1.3.5).
 *
 * Архитектурная база:
 *  - ARCHITECTURE.md §2.5 — LLM Integration Layer, промпт-шаблон {vsl_json}+{goal};
 *  - ARCHITECTURE.md §7 — Action Model, формат ответа LLM (§7.4);
 *  - ARCHITECTURE.md §9.4 — API адаптеров: decide({vslJson, goal});
 *  - ARCHITECTURE.md §10.3 — retry 3× exponential backoff;
 *  - DESIGN_SYSTEM.md §4.4 — visual fragments (vf/vf_meta, forward-compatible);
 *  - DEC-002 — model-agnostic: адаптеры провайдеров без SDK-зависимостей.
 *
 * Транспорт (нативный fetch, node>=18) инъецируется через LlmTransport —
 * тесты работают на моках без сети (решение пользователя, clarification M1.3).
 * Ноль runtime-зависимостей: официальные SDK провайдеров НЕ используются.
 */

import type { VslDiff } from '../diff/diffEngine';
import type { VslDocument, VslObject } from '../types/vsl';

/** Вход LLM-адаптера: полный документ или дифф (§2.5, §11.2 — diff-first). */
export type VslInput = VslDocument | VslDiff;

/** Действие LLM — формат ответа модели (ARCHITECTURE.md §7.4). */
export interface LlmAction {
  /** Имя действия из Action Model (§7.1–7.3; см. VALID_ACTIONS в llm/actions). */
  action: string;
  /** ID элемента-цели в VSL JSON — обязателен для действий с целью. */
  target_id?: string;
  /** Значение: текст ввода для type, option для select и т.п. */
  value?: string | null;
  /** Объяснение выбора модели (свободный текст). */
  reasoning?: string;
}

/** Нормализованное использование токенов (маппинг из usage провайдера). */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Ответ провайдера на sendPrompt (T1.3.1): raw-данные БЕЗ валидации. */
export interface LlmResponse {
  /** Текстовое содержимое ответа (если провайдер его вернул). */
  text: string | null;
  /** Raw-объект действия из tool call (валидацию выполняет decide). */
  action?: unknown;
  /** Идентификатор модели, сформировавшей ответ. */
  model: string;
  usage?: LlmUsage;
}

/** Метаданные visual fragment (DESIGN_SYSTEM.md §4.4). */
export interface VslFragmentMeta {
  type?: string;
  format?: string;
  size?: [number, number];
  hash?: string;
  cached_at?: string;
}

/** Объект VSL с forward-compatible полями visual fragments (§4.4). */
export type VslObjectWithVf = VslObject & {
  /** Ссылка на визуальный фрагмент (например, «emb_abc123»). */
  vf?: string;
  /** Метаданные фрагмента. */
  vf_meta?: VslFragmentMeta;
};

/** Данные изображения фрагмента для мультимодальной подачи (DEC-015). */
export interface VisualFragmentData {
  /** MIME-тип изображения, например «image/webp». */
  mediaType: string;
  /** Base64-данные изображения (без data:-префикса). */
  data: string;
}

/** Стор данных фрагментов: ключ — vf-ссылка объекта («emb_abc123»). */
export type VisualFragmentStore = ReadonlyMap<string, VisualFragmentData>;

/**
 * Провайдер-независимая content-часть user-сообщения (T1.5.4, вариант C):
 * адаптеры маппят её в формат провайдера (OpenAI image_url / Anthropic image
 * base64-блок); форма image-части совпадает с VisualFragmentData (DEC-015).
 */
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string };

/**
 * Провайдер-независимое определение tool: одна JSON Schema на оба провайдера
 * (паттерн schema.ts: OpenAI function.parameters / Anthropic input_schema).
 */
export interface LlmToolDef {
  /** Имя tool (execute_action / classify_fragment). */
  name: string;
  /** Описание для модели. */
  description: string;
  /** JSON Schema аргументов. */
  schema: Record<string, unknown>;
}

/** Опции sendPrompt сверх базовых аргументов. */
export interface SendPromptOptions {
  /**
   * Данные изображений для vf-ссылок входа: image-блоки включаются
   * только для ссылок, присутствующих в сторе (lazy loading, §4.4);
   * без стора подача остаётся текстовой.
   */
  visualFragments?: VisualFragmentStore;
}

/** Вход decide (ARCHITECTURE.md §9.4). */
export interface DecideInput {
  /** VSL JSON: VslDocument или VslDiff от VslSnapshotSession. */
  vslJson: VslInput;
  /** Цель пользователя на естественном языке. */
  goal: string;
  /** Данные изображений для vf-ссылок (см. SendPromptOptions). */
  visualFragments?: VisualFragmentStore;
}

/**
 * Инъекция HTTP-транспорта: подмножество сигнатуры fetch.
 * Прод — нативный fetch; тесты — мок (ноль runtime-зависимостей).
 */
export type LlmTransport = (url: string, init: RequestInit) => Promise<Response>;

/** Функция задержки (инъекция для детерминированных тестов retry). */
export type Sleep = (ms: number) => Promise<void>;

/** Конфиг адаптера провайдера (§9.4: new OpenAIAdapter({apiKey, model})). */
export interface LlmAdapterConfig {
  /** API-ключ провайдера. */
  apiKey: string;
  /** Модель; дефолт задаёт адаптер (gpt-4o / claude-sonnet-4-20250514). */
  model?: string;
  /** База API; по умолчанию — официальный endpoint провайдера. */
  baseUrl?: string;
  /** Попыток при сбоях API (§10.3); по умолчанию 3. */
  maxRetries?: number;
  /** Транспорт; по умолчанию — нативный fetch. */
  transport?: LlmTransport;
  /** Задержка между retry-попытками (инъекция для детерминированных тестов; §10.3). */
  sleep?: Sleep;
}

/** Абстрактный интерфейс LLM Adapter (ROADMAP.md T1.3.1). */
export interface LlmAdapter {
  /** Низкий уровень: VSL JSON + задача → ответ провайдера (raw action). */
  sendPrompt(
    vslJson: VslInput,
    task: string,
    options?: SendPromptOptions,
  ): Promise<LlmResponse>;
  /** Convenience (§9.4): решение для цели с валидацией действия (§7.4). */
  decide(input: DecideInput): Promise<LlmAction>;
}

/**
 * Низкоуровневый вызов провайдера (T1.5.4, вариант C): system + user content +
 * один tool → LlmResponse. Реализуют OpenAIAdapter/AnthropicAdapter (sendRaw);
 * потребитель — LlmVisionClassifier (tool «classify_fragment»). Отдельный
 * интерфейс (не extends LlmAdapter): структурная типизация, контракт LlmAdapter
 * не расширяется — существующие реализации и моки не ломаются.
 */
export interface RawLlmCaller {
  sendRaw(
    system: string,
    userContent: readonly LlmContentPart[],
    tool: LlmToolDef,
  ): Promise<LlmResponse>;
}

/** Базовая ошибка LLM-слоя (транспорт/HTTP/формат ответа провайдера). */
export class LlmError extends Error {
  /** HTTP-статус, если ошибка пришла от API (для классификации retry). */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** Ответ модели не прошёл валидацию: неизвестное действие, невалидный target_id. */
export class LlmValidationError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = 'LlmValidationError';
  }
}