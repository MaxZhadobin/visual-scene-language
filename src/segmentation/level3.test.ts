/**
 * Unit-тесты Segmentation Level 3 (T1.5.1, dev_2).
 *
 * resolveLevel3Type/isPointerInvisible — чистые функции над захваченным
 * CSS-подмножеством (ElementCss) → тесты полностью детерминированы:
 * синтетические css-объекты без jsdom layout (negative_knowledge
 * note_1790213529352). Захват css из DOM — тесты в domExtractor.test.ts;
 * реальный computed CSS — Playwright (integration/e2e, T1.5.6).
 *
 * Контракт: ARCHITECTURE.md:L147-156 (8 паттернов), порядок проверки = таблице.
 */

import { isPointerInvisible, resolveLevel3Type } from './level3';

describe('segmentation/level3 — resolveLevel3Type (8 паттернов ARCHITECTURE.md:L147-156)', () => {
  it('паттерн 1: cursor:pointer + onclick → button', () => {
    expect(resolveLevel3Type({ cursor: 'pointer' }, { onclick: 'submit()' })).toBe('button');
  });

  it('паттерн 1: без onclick — не button (нужны ОБА признака)', () => {
    expect(resolveLevel3Type({ cursor: 'pointer' }, {})).toBeNull();
  });

  it('паттерн 2: display:flex + gap>0 → container', () => {
    expect(resolveLevel3Type({ display: 'flex', gap: '8px' }, {})).toBe('container');
  });

  it('паттерн 2: gap=0/normal — не container', () => {
    expect(resolveLevel3Type({ display: 'flex', gap: '0px' }, {})).toBeNull();
    expect(resolveLevel3Type({ display: 'flex', gap: 'normal' }, {})).toBeNull();
  });

  it('паттерн 3: font-weight:bold + font-size>20px → heading', () => {
    expect(resolveLevel3Type({ fontWeight: 'bold', fontSize: '24px' }, {})).toBe('heading');
    // Computed style отдаёт жирность числом ('700'):
    expect(resolveLevel3Type({ fontWeight: '700', fontSize: '24px' }, {})).toBe('heading');
  });

  it('паттерн 3: font-size=20px (не >20) / weight 600 — не heading', () => {
    expect(resolveLevel3Type({ fontWeight: 'bold', fontSize: '20px' }, {})).toBeNull();
    expect(resolveLevel3Type({ fontWeight: '600', fontSize: '24px' }, {})).toBeNull();
  });

  it('паттерн 4: position:fixed + top:0 → header', () => {
    expect(resolveLevel3Type({ position: 'fixed', top: '0px' }, {})).toBe('header');
    expect(resolveLevel3Type({ position: 'fixed', top: '0' }, {})).toBe('header');
  });

  it('паттерн 5: position:fixed + bottom:0 → footer', () => {
    expect(resolveLevel3Type({ position: 'fixed', bottom: '0px' }, {})).toBe('footer');
  });

  it('паттерны 4/5: top/bottom ≠ 0/auto — не header/footer', () => {
    expect(resolveLevel3Type({ position: 'fixed', top: '10px' }, {})).toBeNull();
    expect(resolveLevel3Type({ position: 'fixed', bottom: 'auto' }, {})).toBeNull();
  });

  it('паттерн 6: overflow:hidden + height>200px → scrollable_container', () => {
    expect(resolveLevel3Type({ overflow: 'hidden', height: '250px' }, {})).toBe(
      'scrollable_container',
    );
  });

  it('паттерн 6: height=200px (не >200) — не scrollable_container', () => {
    expect(resolveLevel3Type({ overflow: 'hidden', height: '200px' }, {})).toBeNull();
  });

  it('паттерны 7/8 (skip): скрытые элементы не классифицируются', () => {
    // display:none / visibility:hidden отфильтровываются раньше (domExtractor):
    expect(resolveLevel3Type({ display: 'none' }, {})).toBeNull();
    // opacity:0 + pointer-events:none — skip через isPointerInvisible:
    expect(resolveLevel3Type({ opacity: '0', pointerEvents: 'none' }, {})).toBeNull();
  });

  it('порядок = таблице: button выигрывает у пересекающихся паттернов', () => {
    const css = {
      cursor: 'pointer',
      display: 'flex',
      gap: '8px',
      position: 'fixed',
      top: '0px',
    };
    expect(resolveLevel3Type(css, { onclick: 'x()' })).toBe('button');
  });

  it('порядок = таблице: header выигрывает у scrollable_container', () => {
    expect(
      resolveLevel3Type({ position: 'fixed', top: '0px', overflow: 'hidden', height: '300px' }, {}),
    ).toBe('header');
  });

  it('без css (undefined) — null, без исключений', () => {
    expect(resolveLevel3Type(undefined, {})).toBeNull();
  });

  it('пустое css-подмножество — null', () => {
    expect(resolveLevel3Type({}, {})).toBeNull();
  });
});

describe('segmentation/level3 — isPointerInvisible (skip-поддерево, T1.5.1)', () => {
  it('opacity:0 + pointer-events:none → true', () => {
    expect(isPointerInvisible({ opacity: '0', pointerEvents: 'none' })).toBe(true);
  });

  it('opacity:0 без pointer-events:none → false', () => {
    expect(isPointerInvisible({ opacity: '0' })).toBe(false);
  });

  it('pointer-events:none без opacity:0 → false', () => {
    expect(isPointerInvisible({ pointerEvents: 'none' })).toBe(false);
  });

  it('opacity 0.5 (полупрозрачный) → false', () => {
    expect(isPointerInvisible({ opacity: '0.5', pointerEvents: 'none' })).toBe(false);
  });

  it('без css → false', () => {
    expect(isPointerInvisible(undefined)).toBe(false);
  });
});