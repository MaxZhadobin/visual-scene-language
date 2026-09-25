/**
 * enrichWithVision (T1.5.4, dev_8): async-шаг конвейера ДО buildVslDocument —
 * Level 5 vision fallback (§2.2.1, ARCHITECTURE.md:L174-202).
 *
 * Отбор кандидатов: элементы, которые builder ОТБРОСИТ (t === null и
 * !isIncludedInVsl — нетипизированный, score < 3, без включённых детей).
 * Для каждого: extract (bounding box → WebP base64, кэш по hash) → classify
 * (порт VisionClassifier) → аннотация t + vf/vf_meta НА МЕСТЕ (мутирует
 * дерево, как segmentTree) — после этого builder включает элемент в VSL
 * (типизирован), а convert переносит vf/vf_meta в объект (AC[5]).
 *
 * Best-effort (vision не должен ломать снапшот): ошибки extract/classify
 * одного элемента не роняют обогащение — элемент остаётся отброшенным
 * (поведение как до vision), ошибка учитывается в failedCount.
 *
 * Кэш и AC[3]: запись FragmentCacheEntry возвращается extract по ссылке и
 * хранит classification — повторный extract того же hash даёт тот же entry,
 * поэтому классификатор вызывается один раз на фрагмент. Обход СТРОГО
 * последовательный: параллельный запуск классифицировал бы одинаковые
 * фрагменты дважды (оба extract завершились бы до первой записи classification).
 *
 * Данные изображений НЕ попадают в VslDocument (бюджет 10-100 KB) —
 * возвращаются в VisualFragmentStore (DEC-015, lazy loading §4.4) для
 * DecideInput.visualFragments.
 */

import { isIncludedInVsl } from '../builder/vslBuilder';
import type { VisualFragmentStore } from '../llm/types';
import type { SegmentedElement } from '../segmentation/segmenter';
import type { FragmentExtraction, FragmentExtractor } from './fragmentExtractor';
import type { VisionClassifier } from './types';

/** Зависимости enrichWithVision (Dependency Inversion — фейки в unit-тестах). */
export interface EnrichWithVisionDeps {
  /** Классификатор фрагментов (LlmVisionClassifier; в тестах — фейк). */
  classifier: VisionClassifier;
  /** Извлекатель фрагментов с кэшем по hash (AC[3]). */
  extractor: FragmentExtractor;
}

/** Результат обогащения: счётчики + стор данных фрагментов (lazy, DEC-015). */
export interface EnrichWithVisionResult {
  /** Число спасённых элементов (аннотированы t + vf/vf_meta). */
  enrichedCount: number;
  /** Число кандидатов, пропущенных из-за ошибок extract/classify (best-effort). */
  failedCount: number;
  /** Данные фрагментов vf_id → {mediaType, data} для DecideInput.visualFragments. */
  fragments: VisualFragmentStore;
}

/**
 * Собирает vision-кандидатов обходом дерева (pre-order): элемент отбрасывается
 * builder-ом ⟺ t === null и !isIncludedInVsl (нетипизированный, score < 3,
 * без включённых детей) — ровно их спасает vision fallback.
 */
function collectCandidates(elements: readonly SegmentedElement[]): SegmentedElement[] {
  const candidates: SegmentedElement[] = [];
  const visit = (element: SegmentedElement): void => {
    if (element.t === null && !isIncludedInVsl(element)) candidates.push(element);
    for (const child of element.ch) {
      visit(child);
    }
  };
  for (const element of elements) visit(element);
  return candidates;
}

/** Подсказка классификатору: контекст элемента (тег; текст, если есть). */
function buildHint(element: SegmentedElement): string {
  return element.txt === null ? `tag=${element.tag}` : `tag=${element.tag}; text: ${element.txt}`;
}

/**
 * Обогащает дерево элементов vision-классификацией (Level 5 fallback).
 * МУТИРУЕТ элементы на месте (t + vf/vf_meta) — как segmentTree; после
 * обогащения buildVslDocument включает спасённые элементы в VSL.
 * Последовательный обход (см. шапку: кэш + AC[3]).
 */
export async function enrichWithVision(
  elements: SegmentedElement[],
  deps: EnrichWithVisionDeps,
): Promise<EnrichWithVisionResult> {
  const fragments = new Map<string, import('../llm/types').VisualFragmentData>();
  let enrichedCount = 0;
  let failedCount = 0;

  for (const element of collectCandidates(elements)) {
    let extraction: FragmentExtraction | null;
    try {
      extraction = await deps.extractor.extract(element.rect);
    } catch {
      // Ошибки capture/crop не глушатся в extract (его контракт) — best-effort
      // здесь: элемент остаётся отброшенным, как до vision.
      failedCount += 1;
      continue;
    }
    if (extraction === null) continue; // пустая геометрия — не ошибка, элемент остаётся отброшенным

    const { entry } = extraction;
    let classification = entry.classification;
    try {
      if (classification === undefined) {
        classification = await deps.classifier.classify(entry.data, buildHint(element));
        entry.classification = classification; // sticky в кэше: повторные hash-hit без вызова модели (AC[3])
      }
    } catch {
      failedCount += 1;
      continue;
    }
    element.t = classification.type;
    element.vf = entry.vfId;
    element.vf_meta = {
      type: classification.type,
      format: entry.meta.format,
      size: entry.meta.size,
      hash: entry.meta.hash,
      cached_at: entry.meta.cached_at,
    };
    fragments.set(entry.vfId, entry.data);
    enrichedCount += 1;
  }

  return { enrichedCount, failedCount, fragments };
}