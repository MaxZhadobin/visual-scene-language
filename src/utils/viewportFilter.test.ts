/**
 * Unit-тесты viewportFilter — единый пайплайн отдачи (АС[3]).
 *
 * Покрывает:
 *  - computeVisibleWindow: вычисление видимого окна из viewport + scroll;
 *  - computeScrollable: метаданные scrollable {top, bottom};
 *  - filterObjectsByViewport: рекурсивная фильтрация объектов;
 *  - collectVisibleIds: сбор id видимых объектов;
 *  - applyViewportFilterToDocument: фильтр полного документа;
 *  - filterDiffByViewport: фильтр диффа.
 *
 * Parity с MCP: packages/mcp-server/src/utils/viewportFilter.ts.
 */
import {
  computeVisibleWindow,
  computeScrollable,
  filterObjectsByViewport,
  collectVisibleIds,
  applyViewportFilterToDocument,
  filterDiffByViewport,
  type ScrollContext,
  type ViewportWindow,
} from './viewportFilter';
import type { VslDocument, VslObject } from '../types/vsl';
import type { VslDiff } from '../diff/diffEngine';

/* ------------------------------ Helpers ------------------------------ */

function makeObj(
  id: string,
  p: [number, number],
  s: [number, number],
  children?: VslObject[],
): VslObject {
  const obj: VslObject = { id, t: 'container' as VslObject['t'], p, s };
  if (children && children.length > 0) {
    obj.ch = children;
  }
  return obj;
}

function makeObjNoCoords(id: string): VslObject {
  // Объект без координат (HTTP-путь) — поля p и s отсутствуют
  return { id, t: 'text' as VslObject['t'] } as unknown as VslObject;
}

function makeDoc(objects: VslObject[]): VslDocument {
  return {
    vsl_version: '1.0',
    canvas: {
      timestamp: '2026-01-01T00:00:00.000Z',
      viewport: { width: 1280, height: 800, unit: 'px' },
      background: '#fff',
      scale: 1,
      orientation: 'landscape',
      url: 'https://example.com',
      title: 'Test',
    },
    objects,
  };
}

function makeDiff(changes: {
  added?: VslObject[];
  modified?: Array<{ id: string; t?: VslObject['t']; txt?: string | null }>;
  removed?: Array<{ id: string; t?: VslObject['t'] }>;
  unchanged_refs?: string[];
}): VslDiff {
  return {
    diff_version: 1,
    base_version: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    changes: {
      added: changes.added ?? [],
      modified: changes.modified ?? [],
      removed: changes.removed ?? [],
      unchanged_refs: changes.unchanged_refs ?? [],
    },
  };
}

/* ------------------------- computeVisibleWindow ---------------------- */

describe('computeVisibleWindow', () => {
  it('без scroll — окно от (0, 0) размером с viewport', () => {
    const win = computeVisibleWindow({ width: 1280, height: 800 }, null);
    expect(win).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it('со scroll — окно от (scroll.x, scroll.y)', () => {
    const scroll: ScrollContext = { x: 0, y: 500, width: 1280, height: 3000 };
    const win = computeVisibleWindow({ width: 1280, height: 800 }, scroll);
    expect(win).toEqual({ x: 0, y: 500, width: 1280, height: 800 });
  });

  it('горизонтальный scroll', () => {
    const scroll: ScrollContext = { x: 200, y: 0, width: 3000, height: 800 };
    const win = computeVisibleWindow({ width: 1280, height: 800 }, scroll);
    expect(win).toEqual({ x: 200, y: 0, width: 1280, height: 800 });
  });
});

/* ------------------------- computeScrollable ------------------------- */

describe('computeScrollable', () => {
  it('без scroll — {top: false, bottom: false}', () => {
    const info = computeScrollable({ width: 1280, height: 800 }, null);
    expect(info).toEqual({ top: false, bottom: false });
  });

  it('scroll.y = 0, docHeight > viewport → top: false, bottom: true', () => {
    const scroll: ScrollContext = { x: 0, y: 0, width: 1280, height: 3000 };
    const info = computeScrollable({ width: 1280, height: 800 }, scroll);
    expect(info).toEqual({ top: false, bottom: true });
  });

  it('scroll.y > 0, scroll.y + viewport <docHeight → top: true, bottom: true', () => {
    const scroll: ScrollContext = { x: 0, y: 500, width: 1280, height: 3000 };
    const info = computeScrollable({ width: 1280, height: 800 }, scroll);
    expect(info).toEqual({ top: true, bottom: true });
  });

  it('scroll.y + viewport >= docHeight → top: true, bottom: false', () => {
    const scroll: ScrollContext = { x: 0, y: 2200, width: 1280, height: 3000 };
    const info = computeScrollable({ width: 1280, height: 800 }, scroll);
    expect(info).toEqual({ top: true, bottom: false });
  });
});

/* ---------------------- filterObjectsByViewport ---------------------- */

describe('filterObjectsByViewport', () => {
  const win: ViewportWindow = { x: 0, y: 0, width: 1280, height: 800 };

  it('видимый объект сохраняется', () => {
    const obj = makeObj('btn_0', [100, 100], [200, 40]);
    const result = filterObjectsByViewport([obj], win);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('btn_0');
  });

  it('невидимый объект исключается', () => {
    const obj = makeObj('btn_0', [100, 2000], [200, 40]); // ниже viewport
    const result = filterObjectsByViewport([obj], win);
    expect(result).toHaveLength(0);
  });

  it('объект частично видимый (пересекает границу) — сохраняется', () => {
    const obj = makeObj('btn_0', [0, 780], [200, 40]); // p.y + s.y = 820 > 800
    const result = filterObjectsByViewport([obj], win);
    expect(result).toHaveLength(1);
  });

  it('объект без координат сохраняется (selfVisible = true для noCoords)', () => {
    const obj = makeObjNoCoords('txt_0');
    const result = filterObjectsByViewport([obj], win);
    // noCoords → selfVisible = true → объект сохраняется
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('txt_0');
  });

  it('контейнер невидим, но имеет видимых потомков → контейнер остаётся', () => {
    const child = makeObj('btn_0', [100, 100], [200, 40]);
    const container = makeObj('div_0', [0, 2000], [1280, 400], [child]);
    const result = filterObjectsByViewport([container], win);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('div_0');
    expect(result[0]!.ch).toHaveLength(1);
    expect(result[0]!.ch![0]!.id).toBe('btn_0');
  });

  it('контейнер невидим и потомки невидимы → исключается', () => {
    const child = makeObj('btn_0', [100, 2500], [200, 40]);
    const container = makeObj('div_0', [0, 2000], [1280, 400], [child]);
    const result = filterObjectsByViewport([container], win);
    expect(result).toHaveLength(0);
  });

  it('контейнер видим, потомок невидим → потомок исключается, контейнер остаётся', () => {
    const child = makeObj('btn_0', [100, 2500], [200, 40]);
    const container = makeObj('div_0', [0, 0], [1280, 800], [child]);
    const result = filterObjectsByViewport([container], win);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('div_0');
    expect(result[0]!.ch).toBeUndefined(); // все потомки отфильтрованы
  });

  it('глубокая вложенность: видимый объект на 3-м уровне', () => {
    const deep = makeObj('btn_0', [100, 100], [200, 40]);
    const mid = makeObj('div_1', [0, 2000], [1280, 400], [deep]); // невидим
    const top = makeObj('div_0', [0, 0], [1280, 800], [mid]); // видим
    const result = filterObjectsByViewport([top], win);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('div_0');
    expect(result[0]!.ch).toHaveLength(1);
    expect(result[0]!.ch![0]!.id).toBe('div_1'); // невидимый контейнер остался
    expect(result[0]!.ch![0]!.ch).toHaveLength(1);
    expect(result[0]!.ch![0]!.ch![0]!.id).toBe('btn_0'); // видимый потомок
  });

  it('со скроллом: объект ниже viewport исключается', () => {
    const scrollWin: ViewportWindow = { x: 0, y: 500, width: 1280, height: 800 };
    const obj = makeObj('btn_0', [100, 100], [200, 40]); // y < 500
    const result = filterObjectsByViewport([obj], scrollWin);
    expect(result).toHaveLength(0);
  });

  it('со скроллом: объект в видимом окне сохраняется', () => {
    const scrollWin: ViewportWindow = { x: 0, y: 500, width: 1280, height: 800 };
    const obj = makeObj('btn_0', [100, 600], [200, 40]); // y ∈ [500, 1300]
    const result = filterObjectsByViewport([obj], scrollWin);
    expect(result).toHaveLength(1);
  });
});

/* ------------------------- collectVisibleIds ------------------------- */

describe('collectVisibleIds', () => {
  const win: ViewportWindow = { x: 0, y: 0, width: 1280, height: 800 };

  it('собирает id видимых объектов', () => {
    const obj1 = makeObj('btn_0', [100, 100], [200, 40]);
    const obj2 = makeObj('btn_1', [100, 2000], [200, 40]); // невидим
    const ids = collectVisibleIds([obj1, obj2], win);
    expect(ids.has('btn_0')).toBe(true);
    expect(ids.has('btn_1')).toBe(false);
  });

  it('объекты без координат считаются видимыми', () => {
    const obj = makeObjNoCoords('txt_0');
    const ids = collectVisibleIds([obj], win);
    expect(ids.has('txt_0')).toBe(true);
  });

  it('рекурсивно обходит потомков', () => {
    const child = makeObj('btn_0', [100, 100], [200, 40]);
    const container = makeObj('div_0', [0, 0], [1280, 800], [child]);
    const ids = collectVisibleIds([container], win);
    expect(ids.has('div_0')).toBe(true);
    expect(ids.has('btn_0')).toBe(true);
  });
});

/* ------------------ applyViewportFilterToDocument -------------------- */

describe('applyViewportFilterToDocument', () => {
  const win: ViewportWindow = { x: 0, y: 0, width: 1280, height: 800 };

  it('фильтрует objects документа, сохраняя canvas', () => {
    const obj1 = makeObj('btn_0', [100, 100], [200, 40]);
    const obj2 = makeObj('btn_1', [100, 2000], [200, 40]);
    const doc = makeDoc([obj1, obj2]);
    const filtered = applyViewportFilterToDocument(doc, win);
    expect(filtered.canvas).toBe(doc.canvas); // canvas не меняется
    expect(filtered.objects).toHaveLength(1);
    expect(filtered.objects[0]!.id).toBe('btn_0');
  });
});

/* ----------------------- filterDiffByViewport ------------------------ */

describe('filterDiffByViewport', () => {
  const win: ViewportWindow = { x: 0, y: 0, width: 1280, height: 800 };

  it('added — фильтруются по прямоугольнику', () => {
    const addedVisible = makeObj('btn_0', [100, 100], [200, 40]);
    const addedInvisible = makeObj('btn_1', [100, 2000], [200, 40]);
    const diff = makeDiff({ added: [addedVisible, addedInvisible] });
    const nextDoc = makeDoc([addedVisible]);
    const result = filterDiffByViewport(diff, nextDoc, null, win);
    expect(result.changes.added).toHaveLength(1);
    expect(result.changes.added[0]!.id).toBe('btn_0');
  });

  it('modified — остаются если id видим в next-документе', () => {
    const modifiedVisible = { id: 'btn_0', t: 'button' as VslObject['t'], txt: 'updated' };
    const modifiedInvisible = { id: 'btn_1', t: 'button' as VslObject['t'], txt: 'updated' };
    const diff = makeDiff({ modified: [modifiedVisible, modifiedInvisible] });
    const visibleObj = makeObj('btn_0', [100, 100], [200, 40]);
    const nextDoc = makeDoc([visibleObj]);
    const result = filterDiffByViewport(diff, nextDoc, null, win);
    expect(result.changes.modified).toHaveLength(1);
    expect(result.changes.modified[0]!.id).toBe('btn_0');
  });

  it('removed — остаются если id видим в prev-документе', () => {
    const removedVisible = { id: 'btn_0', t: 'button' as VslObject['t'] };
    const removedInvisible = { id: 'btn_1', t: 'button' as VslObject['t'] };
    const diff = makeDiff({ removed: [removedVisible, removedInvisible] });
    const prevVisibleObj = makeObj('btn_0', [100, 100], [200, 40]);
    const nextDoc = makeDoc([]);
    const prevDoc = makeDoc([prevVisibleObj]);
    const result = filterDiffByViewport(diff, nextDoc, prevDoc, win);
    expect(result.changes.removed).toHaveLength(1);
    expect(result.changes.removed[0]!.id).toBe('btn_0');
  });

  it('removed — без prevDoc все остаются', () => {
    const removed = { id: 'btn_0', t: 'button' as VslObject['t'] };
    const diff = makeDiff({ removed: [removed] });
    const nextDoc = makeDoc([]);
    const result = filterDiffByViewport(diff, nextDoc, null, win);
    expect(result.changes.removed).toHaveLength(1);
  });

  it('unchanged_refs — только видимые в next-документе', () => {
    const diff = makeDiff({ unchanged_refs: ['btn_0', 'btn_1'] });
    const visibleObj = makeObj('btn_0', [100, 100], [200, 40]);
    const nextDoc = makeDoc([visibleObj]);
    const result = filterDiffByViewport(diff, nextDoc, null, win);
    expect(result.changes.unchanged_refs).toEqual(['btn_0']);
  });
});