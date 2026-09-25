/**
 * VSL SDK — публичное API. Точка входа:
 *  - Snapshot generation (M1.1): capture → segment → build;
 *  - Cache & Diff (M1.2): Cache Store, invalidation, Diff Engine (§6.2),
 *    Snapshot Session (первый вызов → VslDocument, далее → VslDiff).
 *  - LLM Integration (M1.3): LLM Adapter (OpenAI/Anthropic), Action Model, промпты и retry.
 */

// ——— M1.1: Snapshot generation (сохранено полностью) ———

export { extractDomTree, ownText } from './capture/domExtractor';
export type { ExtractedElement, Rect } from './capture/domExtractor';
export { LEVEL1_TAG_MAP, resolveLevel1Type } from './segmentation/level1';
export { ARIA_ROLE_TYPE_MAP, resolveAriaRoleType, resolveSt } from './segmentation/level2';
export { isAriaHidden, segmentTree } from './segmentation/segmenter';
export type { SegmentedElement } from './segmentation/segmenter';
export { buildVslDocument } from './builder/vslBuilder';
export type { BuildOptions } from './builder/vslBuilder';
export { VSL_VERSION } from './types/vsl';
export type {
  VisualFragment,
  VisualFragmentType,
  VslCanvas,
  VslDocument,
  VslObject,
  VslState,
  VslType,
  VslViewport,
} from './types/vsl';

// ——— M1.2: Cache Store + invalidation (T1.2.1/T1.2.2) ———

export { createCacheStore, computeContentHash, computeCoordHash } from './cache/cacheStore';
export type { CacheEntry, CacheStore } from './cache/cacheStore';
export { attachMutationObserver } from './cache/invalidation';
export type { MutationObserverHandle } from './cache/invalidation';

// ——— M1.2: Diff Engine (T1.2.3, формат ARCHITECTURE.md §6.2) ———

export { diffVslDocuments } from './diff/diffEngine';
export type {
  DiffOptions,
  VslDiff,
  VslDiffChanges,
  VslModifiedObject,
  VslRemovedObject,
} from './diff/diffEngine';

// ——— M1.2: Snapshot Session (T1.2.4) ———

export { VslSnapshotSession, isVslDiff } from './session/snapshotSession';
export type { SnapshotInput, SnapshotResult } from './session/snapshotSession';

// ——— M1.3: LLM Integration (T1.3.1–T1.3.5) ———

export { OpenAIAdapter } from './llm/openai';
export { AnthropicAdapter } from './llm/anthropic';
export { AlibabaAdapter } from './llm/alibaba';
export { LlmError, LlmValidationError } from './llm/types';
export { VALID_ACTIONS, collectIds, validateAction } from './llm/actions';
export type { ValidAction } from './llm/actions';
export {
  ACTION_TOOL_DESCRIPTION,
  ACTION_TOOL_NAME,
  ACTION_TOOL_SCHEMA,
} from './llm/schema';
export { buildSystemPrompt, buildUserPrompt } from './llm/prompt';
export type { FewShotExample } from './llm/prompt';
export { retryWithBackoff } from './llm/transport';
export type { RetryOptions } from './llm/transport';
export type {
  DecideInput,
  LlmAction,
  LlmAdapter,
  LlmAdapterConfig,
  LlmResponse,
  LlmUsage,
  LlmTransport,
  SendPromptOptions,
  Sleep,
  VslFragmentMeta,
  VslInput,
  VslObjectWithVf,
  VisualFragmentData,
  VisualFragmentStore,
} from './llm/types';

// ——— M1.4: Action Executor (T1.4.1–T1.4.3) ———

export { executeAction } from './executor/actionExecutor';
export { resolveTarget } from './executor/resolveTarget';
export { ActionExecutionError } from './executor/types';
export type { ActionResult, ExecutorOptions } from './executor/types';

export const VSL_SDK_VERSION = '0.1.0';