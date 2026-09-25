/**
 * Cache Store (T1.2.1, ROADMAP.md M1.2; контракт ARCHITECTURE.md §2.4/§5).
 *
 * In-memory Map id → CacheEntry. Запись кэша содержит VslObject и два
 * детерминированных хэша (решение dc_4):
 *  - contentHash — содержимое {t, r?, st?, txt?, act?} в порядке канона §4;
 *  - coordHash   — координаты {p, s}.
 * id в хэш не входит (он ключ Map), ch не входит (дети отслеживаются
 * собственными записями). Хэш — sha256 (node:crypto) поверх JSON.stringify
 * объекта с фиксированным порядком ключей.
 *
 * Invalidation (ARCHITECTURE.md §5.2, решение dc_5):
 *  - invalidate(id) — точечная инвалидация записи;
 *  - invalidateBySelector — MVP-семантика: '*' → полный сброс; точный id;
 *    иначе селектор трактуется как тег id ('button' → все 'button_*'), т.к.
 *    CSS-селекторы к кэшированным VslObject неприменимы (id = tag_indexPath);
 *  - invalidateCoordinates() — «сброс координат» при viewport resize:
 *    coordHash всех записей обнуляется, содержимое сохраняется.
 */

import { createHash } from 'node:crypto';
import type { VslObject } from '../types/vsl';

/** Запись кэша: объект VSL + хэши содержимого и координат. */
export interface CacheEntry {
  /** Кэшированный VslObject (поддерево ch не хранится — дети в своих записях). */
  object: VslObject;
  /** sha256 от {t, r?, st?, txt?, act?} в фиксированном порядке ключей. */
  contentHash: string;
  /** sha256 от {p, s}; пустая строка — координаты инвалидированы (resize). */
  coordHash: string;
}

function sha256(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * contentHash: только смысловые поля, фиксированный порядок t→r→st→txt→act.
 * Опциональные поля включаются только при наличии — сериализация детерминирована.
 */
export function computeContentHash(object: VslObject): string {
  const payload: Record<string, unknown> = { t: object.t };
  if (object.r !== undefined) payload.r = object.r;
  if (object.st !== undefined) payload.st = object.st;
  if (object.txt !== undefined) payload.txt = object.txt;
  if (object.act !== undefined) payload.act = object.act;
  return sha256(JSON.stringify(payload));
}

/** coordHash: только координаты {p, s}. */
export function computeCoordHash(object: VslObject): string {
  return sha256(JSON.stringify({ p: object.p, s: object.s }));
}

/** Публичный контракт Cache Store (ROADMAP T1.2.1). */
export interface CacheStore {
  /** Сохранить объект под явным id (ROADMAP T1.2.1: cache.set(id, element)). */
  set(id: string, object: VslObject): void;
  /** Запись по id или undefined. */
  get(id: string): CacheEntry | undefined;
  /** Наличие записи. */
  has(id: string): boolean;
  /** Точечная инвалидация (§5.2 cache.invalidate). */
  invalidate(id: string): void;
  /** MVP-семантика (решение dc_5): '*' | точный id | 'tag' → префикс 'tag_'. */
  invalidateBySelector(selector: string): void;
  /** Viewport resize (§5.2 «сброс координат»): обнулить coordHash, объекты сохранить. */
  invalidateCoordinates(): void;
  /** Полный сброс (§5.2 cache.clear). */
  clear(): void;
  /** Все id в порядке вставки. */
  keys(): string[];
  /** Число записей. */
  readonly size: number;
}

export function createCacheStore(): CacheStore {
  const entries = new Map<string, CacheEntry>();

  return {
    set(id: string, object: VslObject): void {
      entries.set(id, {
        object,
        contentHash: computeContentHash(object),
        coordHash: computeCoordHash(object),
      });
    },

    get(id: string): CacheEntry | undefined {
      return entries.get(id);
    },

    has(id: string): boolean {
      return entries.has(id);
    },

    invalidate(id: string): void {
      entries.delete(id);
    },

    invalidateBySelector(selector: string): void {
      if (selector === '*') {
        entries.clear();
        return;
      }
      if (entries.has(selector)) {
        entries.delete(selector);
        return;
      }
      const prefix = `${selector}_`;
      for (const id of entries.keys()) {
        if (id.startsWith(prefix)) entries.delete(id);
      }
    },

    invalidateCoordinates(): void {
      for (const [id, entry] of entries) {
        entries.set(id, { ...entry, coordHash: '' });
      }
    },

    clear(): void {
      entries.clear();
    },

    keys(): string[] {
      return [...entries.keys()];
    },

    get size(): number {
      return entries.size;
    },
  };
}