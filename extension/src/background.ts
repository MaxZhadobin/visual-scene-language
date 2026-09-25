/**
 * MV3 service worker — минимальный агентный цикл (dc_6, note_1790079041609,
 * подтверждено пользователем).
 *
 * Контракт:
 *  - vsl/start {goal, provider, apiKey, maxSteps?} от popup → цикл до maxSteps
 *    (дефолт DEFAULT_MAX_STEPS) или vsl/stop (флаг проверяется между шагами):
 *      1. tabs.sendMessage("vsl/snapshot", {vision}) → SnapshotResponse
 *         (vision-ветка T1.5.5: content обогащает снапшот через
 *         enrichWithVision и возвращает данные фрагментов отдельно);
 *      2. adapter.decide({vslJson, goal, visualFragments}) → LlmAction
 *         (валидация §7.4 внутри адаптера: action ∈ VALID_ACTIONS,
 *         target_id ∈ VSL JSON);
 *      3. tabs.sendMessage("vsl/execute", {action}) → ActionResult;
 *  - софт-фейлы executor'а (ActionResult{success:false}) НЕ роняют цикл —
 *    пишутся в журнал шагов; сбой канала/адаптера завершает цикл status='error';
 *  - статус шагов — chrome.storage.local (ключ AGENT_STATE_KEY), popup читает;
 *  - один цикл за раз; повторный vsl/start во время работы отклоняется.
 *  - vision-ветка T1.5.5: background обслуживает vsl/capture
 *    (chrome.tabs.captureVisibleTab) и vsl/classify (LLM vision API) от
 *    content — эти API доступны только в service worker (MV3).
 *
 * Runtime-строки — на английском (решение 22.09.2026).
 */

import type { ActionResult } from '../../src/executor/types';
import { AnthropicAdapter } from '../../src/llm/anthropic';
import { OpenAIAdapter } from '../../src/llm/openai';
import type { LlmAction, LlmAdapter } from '../../src/llm/types';
import { LlmVisionClassifier } from '../../src/vision/llmVisionClassifier';
import {
  AGENT_STATE_KEY,
  DEFAULT_MAX_STEPS,
  MSG_CAPTURE,
  MSG_CLASSIFY,
  MSG_EXECUTE,
  MSG_SNAPSHOT,
  MSG_START,
  MSG_STOP,
} from './protocol';
import type {
  AgentState,
  AgentStepRecord,
  ClassifyRequest,
  SnapshotResponse,
  StartRequest,
} from './protocol';

let running = false;
let stopRequested = false;

/**
 * Классификатор фрагментов (T1.5.5) — module-level на время цикла (решение
 * note_1790236209349): создаётся из адаптера при vsl/start, обслуживает
 * сообщения vsl/classify от content (API-ключ не ходит в каждом сообщении),
 * сбрасывается в finally после цикла.
 */
let visionClassifier: LlmVisionClassifier | null = null;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Фабрика адаптера по имени провайдера из popup (адаптеры M1.3, §9.4). */
function createAdapter(provider: string, apiKey: string, baseUrl?: string, model?: string): LlmAdapter {
  if (provider === 'anthropic') return new AnthropicAdapter({ apiKey, model });
  if (provider === 'openai') return new OpenAIAdapter({ apiKey, baseUrl, model });
  // Alibaba Qwen (DEC-025): OpenAI-compatible API с кастомным baseUrl.
  if (provider === 'qwen') {
    const qwenBaseUrl = baseUrl ?? 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
    return new OpenAIAdapter({ apiKey, baseUrl: qwenBaseUrl, model: model ?? 'qwen3.8-max' });
  }
  throw new Error(`Unknown LLM provider: "${provider}" — expected "openai", "anthropic", or "qwen"`);
}

async function writeState(state: AgentState): Promise<void> {
  await chrome.storage.local.set({ [AGENT_STATE_KEY]: state });
}

/** Активная вкладка текущего окна — цель агентного цикла. */
async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    throw new Error('No active tab found — open a regular web page and try again');
  }
  return tab.id;
}

/** Запись шага для журнала popup: действие, reasoning, исход исполнения. */
function stepRecord(step: number, action: LlmAction, result: ActionResult): AgentStepRecord {
  return {
    step,
    action: action.action,
    reasoning: action.reasoning,
    success: result.success,
    error: result.error,
  };
}

/**
 * vsl/capture (T1.5.5): скриншот viewport вкладки-источника.
 * captureVisibleTab доступен только в background (MV3); windowId берём из
 * sender.tab — сообщение из content всегда знает свою вкладку.
 */
async function handleCapture(
  sender: ChromeSender,
  sendResponse: (response?: unknown) => void,
): Promise<void> {
  try {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      throw new Error('vsl/capture: sender tab has no windowId');
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    sendResponse({ dataUrl });
  } catch (error) {
    sendResponse({ error: toErrorMessage(error) });
  }
}

/**
 * vsl/classify (T1.5.5): классификация фрагмента через LLM vision API —
 * LlmVisionClassifier над адаптером активного цикла. Ошибки (включая «vision
 * не активен») возвращаются как {error} — content пробросит их в
 * enrichWithVision (best-effort: элемент без аннотации, снапшот не роняется).
 */
async function handleClassify(
  request: ClassifyRequest,
  sendResponse: (response?: unknown) => void,
): Promise<void> {
  try {
    if (visionClassifier === null) {
      throw new Error('vsl/classify: no active agent loop with vision');
    }
    sendResponse({ classification: await visionClassifier.classify(request.image) });
  } catch (error) {
    sendResponse({ error: toErrorMessage(error) });
  }
}

async function runAgentLoop(start: StartRequest): Promise<void> {
  const maxSteps = start.maxSteps ?? DEFAULT_MAX_STEPS;
  const state: AgentState = {
    status: 'running',
    goal: start.goal,
    step: 0,
    maxSteps,
    steps: [],
  };
  await writeState(state);
  try {
    const adapter = createAdapter(start.provider, start.apiKey, start.baseUrl, start.model);
    // Vision-ветка (T1.5.5): классификатор живёт module-level на время цикла —
    // обслуживает vsl/classify от content (ключ не ходит в каждом сообщении).
    visionClassifier = new LlmVisionClassifier(adapter);
    const tabId = await getActiveTabId();

    for (let step = 1; step <= maxSteps; step += 1) {
      if (stopRequested) {
        state.status = 'stopped';
        state.step = step - 1; // последний завершённый шаг
        await writeState(state);
        return;
      }

      state.step = step;
      await writeState(state);

      // Шаг 1: снапшот — полный документ на первом шаге/смене URL, далее дифф.
      // vision=true (T1.5.5): content обогащает снапшот (enrichWithVision) и
      // возвращает данные фрагментов отдельно (SnapshotResponse.fragments).
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: MSG_SNAPSHOT,
        vision: true,
      })) as SnapshotResponse;

      // Шаг 2: решение LLM (валидация действия по VSL JSON внутри decide, §7.4);
      // данные фрагментов (base64) — image-блоки в decide (DEC-015, lazy loading).
      const action: LlmAction = await adapter.decide({
        vslJson: response.snapshot,
        goal: start.goal,
        visualFragments: new Map(Object.entries(response.fragments ?? {})),
      });

      // Шаг 3: исполнение на живом DOM (soft-fail — ActionResult без исключений).
      const result = (await chrome.tabs.sendMessage(tabId, {
        type: MSG_EXECUTE,
        action,
      })) as ActionResult;

      state.steps.push(stepRecord(step, action, result));
      await writeState(state);
    }

    state.status = 'done';
    await writeState(state);
  } catch (error) {
    state.status = 'error';
    state.error = toErrorMessage(error);
    try {
      await writeState(state);
    } catch {
      /* storage недоступен — статус сохранить некуда, цикл всё равно завершён */
    }
  } finally {
    running = false;
    stopRequested = false;
    visionClassifier = null; // ключ/классификатор не живут вне цикла
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG_START) {
    if (running) {
      sendResponse({ ok: false, error: 'Agent loop is already running' });
      return undefined;
    }
    const start = message as unknown as StartRequest;
    running = true;
    stopRequested = false;
    sendResponse({ ok: true });
    void runAgentLoop(start);
    return undefined; // прогресс цикла — через chrome.storage, не через этот канал
  }
  if (message.type === MSG_STOP) {
    stopRequested = true; // проверяется циклом между шагами
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.type === MSG_CAPTURE) {
    // Скриншот viewport (T1.5.5): только background имеет captureVisibleTab.
    void handleCapture(sender, sendResponse);
    return true; // канал открыт до sendResponse (контракт MV3)
  }
  if (message.type === MSG_CLASSIFY) {
    // Классификация через LLM vision API (T1.5.5) — только background (CORS).
    const request = message as unknown as ClassifyRequest;
    void handleClassify(request, sendResponse);
    return true;
  }
  return undefined; // сообщение вне протокола background
});