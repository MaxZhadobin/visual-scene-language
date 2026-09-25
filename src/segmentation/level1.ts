/**
 * Segmentation Level 1: семантические теги (T1.1.3, ROADMAP.md M1.1).
 *
 * Контракт — таблица «Уровень 1: Семантические теги» из ARCHITECTURE.md:
 * ровно 10 тегов, покрывающих ~40% элементов типичной страницы. Теги вне
 * таблицы (div/span/p/footer/…) НЕ классифицируются на этом уровне —
 * их семантика, если есть, добавляется Level 2 (ARIA) в T1.1.4.
 *
 * Функция чистая и детерминированная: (тег) → тип VSL | null.
 */

import type { VslType } from '../types/vsl';

/** Таблица маппинга HTML-тегов (нижний регистр) → семантические типы VSL. */
export const LEVEL1_TAG_MAP: Readonly<Record<string, VslType>> = {
  button: 'button',
  input: 'input',
  a: 'link',
  nav: 'nav',
  header: 'header',
  main: 'main',
  section: 'container',
  img: 'image',
  select: 'select',
  textarea: 'textarea',
};

/**
 * Возвращает семантический тип VSL для HTML-тега по таблице Level 1
 * или null, если тег на этом уровне не классифицируется.
 * Регистр тега не учитывается (защита от tagName в любом регистре).
 */
export function resolveLevel1Type(tag: string): VslType | null {
  return LEVEL1_TAG_MAP[tag.toLowerCase()] ?? null;
}