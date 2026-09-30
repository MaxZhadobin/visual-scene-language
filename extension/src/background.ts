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
 * Iframe support (M2.1):
 *  - background агрегирует snapshots из всех фреймов в единый VslDocument;
 *  - каждый content script в iframe отправляет MSG_FRAME_SNAPSHOT;
 *  - background хранит frame snapshots в registry;
 *  - target_id для элементов iframe: frame_{frameId}:{localId};
 *  - background маршрутизирует vsl/execute по frameId из target_id.
 *
 * Runtime-строки — на английском (решение 22.09.2026).
 */

import type { ActionResult } from '../../src/executor/types';
import { AnthropicAdapter } from '../../src/llm/anthropic';
import { OpenAIAdapter } from '../../src/llm/openai';
import type { LlmAction, LlmAdapter, RawLlmCaller } from '../../src/llm/types';
import type { VslDocument, VslObject } from '../../src/types/vsl';
import { LlmVisionClassifier } from '../../src/vision/llmVisionClassifier';
import {
  AGENT_STATE_KEY,
  DEFAULT_MAX_STEPS,
  MSG_CAPTURE,
  MSG_CLASSIFY,
  MSG_EXECUTE,
  MSG_FRAME_SNAPSHOT,
  MSG_IFRAME_FRAME_IDS,
  MSG_IFRAME_RECTS,
  MSG_SNAPSHOT,
  MSG_START,
  MSG_STOP,
} from './protocol';
import type {
  AgentState,
  AgentStepRecord,
  ClassifyRequest,
  FrameSnapshotResponse,
  IframeFrameIdsRequest,
  IframeFrameIdsResponse,
  IframeRectsMessage,
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

/**
 * Iframe support (M2.1): registry frame snapshots.
 * Каждый content script в iframe отправляет MSG_FRAME_SNAPSHOT — background
 * хранит snapshots в Map<frameId, FrameSnapshotResponse>. При агрегации
 * snapshots все frame snapshots добавляются в единый VslDocument как iframe-объекты.
 */
const frameRegistry = new Map<number, FrameSnapshotResponse>();

/**
 * Iframe support (M2.1): реальные координаты iframe элементов из parent DOM.
 * Top frame content script собирает rects через collectIframeRects() и отправляет
 * через MSG_IFRAME_RECTS. Background хранит их в Map<url, rect> и использует
 * при агрегации для установки p и s iframe-объектов (вместо захардкоженных [0, 0]).
 */
const iframeRectsMap = new Map<string, { x: number; y: number; width: number; height: number }>();

/**
 * Iframe support (M2.1 rework): explicit synchronization mechanism.
 * Background ждёт MSG_FRAME_SNAPSHOT от всех фреймов (countdown) перед агрегацией.
 * pendingFrameSync создаётся при получении MSG_IFRAME_RECTS с iframeCount > 0.
 * Каждый MSG_FRAME_SNAPSHOT decrement received count. Когда received === expected,
 * Promise resolve. Timeout fallback предотвращает deadlock если фрейм не ответил.
 */
let pendingFrameSync: { expected: number; received: number; resolve: () => void } | null = null;
let frameSyncTimeout: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Iframe support (M2.1): агрегирует snapshots из всех фреймов в единый VslDocument.
 * Top frame snapshot + все iframe snapshots как iframe-объекты.
 * Iframe support (M2.1 rework): агрегирует snapshots из всех фреймов в единый VslDocument.
 * Поддерживает nested iframes (iframe внутри iframe) через рекурсивную обработку на основе parentFrameId.
 * Координаты iframe-объектов (p, s) берутся из rect iframe элемента в parent DOM.
 */
export function aggregateSnapshotsWithFrames(
  topFrameSnapshot: SnapshotResponse,
  ): SnapshotResponse {
    if (frameRegistry.size === 0) {
      return topFrameSnapshot; // нет iframe — возвращаем как есть
    }
  
    // Iframe support (M2.1 rework): строим дерево фреймов на основе parentFrameId.
    // parentFrameId === 0 означает top frame, > 0 — iframe.
    const childrenMap = new Map<number, number[]>();
    for (const [frameId, frameSnap] of frameRegistry.entries()) {
      const parentId = frameSnap.parentFrameId ?? 0; // 0 = top frame
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(frameId);
    }
  
    // Рекурсивная функция для добавления iframe-объектов в parent VSL document
    function addIframeObjectsToParent(
      parentSnapshot: VslDocument,
      parentFrameId: number,
    ): void {
      const childFrameIds = childrenMap.get(parentFrameId) ?? [];
      for (const childFrameId of childFrameIds) {
        const childFrameSnap = frameRegistry.get(childFrameId);
        if (!childFrameSnap || !('objects' in childFrameSnap.snapshot)) {
          continue; // VslDiff — пропускаем
        }
        
        // Координаты iframe относительно parent frame
        // Для direct children top frame используем iframeRectsMap (абсолютные координаты на странице)
        // Для nested iframes используем [0, 0] (fallback) — координаты относительно parent iframe
        const rect = iframeRectsMap.get(childFrameSnap.url);
        const position: [number, number] = rect ? [rect.x, rect.y] : [0, 0];
        const size: [number, number] = rect ? [rect.width, rect.height] : [0, 0];
        
        const iframeObject: VslObject = {
          id: `iframe_${childFrameId}`,
          t: 'iframe' as const,
          p: position,
          s: size,
          iframe: {
            url: childFrameSnap.url,
            frameId: childFrameId,
            vsl: childFrameSnap.snapshot as VslDocument,
          },
        };
        
        parentSnapshot.objects = parentSnapshot.objects ?? [];
        parentSnapshot.objects.push(iframeObject);
        
        // Рекурсивно добавляем children этого iframe (nested iframes)
        addIframeObjectsToParent(childFrameSnap.snapshot as VslDocument, childFrameId);
      }
    }
  
    // SnapshotResult может быть VslDiff — проверяем, что это VslDocument
    const topSnapshot = topFrameSnapshot.snapshot;
    if (!('objects' in topSnapshot)) {
      // Это VslDiff, а не VslDocument — возвращаем как есть (iframe не агрегируем)
      return topFrameSnapshot;
    }
  
    // Добавляем iframe-объекты рекурсивно начиная с top frame (parentFrameId = 0)
    addIframeObjectsToParent(topSnapshot as VslDocument, 0);
  
    // Объединяем fragments из всех фреймов
    const aggregatedFragments = {
      ...(topFrameSnapshot.fragments ?? {}),
    };
    for (const frameSnap of frameRegistry.values()) {
      if (frameSnap.fragments) {
        Object.assign(aggregatedFragments, frameSnap.fragments);
      }
    }
  
    return {
      snapshot: topSnapshot,
      fragments: Object.keys(aggregatedFragments).length > 0 ? aggregatedFragments : undefined,
    };
  }

/**
 * Iframe support (M2.1): парсит frame-префикс из target_id.
 * Формат: frame_{frameId}:{localId} (например, frame_3:button_0_1)
 * Если префикс отсутствует — возвращает frameId=null и исходный targetId.
 */
export function parseFramePrefix(targetId: string): { frameId: number | null; localId: string } {
  const match = targetId.match(/^frame_(\d+):(.+)$/);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return {
      frameId: Number(match[1]),
      localId: match[2],
    };
  }
  return {
    frameId: null,
    localId: targetId,
  };
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
    visionClassifier = new LlmVisionClassifier(adapter as unknown as RawLlmCaller);
    // Iframe support (M2.1): очищаем registry и rects map перед каждым циклом,
    // чтобы не было stale snapshots от предыдущих циклов.
    frameRegistry.clear();
    iframeRectsMap.clear();
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
      // Iframe support (M2.1): агрегируем snapshots из всех фреймов.
      const topFrameResponse = (await chrome.tabs.sendMessage(tabId, {
        type: MSG_SNAPSHOT,
        vision: true,
      })) as SnapshotResponse;
      
      // Iframe support (M2.1 rework): ждём iframe snapshots через explicit synchronization.
      // Content scripts в iframe отправляют MSG_FRAME_SNAPSHOT асинхронно через
      // chrome.runtime.sendMessage (fire-and-forget). Background ждёт все фреймы
      // через Promise-based countdown механизм (pendingFrameSync).
      // Timeout fallback (500ms) предотвращает deadlock если фрейм не ответил.
      const syncPromise = (globalThis as unknown as { __pendingFrameSyncPromise?: Promise<void> }).__pendingFrameSyncPromise;
      if (syncPromise) {
        await syncPromise;
        (globalThis as unknown as { __pendingFrameSyncPromise?: Promise<void> }).__pendingFrameSyncPromise = undefined;
      }
      
      const response = aggregateSnapshotsWithFrames(topFrameResponse);

      // Шаг 2: решение LLM (валидация действия по VSL JSON внутри decide, §7.4);
      // данные фрагментов (base64) — image-блоки в decide (DEC-015, lazy loading).
      const action: LlmAction = await adapter.decide({
        vslJson: response.snapshot,
        goal: start.goal,
        visualFragments: new Map(Object.entries(response.fragments ?? {})),
      });

      // Шаг 3: исполнение на живом DOM (soft-fail — ActionResult без исключений).
      // Iframe support (M2.1): маршрутизация execute по frameId из target_id.
      // chrome.tabs.sendMessage принимает options.frameId как третий параметр
      // для отправки сообщения в конкретный фрейм (all_frames: true в manifest).

      const { frameId: targetFrameId, localId } = parseFramePrefix(action.target_id ?? '');
      const executeAction = { ...action, target_id: localId };
      const executeMessage = { type: MSG_EXECUTE, action: executeAction };
      // @ts-expect-error: @types/chrome 0.0.287 не содержит frameId в MessageOptions для tabs.sendMessage, но Chrome API поддерживает его (официальная документация).
      const result = (await chrome.tabs.sendMessage(tabId, executeMessage, { frameId: targetFrameId ?? 0 })) as ActionResult;
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
    frameRegistry.clear(); // iframe snapshots не живут вне цикла
    iframeRectsMap.clear(); // iframe rects не живут вне цикла
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
  
  if (message.type === MSG_FRAME_SNAPSHOT) {
    // Iframe support (M2.1 rework): обработка MSG_FRAME_SNAPSHOT от content scripts в iframe.
    const frameSnapshot = message as unknown as FrameSnapshotResponse;
    // ChromeSender.frameId доступен в MV3 (type definition может отсутствовать).
    const frameId = (sender as unknown as { frameId?: number }).frameId;
    if (frameId !== undefined && frameId > 0) {
      // Iframe support (M2.1 rework): определяем parentFrameId через chrome.webNavigation API.
      // Это позволяет строить иерархию фреймов для nested iframes (iframe внутри iframe).
      (async () => {
        let parentFrameId: number | null = null;
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parentInfo = await (chrome as any).webNavigation.getParentFrameId({ tabId, frameId });
            parentFrameId = parentInfo?.parentFrameId ?? null;
            // parentFrameId === 0 означает top frame — для direct children top frame это корректно.
            // Для nested iframes parentFrameId > 0.
          } catch {
            // webNavigation API недоступен или ошибка — fallback на null.
            parentFrameId = null;
          }
        }
        
        // Сохраняем snapshot в registry с frameId и parentFrameId
        frameRegistry.set(frameId, { ...frameSnapshot, frameId, parentFrameId });
        
        // Iframe support (M2.1 rework): explicit synchronization countdown.
        // Decrement received count и resolve Promise когда все фреймы ответили.
        if (pendingFrameSync) {
          pendingFrameSync.received++;
          if (pendingFrameSync.received >= pendingFrameSync.expected) {
            // Все фреймы ответили — очищаем timeout и resolve Promise
            if (frameSyncTimeout) {
              clearTimeout(frameSyncTimeout);
              frameSyncTimeout = null;
            }
            pendingFrameSync.resolve();
            pendingFrameSync = null;
          }
        }
      })();
    }
    return undefined; // не отвечаем (fire-and-forget)
  }

  if (message.type === MSG_IFRAME_RECTS) {
    // Iframe support (M2.1 rework): обработка MSG_IFRAME_RECTS от top frame content script.
    // Top frame собирает rects всех iframe элементов через collectIframeRects()
    // и отправляет их в background для установки координат iframe-объектов.
    const rectsMessage = message as unknown as IframeRectsMessage;
    
    // Rework 3: динамическая очистка stale frames из registry.
    // MSG_IFRAME_RECTS содержит актуальный список iframe на странице — удаляем из registry
    // фреймы, которых больше нет (например, динамически удалённые iframe).
    const currentUrls = new Set(rectsMessage.iframes.map(({ url }) => url));
    for (const [frameId, frameSnap] of frameRegistry.entries()) {
      if (!currentUrls.has(frameSnap.url)) {
        frameRegistry.delete(frameId);
      }
    }
    for (const url of iframeRectsMap.keys()) {
      if (!currentUrls.has(url)) {
        iframeRectsMap.delete(url);
      }
    }
    
    for (const { url, rect } of rectsMessage.iframes) {
      iframeRectsMap.set(url, rect);
    }
    
    // Iframe support (M2.1 rework): explicit synchronization mechanism.
    // Создаём Promise для ожидания MSG_FRAME_SNAPSHOT от всех фреймов.
    // iframeCount — количество iframe, которые должны отправить snapshots.
    // Promise сохраняется в module-level переменную pendingFrameSync.
    // runAgentLoop ждёт этот Promise после получения snapshot от top frame.
    if (rectsMessage.iframeCount > 0) {
      pendingFrameSync = {
        expected: rectsMessage.iframeCount,
        received: 0,
        resolve: () => {}, // будет перезаписан в Promise constructor
      };
      
      // Создаём Promise, который resolve когда все фреймы отправят snapshots
      // или timeout (500ms) для предотвращения deadlock.
      const syncPromise = new Promise<void>((resolve) => {
        pendingFrameSync!.resolve = resolve;
      });
      
      // Timeout fallback: если фрейм не ответил за 500ms, продолжаем агрегацию
      frameSyncTimeout = setTimeout(() => {
        if (pendingFrameSync) {
          pendingFrameSync.resolve();
          pendingFrameSync = null;
        }
      }, 500);
      
      // Сохраняем Promise в module-level переменную для runAgentLoop
      // (не await здесь — message handler не может await)
      (globalThis as unknown as { __pendingFrameSyncPromise?: Promise<void> }).__pendingFrameSyncPromise = syncPromise;
    }
    
    return undefined; // не отвечаем (fire-and-forget)
  }
  if (message.type === MSG_IFRAME_FRAME_IDS) {
    // Iframe support (M2.1 rework): обработка MSG_IFRAME_FRAME_IDS от top frame content script.
    // Top frame собирает URL iframe элементов через collectIframeRects() и отправляет запрос
    // для получения frameId из frameRegistry. Background ищет frameId по URL и возвращает маппинг.
    const request = message as unknown as IframeFrameIdsRequest;
    const frameIds: Record<string, number> = {};
    
    // Ищем frameId в frameRegistry по URL
    for (const url of request.urls) {
      for (const [frameId, frameSnap] of frameRegistry.entries()) {
        if (frameSnap.url === url) {
          frameIds[url] = frameId;
          break;
        }
      }
    }
    
    sendResponse({ frameIds } as IframeFrameIdsResponse);
    return false; // канал закрывается после sendResponse
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