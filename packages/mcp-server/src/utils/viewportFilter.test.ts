/**
 * Тесты вьюпорт-фильтра — единый пайплайн отдачи (АС[3], dev3_pipeline).
 *
 * Кэш хранит полный документ в абсолютных координатах; фильтр вырезает
 * видимое окно [scroll, scroll + viewport] на отдаче в LLM.
 */

import {
  applyViewportFilterToDocument,
  computeScrollable,
  computeVisibleWindow,
  filterDiffByViewport,
  filterObjectsByViewport,
  type ViewportWindow,
} from './viewportFilter.js';
import type { VslDiff, VslDocument, VslObject } from '@thinkingos/vsl-sdk';

/** Тестовое видимое окно 100x100 в начале страницы. */
const WIN: ViewportWindow = { x: 0, y: 0, width: 100, height: 100 };

/** Сдвинутое окно: скролл 300px вниз. */
const WIN_SCROLLED: ViewportWindow = { x: 0, y: 300, width: 100, height: 100 };

function obj(partial: Partial<VslObject> & Pick<VslObject, 'id'>): VslObject {
  return { t: 'button', p: [0, 0], s: [10, 10], ...partial } as VslObject;
}

function makeDoc(objects: VslObject[]): VslDocument {
  return {
    vsl_version: '1.0.0',
    canvas: {
      viewport: { width: 100, height: 100, unit: 'px' },
      background: '#ffffff',
      scale: 1,
      orientation: 'landscape',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    objects,
  };
}

describe('computeVisibleWindow', () => {
  it('без скролла — окно от (0,0) размером с вьюпорт', () => {
    const win = computeVisibleWindow({ width: 1280, height: 800 }, null);
    expect(win).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it('со скроллом — окно сдвигается на позицию скролла', () => {
    const win = computeVisibleWindow(
      { width: 1280, height: 800 },
      { x: 0, y: 300, width: 1280, height: 2000 },
    );
    expect(win).toEqual({ x: 0, y: 300, width: 1280, height: 800 });
  });
});

describe('computeScrollable', () => {
  it('без скролла — топ и боттом false', () => {
    expect(computeScrollable({ width: 100, height: 100 }, null)).toEqual({
      top: false,
      bottom: false,
    });
  });

  it('начало страницы — только боттом', () => {
    expect(
      computeScrollable({ width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 2000 }),
    ).toEqual({ top: false, bottom: true });
  });

  it('середина страницы — топ и боттом', () => {
    expect(
      computeScrollable({ width: 100, height: 100 }, { x: 0, y: 500, width: 100, height: 2000 }),
    ).toEqual({ top: true, bottom: true });
  });

  it('конец страницы (вьюпорт упирается в низ) — только топ', () => {
    expect(
      computeScrollable({ width: 100, height: 100 }, { x: 0, y: 1900, width: 100, height: 2000 }),
    ).toEqual({ top: true, bottom: false });
  });

  it('страница короче вьюпорта — ничего не скроллится', () => {
    expect(
      computeScrollable({ width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 50 }),
    ).toEqual({ top: false, bottom: false });
  });
});

describe('filterObjectsByViewport', () => {
  it('видимый объект остаётся', () => {
    const visible = obj({ id: 'btn_1', p: [10, 10], s: [20, 20] });
    const result = filterObjectsByViewport([visible], WIN);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(visible);
  });

  it('объект вне окна удаляется', () => {
    const offscreen = obj({ id: 'btn_2', p: [500, 500], s: [20, 20] });
    expect(filterObjectsByViewport([offscreen], WIN)).toEqual([]);
  });

  it('частичное пересечение — объект видим', () => {
    const partial = obj({ id: 'btn_3', p: [95, 95], s: [20, 20] });
    expect(filterObjectsByViewport([partial], WIN)).toHaveLength(1);
  });

  it('контейнер вне окна с видимым потомком остаётся (с потомком)', () => {
    const child = obj({ id: 'btn_child', p: [10, 310], s: [20, 20] });
    const container = obj({
      id: 'div_wrap',
      t: 'container',
      p: [0, 300],
      s: [50, 50],
      ch: [child, obj({ id: 'btn_off', p: [800, 800], s: [10, 10] })],
    });
    // Окно со скроллом 300: контейнер и child попадают, второй потомок нет
    const result = filterObjectsByViewport([container], WIN_SCROLLED);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('div_wrap');
    expect(result[0].ch).toHaveLength(1);
    expect(result[0].ch![0].id).toBe('btn_child');
  });

  it('контейнер без видимых потомков и сам невидим — удаляется', () => {
    const container = obj({
      id: 'div_far',
      t: 'container',
      p: [1000, 1000],
      s: [50, 50],
      ch: [obj({ id: 'btn_far', p: [1010, 1010], s: [10, 10] })],
    });
    expect(filterObjectsByViewport([container], WIN)).toEqual([]);
  });

  it('объект без координат (HTTP-путь) пропускается всегда', () => {
    // Приведение: в HTTP-пути p = null (нет layout)
    const httpObj = obj({ id: 'link_1' });
    (httpObj as unknown as { p: null }).p = null;
    (httpObj as unknown as { s: null }).s = null;
    const result = filterObjectsByViewport([httpObj], WIN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('link_1');
  });

  it('видимый контейнер теряет невидимых потомков', () => {
    const visibleChild = obj({ id: 'btn_in', p: [5, 5], s: [10, 10] });
    const hiddenChild = obj({ id: 'btn_out', p: [700, 700], s: [10, 10] });
    const container = obj({
      id: 'div_main',
      t: 'container',
      p: [0, 0],
      s: [100, 100],
      ch: [visibleChild, hiddenChild],
    });
    const result = filterObjectsByViewport([container], WIN);
    expect(result).toHaveLength(1);
    expect(result[0].ch).toHaveLength(1);
    expect(result[0].ch![0].id).toBe('btn_in');
  });

  it('глубокая цепочка: невидимое поддерево вырезается при неизменном числе прямых детей (регрессия Хабра)', () => {
    // корень видим; средний видим; у среднего дети: видимый + невидимый.
    // Старый код при равенстве длин возвращал ОРИГИНАЛ — невидимая кнопка оставалась.
    const deepHidden = obj({ id: 'btn_deep_hidden', p: [10, 22000], s: [50, 20] });
    const deepVisible = obj({ id: 'btn_deep_visible', p: [10, 10], s: [50, 20] });
    const middle = obj({
      id: 'cont_middle',
      t: 'container',
      p: [0, 0],
      s: [100, 100],
      ch: [deepVisible, deepHidden],
    });
    const root = obj({
      id: 'cont_root',
      t: 'container',
      p: [0, 0],
      s: [100, 23000],
      ch: [middle],
    });
    const result = filterObjectsByViewport([root], WIN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cont_root');
    expect(result[0].ch).toHaveLength(1);
    expect(result[0].ch![0].id).toBe('cont_middle');
    expect(result[0].ch![0].ch).toHaveLength(1);
    expect(result[0].ch![0].ch![0].id).toBe('btn_deep_visible');
    // исходные объекты не мутируются
    expect(middle.ch).toHaveLength(2);
    expect(root.ch).toHaveLength(1);
  });
});

describe('applyViewportFilterToDocument', () => {
  it('фильтрует objects и сохраняет остальные поля документа', () => {
    const doc = makeDoc([
      obj({ id: 'btn_vis', p: [10, 10], s: [20, 20] }),
      obj({ id: 'btn_off', p: [900, 900], s: [20, 20] }),
    ]);
    const result = applyViewportFilterToDocument(doc, WIN);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].id).toBe('btn_vis');
    // canvas и версия сохранены
    expect(result.canvas).toEqual(doc.canvas);
    expect(result.vsl_version).toBe(doc.vsl_version);
  });
});

describe('filterDiffByViewport', () => {
  it('added фильтруется по прямоугольнику', () => {
    const addedVisible = obj({ id: 'btn_new_in', p: [20, 20], s: [10, 10] });
    const addedHidden = obj({ id: 'btn_new_out', p: [900, 900], s: [10, 10] });
    const nextDoc = makeDoc([addedVisible, addedHidden]);
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      changes: {
        added: [addedVisible, addedHidden],
        modified: [],
        removed: [],
        unchanged_refs: [],
      },
    };
    const result = filterDiffByViewport(diff, nextDoc, null, WIN);
    expect(result.changes.added).toHaveLength(1);
    expect(result.changes.added[0].id).toBe('btn_new_in');
  });

  it('modified остаётся только при видимости id в next-документе', () => {
    const nextDoc = makeDoc([
      obj({ id: 'btn_m_vis', p: [10, 10], s: [10, 10] }),
      obj({ id: 'btn_m_off', p: [900, 900], s: [10, 10] }),
    ]);
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      changes: {
        added: [],
        modified: [{ id: 'btn_m_vis' }, { id: 'btn_m_off' }],
        removed: [],
        unchanged_refs: [],
      },
    };
    const result = filterDiffByViewport(diff, nextDoc, null, WIN);
    expect(result.changes.modified).toEqual([{ id: 'btn_m_vis' }]);
  });

  it('removed остаётся только при видимости id в prev-документе', () => {
    const nextDoc = makeDoc([]);
    const prevDoc = makeDoc([
      obj({ id: 'btn_r_vis', p: [10, 10], s: [10, 10] }),
      obj({ id: 'btn_r_off', p: [900, 900], s: [10, 10] }),
    ]);
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      changes: {
        added: [],
        modified: [],
        removed: [{ id: 'btn_r_vis' }, { id: 'btn_r_off' }],
        unchanged_refs: [],
      },
    };
    const result = filterDiffByViewport(diff, nextDoc, prevDoc, WIN);
    expect(result.changes.removed).toEqual([{ id: 'btn_r_vis' }]);
  });

  it('без prev-документа removed сохраняются все', () => {
    const nextDoc = makeDoc([]);
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      changes: {
        added: [],
        modified: [],
        removed: [{ id: 'btn_x' }],
        unchanged_refs: [],
      },
    };
    const result = filterDiffByViewport(diff, nextDoc, null, WIN);
    expect(result.changes.removed).toEqual([{ id: 'btn_x' }]);
  });

  it('unchanged_refs фильтруются по видимости в next-документе', () => {
    const nextDoc = makeDoc([
      obj({ id: 'btn_u_vis', p: [50, 50], s: [10, 10] }),
      obj({ id: 'btn_u_off', p: [900, 900], s: [10, 10] }),
    ]);
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      changes: {
        added: [],
        modified: [],
        removed: [],
        unchanged_refs: ['btn_u_vis', 'btn_u_off'],
      },
    };
    const result = filterDiffByViewport(diff, nextDoc, null, WIN);
    expect(result.changes.unchanged_refs).toEqual(['btn_u_vis']);
  });
});