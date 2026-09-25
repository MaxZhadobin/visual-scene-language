/**
 * Content script (isolated world, DOM общий со страницей) — M1.4, dc_6
 * (note_1790079041609, подтверждено пользователем).
 *
 * Ответственность:
 *  - держит инстанс VslSnapshotSession: кэш и дифф живут в content script
 *    (пересоздаются на каждую страницу), root = document.body;
 *  - отвечает на сообщения background (протокол в protocol.ts):
 *      vsl/snapshot → SnapshotResponse {snapshot, fragments?} — vision-ветка
 *      T1.5.5: enrichWithVision ДО сборки + порты-прокси vsl/capture,
 *      vsl/classify (captureVisibleTab и LLM API — только в background);
 *      vsl/execute (LlmAction) → ActionResult (soft-fail контракт executor:
 *      ActionResult возвращается всегда, отдельный канал ошибок не нужен).
 *
 * Root снапшота и root исполнения совпадают (document.body) — обязательный
 * контракт ExecutorOptions.root, иначе indexPath в target_id укажет не на тот
 * элемент. Runtime-строки — на английском (решение 22.09.2026).
 */

import { executeAction } from '../../src/executor/actionExecutor';
import type { ActionResult } from '../../src/executor/types';
import { VslSnapshotSession } from '../../src/session/snapshotSession';
import { FragmentExtractor } from '../../src/vision/fragmentExtractor';
import type { ViewportCapture, VisionClassifier } from '../../src/vision/types';
import type { LlmAction } from '../../src/llm/types';
import type {
  CaptureResponse,
  ClassifyResponse,
  ExecuteRequest,
  SnapshotRequest,
  SnapshotResponse,
} from './protocol';
import { MSG_CAPTURE, MSG_CLASSIFY, MSG_EXECUTE, MSG_SNAPSHOT } from './protocol';

/** Один инстанс на время жизни страницы: кэш между шагами агентного цикла. */
const session = new VslSnapshotSession();

/**
 * Экстрактор фрагментов — module-level (T1.5.5, AC[3]): кэш по hash живёт
 * между снапшотами, неизменённые фрагменты не классифицируются повторно.
 * Ленивая инициализация при первом vision-запросе.
 */
let extractor: FragmentExtractor | null = null;

/**
 * document.body — единый корень снапшота и исполнения. На run_at=document_idle
 * (manifest.json) body гарантированно существует; защита от ранних вызовов.
 */
function requireBody(): HTMLElement {
  const body = document.body;
  if (body === null) {
    throw new Error('document.body is not ready — content script must run after DOM is parsed');
  }
  return body;
}

/**
 * Порты vision (T1.5.5) — прокси в background через runtime.sendMessage:
 * captureVisibleTab и fetch к LLM API доступны только в service worker
 * (MV3: content script — CORS-ограничения + нет chrome.tabs). Кроп — локально
 * в content (DOM canvas доступен, дефолтная реализация FragmentExtractor).
 */
function createCapturePort(): ViewportCapture {
  return async () => {
    const response = (await chrome.runtime.sendMessage({
      type: MSG_CAPTURE,
    })) as CaptureResponse;
    if (response.dataUrl === undefined) {
      throw new Error(response.error ?? 'Viewport capture failed');
    }
    return response.dataUrl;
  };
}

function createClassifyPort(): VisionClassifier {
  return {
    classify: async (image) => {
      const response = (await chrome.runtime.sendMessage({
        type: MSG_CLASSIFY,
        image,
      })) as ClassifyResponse;
      if (response.classification === undefined) {
        throw new Error(response.error ?? 'Fragment classification failed');
      }
      return response.classification;
    },
  };
}

/**
 * vsl/snapshot: полный документ при первом вызове/смене URL, далее дифф (§5.2).
 * vision=true (T1.5.5): snapshotWithVision — enrichWithVision (Level 5
 * fallback) ДО сборки; данные фрагментов возвращаются отдельно
 * (SnapshotResponse.fragments) — в документе только метаданные (DEC-015).
 */
async function handleSnapshot(vision: boolean): Promise<SnapshotResponse> {
  const input = {
    url: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
  if (!vision) {
    return { snapshot: session.snapshot(requireBody(), input) };
  }
  extractor ??= new FragmentExtractor({ capture: createCapturePort() });
  const result = await session.snapshotWithVision(requireBody(), input, {
    classifier: createClassifyPort(),
    extractor,
  });
  return {
    snapshot: result.snapshot,
    fragments: Object.fromEntries(result.fragments),
  };
}

/** vsl/execute: исполнение действия LLM на живом DOM от того же корня. */
function handleExecute(action: LlmAction): Promise<ActionResult> {
  return executeAction(action, { root: requireBody() });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG_SNAPSHOT) {
    // Асинхронный ответ: vision-ветка (T1.5.5) делает capture/classify через
    // background. При сбое (body недоступен и т.п.) канал закрывается без
    // ответа — background увидит реджек промиса sendMessage.
    const request = message as unknown as SnapshotRequest;
    handleSnapshot(request.vision === true).then(sendResponse, () => {
      /* сбой: канал закрывается без ответа (контракт MV3) */
    });
    return true; // держим канал открытым до sendResponse (контракт MV3)
  }
  if (message.type === MSG_EXECUTE) {
    // executeAction soft-fail — никогда не бросает; ответ асинхронный.
    const request = message as unknown as ExecuteRequest;
    void handleExecute(request.action).then(sendResponse);
    return true; // держим канал открытым до sendResponse (контракт MV3)
  }
  return undefined; // сообщение вне протокола content script
});