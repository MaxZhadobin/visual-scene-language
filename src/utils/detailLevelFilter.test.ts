/**
 * Тесты Detail Level Filter (DEC-027, dev_7).
 *
 * Проверяет фильтрацию VSL-объектов по уровням детализации:
 *  - 'low': только интерактивные элементы;
 *  - 'medium': интерактивные + контейнеры;
 *  - 'high': все объекты (без фильтрации).
 */

import type { VslObject, VslDocument } from '../types/vsl';
import type { VslDiff } from '../diff/diffEngine';
import {
  filterObjectsByDetailLevel,
  applyDetailLevelFilter,
  filterDiffByDetailLevel,
  isInteractiveType,
  isContainerType,
  INTERACTIVE_TYPES,
  CONTAINER_TYPES,
} from './detailLevelFilter';

/** Helper: создать VslObject с минимальными полями. */
function makeObj(
  id: string,
  type: string,
  children?: VslObject[],
  styles?: Record<string, string>,
  ): VslObject {
    const obj: VslObject = { id, t: type as VslObject['t'], txt: type, p: [0, 0], s: [100, 30] };
    if (children && children.length > 0) {
      obj.ch = children;
    }
    if (styles) {
      obj.sty = styles;
    }
    return obj;
  }

describe('INTERACTIVE_TYPES / CONTAINER_TYPES sets', () => {
  it('INTERACTIVE_TYPES содержит ожидаемые типы', () => {
    expect(INTERACTIVE_TYPES.has('button')).toBe(true);
    expect(INTERACTIVE_TYPES.has('link')).toBe(true);
    expect(INTERACTIVE_TYPES.has('input')).toBe(true);
    expect(INTERACTIVE_TYPES.has('select')).toBe(true);
    expect(INTERACTIVE_TYPES.has('textarea')).toBe(true);
    expect(INTERACTIVE_TYPES.has('file_input')).toBe(true);
    expect(INTERACTIVE_TYPES.has('tab')).toBe(true);
    expect(INTERACTIVE_TYPES.has('modal')).toBe(true);
    expect(INTERACTIVE_TYPES.has('dropdown_toggle')).toBe(true);
  });

  it('CONTAINER_TYPES содержит ожидаемые типы', () => {
    expect(CONTAINER_TYPES.has('container')).toBe(true);
    expect(CONTAINER_TYPES.has('scrollable_container')).toBe(true);
    expect(CONTAINER_TYPES.has('layout')).toBe(true);
    expect(CONTAINER_TYPES.has('list')).toBe(true);
    expect(CONTAINER_TYPES.has('grid')).toBe(true);
    expect(CONTAINER_TYPES.has('toolbar')).toBe(true);
    expect(CONTAINER_TYPES.has('tab_bar')).toBe(true);
    expect(CONTAINER_TYPES.has('form_field')).toBe(true);
    expect(CONTAINER_TYPES.has('nav')).toBe(true);
    expect(CONTAINER_TYPES.has('header')).toBe(true);
    expect(CONTAINER_TYPES.has('main')).toBe(true);
    expect(CONTAINER_TYPES.has('footer')).toBe(true);
    expect(CONTAINER_TYPES.has('iframe')).toBe(true);
  });
});

describe('isInteractiveType / isContainerType', () => {
  it('isInteractiveType возвращает true для интерактивных типов', () => {
    expect(isInteractiveType('button')).toBe(true);
    expect(isInteractiveType('input')).toBe(true);
    expect(isInteractiveType('div')).toBe(false);
    expect(isInteractiveType('text')).toBe(false);
  });

  it('isContainerType возвращает true для контейнерных типов', () => {
    expect(isContainerType('container')).toBe(true);
    expect(isContainerType('layout')).toBe(true);
    expect(isContainerType('button')).toBe(false);
    expect(isContainerType('text')).toBe(false);
  });
});

describe('filterObjectsByDetailLevel', () => {
  const tree: VslObject[] = [
    makeObj('main_0', 'main', [
      makeObj('btn_0_0', 'button'),
      makeObj('div_0_1', 'div', [
        makeObj('a_0_1_0', 'link'),
        makeObj('txt_0_1_1', 'text'),
      ]),
      makeObj('inp_0_2', 'input'),
    ]),
    makeObj('footer_1', 'footer', [
      makeObj('txt_1_0', 'text'),
    ]),
  ];

  describe('level = high', () => {
    it('возвращает все объекты без изменений', () => {
      const result = filterObjectsByDetailLevel(tree, 'high');
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('main_0');
      expect(result[1]!.id).toBe('footer_1');
      // Дети тоже на месте
      expect(result[0]!.ch).toHaveLength(3);
    });
  });

  describe('level = low', () => {
    it('оставляет только интерактивные элементы', () => {
      const result = filterObjectsByDetailLevel(tree, 'low');
      // main не интерактивный, но содержит button и input → остаётся как обёртка
      // footer не интерактивный и содержит только text → удаляется
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('main_0');
      // Дети main: button (интерактивный), div (не интерактивный, но содержит link), input (интерактивный)
      expect(result[0]!.ch).toHaveLength(3);
      // button
      expect(result[0]!.ch![0]!.id).toBe('btn_0_0');
      // div → обёртка для link
      expect(result[0]!.ch![1]!.id).toBe('div_0_1');
      expect(result[0]!.ch![1]!.ch).toHaveLength(1);
      expect(result[0]!.ch![1]!.ch![0]!.id).toBe('a_0_1_0');
      // input
      expect(result[0]!.ch![2]!.id).toBe('inp_0_2');
    });

    it('strips styles по умолчанию', () => {
      const styledTree = [makeObj('btn_0', 'button', undefined, { color: 'red' })];
      const result = filterObjectsByDetailLevel(styledTree, 'low');
      expect(result[0]!.sty).toBeUndefined();
    });

    it('сохраняет styles при stripStyles=false', () => {
      const styledTree = [makeObj('btn_0', 'button', undefined, { color: 'red' })];
      const result = filterObjectsByDetailLevel(styledTree, 'low', { stripStyles: false });
      expect(result[0]!.sty).toEqual({ color: 'red' });
    });

    it('удаляет неинтерактивные элементы без интерактивных детей', () => {
      const plainTree = [makeObj('txt_0', 'text'), makeObj('div_0', 'div')];
      const result = filterObjectsByDetailLevel(plainTree, 'low');
      expect(result).toHaveLength(0);
    });
  });

  describe('level = medium', () => {
    it('оставляет интерактивные + контейнеры', () => {
      const result = filterObjectsByDetailLevel(tree, 'medium');
      // main — контейнер, footer — контейнер
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('main_0');
      expect(result[1]!.id).toBe('footer_1');
    });

    it('фильтрует детей рекурсивно', () => {
      const result = filterObjectsByDetailLevel(tree, 'medium');
      // main children: button (interactive), div (not container/interactive but has link child), input (interactive)
      const mainChildren = result[0]!.ch!;
      expect(mainChildren).toHaveLength(3);
      // div остаётся потому что содержит link (интерактивный)
      const divWrapper = mainChildren.find(c => c.id === 'div_0_1');
      expect(divWrapper).toBeDefined();
      expect(divWrapper!.ch).toHaveLength(1);
      expect(divWrapper!.ch![0]!.id).toBe('a_0_1_0');
    });

    it('strips styles по умолчанию', () => {
      const styledTree = [makeObj('container_0', 'container', undefined, { bg: 'blue' })];
      const result = filterObjectsByDetailLevel(styledTree, 'medium');
      expect(result[0]!.sty).toBeUndefined();
    });
  });
});

describe('applyDetailLevelFilter', () => {
  const doc: VslDocument = {
    vsl_version: '1.0',
    canvas: {
      timestamp: '2026-01-01T00:00:00.000Z',
      viewport: { width: 1920, height: 1080, unit: 'px' },
      background: '#fff',
      scale: 1,
      orientation: 'landscape',
      url: 'https://example.com',
      title: 'Test',
    },
    objects: [
      makeObj('btn_0', 'button'),
      makeObj('txt_0', 'text'),
    ],
  };

  it('high — возвращает документ без изменений', () => {
    const result = applyDetailLevelFilter(doc, 'high');
    expect(result).toBe(doc); // same reference
  });

  it('low — фильтрует объекты', () => {
    const result = applyDetailLevelFilter(doc, 'low');
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.id).toBe('btn_0');
  });

  it('medium — фильтрует объекты', () => {
    const result = applyDetailLevelFilter(doc, 'medium');
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.id).toBe('btn_0');
  });

  it('документ без objects — возвращает как есть', () => {
    const emptyDoc = { vsl_version: '1.0' } as unknown as VslDocument;
    const result = applyDetailLevelFilter(emptyDoc, 'low');
    expect(result).toBe(emptyDoc);
  });
});

describe('filterDiffByDetailLevel', () => {
  const nextDoc = {
    objects: [
      makeObj('btn_0', 'button'),
      makeObj('txt_0', 'text'),
      makeObj('container_0', 'container', [
        makeObj('inp_0', 'input'),
      ]),
    ],
  };

  const diff: VslDiff = {
    diff_version: 2,
    base_version: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    changes: {
      added: [makeObj('new_btn', 'button'), makeObj('new_txt', 'text')],
      modified: [
        { id: 'btn_0', txt: 'updated' },
        { id: 'txt_0', txt: 'updated' },
      ],
      removed: [{ id: 'old_0' }],
      unchanged_refs: ['btn_0', 'txt_0', 'container_0', 'inp_0'],
    },
  };

  it('high — возвращает diff без изменений', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'high');
    expect(result).toBe(diff);
  });

  it('low — фильтрует added, modified, unchanged_refs', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'low');
    // added: только button (txt фильтруется)
    expect(result.changes.added).toHaveLength(1);
    expect(result.changes.added[0]!.id).toBe('new_btn');
    // modified: только btn_0 (txt_0 не виден в low)
    expect(result.changes.modified).toHaveLength(1);
    expect(result.changes.modified[0]!.id).toBe('btn_0');
    // removed — остаётся как есть
    expect(result.changes.removed).toHaveLength(1);
    // unchanged_refs: только видимые в low (btn_0, container_0, inp_0)
    expect(result.changes.unchanged_refs).toContain('btn_0');
    expect(result.changes.unchanged_refs).toContain('container_0');
    expect(result.changes.unchanged_refs).toContain('inp_0');
    expect(result.changes.unchanged_refs).not.toContain('txt_0');
  });

  it('medium — включает контейнеры', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'medium');
    // added: button (interactive) — text не контейнер и не interactive
    expect(result.changes.added).toHaveLength(1);
    // modified: btn_0 (interactive)
    expect(result.changes.modified).toHaveLength(1);
    expect(result.changes.modified[0]!.id).toBe('btn_0');
    // unchanged_refs: btn_0, container_0, inp_0 (container + interactive child)
    expect(result.changes.unchanged_refs).toContain('btn_0');
    expect(result.changes.unchanged_refs).toContain('container_0');
    expect(result.changes.unchanged_refs).toContain('inp_0');
  });
});