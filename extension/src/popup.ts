/**
 * Popup UI (extension/popup.html + dist/popup.js) — M1.4, dc_6
 * (note_1790079041609, подтверждено пользователем).
 *
 * Ответственность:
 *  - ввод цели, выбор LLM-провайдера (openai|anthropic) и API-ключа;
 *  - provider+apiKey сохраняются в chrome.storage.local (ключ SETTINGS_KEY)
 *    и восстанавливаются при открытии popup;
 *  - Start → chrome.runtime.sendMessage("vsl/start") в background (агентный
 *    цикл), Stop → "vsl/stop" (флаг проверяется циклом между шагами);
 *  - статус цикла читается из chrome.storage.local (AGENT_STATE_KEY) и
 *    обновляется подпиской storage.onChanged — popup не держит своего
 *    состояния и переживает закрытие/открытие окна.
 *
 * Runtime-строки — на английском (решение 22.09.2026).
 */

import { AGENT_STATE_KEY, MSG_START, MSG_STOP } from './protocol';
import type { AckResponse, AgentState, LlmProvider, StartRequest } from './protocol';

/** Ключ chrome.storage.local с настройками popup (provider + apiKey). */
const SETTINGS_KEY = 'vsl/settings';

/** Настройки popup; переживают перезапуск браузера (chrome.storage.local). */
interface Settings {
  provider: LlmProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Скрипт подключён в конце body — DOM гарантированно разобран. */
function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Popup markup error: #${id} not found`);
  }
  return element as T;
}

const goalInput = requireElement<HTMLTextAreaElement>('goal');
const providerSelect = requireElement<HTMLSelectElement>('provider');
const baseUrlInput = requireElement<HTMLInputElement>('baseUrl');
const baseUrlField = requireElement<HTMLDivElement>('baseUrlField');
const baseUrlHint = requireElement<HTMLDivElement>('baseUrlHint');
const modelInput = requireElement<HTMLInputElement>('model');
const modelHint = requireElement<HTMLDivElement>('modelHint');
const apiKeyInput = requireElement<HTMLInputElement>('apiKey');
const startButton = requireElement<HTMLButtonElement>('start');
const stopButton = requireElement<HTMLButtonElement>('stop');
const statusLine = requireElement<HTMLParagraphElement>('statusLine');
const errorLine = requireElement<HTMLParagraphElement>('errorLine');
const logList = requireElement<HTMLOListElement>('log');

function showError(message: string): void {
  errorLine.textContent = message;
}

function clearError(): void {
  errorLine.textContent = '';
}

/** Дефолтные модели по провайдеру (подсказка в placeholder). */
const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  qwen: 'qwen3.8-max',
};

/** Дефолтные baseUrl по провайдеру. */
const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  qwen: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
};

/** Обновляет UI при смене провайдера: скрывает baseUrl для Anthropic, обновляет placeholder/hint. */
function updateProviderUI(): void {
  const provider = providerSelect.value as LlmProvider;
  // Anthropic имеет фиксированный endpoint — кастомный baseUrl не нужен.
  if (provider === 'anthropic') {
    baseUrlField.classList.add('hidden');
  } else {
    baseUrlField.classList.remove('hidden');
  }
  baseUrlInput.placeholder = DEFAULT_BASE_URLS[provider];
  baseUrlHint.textContent = provider === 'anthropic'
    ? 'Fixed endpoint (Anthropic API)'
    : 'Leave empty for default endpoint';
  modelInput.placeholder = DEFAULT_MODELS[provider];
  modelHint.textContent = `Default: ${DEFAULT_MODELS[provider]}`;
}

/** Рендер состояния агентного цикла: статус, счётчик шагов, журнал. */
function renderState(state: AgentState | undefined): void {
  if (state === undefined) {
    statusLine.textContent = 'Status: idle';
    logList.replaceChildren();
    return;
  }
  statusLine.textContent = `Status: ${state.status} — step ${state.step}/${state.maxSteps}`;
  const items = state.steps.map((record) => {
    const item = document.createElement('li');
    const outcome = record.success
      ? 'ok'
      : record.error === undefined
        ? 'failed'
        : `failed: ${record.error}`;
    item.textContent = `#${record.step} ${record.action} — ${outcome}`;
    return item;
  });
  logList.replaceChildren(...items);
}

/** Восстановление настроек и последнего статуса при открытии popup. */
/** Восстановление настроек и последнего статуса при открытии popup. */
async function restoreState(): Promise<void> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, AGENT_STATE_KEY]);
  const settings = stored[SETTINGS_KEY] as Settings | undefined;
  if (settings !== undefined) {
    providerSelect.value = settings.provider;
    apiKeyInput.value = settings.apiKey;
    baseUrlInput.value = settings.baseUrl ?? '';
    modelInput.value = settings.model ?? '';
  }
  updateProviderUI();
  renderState(stored[AGENT_STATE_KEY] as AgentState | undefined);
}

/** Start: валидация полей, сохранение настроек, команда vsl/start в background. */
async function handleStart(): Promise<void> {
  clearError();
  const goal = goalInput.value.trim();
  if (goal.length === 0) {
    showError('Enter a goal for the agent');
    return;
  }
  const apiKey = apiKeyInput.value.trim();
  if (apiKey.length === 0) {
    showError('Enter an API key');
    return;
  }
  const provider = providerSelect.value as LlmProvider;
  const baseUrl = baseUrlInput.value.trim() || undefined;
  const model = modelInput.value.trim() || undefined;
  const settings: Settings = { provider, apiKey, baseUrl, model };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  const request: StartRequest = { type: MSG_START, goal, provider, apiKey, baseUrl, model };
  try {
    const ack = (await chrome.runtime.sendMessage(request)) as AckResponse | undefined;
    if (ack !== undefined && !ack.ok) {
      showError(ack.error ?? 'Failed to start the agent loop');
    }
  } catch (error) {
    showError(toErrorMessage(error));
  }
}

/** Stop: команда vsl/stop — цикл завершится между шагами (status='stopped'). */
async function handleStop(): Promise<void> {
  clearError();
  try {
    const ack = (await chrome.runtime.sendMessage({ type: MSG_STOP })) as
      | AckResponse
      | undefined;
    if (ack !== undefined && !ack.ok) {
      showError(ack.error ?? 'Failed to stop the agent loop');
    }
  } catch (error) {
    showError(toErrorMessage(error));
  }
}

startButton.addEventListener('click', () => {
  void handleStart();
});
stopButton.addEventListener('click', () => {
  void handleStop();
});

// Статус пишет background в chrome.storage.local — popup только подписан.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  const change = changes[AGENT_STATE_KEY];
  if (change !== undefined) {
    renderState(change.newValue as AgentState | undefined);
  }
});


// Обновление UI при смене провайдера.
providerSelect.addEventListener('change', () => {
  updateProviderUI();
});
void restoreState();