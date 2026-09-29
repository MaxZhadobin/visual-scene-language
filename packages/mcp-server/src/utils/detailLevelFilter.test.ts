/**
 * Unit tests for detailLevelFilter utility functions.
 *
 * Test cases:
 *  - isInteractiveType: проверка интерактивных типов
 *  - isContainerType: проверка контейнерных типов
 *  - filterObjectsByDetailLevel: фильтрация по уровням low/medium/high
 *  - applyDetailLevelFilter: фильтрация документа
 *  - Style stripping: удаление sty поля при low/medium
 */

import { describe, it, expect } from '@jest/globals';
import type { VslDiff, VslObject } from '@thinkingos/vsl-sdk';
import {
  filterObjectsByDetailLevel,
  applyDetailLevelFilter,
  filterDiffByDetailLevel,
  isInteractiveType,
  isContainerType,
  INTERACTIVE_TYPES,
  CONTAINER_TYPES,
} from './detailLevelFilter.js';

describe('isInteractiveType', () => {
  it('возвращает true для интерактивных типов', () => {
    expect(isInteractiveType('button')).toBe(true);
    expect(isInteractiveType('link')).toBe(true);
    expect(isInteractiveType('input')).toBe(true);
    expect(isInteractiveType('select')).toBe(true);
    expect(isInteractiveType('textarea')).toBe(true);
    expect(isInteractiveType('file_input')).toBe(true);
    expect(isInteractiveType('tab')).toBe(true);
    expect(isInteractiveType('modal')).toBe(true);
    expect(isInteractiveType('dropdown_toggle')).toBe(true);
  });

  it('возвращает false для неинтерактивных типов', () => {
    expect(isInteractiveType('container')).toBe(false);
    expect(isInteractiveType('layout')).toBe(false);
    expect(isInteractiveType('text')).toBe(false);
    expect(isInteractiveType('image')).toBe(false);
    expect(isInteractiveType('heading')).toBe(false);
    expect(isInteractiveType('')).toBe(false);
  });
});

describe('isContainerType', () => {
  it('возвращает true для контейнерных типов', () => {
    expect(isContainerType('container')).toBe(true);
    expect(isContainerType('scrollable_container')).toBe(true);
    expect(isContainerType('layout')).toBe(true);
    expect(isContainerType('list')).toBe(true);
    expect(isContainerType('grid')).toBe(true);
    expect(isContainerType('toolbar')).toBe(true);
    expect(isContainerType('tab_bar')).toBe(true);
    expect(isContainerType('form_field')).toBe(true);
    expect(isContainerType('nav')).toBe(true);
    expect(isContainerType('header')).toBe(true);
    expect(isContainerType('main')).toBe(true);
    expect(isContainerType('footer')).toBe(true);
  });

  it('возвращает false для неконтейнерных типов', () => {
    expect(isContainerType('button')).toBe(false);
    expect(isContainerType('input')).toBe(false);
    expect(isContainerType('text')).toBe(false);
    expect(isContainerType('image')).toBe(false);
    expect(isContainerType('')).toBe(false);
  });
});

describe('INTERACTIVE_TYPES', () => {
  it('содержит все интерактивные типы', () => {
    expect(INTERACTIVE_TYPES.size).toBe(9);
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

  it('не содержит неинтерактивные типы', () => {
    expect(INTERACTIVE_TYPES.has('container')).toBe(false);
    expect(INTERACTIVE_TYPES.has('text')).toBe(false);
    expect(INTERACTIVE_TYPES.has('div')).toBe(false); // HTML tag, не VSL type
  });
});

describe('CONTAINER_TYPES', () => {
  it('содержит все контейнерные типы', () => {
    expect(CONTAINER_TYPES.size).toBe(12);
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
  });

  it('не содержит HTML-теги', () => {
    expect(CONTAINER_TYPES.has('div')).toBe(false);
    expect(CONTAINER_TYPES.has('section')).toBe(false);
    expect(CONTAINER_TYPES.has('article')).toBe(false);
    expect(CONTAINER_TYPES.has('aside')).toBe(false);
  });
});

describe('filterObjectsByDetailLevel', () => {
  const createObject = (overrides: Partial<VslObject> = {}): VslObject => ({
    id: 'test_1',
    t: 'button',
    p: [0.1, 0.2],
    s: [100, 50],
    ...overrides,
  });

  describe('level = high', () => {
    it('возвращает все объекты без изменений', () => {
      const objects: VslObject[] = [
        createObject({ id: 'btn_1', t: 'button' }),
        createObject({ id: 'txt_1', t: 'text' }),
        createObject({ id: 'img_1', t: 'image' }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'high');
      expect(result).toEqual(objects);
    });

    it('сохраняет стили при level=high', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'btn_1',
          t: 'button',
          sty: { bg: '#fff', fg: '#000' },
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'high');
      expect(result[0].sty).toEqual({ bg: '#fff', fg: '#000' });
    });
  });

  describe('level = low', () => {
    it('оставляет только интерактивные элементы', () => {
      const objects: VslObject[] = [
        createObject({ id: 'btn_1', t: 'button' }),
        createObject({ id: 'txt_1', t: 'text' }),
        createObject({ id: 'inp_1', t: 'input' }),
        createObject({ id: 'img_1', t: 'image' }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'low');
      expect(result.map((o) => o.id)).toEqual(['btn_1', 'inp_1']);
    });

    it('сохраняет контейнеры с интерактивными детьми', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'cont_1',
          t: 'container',
          ch: [createObject({ id: 'btn_1', t: 'button' })],
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'low');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cont_1');
      expect(result[0].ch).toHaveLength(1);
      expect(result[0].ch![0].id).toBe('btn_1');
    });

    it('удаляет контейнеры без интерактивных детей', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'cont_1',
          t: 'container',
          ch: [createObject({ id: 'txt_1', t: 'text' })],
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'low');
      expect(result).toHaveLength(0);
    });

    it('удаляет стили по умолчанию (stripStyles=true)', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'btn_1',
          t: 'button',
          sty: { bg: '#fff', fg: '#000' },
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'low');
      expect(result[0].sty).toBeUndefined();
    });

    it('сохраняет стили при stripStyles=false', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'btn_1',
          t: 'button',
          sty: { bg: '#fff', fg: '#000' },
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'low', {
        stripStyles: false,
      });
      expect(result[0].sty).toEqual({ bg: '#fff', fg: '#000' });
    });
  });

  describe('level = medium', () => {
    it('оставляет интерактивные и контейнерные элементы', () => {
      const objects: VslObject[] = [
        createObject({ id: 'btn_1', t: 'button' }),
        createObject({ id: 'cont_1', t: 'container' }),
        createObject({ id: 'txt_1', t: 'text' }),
        createObject({ id: 'nav_1', t: 'nav' }),
        createObject({ id: 'img_1', t: 'image' }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'medium');
      expect(result.map((o) => o.id)).toEqual(['btn_1', 'cont_1', 'nav_1']);
    });

    it('рекурсивно фильтрует детей', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'cont_1',
          t: 'container',
          ch: [
            createObject({ id: 'btn_1', t: 'button' }),
            createObject({ id: 'txt_1', t: 'text' }),
            createObject({ id: 'inp_1', t: 'input' }),
          ],
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'medium');
      expect(result).toHaveLength(1);
      expect(result[0].ch).toHaveLength(2);
      expect(result[0].ch!.map((o) => o.id)).toEqual(['btn_1', 'inp_1']);
    });

    it('удаляет стили по умолчанию (stripStyles=true)', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'btn_1',
          t: 'button',
          sty: { bg: '#fff', fg: '#000', border: '1px solid #ccc' },
        }),
        createObject({
          id: 'cont_1',
          t: 'container',
          sty: { bg: '#f5f5f5' },
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'medium');
      expect(result[0].sty).toBeUndefined();
      expect(result[1].sty).toBeUndefined();
    });

    it('сохраняет стили при stripStyles=false', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'btn_1',
          t: 'button',
          sty: { bg: '#fff' },
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'medium', {
        stripStyles: false,
      });
      expect(result[0].sty).toEqual({ bg: '#fff' });
    });
  });

  describe('edge cases', () => {
    it('возвращает пустой массив для пустого входа', () => {
      const result = filterObjectsByDetailLevel([], 'low');
      expect(result).toEqual([]);
    });

    it('обрабатывает вложенные контейнеры', () => {
      const objects: VslObject[] = [
        createObject({
          id: 'cont_1',
          t: 'container',
          ch: [
            createObject({
              id: 'cont_2',
              t: 'container',
              ch: [createObject({ id: 'btn_1', t: 'button' })],
            }),
          ],
        }),
      ];

      const result = filterObjectsByDetailLevel(objects, 'low');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cont_1');
      expect(result[0].ch).toHaveLength(1);
      expect(result[0].ch![0].id).toBe('cont_2');
      expect(result[0].ch![0].ch).toHaveLength(1);
      expect(result[0].ch![0].ch![0].id).toBe('btn_1');
    });
  });
});

describe('applyDetailLevelFilter', () => {
  const createDocument = (objects: VslObject[]) => ({
    vsl_version: '1.0.0',
    viewport: { width: 1920, height: 1080 },
    objects,
  });

  it('фильтрует объекты в документе', () => {
    const doc = createDocument([
      { id: 'btn_1', t: 'button', p: [0.1, 0.2], s: [100, 50] },
      { id: 'txt_1', t: 'text', p: [0.3, 0.4], s: [200, 30] },
    ]);

    const result = applyDetailLevelFilter(doc, 'low');
    expect(result.objects).toHaveLength(1);
    expect(result.objects![0].id).toBe('btn_1');
  });

  it('возвращает документ без изменений при level=high', () => {
    const doc = createDocument([
      { id: 'btn_1', t: 'button', p: [0.1, 0.2], s: [100, 50] },
      { id: 'txt_1', t: 'text', p: [0.3, 0.4], s: [200, 30] },
    ]);

    const result = applyDetailLevelFilter(doc, 'high');
    expect(result).toEqual(doc);
  });

  it('возвращает документ без изменений если нет objects', () => {
    const doc = { vsl_version: '1.0.0', viewport: { width: 1920, height: 1080 } };

    const result = applyDetailLevelFilter(doc, 'low');
    expect(result).toEqual(doc);
  });

  it('передаёт stripStyles опцию', () => {
    const doc = createDocument([
      {
        id: 'btn_1',
        t: 'button',
        p: [0.1, 0.2],
        s: [100, 50],
        sty: { bg: '#fff' },
      },
    ]);

    const resultWithStrip = applyDetailLevelFilter(doc, 'low');
    expect(resultWithStrip.objects![0].sty).toBeUndefined();

    const resultWithoutStrip = applyDetailLevelFilter(doc, 'low', {
      stripStyles: false,
    });
    expect(resultWithoutStrip.objects![0].sty).toEqual({ bg: '#fff' });
  });
});

describe('filterDiffByDetailLevel', () => {
  const mk = (id: string, t: string, ch?: VslObject[]): VslObject =>
    ({ id, t, p: [0, 0], s: [10, 10], ...(ch ? { ch } : {}) }) as VslObject;

  const diff: VslDiff = {
    diff_version: 2,
    base_version: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    changes: {
      added: [
        mk('btn_new', 'button'),
        mk('img_new', 'image'),
        mk('cont_new', 'container', [mk('inp_new', 'input')]),
      ],
      modified: [{ id: 'btn_mod' }, { id: 'img_mod' }],
      removed: [{ id: 'txt_old' }],
      unchanged_refs: ['link_same', 'heading_same'],
    },
  };

  const nextDoc = {
    objects: [
      mk('btn_mod', 'button'),
      mk('img_mod', 'image'),
      mk('link_same', 'link'),
      mk('heading_same', 'heading'),
    ],
  };

  it('low: added — только интерактивные и контейнеры с интерактивными потомками', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'low');
    expect(result.changes.added.map((o) => o.id)).toEqual(['btn_new', 'cont_new']);
    expect(result.changes.added[1].ch).toHaveLength(1);
    expect(result.changes.added[1].ch![0].id).toBe('inp_new');
  });

  it('low: modified — только id объектов, остающихся после детал-фильтрации next', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'low');
    expect(result.changes.modified).toEqual([{ id: 'btn_mod' }]);
  });

  it('low: unchanged_refs — только id остающихся объектов', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'low');
    expect(result.changes.unchanged_refs).toEqual(['link_same']);
  });

  it('removed не изменяется (нет данных о типе)', () => {
    const result = filterDiffByDetailLevel(diff, nextDoc, 'low');
    expect(result.changes.removed).toEqual([{ id: 'txt_old' }]);
  });

  it('medium: контейнерные типы остаются в added', () => {
    const scrollDiff: VslDiff = {
      ...diff,
      changes: { ...diff.changes, added: [mk('scroll_new', 'scrollable_container')] },
    };
    const result = filterDiffByDetailLevel(scrollDiff, nextDoc, 'medium');
    expect(result.changes.added.map((o) => o.id)).toEqual(['scroll_new']);
  });

  it('high — дифф возвращается без изменений', () => {
    expect(filterDiffByDetailLevel(diff, nextDoc, 'high')).toBe(diff);
  });

  it('стили стрипаются из added при low/medium', () => {
    const styledDiff: VslDiff = {
      ...diff,
      changes: {
        ...diff.changes,
        added: [mk('btn_styled', 'button')],
      },
    };
    (styledDiff.changes.added[0] as VslObject).sty = { bg: '#fff' };
    const result = filterDiffByDetailLevel(styledDiff, nextDoc, 'low');
    expect(result.changes.added[0].sty).toBeUndefined();
  });
});