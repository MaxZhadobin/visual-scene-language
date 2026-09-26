/**
 * Segmentation Engine: объединение уровней 1-4 (T1.1.3/T1.1.4/T1.5.1/T1.5.2).
 *
 * Обходит ExtractedElement-дерево (domExtractor) и аннотирует каждый элемент:
 *  - t: приоритет L1 (тег) → L2 (ARIA-роль) → L3 (CSS-паттерны) → L4
 *    (структурные паттерны по геометрии уже аннотированных детей); null —
 *    не классифицирован (включение и типизация контейнеров — решение
 *    VSL Builder, T1.1.5);
 *  - txt: aria-label (приоритет по семантике доступного имени) ?? собственный текст;
 *  - st: состояние из aria-pressed/expanded/disabled ("true" only).
 *
 * Skip-поддеревья (элемент не попадает в VSL вместе с поддеревом):
 *  - aria-hidden="true" — декоративный по семантике accessibility-дерева;
 *  - opacity:0 + pointer-events:none — визуально невидимый (L3,
 *    isPointerInvisible).
 *
 * L4 применяется после рекурсивной обработки детей: структурные паттерны
 * (toolbar/list/grid/form_field/tab_bar/layout) анализируют t детей.
 */

import type { ElementCss, ExtractedElement, Rect } from '../capture/domExtractor';
import type { VslFragmentMeta, VslState, VslType } from '../types/vsl';
import { resolveLevel1Type } from './level1';
import { resolveAriaRoleType, resolveSt } from './level2';
import { isPointerInvisible, resolveLevel3Type } from './level3';
import { resolveLevel4Type } from './level4';

export interface SegmentedElement {
  tag: string;
  indexPath: number[];
  rect: Rect;
  /** Атрибуты verbatim (нужны Builder для умных дефолтов act и валидации). */
  attributes: Record<string, string>;
  /** Тип VSL: приоритет L1 > L2 > L3 > L4; null — не классифицирован. */
  t: VslType | null;
  /** Текст: aria-label ?? собственный текст; null, если нет ни того, ни другого. */
  txt: string | null;
  /** Состояние из ARIA (checked/expanded/disabled) или null. */
  st: VslState | null;
  /** CSS-подмножество для визуальных стилей (передаётся в Builder для sty). */
  css?: ElementCss;
  ch: SegmentedElement[];
  /** Ссылка на визуальный фрагмент (заполняется enrichWithVision, T1.5.4). */
  vf?: string;
  /** Метаданные фрагмента (§4.4). */
  vf_meta?: VslFragmentMeta;
}

/** Элемент декоративен (aria-hidden="true") → в VSL не включается. */
export function isAriaHidden(attributes: Record<string, string>): boolean {
  return attributes['aria-hidden'] === 'true';
}

function segmentOne(el: ExtractedElement): SegmentedElement {
  const { attributes } = el;
  // Специальная проверка для input[type=file] → file_input
  // (не ломает контракт resolveLevel1Type, который принимает только tag)
  const isFileInput = el.tag === 'input' && attributes['type'] === 'file';
  return {
    tag: el.tag,
    indexPath: el.indexPath,
    rect: el.rect,
    attributes,
    t: isFileInput
      ? 'file_input'
      : (resolveLevel1Type(el.tag) ??
         resolveAriaRoleType(attributes['role']) ??
         resolveLevel3Type(el.css, attributes)),
    txt: attributes['aria-label'] ?? el.text,
    st: resolveSt(attributes),
    css: el.css,
    ch: [],
  };
}

/**
 * Аннотирует видимое дерево (результат extractDomTree) семантикой L1-L4,
 * обрезая skip-поддеревья (aria-hidden, isPointerInvisible). Порядок
 * элементов сохраняется. L4 анализирует геометрию детей ПОСЛЕ их
 * аннотирования (post-order по t).
 */
export function segmentTree(elements: readonly ExtractedElement[]): SegmentedElement[] {
  const result: SegmentedElement[] = [];
  for (const el of elements) {
    if (isAriaHidden(el.attributes)) continue;
    if (isPointerInvisible(el.css)) continue;
    const segmented = segmentOne(el);
    segmented.ch = segmentTree(el.children);
    if (segmented.t === null) {
      segmented.t = resolveLevel4Type(segmented);
    }
    result.push(segmented);
  }
  return result;
}