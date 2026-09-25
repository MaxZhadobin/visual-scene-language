/**
 * Протокол сообщений extension M1.4 (dc_6, note_1790079041609):
 *  - background → content (вкладка): vsl/snapshot, vsl/execute;
 *  - popup → background (service worker): vsl/start, vsl/stop;
 *  - content → background (vision-ветка T1.5.5): vsl/capture, vsl/classify;
 *  - статусы агентного цикла — chrome.storage.local (ключ AGENT_STATE_KEY).
 *
 * Модуль НЕ обращается к chrome API — импортируется content, background, popup
 * и структурными тестами tests/extension (jest/ts-jest компилирует его вместе
 * с SDK-типами). Runtime-строки — на английском (решение 22.09.2026).
 */

import type { LlmAction, VisualFragmentData } from '../../src/llm/types';
import type { SnapshotResult } from '../../src/session/snapshotSession';
import type { VisionClassification } from '../../src/vision/types';

/** background → content: построить VSL-снапшот (полный документ или дифф). */
export const MSG_SNAPSHOT = 'vsl/snapshot';

/** background → content: исполнить действие LLM на DOM страницы. */
export const MSG_EXECUTE = 'vsl/execute';

/** popup → background: запустить агентный цикл. */
export const MSG_START = 'vsl/start';

/** popup → background: запросить остановку цикла (проверяется между шагами). */
export const MSG_STOP = 'vsl/stop';

/** content → background: скриншот viewport вкладки (chrome.tabs.captureVisibleTab). */
export const MSG_CAPTURE = 'vsl/capture';

/** content → background: классификация фрагмента через LLM vision API. */
export const MSG_CLASSIFY = 'vsl/classify';

/** LLM-провайдеры, поддерживаемые адаптерами M1.3 (§9.4). */
export type LlmProvider = 'openai' | 'anthropic' | 'qwen';

/** background → content. */
export interface SnapshotRequest {
  type: typeof MSG_SNAPSHOT;
  /** Vision-ветка (T1.5.5): обогащение снапшота через enrichWithVision. */
  vision?: boolean;
}

/** Ответ content на vsl/snapshot: снапшот + (при vision) данные фрагментов. */
export interface SnapshotResponse {
  snapshot: SnapshotResult;
  /** Данные фрагментов (base64) по vf_id — только при vision=true (DEC-015). */
  fragments?: Record<string, VisualFragmentData>;
}

export interface ExecuteRequest {
  type: typeof MSG_EXECUTE;
  action: LlmAction;
}

export type ContentMessage = SnapshotRequest | ExecuteRequest;

/** content → background: запрос скриншота viewport (vision-ветка, T1.5.5). */
export interface CaptureRequest {
  type: typeof MSG_CAPTURE;
}

/** background → content: data-URL скриншота или описание сбоя. */
export interface CaptureResponse {
  dataUrl?: string;
  error?: string;
}

/** content → background: классификация фрагмента (vision-ветка, T1.5.5). */
export interface ClassifyRequest {
  type: typeof MSG_CLASSIFY;
  /** Данные изображения фрагмента (mediaType + base64 без data:-префикса). */
  image: VisualFragmentData;
}

/** background → content: результат классификации или описание сбоя. */
export interface ClassifyResponse {
  classification?: VisionClassification;
  error?: string;
}

/** popup → background. */
export interface StartRequest {
  type: typeof MSG_START;
  goal: string;
  provider: LlmProvider;
  apiKey: string;
  /** Кастомный baseUrl API (для Alibaba Qwen и совместимых); опционально. */
  baseUrl?: string;
  /** Модель; опционально (дефолт задаёт адаптер). */
  model?: string;
  /** Лимит шагов цикла; по умолчанию DEFAULT_MAX_STEPS (решение dc_6). */
  maxSteps?: number;
}

export interface StopRequest {
  type: typeof MSG_STOP;
}

export type BackgroundMessage = StartRequest | StopRequest;

/** Подтверждение background на команду popup (start/stop). */
export interface AckResponse {
  ok: boolean;
  /** Машиночитаемое описание отказа (например, «цикл уже запущен»). */
  error?: string;
}

/** Запись одного шага агентного цикла (журнал для popup). */
export interface AgentStepRecord {
  step: number;
  action: string;
  reasoning?: string;
  success: boolean;
  error?: string;
}

/** Статусы агентного цикла. */
export type AgentStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error';

/** Состояние агента в chrome.storage.local — пишет background, читает popup. */
export interface AgentState {
  status: AgentStatus;
  goal: string;
  /** Номер текущего/последнего шага (1-based; 0 — цикл ещё не начат). */
  step: number;
  maxSteps: number;
  steps: AgentStepRecord[];
  /** Машиночитаемое описание сбоя при status='error'. */
  error?: string;
}

/** Ключ chrome.storage.local для AgentState. */
export const AGENT_STATE_KEY = 'vsl/agentState';

/** Дефолтный лимит шагов агентного цикла (решение dc_6). */
export const DEFAULT_MAX_STEPS = 10;