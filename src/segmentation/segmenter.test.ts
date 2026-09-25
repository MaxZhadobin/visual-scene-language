/**
 * Юнит-тесты Segmentation Level 2 + segmenter (T1.1.4).
 * Контракт: ARCHITECTURE.md «Уровень 2: ARIA-атрибуты».
 */
import { ARIA_ROLE_TYPE_MAP, resolveAriaRoleType, resolveSt } from './level2';
import { isAriaHidden, segmentTree, type SegmentedElement } from './segmenter';
import { extractDomTree } from '../capture/domExtractor';

describe('ARIA_ROLE_TYPE_MAP', () => {
  it('содержит ровно 4 контракные роли', () => {
    expect(Object.keys(ARIA_ROLE_TYPE_MAP).sort()).toEqual([
      'button',
      'dialog',
      'tab',
      'tabpanel',
    ]);
  });
});

describe('resolveAriaRoleType', () => {
  it.each`
    role          | expected
    ${'button'}   | ${'button'}
    ${'dialog'}   | ${'modal'}
    ${'tab'}      | ${'tab'}
    ${'tabpanel'} | ${'container'}
  `('role="$role" → t: $expected', ({ role, expected }) => {
    expect(resolveAriaRoleType(role)).toBe(expected);
  });

  it('регистронезависим', () => {
    expect(resolveAriaRoleType('Dialog')).toBe('modal');
  });

  it('неизвестная роль, пустая и отсутствующая роль → null', () => {
    expect(resolveAriaRoleType('gridcell')).toBeNull();
    expect(resolveAriaRoleType('')).toBeNull();
    expect(resolveAriaRoleType(undefined)).toBeNull();
  });
});

describe('resolveSt', () => {
  it('aria-pressed="true" → checked', () => {
    expect(resolveSt({ 'aria-pressed': 'true' })).toBe('checked');
  });

  it('aria-expanded="true" → expanded', () => {
    expect(resolveSt({ 'aria-expanded': 'true' })).toBe('expanded');
  });

  it('aria-disabled="true" → disabled', () => {
    expect(resolveSt({ 'aria-disabled': 'true' })).toBe('disabled');
  });

  it('"false", "mixed" и отсутствие атрибутов → null (только точный "true" по контракту)', () => {
    expect(resolveSt({ 'aria-pressed': 'false' })).toBeNull();
    expect(resolveSt({ 'aria-pressed': 'mixed' })).toBeNull();
    expect(resolveSt({})).toBeNull();
  });

  it('приоритет при нескольких состояниях: checked → expanded → disabled', () => {
    expect(resolveSt({ 'aria-expanded': 'true', 'aria-pressed': 'true' })).toBe('checked');
    expect(resolveSt({ 'aria-disabled': 'true', 'aria-expanded': 'true' })).toBe('expanded');
  });
});

describe('isAriaHidden', () => {
  it('только точное "true" скрывает элемент', () => {
    expect(isAriaHidden({ 'aria-hidden': 'true' })).toBe(true);
    expect(isAriaHidden({ 'aria-hidden': 'false' })).toBe(false);
    expect(isAriaHidden({})).toBe(false);
  });
});

describe('segmentTree (интеграция L1+L2 через extractDomTree)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function flatSegs(elements: SegmentedElement[]): SegmentedElement[] {
    return elements.flatMap((el) => [el, ...flatSegs(el.ch)]);
  }

  it('role="button" + aria-pressed → t=button, st=checked (L2 типизирует div)', () => {
    document.body.innerHTML =
      '<div role="button" aria-pressed="true" data-rect="0,0,80,32">Тоггл</div>';
    const [seg] = segmentTree(extractDomTree());
    expect(seg!.t).toBe('button');
    expect(seg!.st).toBe('checked');
    expect(seg!.txt).toBe('Тоггл');
  });

  it('role="dialog" → modal с txt из aria-label; role="tabpanel" → container', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Вход" data-rect="100,100,400,300">
        <div role="tabpanel" data-rect="110,110,380,200">Содержимое</div>
      </div>
    `;
    const segs = segmentTree(extractDomTree());
    expect(segs).toHaveLength(1);
    expect(segs[0]!.t).toBe('modal');
    expect(segs[0]!.txt).toBe('Вход');
    expect(segs[0]!.ch[0]!.t).toBe('container');
  });

  it('L1 приоритетнее L2: <button role="dialog"> → button (L2 дополняет L1)', () => {
    document.body.innerHTML =
      '<button role="dialog" data-rect="0,0,100,40">Кнопка</button>';
    const [seg] = segmentTree(extractDomTree());
    expect(seg!.t).toBe('button');
  });

  it('aria-label приоритетнее собственного текста', () => {
    document.body.innerHTML =
      '<button aria-label="Поиск" data-rect="0,0,80,32">Кнопка</button>';
    const [seg] = segmentTree(extractDomTree());
    expect(seg!.txt).toBe('Поиск');
  });

  it('aria-expanded / aria-disabled → st: expanded / disabled', () => {
    document.body.innerHTML = `
      <div role="button" aria-expanded="true" data-rect="0,0,80,32">Меню</div>
      <button aria-disabled="true" data-rect="0,40,80,32">Недоступна</button>
    `;
    const segs = segmentTree(extractDomTree());
    expect(segs[0]!.st).toBe('expanded');
    expect(segs[1]!.st).toBe('disabled');
  });

  it('aria-hidden="true" обрезает элемент и всё поддерево', () => {
    document.body.innerHTML = `
      <nav data-rect="0,0,600,40">
        <span aria-hidden="true" data-rect="0,0,60,20">
          <img data-rect="0,0,20,20" alt="decor">
        </span>
        <a data-rect="70,0,60,20" href="/ok">Видимая</a>
      </nav>
    `;
    const segs = flatSegs(segmentTree(extractDomTree()));
    expect(segs.map((s) => s.tag)).toEqual(['nav', 'a']);
  });

  it('нетипизированные элементы сохраняются с t=null (решение за Builder)', () => {
    document.body.innerHTML =
      '<div data-rect="0,0,200,100"><span data-rect="10,10,80,20">текст</span></div>';
    const segs = segmentTree(extractDomTree());
    expect(segs).toHaveLength(1);
    expect(segs[0]!.t).toBeNull();
    // ownText берёт ТОЛЬКО прямые текстовые узлы: 'текст' принадлежит span-ребёнку,
    // поэтому txt родителя-div корректно null (txt не агрегируется от детей — решение L2).
    expect(segs[0]!.txt).toBeNull();
    expect(segs[0]!.ch[0]!.txt).toBe('текст');
  });

  it('кумулятивное покрытие ~60%: L1 (теги) + L2 (роли) на демо-странице', () => {
    document.body.innerHTML = `
      <div data-rect="0,0,1920,600">
        <span data-rect="20,20,200,40">Заголовок</span>
        <nav data-rect="0,0,1920,60"><a data-rect="10,10,60,20" href="/">Главная</a></nav>
        <div role="button" data-rect="20,100,180,48" aria-label="Скачать">↓</div>
        <div role="dialog" data-rect="100,100,400,300" aria-label="Диалог"></div>
        <section data-rect="0,200,300,100"><b data-rect="10,210,100,20">жирный</b></section>
        <img data-rect="0,300,120,40" alt="logo">
      </div>
    `;
    const all = flatSegs(segmentTree(extractDomTree()));
    const typed = all.filter((s) => s.t !== null);
    // 9 элементов, 6 типизированы (nav, link, button, modal, container, image) → 66.7%
    expect(all).toHaveLength(9);
    expect(typed.map((s) => s.t)).toEqual([
      'nav',
      'link',
      'button',
      'modal',
      'container',
      'image',
    ]);
    expect(typed.length / all.length).toBeGreaterThanOrEqual(0.6);
  });
});