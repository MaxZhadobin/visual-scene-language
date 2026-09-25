/**
 * Тесты Diff Engine (T1.2.3, ROADMAP.md M1.2; формат ARCHITECTURE.md §6.2).
 *
 * Чистые юнит-тесты без DOM: hand-собранные VslDocument. Покрывают: валидный
 * пустой дифф (все id в unchanged_refs), невмешательство canvas, added полными
 * поддеревьями, removed только {id} (tree order prev), modified по полям с
 * явным null и порядком канона §4, плоскую семантику (ch не сравнивается),
 * комбинированный сценарий, заголовок версий/timestamp.
 */

import { diffVslDocuments } from './diffEngine';
import type { VslDiff } from './diffEngine';
import { VSL_VERSION } from '../types/vsl';
import type { VslDocument, VslObject } from '../types/vsl';

const TS = '2026-09-21T00:00:00.000Z';

function obj(overrides: Partial<VslObject> & { id: string }): VslObject {
  return { t: 'button', p: [0.1, 0.2], s: [100, 30], ...overrides };
}

function doc(objects: VslObject[]): VslDocument {
  return {
    vsl_version: VSL_VERSION,
    canvas: {
      viewport: { width: 1920, height: 1080, unit: 'px' },
      background: '#ffffff',
      scale: 1,
      orientation: 'landscape',
      timestamp: TS,
    },
    objects,
  };
}

const OPT = { diffVersion: 2, baseVersion: 1, timestamp: TS };

/** Плоский список id добавленных объектов (включая детей поддеревьев). */
function flatAdded(objects: readonly VslObject[]): string[] {
  return objects.flatMap((o) => [o.id, ...flatAdded(o.ch ?? [])]);
}

describe('diffVslDocuments (T1.2.3, ARCHITECTURE §6.2)', () => {
  it('идентичные документы → валидный пустой дифф: все id в unchanged_refs, остальные списки пусты', () => {
    const d = doc([
      obj({ id: 'nav_0' }),
      obj({ id: 'button_0_0', txt: 'Войти', act: ['click'] }),
    ]);
    const diff = diffVslDocuments(d, d, OPT);

    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.modified).toEqual([]);
    expect(diff.changes.removed).toEqual([]);
    expect(diff.changes.unchanged_refs).toEqual(['nav_0', 'button_0_0']);
  });

  it('различие canvas не влияет на дифф — сравнивается только objects', () => {
    const a = doc([obj({ id: 'nav_0' })]);
    const b: VslDocument = {
      ...a,
      canvas: { ...a.canvas, background: '#000000', timestamp: '2026-09-21T01:00:00.000Z' },
    };
    const diff = diffVslDocuments(a, b, OPT);

    expect(diff.changes.unchanged_refs).toEqual(['nav_0']);
    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.modified).toEqual([]);
    expect(diff.changes.removed).toEqual([]);
  });

  it('added → новые объекты полными поддеревьями (дети внутри added, не отдельными записями)', () => {
    const prev = doc([obj({ id: 'main_0' })]);
    const modal: VslObject = {
      ...obj({ id: 'modal_0_1', t: 'modal' }),
      ch: [obj({ id: 'button_0_1_0', txt: 'Ок' })],
    };
    const next = doc([obj({ id: 'main_0' }), modal]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(diff.changes.added).toEqual([modal]);
    expect(flatAdded(diff.changes.added)).toEqual(['modal_0_1', 'button_0_1_0']);
    expect(diff.changes.unchanged_refs).toEqual(['main_0']);
  });

  it('removed → только {id} в tree order prev; остальные в unchanged_refs (tree order next)', () => {
    const prev = doc([
      obj({
        id: 'main_0',
        ch: [obj({ id: 'button_0_0_0' }), obj({ id: 'button_0_0_1' })],
      }),
      obj({ id: 'nav_1' }),
    ]);
    const next = doc([
      obj({ id: 'main_0', ch: [obj({ id: 'button_0_0_0' })] }),
      obj({ id: 'nav_1' }),
    ]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(diff.changes.removed).toEqual([{ id: 'button_0_0_1' }]);
    expect(diff.changes.unchanged_refs).toEqual(['main_0', 'button_0_0_0', 'nav_1']);
  });

  it('modified → только изменившиеся поля (txt), неизменные act не попадают в запись', () => {
    const prev = doc([obj({ id: 'button_0', txt: 'Войти', act: ['click'] })]);
    const next = doc([obj({ id: 'button_0', txt: 'Войти в систему', act: ['click'] })]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(diff.changes.modified).toEqual([{ id: 'button_0', txt: 'Войти в систему' }]);
  });

  it('modified → удалённые опциональные поля как явный null (r, st, txt, act)', () => {
    const prev = doc([
      obj({ id: 'button_0', r: 'submit', st: 'disabled', txt: 'Войти', act: ['click'] }),
    ]);
    const next = doc([obj({ id: 'button_0' })]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(diff.changes.modified).toEqual([
      { id: 'button_0', r: null, st: null, txt: null, act: null },
    ]);
  });

  it('modified → появление опционального поля передаётся значением (не null), p — при изменении', () => {
    const prev = doc([obj({ id: 'button_0' })]);
    const next = doc([obj({ id: 'button_0', st: 'disabled', txt: 'Стоп', p: [0.3, 0.4] })]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(diff.changes.modified).toEqual([
      { id: 'button_0', p: [0.3, 0.4], st: 'disabled', txt: 'Стоп' },
    ]);
  });

  it('ключи modified следуют порядку канона §4: id, t, r, p, s, st, txt, act', () => {
    const prev = doc([
      obj({
        id: 'x',
        t: 'link',
        r: 'tab',
        p: [0, 0],
        s: [1, 1],
        st: 'checked',
        txt: 'a',
        act: ['click'],
      }),
    ]);
    const next = doc([
      obj({ id: 'x', t: 'button', p: [0.5, 0.5], s: [2, 2], txt: 'b', act: [] }),
    ]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(Object.keys(diff.changes.modified[0]!)).toEqual([
      'id',
      't',
      'r',
      'p',
      's',
      'st',
      'txt',
      'act',
    ]);
  });

  it('плоская семантика: изменение поля ребёнка не затрагивает запись родителя (ch не сравнивается)', () => {
    const prev = doc([obj({ id: 'main_0', ch: [obj({ id: 'button_0_0', txt: 'Было' })] })]);
    const next = doc([obj({ id: 'main_0', ch: [obj({ id: 'button_0_0', txt: 'Стало' })] })]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(diff.changes.modified).toEqual([{ id: 'button_0_0', txt: 'Стало' }]);
    expect(diff.changes.unchanged_refs).toContain('main_0');
  });

  it('комбинированный сценарий: added + modified + removed + unchanged одновременно', () => {
    const prev = doc([
      obj({ id: 'header_0' }),
      obj({
        id: 'main_0',
        ch: [obj({ id: 'button_0_0', txt: 'Войти' }), obj({ id: 'link_0_1' })],
      }),
    ]);
    const next = doc([
      obj({ id: 'header_0' }),
      obj({
        id: 'main_0',
        ch: [obj({ id: 'button_0_0', txt: 'Войти в систему' }), obj({ id: 'form_0_2' })],
      }),
    ]);
    const diff = diffVslDocuments(prev, next, OPT);

    expect(flatAdded(diff.changes.added)).toEqual(['form_0_2']);
    expect(diff.changes.modified).toEqual([{ id: 'button_0_0', txt: 'Войти в систему' }]);
    expect(diff.changes.removed).toEqual([{ id: 'link_0_1' }]);
    expect(diff.changes.unchanged_refs).toEqual(['header_0', 'main_0']);
  });

  it('заголовок: diff_version/base_version/timestamp берутся из опций вызова', () => {
    const d = doc([obj({ id: 'nav_0' })]);
    const diff: VslDiff = diffVslDocuments(d, d, OPT);

    expect(diff.diff_version).toBe(2);
    expect(diff.base_version).toBe(1);
    expect(diff.timestamp).toBe(TS);
  });
});