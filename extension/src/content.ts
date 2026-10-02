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
 * Iframe support (M2.1):
 *  - content script инжектится во все фреймы (all_frames: true);
 *  - в iframe: отправляет MSG_FRAME_SNAPSHOT через chrome.runtime.sendMessage;
 *  - в топ-фрейме: отвечает через sendResponse (как раньше).
 *
 * Root снапшота и root исполнения совпадают (document.body) — обязательный
 * контракт ExecutorOptions.root, иначе indexPath в target_id укажет не на тот
 * элемент. Runtime-строки — на английском (решение 22.09.2026).
 */

import { executeAction } from '../../src/executor/actionExecutor';
import type { ActionResult } from '../../src/executor/types';
import { VslSnapshotSession, isVslDiff } from '../../src/session/snapshotSession';
import { FragmentExtractor } from '../../src/vision/fragmentExtractor';
import type { ViewportCapture, VisionClassifier } from '../../src/vision/types';
import type { LlmAction } from '../../src/llm/types';
import {
  filterObjectsByViewport,
  filterDiffByViewport,
  computeScrollable,
  computeVisibleWindow,
  type ScrollContext,
  filterObjectsByDetailLevel,
  filterDiffByDetailLevel,
  type DetailLevel,
  buildReverseIdMap,
  replaceIdsInDocument,
  replaceIdsInDiff,
} from '../../src';
import type { VslDocument } from '../../src/types/vsl';
import type {
  CaptureResponse,
  ClassifyResponse,
  ExecuteRequest,
  FrameSnapshotResponse,
  GetTextBlockRequest,
  GetTextBlockResponse,
  IframeFrameIdsResponse,
  SnapshotRequest,
  SnapshotResponse,
} from './protocol';
import {
  MSG_CAPTURE,
  MSG_CLASSIFY,
  MSG_EXECUTE,
  MSG_FRAME_SNAPSHOT,
  MSG_GET_TEXT_BLOCK,
  MSG_IFRAME_FRAME_IDS,
  MSG_IFRAME_RECTS,
  MSG_SNAPSHOT,
} from './protocol';

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
/**
 * Iframe support (M2.1): собирает rects всех iframe элементов в parent DOM.
 * Top frame content script вызывает эту функцию перед отправкой snapshot,
 * чтобы background мог сопоставить frameId с реальными координатами iframe.
 */
function collectIframeRects(): Array<{ url: string; rect: { x: number; y: number; width: number; height: number } }> {
  const iframes = document.querySelectorAll('iframe');
  const result: Array<{ url: string; rect: { x: number; y: number; width: number; height: number } }> = [];
  
  for (const iframe of iframes) {
    const rect = iframe.getBoundingClientRect();
    // Пропускаем невидимые iframe
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    
    // Получаем URL iframe (может быть относительным)
    let url = iframe.src;
    if (!url) {
      continue; // iframe без src — пропускаем
    }
    
    // Преобразуем относительный URL в абсолютный
    try {
      url = new URL(url, window.location.href).href;
    } catch {
      continue; // невалидный URL — пропускаем
    }
    
    result.push({
      url,
      rect: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }
  
  return result;
}

/**
 * Iframe support (M2.1 rework): инжектит data-vsl-id атрибуты в iframe элементы parent DOM.
 * Top frame content script находит все iframe элементы, запрашивает frameId через
 * MSG_IFRAME_FRAME_IDS, и добавляет data-vsl-id="iframe_${frameId}" для каждого iframe.
 * Это позволяет vsl_get_visual находить iframe-объекты через DOM querySelector.
 */
async function injectIframeIdsIntoDom(): Promise<void> {
  const iframes = document.querySelectorAll('iframe');
  if (iframes.length === 0) {
    return;
  }
  
  // Собираем URL всех iframe элементов
  const urls: string[] = [];
  const iframeElements: HTMLIFrameElement[] = [];
  
  for (const iframe of iframes) {
    const rect = iframe.getBoundingClientRect();
    // Пропускаем невидимые iframe
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    
    let url = iframe.src;
    if (!url) {
      continue; // iframe без src — пропускаем
    }
    
    // Преобразуем относительный URL в абсолютный
    try {
      url = new URL(url, window.location.href).href;
    } catch {
      continue; // невалидный URL — пропускаем
    }
    
    urls.push(url);
    iframeElements.push(iframe);
  }
  
  if (urls.length === 0) {
    return;
  }
  
  // Запрашиваем frameId для каждого URL через background
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MSG_IFRAME_FRAME_IDS,
      urls,
    })) as IframeFrameIdsResponse;
    
    // Добавляем data-vsl-id для каждого iframe элемента
    for (let i = 0; i <iframeElements.length; i++) {
      const url = urls[i];
      const iframeElement = iframeElements[i];
      if (url !== undefined && iframeElement !== undefined) {
        const frameId = response.frameIds[url];
        if (frameId !== undefined) {
          iframeElement.setAttribute('data-vsl-id', `iframe_${frameId}`);
        }
      }
    }
  } catch {
    // сбой: iframe элементы останутся без data-vsl-id (best-effort)
  }
}

/**
 * vsl/snapshot: полный документ при первом вызове/смене URL, далее дифф (§5.2).
 *
 * dev_7: интегрирует viewport filtering, detail_level filtering, ID mapping,
 * lazy text loading (text_blocks) — parity с MCP pipeline.
 *
 * vision=true (T1.5.5): snapshotWithVision — enrichWithVision (Level 5
 * fallback) ДО сборки; данные фрагментов возвращаются отдельно
 * (SnapshotResponse.fragments) — в документе только метаданные (DEC-015).
 */
async function handleSnapshot(req: SnapshotRequest): Promise<SnapshotResponse> {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const scroll: ScrollContext = {
    x: window.scrollX,
    y: window.scrollY,
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  };
  const input = {
    url: window.location.href,
    viewport,
    scroll,
    ttl: req.ttl,
  };

  const detailLevel: DetailLevel = req.full === true ? 'high' : (req.detail_level ?? 'medium');
  const stripStyles = detailLevel !== 'high';

  if (!req.vision) {
    const rawResult = session.snapshot(requireBody(), input);
    return applyPostProcessing(rawResult, detailLevel, stripStyles, viewport, scroll);
  }
  extractor ??= new FragmentExtractor({ capture: createCapturePort() });
  const result = await session.snapshotWithVision(requireBody(), input, {
    classifier: createClassifyPort(),
    extractor,
  });
  const response = applyPostProcessing(result.snapshot, detailLevel, stripStyles, viewport, scroll);
  response.fragments = Object.fromEntries(result.fragments);
  return response;
}

/**
 * Post-processing pipeline: viewport filter → detail_level filter → ID mapping.
 * Parity с MCP getStateAfterAction (getSnapshot.ts L119-172).
 */
function applyPostProcessing(
  rawResult: ReturnType<VslSnapshotSession['snapshot']>,
  detailLevel: DetailLevel,
  stripStyles: boolean,
  viewport: { width: number; height: number },
  scroll: ScrollContext,
  prevDoc?: VslDocument | null,
): SnapshotResponse {
  const isDiff = isVslDiff(rawResult);
  const currentDoc: VslDocument | null = isDiff
    ? (session.getLastDocument() ?? null)
    : rawResult;
  const textBlocks = currentDoc?.text_blocks;
  const scrollable = computeScrollable(viewport, scroll);
  const visibleWindow = computeVisibleWindow(viewport, scroll);
  const filterOpts = { stripStyles };
  if (isDiff) {
    const nextDoc = session.getLastDocument();
    if (!nextDoc) {
      // Should not happen: diff implies a previous document exists
      return {
        snapshot: { vsl_version: '1.0', canvas: { width: 0, height: 0, url: '', title: '', timestamp: '', viewport: { width: 0, height: 0, unit: 'px' }, background: '#fff', scale: 1, orientation: 'portrait' }, objects: [] } as VslDocument,
        scrollable,
        text_blocks: {},
      };
    }
    // Diff path: viewport filter → detail_level filter → ID mapping
    const vpFilteredDiff = filterDiffByViewport(rawResult, nextDoc, prevDoc ?? null, visibleWindow);
    const dlFilteredDiff = filterDiffByDetailLevel(vpFilteredDiff, nextDoc, detailLevel, filterOpts);

    // ID mapping: build reverse map (longId → shortId) from the full next document
    const reverseIdMap = buildReverseIdMap(nextDoc.objects);
    const mappedDiff = replaceIdsInDiff(dlFilteredDiff, reverseIdMap);

    // Also build the filtered document for the response
    const vpFilteredDoc = filterObjectsByViewport(nextDoc.objects, visibleWindow);
    const dlFilteredDoc = filterObjectsByDetailLevel(vpFilteredDoc, detailLevel, filterOpts);
    const mappedDoc = replaceIdsInDocument(
      { ...nextDoc, objects: dlFilteredDoc },
      reverseIdMap,
    );

    return {
      snapshot: mappedDoc,
      scrollable,
      text_blocks: nextDoc.text_blocks ?? {},
      _diff: mappedDiff,
    } as SnapshotResponse;
  }
  const doc = rawResult as VslDocument;
  const vpFilteredObjects = filterObjectsByViewport(doc.objects, visibleWindow);
  const dlFilteredObjects = filterObjectsByDetailLevel(vpFilteredObjects, detailLevel, filterOpts);
  const reverseIdMap = buildReverseIdMap(doc.objects);
  const mappedDoc = replaceIdsInDocument(
    { ...doc, objects: dlFilteredObjects },
    reverseIdMap,
  );

  return {
    snapshot: mappedDoc,
    scrollable,
    text_blocks: textBlocks ?? {},
  };
}

/** vsl/execute: исполнение действия LLM на живом DOM от того же корня. */
function handleExecute(action: LlmAction): Promise<ActionResult> {
  return executeAction(action, { root: requireBody() });
}

/** vsl/getTextBlock: получить полный текст по txt_ref (lazy text loading, M1.7). */
function handleGetTextBlock(blockId: string): GetTextBlockResponse {
  const text = session.getTextBlock(blockId);
  if (text === undefined) {
    return { block_id: blockId, error: `Text block '${blockId}' not found` };
  }
  return { block_id: blockId, text };
}

/**
 * Iframe support (M2.1): детектит, работает ли content script в iframe.
 * В iframe: отправляет snapshot через chrome.runtime.sendMessage (MSG_FRAME_SNAPSHOT).
 * В топ-фрейме: отвечает через sendResponse (как раньше).
 */
function isInIframe(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // Cross-origin iframe: доступ к window.top может быть запрещён
    return true;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG_SNAPSHOT) {
    const request = message as unknown as SnapshotRequest;

    if (isInIframe()) {
      // Iframe: отправляем snapshot через chrome.runtime.sendMessage
      handleSnapshot(request).then((response) => {
        const frameResponse: FrameSnapshotResponse = {
          type: MSG_FRAME_SNAPSHOT,
          snapshot: response.snapshot,
          fragments: response.fragments,
          frameId: 0, // background извлечёт из sender.frameId
          url: window.location.href,
          parentFrameId: null, // background определит через sender
        };
        chrome.runtime.sendMessage(frameResponse);
      }).catch(() => {
        // сбой: канал закрывается без ответа (контракт MV3)
      });
      return false; // не держим канал открытым (iframe не отвечает через sendResponse)
    }

    // Топ-фрейм: отвечаем через sendResponse (как раньше)
    handleSnapshot(request).then(async (response) => {
      // Собираем rects iframe элементов для background (M2.1)
      const iframeRects = collectIframeRects();
      if (iframeRects.length > 0) {
        // Iframe support (M2.1 rework): отправляем iframeCount для explicit synchronization.
        // Background ждёт MSG_FRAME_SNAPSHOT от всех фреймов (countdown) перед агрегацией.
        chrome.runtime.sendMessage({
          type: MSG_IFRAME_RECTS,
          iframes: iframeRects,
          iframeCount: iframeRects.length,
        });
      }

      // Iframe support (M2.1 rework): инжектим data-vsl-id в iframe элементы parent DOM
      // для vsl_get_visual поддержки. Best-effort — ошибки не блокируют snapshot.
      await injectIframeIdsIntoDom();

      sendResponse(response);
    }, () => {
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
  if (message.type === MSG_GET_TEXT_BLOCK) {
    const request = message as unknown as GetTextBlockRequest;
    sendResponse(handleGetTextBlock(request.block_id));
    return false; // синхронный ответ, канал не держим
  }
  return undefined; // сообщение вне протокола content script
});