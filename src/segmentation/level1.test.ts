/**
 * Юнит-тесты Segmentation Level 1 (T1.1.3).
 * Контракт: ARCHITECTURE.md «Уровень 1: Семантические теги».
 */
import { LEVEL1_TAG_MAP, resolveLevel1Type } from './level1';
import { extractDomTree, type ExtractedElement } from '../capture/domExtractor';

describe('LEVEL1_TAG_MAP', () => {
  it('содержит ровно 10 контракных тегов', () => {
    expect(Object.keys(LEVEL1_TAG_MAP).sort()).toEqual([
      'a',
      'button',
      'header',
      'img',
      'input',
      'main',
      'nav',
      'section',
      'select',
      'textarea',
    ]);
  });
});

describe('resolveLevel1Type', () => {
  it.each`
    tag          | expected
    ${'button'}  | ${'button'}
    ${'input'}   | ${'input'}
    ${'a'}       | ${'link'}
    ${'nav'}     | ${'nav'}
    ${'header'}  | ${'header'}
    ${'main'}    | ${'main'}
    ${'section'} | ${'container'}
    ${'img'}     | ${'image'}
    ${'select'}  | ${'select'}
    ${'textarea'} | ${'textarea'}
  `('тег <$tag> → t: $expected', ({ tag, expected }) => {
    expect(resolveLevel1Type(tag)).toBe(expected);
  });

  it('регистронезависим', () => {
    expect(resolveLevel1Type('BUTTON')).toBe('button');
    expect(resolveLevel1Type('Main')).toBe('main');
    expect(resolveLevel1Type('Img')).toBe('image');
  });

  it('теги вне контракта и пустая строка → null (классификация не импровизируется)', () => {
    for (const tag of [
      'div',
      'span',
      'p',
      'ul',
      'li',
      'footer',
      'aside',
      'h1',
      'h2',
      'label',
      'form',
      'option',
      'svg',
      'BODY',
      '',
    ]) {
      expect(resolveLevel1Type(tag)).toBeNull();
    }
  });
});

describe('интеграция resolveLevel1Type с extractDomTree', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function flatAll(elements: ExtractedElement[]): ExtractedElement[] {
    return elements.flatMap((el) => [el, ...flatAll(el.children)]);
  }

  it('лендинг: семантические теги классифицированы, декоративные обёртки — нет', () => {
    document.body.innerHTML = `
      <div data-rect="0,0,1920,600">
        <span data-rect="20,20,200,40">Hero title</span>
        <nav data-rect="0,0,1920,60">
          <a data-rect="10,10,60,20" href="/">Главная</a>
          <a data-rect="80,10,80,20" href="/pricing">Цены</a>
        </nav>
        <button data-rect="20,500,180,48">Начать бесплатно</button>
      </div>
    `;
    const classified = flatAll(extractDomTree())
      .map((el) => ({ tag: el.tag, t: resolveLevel1Type(el.tag) }))
      .filter((x) => x.t !== null);

    expect(classified).toEqual([
      { tag: 'nav', t: 'nav' },
      { tag: 'a', t: 'link' },
      { tag: 'a', t: 'link' },
      { tag: 'button', t: 'button' },
    ]);
  });

  it('форма: input/select/textarea классифицированы, label/form/option — нет', () => {
    document.body.innerHTML = `
      <form data-rect="0,0,400,300">
        <label data-rect="0,0,100,20">Email</label>
        <input data-rect="0,30,300,36" type="email">
        <select data-rect="0,80,300,36"><option>A</option></select>
        <textarea data-rect="0,130,300,100"></textarea>
      </form>
    `;
    const types = flatAll(extractDomTree())
      .map((el) => resolveLevel1Type(el.tag))
      .filter((t) => t !== null);

    expect(types).toEqual(['input', 'select', 'textarea']);
  });
});