/**
 * Segmentation Level 4: структурный анализ (T1.5.2, ROADMAP.md M1.5).
 *
 * Контракт — таблица «Уровень 4: Структурный анализ» из ARCHITECTURE.md:L158-172:
 * паттерны определяются по ГЕОМЕТРИИ ДЕТЕЙ уже аннотированного элемента
 * (L1/L2/L3 применены раньше — итоговый приоритет L1>L2>L3>L4, интеграция
 * в segmenter — следующий шаг; rect захвачен domExtractor):
 *
 * | Паттерн                   | Условие                                          | → Тип       |
 * |---------------------------|--------------------------------------------------|-------------|
 * | Горизонтальный ряд кнопок | ≥3 элемента с t: button в ряд, одинаковая высота | toolbar     |
 * | Вертикальный список       | ≥3 элемента с одинаковой шириной, вертикально    | list        |
 * | Сетка карточек            | Элементы в строках и столбцах, одинаковый размер | grid        |
 * | Label + input рядом       | text элемент рядом с input элемент               | form_field  |
 * | Tab bar                   | Горизонтальный ряд элементов с role="tab"        | tab_bar     |
 * | Sidebar + main            | Вертикальный split: узкий слева + широкий справа | layout      |
 *
 * Функция чистая и детерминированная: (элемент + дети) → тип VSL | null.
 * Порядок проверки = порядку таблицы (первое совпадение выигрывает).
 * Без импорта segmenter — нет циклической зависимости (SegmentedElement
 * структурно совместим с Level4Input: rect/ch/t/attributes/txt).
 */

import type { Rect } from '../capture/domExtractor';
import type { VslType } from '../types/vsl';

/** Допуск сравнения геометрии (px): суб-пиксельный рендеринг и округления. */
const EPS = 2;

/** Ребёнок для L4-анализа: уже аннотирован L1/L2/L3 (t может отсутствовать). */
export interface Level4Child {
  rect: Rect;
  t?: VslType | null;
  attributes?: Readonly<Record<string, string>>;
  txt?: string | null;
}

/** Вход L4: элемент-кандидат (контейнер группы) с его детьми. */
export interface Level4Input {
  rect: Rect;
  ch?: readonly Level4Child[];
}

const bottomOf = (r: Rect): number => r.y + r.height;
const rightOf = (r: Rect): number => r.x + r.width;

/** В одном горизонтальном ряду: перекрытие по Y > половины меньшей высоты. */
function sameRow(a: Rect, b: Rect): boolean {
  const overlap = Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y);
  return overlap > 0.5 * Math.min(a.height, b.height);
}

/** В одной вертикальной колонке: перекрытие по X > половины меньшей ширины. */
function sameColumn(a: Rect, b: Rect): boolean {
  const overlap = Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x);
  return overlap > 0.5 * Math.min(a.width, b.width);
}

const eq = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;
const sameHeight = (a: Rect, b: Rect): boolean => eq(a.height, b.height);
const sameWidth = (a: Rect, b: Rect): boolean => eq(a.width, b.width);

/**
 * toolbar: ≥3 кнопок (t: button) в одном ряду одинаковой высоты.
 * Упрощение контракта: все кнопки-кандидаты в одном ряду — многострочные
 * панели кнопок не классифицируются как toolbar (их ловит grid при равных
 * размерах).
 */
function isToolbarRow(children: readonly Level4Child[]): boolean {
  const buttons = children.filter((c) => c.t === 'button');
  const first = buttons[0];
  if (buttons.length < 3 || first === undefined) return false;
  return buttons
    .slice(1)
    .every((b) => sameRow(first.rect, b.rect) && sameHeight(first.rect, b.rect));
}

/** Дети выстроены вертикально подряд: соседние по Y не перекрываются. */
function verticallyStacked(children: readonly Level4Child[]): boolean {
  const sorted = [...children].sort((a, b) => a.rect.y - b.rect.y);
  for (let i = 1; i <sorted.length; i += 1) {
    if (sorted[i]!.rect.y <bottomOf(sorted[i - 1]!.rect) - EPS) return false;
  }
  return true;
}

/** list: ≥3 детей одинаковой ширины, вертикально (в колонке, без наложений по Y). */
function isVerticalList(children: readonly Level4Child[]): boolean {
  const first = children[0];
  if (children.length < 3 || first === undefined) return false;
  return (
    children
      .slice(1)
      .every((c) => sameWidth(first.rect, c.rect) && sameColumn(first.rect, c.rect)) &&
    verticallyStacked(children)
  );
}

/** Количество кластеров значений с допуском eps (полосы строк/столбцов сетки). */
function bandCount(values: readonly number[], eps: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  let count = 1;
  let anchor = sorted[0]!;
  for (const value of sorted.slice(1)) {
    if (value - anchor > eps) {
      count += 1;
      anchor = value;
    }
  }
  return count;
}

/** grid: ≥4 детей одного размера, минимум 2 строки и 2 столбца. */
function isGrid(children: readonly Level4Child[]): boolean {
  const first = children[0];
  if (children.length < 4 || first === undefined) return false;
  const sameSize = children
    .slice(1)
    .every((c) => sameWidth(first.rect, c.rect) && sameHeight(first.rect, c.rect));
  if (!sameSize) return false;
  return (
    bandCount(children.map((c) => c.rect.y), first.rect.height + EPS) >= 2 &&
    bandCount(children.map((c) => c.rect.x), first.rect.width + EPS) >= 2
  );
}

/** Соседство: общий ряд/колонка с зазором не более 16px (или перекрытием). */
function adjacent(a: Rect, b: Rect): boolean {
  const gapX = Math.max(a.x, b.x) - Math.min(rightOf(a), rightOf(b));
  const gapY = Math.max(a.y, b.y) - Math.min(bottomOf(a), bottomOf(b));
  return (sameRow(a, b) && gapX <= 8 * EPS) || (sameColumn(a, b) && gapY <= 8 * EPS);
}

/** form_field: text-элемент (label с txt) рядом с input-элементом. */
function hasLabelNextToInput(children: readonly Level4Child[]): boolean {
  return children.some((input) => {
    if (input.t !== 'input') return false;
    return children.some((label) => {
      if (label === input) return false;
      if ((label.txt ?? '').length === 0) return false;
      return adjacent(label.rect, input.rect);
    });
  });
}

/** tab_bar: ≥2 элементов с role="tab" в одном горизонтальном ряду. */
function isTabBarRow(children: readonly Level4Child[]): boolean {
  const tabs = children.filter((c) => c.attributes?.['role'] === 'tab');
  const first = tabs[0];
  if (tabs.length < 2 || first === undefined) return false;
  return tabs.slice(1).every((t) => sameRow(first.rect, t.rect));
}

/** layout: ровно 2 ребёнка — узкий слева + широкий справа (вертикальный split). */
function isSidebarSplit(children: readonly Level4Child[], parent: Rect): boolean {
  if (children.length !== 2) return false;
  const sorted = [...children].sort((a, b) => a.rect.x - b.rect.x);
  const left = sorted[0];
  const right = sorted[1];
  if (left === undefined || right === undefined) return false;
  return (
    left.rect.width <parent.width / 3 &&
    right.rect.width > parent.width / 2 &&
    rightOf(left.rect) <= right.rect.x + EPS &&
    sameRow(left.rect, right.rect)
  );
}

/**
 * Возвращает тип VSL по структурному паттерну (уровень 4) или null, если ни
 * один из 6 паттернов не совпал. Вызывается в segmenter ПОСЛЕ L1/L2/L3
 * (приоритет L1>L2>L3>L4): аннотирует контейнер группы по геометрии детей.
 *
 * @param el элемент-кандидат: rect + уже аннотированные дети (ch)
 */
export function resolveLevel4Type(el: Level4Input): VslType | null {
  const children = el.ch ?? [];
  if (children.length === 0) return null;
  if (isToolbarRow(children)) return 'toolbar';
  if (isVerticalList(children)) return 'list';
  if (isGrid(children)) return 'grid';
  if (hasLabelNextToInput(children)) return 'form_field';
  if (isTabBarRow(children)) return 'tab_bar';
  if (isSidebarSplit(children, el.rect)) return 'layout';
  return null;
}