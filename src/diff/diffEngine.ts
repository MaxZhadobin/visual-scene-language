/**
 * Diff Engine (T1.2.3, ROADMAP.md M1.2; формат ARCHITECTURE.md §6.2).
 *
 * diffVslDocuments(prev, next, options) сравнивает два VslDocument по ПЛОСКОМУ
 * индексу id (id = tag_indexPath глобально уникальны — база M1.1) и выдаёт
 * дифф строго в формате §6.2:
 *  - added    — новые объекты полными поддеревьями (tree order next);
 *  - modified — id + только изменившиеся поля в порядке канона §4
 *    (t→r→p→s→st→txt→act); УДАЛЁННОЕ опциональное поле передаётся явным null
 *    (r/st/txt/act; решение dc_5: отсутствие в Partial амбивалентно —
 *    «не изменилось» vs «удалено»); t/p/s/id никогда не null;
 *  - removed  — {id} в tree order prev;
 *  - unchanged_refs — id неизменённых объектов (tree order next).
 *
 * Равенство объектов — по паре хэшей Cache Store (решение dc_4):
 * contentHash {t,r?,st?,txt?,act?} + coordHash {p,s}, sha256 по фиксированному
 * порядку ключей. Поле ch в сравнении НЕ участвует — diff плоский, дети
 * отслеживаются собственными id: изменение состава/содержимого детей проявляется
 * их собственными added/removed/modified записями. Canvas не диффуется —
 * сравнивается только дерево objects.
 *
 * Пустой дифф валиден: идентичные документы → все id в unchanged_refs,
 * остальные списки пусты.
 *
 * Предусловие: id уникальны в пределах каждого документа (гарантия M1.1).
 */

import { computeCoordHash, computeContentHash } from '../cache/cacheStore';
import type { VslDocument, VslObject, VslState, VslType } from '../types/vsl';

/** Изменившийся объект: id + только изменившиеся поля (порядок канона §4). */
export interface VslModifiedObject {
  id: string;
  t?: VslType;
  /** null = опциональное поле r удалено в next. */
  r?: string | null;
  p?: [number, number];
  s?: [number, number];
  /** null = состояние st удалено в next. */
  st?: VslState | null;
  /** null = текст txt удалён в next. */
  txt?: string | null;
  /** null = список действий act удалён в next. */
  act?: string[] | null;
}

/** Удалённый объект: только ссылка на id (§6.2). */
export interface VslRemovedObject {
  id: string;
}

/** Блок changes формата §6.2. */
export interface VslDiffChanges {
  /** Новые объекты — полные поддеревья, tree order next. */
  added: VslObject[];
  /** Изменившиеся объекты, tree order next. */
  modified: VslModifiedObject[];
  /** Удалённые объекты, tree order prev. */
  removed: VslRemovedObject[];
  /** id неизменённых объектов, tree order next. */
  unchanged_refs: string[];
}

/** Дифф двух VslDocument (формат ARCHITECTURE.md §6.2). */
export interface VslDiff {
  /** Версия нового состояния (счётчик session). */
  diff_version: number;
  /** Версия базового (предыдущего) состояния. */
  base_version: number;
  /** ISO 8601. */
  timestamp: string;
  changes: VslDiffChanges;
}

/** Опции diffVslDocuments: версии заголовка обязательны (явный контракт session). */
export interface DiffOptions {
  diffVersion: number;
  baseVersion: number;
  /** ISO 8601; по умолчанию — текущее время (недетерминированно; в тестах фиксировать). */
  timestamp?: string;
}

/** Плоский индекс id → VslObject в tree order (обход дерева в глубину). */
function flatten(objects: readonly VslObject[], map: Map<string, VslObject>): void {
  for (const object of objects) {
    map.set(object.id, object);
    flatten(object.ch ?? [], map);
  }
}

/** Равенство объектов по паре хэшей dc_4 (ch/id в сравнении не участвуют). */
function objectsEqual(a: VslObject, b: VslObject): boolean {
  return (
    computeContentHash(a) === computeContentHash(b) &&
    computeCoordHash(a) === computeCoordHash(b)
  );
}

function tuple2Equal(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function stringArrayEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Field-by-field в порядке канона §4; удалённые опциональные поля → явный null (dc_5). */
function buildModified(prev: VslObject, next: VslObject): VslModifiedObject {
  const result: VslModifiedObject = { id: next.id };
  if (prev.t !== next.t) result.t = next.t;
  if (prev.r !== next.r) result.r = next.r ?? null;
  if (!tuple2Equal(prev.p, next.p)) result.p = next.p;
  if (!tuple2Equal(prev.s, next.s)) result.s = next.s;
  if (prev.st !== next.st) result.st = next.st ?? null;
  if (prev.txt !== next.txt) result.txt = next.txt ?? null;
  if (!stringArrayEqual(prev.act, next.act)) result.act = next.act ?? null;
  return result;
}

/** Сравнивает два VSL-документа и возвращает дифф формата §6.2 (см. шапку модуля). */
export function diffVslDocuments(
  prev: VslDocument,
  next: VslDocument,
  options: DiffOptions,
): VslDiff {
  const prevFlat = new Map<string, VslObject>();
  const nextFlat = new Map<string, VslObject>();
  flatten(prev.objects, prevFlat);
  flatten(next.objects, nextFlat);

  const added: VslObject[] = [];
  const modified: VslModifiedObject[] = [];
  const unchangedRefs: string[] = [];

  // Tree order next (DFS): добавленные корни поддеревьев → изменённые →
  // неизменённые. Потомки добавленного корня НЕ дублируются отдельными записями
  // added — они уже перенесены внутри ch добавленного поддерева (§6.2).
  const walk = (objects: readonly VslObject[], insideAdded: boolean): void => {
    for (const nextObject of objects) {
      if (insideAdded) {
        walk(nextObject.ch ?? [], true);
        continue;
      }
      const prevObject = prevFlat.get(nextObject.id);
      if (prevObject === undefined) {
        added.push(nextObject); // корень добавленного поддерева
        walk(nextObject.ch ?? [], true);
      } else if (objectsEqual(prevObject, nextObject)) {
        unchangedRefs.push(nextObject.id);
        walk(nextObject.ch ?? [], false);
      } else {
        modified.push(buildModified(prevObject, nextObject));
        walk(nextObject.ch ?? [], false);
      }
    }
  };
  walk(next.objects, false);

  // Tree order prev: удалённые.
  const removed: VslRemovedObject[] = [];
  for (const id of prevFlat.keys()) {
    if (!nextFlat.has(id)) removed.push({ id });
  }

  return {
    diff_version: options.diffVersion,
    base_version: options.baseVersion,
    timestamp: options.timestamp ?? new Date().toISOString(),
    changes: { added, modified, removed, unchanged_refs: unchangedRefs },
  };
}