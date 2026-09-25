/**
 * VSL Snapshot Session (T1.2.4, ROADMAP.md M1.2; ARCHITECTURE.md §2.4/§5.2/§6.3).
 *
 * Stateful-фасад над пайплайном capture→segment→build→cache→diff:
 *  - первый вызов или смена URL → полный VslDocument; кэш очищается и
 *    заполняется объектами документа; счётчик версий сбрасывается в 1;
 *  - тот же URL → VslDiff последнего документа против нового (формат §6.2):
 *    diff_version = version + 1, base_version = version;
 *  - viewport изменился при том же URL → дополнительно
 *    store.invalidateCoordinates() — «сброс координат» §5.2, НЕ полный сброс.
 *
 * Состояние {lastUrl, lastViewport, lastDocument, version} — в памяти
 * экземпляра; VslDocument (канон §4) версиями НЕ расширяется.
 *
 * Политика кэша — store отражает текущий документ: full → clear + заполнение;
 * diff → удалённые invalidate, добавленные (поддеревья) и изменённые set из
 * нового документа; неизменённые остаются кэшированными (после resize — с
 * обнулённым coordHash: наблюдаемый эффект invalidateCoordinates).
 *
 * input.url/viewport/timestamp/background передаются в BuildOptions ЯВНО —
 * дефолты builder (window.innerWidth/innerHeight/location.href/document.title)
 * вычислялись бы от глобалов: недетерминированны в тестах и недоступны в Node;
 * title — из input, иначе root.ownerDocument.title (портативный фолбэк — фикс
 * packaging-smoke demo:cache-diff).
 */

import { extractDomTree } from '../capture/domExtractor';
import { segmentTree, type SegmentedElement } from '../segmentation/segmenter';
import { buildVslDocument } from '../builder/vslBuilder';
import type { BuildOptions } from '../builder/vslBuilder';
import { createCacheStore } from '../cache/cacheStore';
import type { CacheStore } from '../cache/cacheStore';
import { diffVslDocuments } from '../diff/diffEngine';
import type { DiffOptions, VslDiff } from '../diff/diffEngine';
import type { VslDocument, VslObject } from '../types/vsl';
import { enrichWithVision, type EnrichWithVisionDeps } from '../vision/enrichWithVision';
import type { VisualFragmentStore } from '../llm/types';

/** Результат snapshot(): полный документ (1-й вызов / URL change) или дифф. */
export type SnapshotResult = VslDocument | VslDiff;

/** Type guard: различение диффа и полного документа (контракт T1.2.4). */
export function isVslDiff(result: SnapshotResult): result is VslDiff {
  return 'changes' in result;
}

/**
 * Результат snapshotWithVision (T1.5.5): снапшот (документ/дифф) + ДАННЫЕ
 * фрагментов (base64) — стора в документе нет по контракту (DEC-015):
 * документ несёт только vf/vf_meta, данные идут в decide({visualFragments}).
 */
export interface VisionSnapshotResult {
  snapshot: SnapshotResult;
  fragments: VisualFragmentStore;
}

/** Входные параметры снапшота; url/viewport обязательны (инвалидация §5.2). */
export interface SnapshotInput {
  /** URL страницы: изменение → полный сброс кэша и новый полный документ. */
  url: string;
  /** Текущий viewport: изменение при том же URL → сброс координат кэша. */
  viewport: { width: number; height: number };
  title?: string;
  /** ISO 8601; фиксировать в тестах (детерминизм canvas.timestamp и диффа). */
  timestamp?: string;
  background?: string;
}

/** Плоский индекс id → VslObject (обход дерева в глубину). */
function flattenObjects(objects: readonly VslObject[], map: Map<string, VslObject>): void {
  for (const object of objects) {
    map.set(object.id, object);
    flattenObjects(object.ch ?? [], map);
  }
}

/** Сохраняет поддерево в store пообъектно (id уникальны — база M1.1). */
function storeTree(store: CacheStore, objects: readonly VslObject[]): void {
  for (const object of objects) {
    store.set(object.id, object);
    storeTree(store, object.ch ?? []);
  }
}

/**
 * Session-фасад (§2.4 «первый вызов → полный JSON, последующие → дифф»).
 * Store инъекцией — тесты наблюдают coordHash-инвалидацию напрямую.
 */
export class VslSnapshotSession {
  private readonly store: CacheStore;
  private lastUrl: string | null = null;
  private lastViewport: { width: number; height: number } | null = null;
  private lastDocument: VslDocument | null = null;
  private version = 0;

  constructor(store: CacheStore = createCacheStore()) {
    this.store = store;
  }

  /**
   * Строит VSL из DOM поддерева root (extractDomTree → segmentTree →
   * buildVslDocument) и возвращает полный документ либо дифф (см. шапку).
   */
  snapshot(root: Element, input: SnapshotInput): SnapshotResult {
    const elements = segmentTree(extractDomTree(root));
    return this.commit(elements, this.buildOptions(root, input), input);
  }

  /**
   * Vision-вариант конвейера (T1.5.5): segmentTree → enrichWithVision (Level 5
   * fallback — аннотация t + vf/vf_meta на элементах ДО сборки) → buildVslDocument
   * → cache/diff — та же логика состояния, что snapshot(). Синхронный snapshot()
   * сохранён (существующие контракты/тесты не ломаются); данные фрагментов
   * (base64) возвращаются ОТДЕЛЬНО — в документе только метаданные (DEC-015).
   */
  async snapshotWithVision(
    root: Element,
    input: SnapshotInput,
    vision: EnrichWithVisionDeps,
  ): Promise<VisionSnapshotResult> {
    const elements = segmentTree(extractDomTree(root));
    const visionResult = await enrichWithVision(elements, vision);
    const snapshot = this.commit(elements, this.buildOptions(root, input), input);
    return { snapshot, fragments: visionResult.fragments };
  }

  /** BuildOptions из input + портативный title (логика бывшего snapshot()). */
  private buildOptions(root: Element, input: SnapshotInput): BuildOptions {
    const options: BuildOptions = {
      viewport: { width: input.viewport.width, height: input.viewport.height },
      url: input.url,
    };
    // title: из input, иначе из документа root — ПОРТАТИВНО, без глобального
    // document (дефолт builder document.title упал бы в Node — packaging-smoke).
    options.title = input.title ?? root.ownerDocument.title;
    if (input.timestamp !== undefined) options.timestamp = input.timestamp;
    if (input.background !== undefined) options.background = input.background;
    return options;
  }

  /** Сборка документа + кэш/дифф (логика бывшего snapshot(), см. шапку модуля). */
  private commit(
    elements: readonly SegmentedElement[],
    options: BuildOptions,
    input: SnapshotInput,
  ): SnapshotResult {
    const nextDocument = buildVslDocument(elements, options);

    const firstCall = this.lastDocument === null;
    const urlChanged = !firstCall && input.url !== this.lastUrl;

    if (firstCall || urlChanged) {
      this.store.clear();
      storeTree(this.store, nextDocument.objects);
      this.version = 1;
      this.lastUrl = input.url;
      this.lastViewport = { ...input.viewport };
      this.lastDocument = nextDocument;
      return nextDocument;
    }

    const viewportChanged =
      this.lastViewport === null ||
      input.viewport.width !== this.lastViewport.width ||
      input.viewport.height !== this.lastViewport.height;
    if (viewportChanged) this.store.invalidateCoordinates();

    const diffOptions: DiffOptions = {
      diffVersion: this.version + 1,
      baseVersion: this.version,
    };
    if (input.timestamp !== undefined) diffOptions.timestamp = input.timestamp;
    const diff = diffVslDocuments(this.lastDocument!, nextDocument, diffOptions);

    // Кэш отражает новый документ (см. шапку): неизменённые остаются,
    // изменённые/добавленные обновляются из fresh-документа, удалённые —
    // инвалидируются.
    const fresh = new Map<string, VslObject>();
    flattenObjects(nextDocument.objects, fresh);
    for (const removed of diff.changes.removed) this.store.invalidate(removed.id);
    for (const modified of diff.changes.modified) {
      const object = fresh.get(modified.id);
      if (object !== undefined) this.store.set(object.id, object);
    }
    for (const added of diff.changes.added) storeTree(this.store, [added]);

    this.version = diff.diff_version;
    this.lastUrl = input.url;
    this.lastViewport = { ...input.viewport };
    this.lastDocument = nextDocument;
    return diff;
  }
}