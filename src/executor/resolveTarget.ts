/**
 * Резолв target_id → DOM-элемент (ARCHITECTURE.md §7.4 «Action Executor»,
 * ROADMAP.md M1.4, T1.4.1).
 *
 * Контракт (spec M1.4 п.4; формат id — vslBuilder.ts:100):
 *  - target_id = `tag_index1_index2_...`: tag — имя тега в нижнем регистре,
 *    индексы — indexPath элемента (id = `${el.tag}_${el.indexPath.join('_')}`);
 *  - indexPath — индексы среди ЭЛЕМЕНТНЫХ детей каждого уровня, вычисляются по
 *    структуре DOM ДО фильтрации (domExtractor.collectVisibleChildren) — позиция
 *    стабильна независимо от фильтров видимости/сегментации;
 *  - extractDomTree возвращает ЛЕС потомков root (сам root не включается), поэтому
 *    каждый VSL id содержит ≥1 индекс, а обход стартует с root.children[index];
 *  - обход от корня снапшота: ExecutorOptions.root ?? document.body. Root обязан
 *    совпадать с root, переданным в extractDomTree/VslSnapshotSession, иначе
 *    indexPath укажет не на тот элемент;
 *  - резолв чисто вычислительный: executor не аннотирует DOM и не хранит ссылок;
 *  - при невалидном формате id, отсутствии элемента по indexPath или несовпадении
 *    tag бросается ActionExecutionError (DOM изменился с момента снапшота).
 *    Сообщения ошибок — на английском: runtime-строки — публичный API @vsl/sdk и
 *    вход для LLM-агента (решение 22.09.2026).
 */

import { ActionExecutionError } from './types';
import type { ExecutorOptions } from './types';

/** Разделитель сегментов target_id (формат vslBuilder.ts:100). */
const ID_SEPARATOR = '_';

/** Сегмент индекса: непустая последовательность десятичных цифр (без знака). */
const INDEX_SEGMENT_RE = /^\d+$/;

/**
 * Корень обхода по умолчанию — document.body (прод в браузере).
 * Отдельная функция: обращение к document только в момент вызова, чтобы импорт
 * модуля в plain Node (demo, packaging-smoke) не падал с ReferenceError.
 */
function defaultRoot(): Element {
  const body = document.body;
  if (body === null) {
    throw new ActionExecutionError(
      'resolveTarget: document.body is not available — pass the snapshot root via ExecutorOptions.root',
    );
  }
  return body;
}

/**
 * Разбирает target_id на tag и indexPath.
 * Строгий формат (vslBuilder порождает id всегда с indexPath): минимум один индекс;
 * сегменты индексов — только десятичные цифры (пустой сегмент и знак запрещены:
 * Number('') === 0 и приведение '-1' — ловушки парсинга).
 */
function parseTargetId(targetId: string): { tag: string; indexPath: number[] } {
  const segments = targetId.split(ID_SEPARATOR);
  const tag = segments[0];
  if (tag === undefined || tag.length === 0) {
    throw new ActionExecutionError(
      `Invalid target_id "${targetId}": missing tag — expected format "tag_index1_index2_..."`,
    );
  }
  const indexSegments = segments.slice(1);
  if (indexSegments.length === 0) {
    throw new ActionExecutionError(
      `Invalid target_id "${targetId}": missing index path — expected format "tag_index1_index2_..."`,
    );
  }
  const indexPath: number[] = [];
  for (const segment of indexSegments) {
    if (!INDEX_SEGMENT_RE.test(segment)) {
      throw new ActionExecutionError(
        `Invalid target_id "${targetId}": index segment "${segment}" is not a non-negative integer`,
      );
    }
    indexPath.push(Number(segment));
  }
  return { tag, indexPath };
}

/**
 * Резолвит target_id в DOM-элемент обходом от корня снапшота (§7.4, T1.4.1).
 *
 * @param targetId — id элемента из VSL JSON, формат "tag_index1_index2_...".
 * @param options — ExecutorOptions; root обязан совпадать с корнем снапшота
 *   (extractDomTree/§5.1), по умолчанию document.body.
 * @returns найденный DOM-элемент.
 * @throws ActionExecutionError — невалидный формат id, элемент по indexPath не
 *   найден или tag не совпал (DOM изменился с момента снапшота).
 */
export function resolveTarget(targetId: string, options: ExecutorOptions = {}): Element {
  const root = options.root ?? defaultRoot();
  const { tag, indexPath } = parseTargetId(targetId);

  let current: Element = root;
  let depth = 0;
  for (const index of indexPath) {
    depth += 1;
    // Индексы считаются по ЭЛЕМЕНТНЫМ детям (Element.children) — конвенция domExtractor.
    const next = current.children[index];
    if (next === undefined) {
      throw new ActionExecutionError(
        `Failed to resolve target_id "${targetId}": no element child at index ${index} on depth ${depth} — DOM may have changed since the snapshot`,
      );
    }
    current = next;
  }

  const actualTag = current.tagName.toLowerCase();
  if (actualTag !== tag) {
    throw new ActionExecutionError(
      `Failed to resolve target_id "${targetId}": found <${actualTag}>, expected tag "${tag}" — DOM may have changed since the snapshot`,
    );
  }
  return current;
}