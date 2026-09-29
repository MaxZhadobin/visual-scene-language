/**
 * Viewport Filter — единый пайплайн отдачи (АС[3], dev3_pipeline).
 *
 * Кэш (ServerSession) хранит ПОЛНЫЙ документ в абсолютных страница-релятивных
 * координатах (АС[2]). Фильтр вырезает видимое окно НА ОТДАЧЕ в LLM:
 * видимый прямоугольник = [scroll, scroll + viewport].
 *
 * Правила:
 *  - объект видим, если его прямоугольник [p, p+s] пересекает видимое окно;
 *  - контейнер жив, пока остаётся хотя бы один видимый потомок;
 *  - отфильтрованные копии потомков применяются ВСЕГДА (включая случаи,
 *    когда число прямых детей не изменилось — изменения в глубине);
 *  - объекты без p/s (HTTP-путь, p = null) пропускаются всегда (прозрачность);
 *  - дифф фильтруется отдельно: added — по прямоугольнику, modified — по
 *    видимости id в next-документе, removed — по видимости id в prev-документе,
 *    unchanged_refs — по видимости в next-документе.
 *
 * Порядок композиции с фильтрацией по детальности: сначала вьюпорт-фильтр
 * (сокращает число объектов), затем detail_level.
 *
 * Ограничение: fixed/sticky-элементы не детектируются (нет данных о
 * position в VslObject) и фильтруются по абсолютному прямоугольнику.
 */

import type { VslDiff, VslDocument, VslObject } from '@thinkingos/vsl-sdk';

/** Метаданные скролла страницы (позиция + полные размеры документа). */
export interface ScrollContext {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Видимое окно в абсолютных страница-релятивных координатах. */
export interface ViewportWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Метаданные scrollable для LLM: есть ли контент сверху/снизу. */
export interface ScrollableInfo {
  top: boolean;
  bottom: boolean;
}

/**
 * Вычисляет видимое окно из вьюпорта и скролла.
 * Без скролл-контекста (нет данных) — окно от (0, 0) размером с вьюпорт.
 */
export function computeVisibleWindow(
  viewport: { width: number; height: number },
  scroll: ScrollContext | null,
): ViewportWindow {
  if (!scroll) {
    return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  }
  return { x: scroll.x, y: scroll.y, width: viewport.width, height: viewport.height };
}

/**
 * Вычисляет метаданные scrollable {top, bottom}.
 * top — есть контент выше видимого окна; bottom — ниже.
 */
export function computeScrollable(
  viewport: { width: number; height: number },
  scroll: ScrollContext | null,
): ScrollableInfo {
  if (!scroll) {
    return { top: false, bottom: false };
  }
  return {
    top: scroll.y > 0,
    bottom: scroll.y + viewport.height <scroll.height,
  };
}

/** Пересечение прямоугольника объекта [p, p+s] с видимым окном. */
function isVisible(
  p: [number, number],
  s: [number, number],
  win: ViewportWindow,
): boolean {
  return (
    p[0] <win.x + win.width &&
    p[0] + s[0] > win.x &&
    p[1] <win.y + win.height &&
    p[1] + s[1] > win.y
  );
}

/**
 * Рекурсивный фильтр объектов по видимому окну.
 * Контейнер остаётся, если сам видим ИЛИ есть видимые потомки.
 * Объекты без координат (p/s отсутствуют — HTTP-путь) пропускаются всегда.
 */
export function filterObjectsByViewport(
  objects: readonly VslObject[],
  win: ViewportWindow,
): VslObject[] {
  function filterRecursive(obj: VslObject): VslObject | null {
    const noCoords = !obj.p || !obj.s;
    const selfVisible = noCoords || isVisible(obj.p!, obj.s!, win);

    // Рекурсивно фильтруем потомков
    let filteredChildren: VslObject[] | null = null;
    let childrenChanged = false;
    if (obj.ch && obj.ch.length > 0) {
      filteredChildren = obj.ch
        .map(filterRecursive)
        .filter((child): child is VslObject => child !== null);
      // Любое изменение состава/содержимого потомков: вырезка хвоста/середины
      // (длина) или замена копий с отфильтрованными внуками (позиции)
      childrenChanged = filteredChildren.length !== obj.ch.length
        || filteredChildren.some((child, index) => child !== obj.ch![index]);
    }

    if (selfVisible) {
      // Объект видим — сохраняем. ВАЖНО: отфильтрованные копии потомков
      // применяются всегда при ЛЮБОМ изменении (иначе глубокие невидимые
      // поддеревья сохранялись бы вместе с видимым предком).
      if (filteredChildren && obj.ch && childrenChanged) {
        const copy = { ...obj };
        if (filteredChildren.length > 0) {
          copy.ch = filteredChildren;
        } else {
          delete copy.ch;
        }
        return copy;
      }
      return obj;
    }

    // Сам невидим, но есть видимые потомки — контейнер остаётся
    if (filteredChildren && filteredChildren.length > 0) {
      return { ...obj, ch: filteredChildren };
    }

    return null;
  }

  return objects
    .map(filterRecursive)
    .filter((obj): obj is VslObject => obj !== null);
}

/**
 * Собирает id объектов, чей СОБСТВЕННЫЙ прямоугольник пересекает окно.
 * Объекты без координат считаются видимыми (прозрачность для HTTP-пути).
 */
export function collectVisibleIds(
  objects: readonly VslObject[],
  win: ViewportWindow,
  acc: Set<string> = new Set(),
): Set<string> {
  for (const obj of objects) {
    if (!obj.p || !obj.s || isVisible(obj.p, obj.s, win)) {
      acc.add(obj.id);
    }
    if (obj.ch && obj.ch.length > 0) {
      collectVisibleIds(obj.ch, win, acc);
    }
  }
  return acc;
}

/**
 * Фильтрует полный документ по видимому окну (единый пайплайн отдачи).
 */
export function applyViewportFilterToDocument(
  doc: VslDocument,
  win: ViewportWindow,
): VslDocument {
  return { ...doc, objects: filterObjectsByViewport(doc.objects, win) };
}

/**
 * Фильтрует дифф по видимому окну:
 *  - added — полные поддеревья фильтруются по прямоугольнику;
 *  - modified — остаются, если id видим в next-документе;
 *  - removed — остаются, если id видим в prev-документе (нет prev — все);
 *  - unchanged_refs — только видимые в next-документе.
 */
export function filterDiffByViewport(
  diff: VslDiff,
  nextDoc: VslDocument,
  prevDoc: VslDocument | null,
  win: ViewportWindow,
): VslDiff {
  const nextVisible = collectVisibleIds(nextDoc.objects, win);
  const prevVisible = prevDoc ? collectVisibleIds(prevDoc.objects, win) : null;

  return {
    ...diff,
    changes: {
      added: filterObjectsByViewport(diff.changes.added, win),
      modified: diff.changes.modified.filter((m) => nextVisible.has(m.id)),
      removed: diff.changes.removed.filter((r) =>
        prevVisible ? prevVisible.has(r.id) : true,
      ),
      unchanged_refs: diff.changes.unchanged_refs.filter((id) => nextVisible.has(id)),
    },
  };
}