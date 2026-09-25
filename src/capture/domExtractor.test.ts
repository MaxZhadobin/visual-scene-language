/**
 * Юнит-тесты DOM extraction (T1.1.2).
 *
 * Координаты задаются фикстурным атрибутом data-rect="x,y,w,h" (см. jest.setup.ts):
 * полифилл getBoundingClientRect парсит его — проверка гипотезы note_1789916090383.
 */
import { extractDomTree, ownText, type ExtractedElement } from './domExtractor';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function flat(elements: ExtractedElement[]): ExtractedElement[] {
  return elements.flatMap((el) => [el, ...flat(el.children)]);
}

describe('extractDomTree', () => {
  afterEach(() => {
    setBody('');
  });

  it('извлекает видимый элемент с координатами из data-rect, текстом и атрибутами', () => {
    setBody('<button data-rect="10,20,120,40" id="submit" class="btn primary">Отправить</button>');
    const tree = extractDomTree();
    expect(tree).toHaveLength(1);
    const btn = tree[0]!;
    expect(btn.tag).toBe('button');
    expect(btn.rect).toEqual({ x: 10, y: 20, width: 120, height: 40 });
    expect(btn.text).toBe('Отправить');
    expect(btn.attributes.id).toBe('submit');
    expect(btn.attributes.class).toBe('btn primary');
    expect(btn.indexPath).toEqual([0]);
    expect(btn.children).toEqual([]);
  });

  it('пропускает display:none вместе со всем поддеревом', () => {
    setBody(`
      <div style="display:none">
        <button data-rect="1,2,3,4">Скрытая кнопка</button>
      </div>
      <a data-rect="0,0,50,20" href="/x">Видимая ссылка</a>
    `);
    const tags = flat(extractDomTree()).map((el) => el.tag);
    expect(tags).toEqual(['a']);
  });

  it('пропускает visibility:hidden элемент, но включает видимого ребёнка', () => {
    setBody(`
      <div style="visibility:hidden">
        <span data-rect="5,5,10,10" style="visibility:visible">Видимый span</span>
      </div>
    `);
    const els = flat(extractDomTree());
    expect(els.map((e) => e.tag)).toEqual(['span']);
    expect(els[0]!.text).toBe('Видимый span');
  });

  it('пропускает элементы с нулевым боксом, но включает видимых детей', () => {
    setBody(`
      <div><!-- без data-rect полифилл вернёт нулевой rect -->
        <p data-rect="0,100,600,24">Текст параграфа</p>
      </div>
    `);
    const els = flat(extractDomTree());
    expect(els.map((e) => e.tag)).toEqual(['p']);
  });

  it('пропускает непрендеримые теги (script/style/template)', () => {
    setBody(`
      <script>var x = 1;</script>
      <style>.a { color: red }</style>
      <template><p data-rect="1,1,1,1">tpl</p></template>
      <main data-rect="0,0,1000,500">Контент</main>
    `);
    const tags = flat(extractDomTree()).map((e) => e.tag);
    expect(tags).toEqual(['main']);
  });

  it('берёт только собственный текст: текст детей не попадает родителю; whitespace нормализован', () => {
    setBody(`
      <div data-rect="0,0,200,100">
        Заголовок
        <span data-rect="10,10,80,20">  кнопка
          внутри   </span>
      </div>
    `);
    const div = extractDomTree()[0]!;
    expect(div.text).toBe('Заголовок');
    expect(div.children[0]!.text).toBe('кнопка внутри');
  });

  it('indexPath детерминирован и считает позицию среди элементных детей ДО фильтрации', () => {
    setBody(`
      <nav data-rect="0,0,600,40">
        <a data-rect="0,0,60,20" href="/1">один</a>
        <span style="display:none">скрыт</span>
        <a data-rect="70,0,60,20" href="/2">два</a>
      </nav>
    `);
    const nav = extractDomTree()[0]!;
    expect(nav.indexPath).toEqual([0]);
    expect(nav.children).toHaveLength(2);
    // Скрытый span занимает индекс 1, вторая ссылка сохраняет структурный индекс 2.
    const second = nav.children[1]!;
    expect(second.indexPath).toEqual([0, 2]);
    expect(second.text).toBe('два');
  });

  it('пустое body → пустой лес', () => {
    setBody('');
    expect(extractDomTree()).toEqual([]);
  });

  it('повторный вызов на том же DOM даёт идентичный результат (детерминизм)', () => {
    setBody(`
      <header data-rect="0,0,1920,80"><img data-rect="10,10,120,40" alt="logo"></header>
      <main data-rect="0,80,1920,1000">
        <button data-rect="100,100,120,40">OK</button>
      </main>
    `);
    const first = extractDomTree();
    const second = extractDomTree();
    expect(second).toEqual(first);
  });

  it('работает с произвольным корнем, не включая сам корень', () => {
    setBody(`
      <div id="outer" data-rect="0,0,500,500">
        <div id="inner" data-rect="10,10,100,50"><button data-rect="15,15,60,24">Go</button></div>
      </div>
      <button data-rect="600,0,80,30">Вне корня</button>
    `);
    const outer = document.querySelector('#outer');
    expect(outer).not.toBeNull();
    const tags = flat(extractDomTree(outer!)).map((e) => e.tag);
    expect(tags).toEqual(['div', 'button']);
  });

  describe('ownText', () => {
    it('возвращает пустую строку, если прямых текстовых узлов нет', () => {
      setBody('<div data-rect="0,0,1,1"><b data-rect="0,0,1,1">x</b></div>');
      const div = document.body.querySelector('div');
      expect(div).not.toBeNull();
      expect(ownText(div!)).toBe('');
    });
  });
});