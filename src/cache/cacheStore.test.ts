/**
 * Тесты Cache Store (T1.2.1 + часть T1.2.5).
 *
 * Покрывают: детерминизм и чувствительность contentHash/coordHash (решение dc_4),
 * базовый API set/get/has/keys/size, invalidate/clear (§5.2), MVP-семантику
 * invalidateBySelector (решение dc_5), invalidateCoordinates (viewport resize).
 */

import { createCacheStore, computeContentHash, computeCoordHash } from './cacheStore';
import type { VslObject } from '../types/vsl';

function makeButton(overrides: Partial<VslObject> = {}): VslObject {
  return {
    id: 'button_0_0',
    t: 'button',
    p: [0.1, 0.2],
    s: [160, 32],
    txt: 'Войти',
    act: ['click'],
    ...overrides,
  };
}

describe('cacheStore — хэширование (T1.2.1, решение dc_4)', () => {
  it('contentHash чувствителен к txt/st, не зависит от координат', () => {
    const base = makeButton();
    expect(computeContentHash(base)).not.toBe(
      computeContentHash(makeButton({ txt: 'Войти в систему' })),
    );
    expect(computeContentHash(base)).not.toBe(
      computeContentHash(makeButton({ st: 'disabled' })),
    );
    expect(computeContentHash(base)).toBe(
      computeContentHash(makeButton({ p: [0.9, 0.9], s: [1, 1] })),
    );
  });

  it('coordHash чувствителен к p/s, не зависит от смысловых полей', () => {
    const base = makeButton();
    expect(computeCoordHash(base)).not.toBe(computeCoordHash(makeButton({ p: [0.5, 0.2] })));
    expect(computeCoordHash(base)).not.toBe(computeCoordHash(makeButton({ s: [200, 32] })));
    expect(computeCoordHash(base)).toBe(computeCoordHash(makeButton({ txt: 'Другая кнопка' })));
  });

  it('id и ch не входят в contentHash (дети отслеживаются собственными записями)', () => {
    const base = makeButton();
    const withCh: VslObject = {
      ...makeButton({ id: 'button_9_9' }),
      ch: [{ id: 'container_0', t: 'container', p: [0, 0], s: [0, 0] }],
    };
    expect(computeContentHash(base)).toBe(computeContentHash(withCh));
  });

  it('хэши детерминированы и имеют форму sha256 (64 hex-символа)', () => {
    const a = makeButton();
    expect(computeContentHash(a)).toBe(computeContentHash(makeButton()));
    expect(computeCoordHash(a)).toBe(computeCoordHash(makeButton()));
    expect(computeContentHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeCoordHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cacheStore — базовый API', () => {
  it('set сохраняет запись с вычисленными хэшами; get/has/keys/size согласованы', () => {
    const store = createCacheStore();
    const btn = makeButton();
    store.set(btn.id, btn);

    expect(store.has('button_0_0')).toBe(true);
    expect(store.size).toBe(1);
    expect(store.keys()).toEqual(['button_0_0']);

    const entry = store.get('button_0_0');
    expect(entry?.object).toEqual(btn);
    expect(entry?.contentHash).toBe(computeContentHash(btn));
    expect(entry?.coordHash).toBe(computeCoordHash(btn));
  });

  it('get/has неизвестного id — undefined/false; повторный set перезаписывает запись', () => {
    const store = createCacheStore();
    expect(store.get('nope')).toBeUndefined();
    expect(store.has('nope')).toBe(false);

    store.set('x', makeButton());
    store.set('x', makeButton({ txt: 'Обновлённая' }));
    expect(store.size).toBe(1);
    expect(store.get('x')?.object.txt).toBe('Обновлённая');
  });
});

describe('cacheStore — invalidate/clear (§5.2)', () => {
  it('invalidate удаляет точечную запись, не трогая остальные', () => {
    const store = createCacheStore();
    store.set('button_0_0', makeButton());
    store.set('button_0_1', makeButton({ id: 'button_0_1', txt: 'Регистрация' }));

    store.invalidate('button_0_0');
    expect(store.has('button_0_0')).toBe(false);
    expect(store.has('button_0_1')).toBe(true);
    expect(store.size).toBe(1);
  });

  it('clear полностью опустошает кэш', () => {
    const store = createCacheStore();
    store.set('button_0_0', makeButton());
    store.clear();
    expect(store.size).toBe(0);
    expect(store.keys()).toEqual([]);
  });
});

describe('cacheStore — invalidateBySelector (MVP-семантика, решение dc_5)', () => {
  it("'*' эквивалентен clear", () => {
    const store = createCacheStore();
    store.set('button_0_0', makeButton());
    store.set('link_0_1', { id: 'link_0_1', t: 'link', p: [0, 0], s: [80, 24] });

    store.invalidateBySelector('*');
    expect(store.size).toBe(0);
  });

  it('точный id инвалидирует только эту запись', () => {
    const store = createCacheStore();
    store.set('button_0_0', makeButton());
    store.set('button_0_1', makeButton({ id: 'button_0_1' }));

    store.invalidateBySelector('button_0_0');
    expect(store.has('button_0_0')).toBe(false);
    expect(store.has('button_0_1')).toBe(true);
  });

  it("'button' инвалидирует все button_* и не трогает link_*", () => {
    const store = createCacheStore();
    store.set('button_0_0', makeButton());
    store.set('button_0_1_2', makeButton({ id: 'button_0_1_2' }));
    store.set('link_0_1', { id: 'link_0_1', t: 'link', p: [0, 0], s: [80, 24] });

    store.invalidateBySelector('button');
    expect(store.has('button_0_0')).toBe(false);
    expect(store.has('button_0_1_2')).toBe(false);
    expect(store.has('link_0_1')).toBe(true);
    expect(store.size).toBe(1);
  });

  it('неизвестный селектор — безопасный no-op', () => {
    const store = createCacheStore();
    store.set('button_0_0', makeButton());

    store.invalidateBySelector('footer');
    expect(store.size).toBe(1);
  });
});

describe('cacheStore — invalidateCoordinates (viewport resize, §5.2, решение dc_5)', () => {
  it('обнуляет coordHash всех записей; contentHash и object сохраняются', () => {
    const store = createCacheStore();
    const a = makeButton();
    const b: VslObject = { id: 'div_0', t: 'container', p: [0.2, 0.2], s: [100, 100] };
    store.set(a.id, a);
    store.set(b.id, b);

    store.invalidateCoordinates();

    const entryA = store.get('button_0_0');
    expect(entryA?.coordHash).toBe('');
    expect(entryA?.contentHash).toBe(computeContentHash(a));
    expect(entryA?.object).toEqual(a);

    const entryB = store.get('div_0');
    expect(entryB?.coordHash).toBe('');
    expect(entryB?.object).toEqual(b);
  });
});