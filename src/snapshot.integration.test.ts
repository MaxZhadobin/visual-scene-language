/**
 * Интеграционные тесты snapshot generation (T1.1.6, ROADMAP.md M1.1).
 *
 * Полный путь DOM → extractDomTree → segmentTree → buildVslDocument на трёх
 * типах страниц (лендинг / форма / дашборд) — ac[5]: snapshots валидны по
 * схеме DESIGN_SYSTEM §4, фильтры работают, ID стабильны.
 */
import { extractDomTree } from './capture/domExtractor';
import { segmentTree } from './segmentation/segmenter';
import { buildVslDocument, type BuildOptions } from './builder/vslBuilder';
import { VSL_VERSION, type VslDocument, type VslObject } from './types/vsl';

const OPTIONS: BuildOptions = {
  viewport: { width: 1280, height: 800 },
  timestamp: '2026-01-01T00:00:00.000Z',
  url: 'https://example.com/page',
  title: 'Integration',
};

const TYPES = new Set([
  'button', 'input', 'link', 'nav', 'header', 'main', 'container',
  'image', 'select', 'textarea', 'modal', 'tab',
  // L3 — CSS-анализ (T1.5.1):
  'heading', 'footer', 'scrollable_container',
  // L4 — структурный анализ (T1.5.2):
  'toolbar', 'list', 'grid', 'form_field', 'tab_bar', 'layout',
  // L5 — vision fallback (T1.5.4):
  'icon', 'chart', 'custom_widget', 'unknown',
]);
const STATES = new Set(['checked', 'expanded', 'disabled']);
const ACTIONS = new Set([
  'click', 'type', 'clear', 'scroll', 'hover', 'focus', 'blur',
  'select', 'check', 'uncheck', 'close', 'expand', 'collapse',
]);

/** Валидатор VSL по DESIGN_SYSTEM §4; падает на первом нарушении контракта. */
function validateVslDocument(doc: VslDocument): void {
  expect(doc.vsl_version).toBe(VSL_VERSION);
  expect(doc.canvas.viewport.width).toBeGreaterThan(0);
  expect(doc.canvas.viewport.height).toBeGreaterThan(0);
  expect(doc.canvas.viewport.unit).toBe('px');
  expect(['landscape', 'portrait']).toContain(doc.canvas.orientation);
  expect(Number.isNaN(Date.parse(doc.canvas.timestamp))).toBe(false);

  const ids = new Set<string>();
  const walk = (objects: readonly VslObject[]): void => {
    for (const o of objects) {
      expect(typeof o.id).toBe('string');
      expect(o.id.length).toBeGreaterThan(0);
      expect(ids.has(o.id)).toBe(false); // уникальность ID
      ids.add(o.id);
      expect(TYPES.has(o.t)).toBe(true);
      expect(o.p).toHaveLength(2);
      for (const v of o.p) {
        expect(v).toBeGreaterThanOrEqual(0); // p относительные 0..1
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(o.s).toHaveLength(2);
      for (const v of o.s) expect(v).toBeGreaterThanOrEqual(0);
      if (o.st !== undefined) expect(STATES.has(o.st)).toBe(true);
      if (o.txt !== undefined) expect(typeof o.txt).toBe('string');
      if (o.act !== undefined) {
        expect(Array.isArray(o.act)).toBe(true);
        expect(o.act.length).toBeGreaterThan(0);
        for (const a of o.act) expect(ACTIONS.has(a)).toBe(true);
      }
      if (o.vf !== undefined) {
        expect(typeof o.vf).toBe('string');
        expect(o.vf.length).toBeGreaterThan(0);
        // Инвариант vf→map (AC[5]): каждая vf-ссылка — ключ в visual_fragments.
        expect(doc.visual_fragments?.[o.vf]).toBeDefined();
      }
      if (o.ch !== undefined) walk(o.ch);
    }
  };
  walk(doc.objects);
}

function buildFromHtml(html: string, options: BuildOptions = OPTIONS): VslDocument {
  document.body.innerHTML = html;
  return buildVslDocument(segmentTree(extractDomTree()), options);
}

function flatObjects(objects: readonly VslObject[]): VslObject[] {
  return objects.flatMap((o) => [o, ...flatObjects(o.ch ?? [])]);
}

function byId(objects: readonly VslObject[], id: string): VslObject {
  const found = flatObjects(objects).find((o) => o.id === id);
  expect(found).toBeDefined();
  return found!;
}

/* ------------------------------ Фикстуры ------------------------------ */

const LANDING_HTML = `
  <header data-rect="0,0,1280,64">
    <img data-rect="16,16,120,32" alt="Логотип">
    <nav data-rect="200,20,600,24">
      <a data-rect="200,20,80,24" href="/">Главная</a>
      <a data-rect="300,20,90,24" href="/pricing">Тарифы</a>
      <a data-rect="410,20,70,24" href="/docs">Документация</a>
    </nav>
    <button data-rect="1100,16,160,32">Войти</button>
  </header>
  <section data-rect="0,64,1280,400">
    <span data-rect="100,140,600,48">Продукт нового поколения</span>
    <button data-rect="100,240,220,48" aria-label="Начать бесплатно">Начать</button>
    <img data-rect="700,120,480,300" alt="Скриншот">
  </section>
`;

const FORM_HTML = `
  <main data-rect="0,0,1280,800">
    <form data-rect="340,120,600,560" aria-label="Регистрация">
      <input data-rect="360,180,560,40" type="text" aria-label="Имя">
      <input data-rect="360,240,560,40" type="email" aria-label="Email">
      <input data-rect="360,300,560,40" type="password" aria-label="Пароль">
      <select data-rect="360,420,560,40" aria-label="Страна"><option>Россия</option></select>
      <textarea data-rect="360,480,560,80" aria-label="О себе"></textarea>
      <input data-rect="360,580,20,20" type="checkbox" aria-label="Согласен">
      <button data-rect="360,640,560,48" type="submit">Зарегистрироваться</button>
      <button data-rect="360,700,560,48" aria-disabled="true">Войти через GitHub</button>
    </form>
  </main>
`;

const DASHBOARD_HTML = `
  <div data-rect="0,0,1280,800">
    <nav data-rect="0,0,240,800" aria-label="Боковое меню">
      <a data-rect="16,80,208,40" href="/overview">Обзор</a>
      <a data-rect="16,130,208,40" href="/reports">Отчёты</a>
    </nav>
    <main data-rect="240,0,1040,800">
      <div role="tablist" data-rect="264,24,992,40">
        <div role="tab" data-rect="264,24,120,40">День</div>
        <div role="tab" data-rect="392,24,120,40">Неделя</div>
      </div>
      <button aria-expanded="true" data-rect="1024,24,120,40">Фильтры</button>
      <div role="tabpanel" data-rect="264,80,992,400">
        <section data-rect="264,80,320,180">
          <span data-rect="280,100,120,24">Продажи</span>
          <span data-rect="280,140,200,40">1 240 500 ₽</span>
        </section>
        <section data-rect="608,80,320,180">
          <span data-rect="624,100,120,24">Клиенты</span>
          <span data-rect="624,140,200,40">8 942</span>
        </section>
      </div>
      <div role="dialog" aria-label="Экспорт отчёта" data-rect="440,300,400,200">
        <button data-rect="600,440,160,40">Скачать</button>
      </div>
    </main>
  </div>
`;

/* ------------------------------- Тесты -------------------------------- */

describe('Snapshot generation: лендинг (T1.1.6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('полный путь DOM→VSL: документ валиден, состав ID точно соответствует L1+L2+density', () => {
    const doc = buildFromHtml(LANDING_HTML);
    validateVslDocument(doc);
    expect(flatObjects(doc.objects).map((o) => o.id)).toEqual([
      'header_0', 'img_0_0', 'nav_0_1',
      'a_0_1_0', 'a_0_1_1', 'a_0_1_2', 'button_0_2',
      'section_1', 'button_1_1', 'img_1_2',
    ]);
  });

  it('типы L1 и приоритет aria-label для txt; текстовый span отфильтрован density', () => {
    const doc = buildFromHtml(LANDING_HTML);
    expect(byId(doc.objects, 'header_0').t).toBe('header');
    expect(byId(doc.objects, 'nav_0_1').t).toBe('nav');
    expect(byId(doc.objects, 'nav_0_1').ch).toHaveLength(3);
    expect(byId(doc.objects, 'a_0_1_0').t).toBe('link');
    expect(byId(doc.objects, 'section_1').t).toBe('container');
    expect(byId(doc.objects, 'button_1_1').txt).toBe('Начать бесплатно'); // aria-label
    expect(byId(doc.objects, 'button_1_1').act).toEqual(['click']);
    // span с единственным txt: score 1 < 3 → декоративный, исключён
    expect(flatObjects(doc.objects).some((o) => o.id === 'span_1_0')).toBe(false);
  });
});

describe('Snapshot generation: форма (T1.1.6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('документ валиден; form → container-обёртка (aria-label 2 < 3, но есть дети)', () => {
    const doc = buildFromHtml(FORM_HTML);
    validateVslDocument(doc);
    expect(flatObjects(doc.objects).map((o) => o.id)).toEqual([
      'main_0', 'form_0_0',
      'input_0_0_0', 'input_0_0_1', 'input_0_0_2', 'select_0_0_3',
      'textarea_0_0_4', 'input_0_0_5', 'button_0_0_6', 'button_0_0_7',
    ]);
    expect(byId(doc.objects, 'form_0_0').t).toBe('container');
    expect(byId(doc.objects, 'form_0_0').txt).toBe('Регистрация');
    // 8 прямых детей form (индексы 0-7): input x3 + select + textarea + checkbox + button x2.
    expect(byId(doc.objects, 'form_0_0').ch).toHaveLength(8);
  });

  it('act-дефолты по типам input; disabled-кнопка без act', () => {
    const doc = buildFromHtml(FORM_HTML);
    expect(byId(doc.objects, 'input_0_0_0').act).toEqual(['click', 'type', 'clear']);
    expect(byId(doc.objects, 'input_0_0_2').act).toEqual(['click', 'type', 'clear']); // password
    expect(byId(doc.objects, 'select_0_0_3').act).toEqual(['click', 'select']);
    expect(byId(doc.objects, 'textarea_0_0_4').act).toEqual(['click', 'type', 'clear']);
    expect(byId(doc.objects, 'input_0_0_5').act).toEqual(['click', 'check', 'uncheck']); // checkbox
    expect(byId(doc.objects, 'button_0_0_7').st).toBe('disabled');
    expect(byId(doc.objects, 'button_0_0_7').act).toBeUndefined();
  });
});

describe('Snapshot generation: дашборд (T1.1.6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('документ валиден; роли ARIA → tab/tablist (L4: tab_bar)/tabpanel-container/modal', () => {
    const doc = buildFromHtml(DASHBOARD_HTML);
    validateVslDocument(doc);
    expect(flatObjects(doc.objects).map((o) => o.id)).toEqual([
      'div_0', 'nav_0_0', 'a_0_0_0', 'a_0_0_1', 'main_0_1',
      'div_0_1_0', 'div_0_1_0_0', 'div_0_1_0_1', 'button_0_1_1',
      'div_0_1_2', 'section_0_1_2_0', 'section_0_1_2_1',
      'div_0_1_3', 'button_0_1_3_0',
    ]);
    expect(byId(doc.objects, 'div_0_1_0').t).toBe('tab_bar'); // L4: ряд role=tab → tab_bar (T1.5.2)
    expect(byId(doc.objects, 'div_0_1_0').r).toBe('tablist');
    expect(byId(doc.objects, 'div_0_1_0_0').t).toBe('tab');
    expect(byId(doc.objects, 'div_0_1_2').t).toBe('container'); // tabpanel
    expect(byId(doc.objects, 'div_0_1_3').t).toBe('modal'); // dialog
    expect(byId(doc.objects, 'div_0_1_3').txt).toBe('Экспорт отчёта');
    expect(byId(doc.objects, 'button_0_1_3_0').txt).toBe('Скачать');
  });

  it('st=expanded не убирает act; вложенные контейнеры-карточки пусты внутри (spans отфильтрованы)', () => {
    const doc = buildFromHtml(DASHBOARD_HTML);
    expect(byId(doc.objects, 'button_0_1_1').st).toBe('expanded');
    expect(byId(doc.objects, 'button_0_1_1').act).toEqual(['click']);
    expect(byId(doc.objects, 'section_0_1_2_0').t).toBe('container');
    expect(byId(doc.objects, 'section_0_1_2_0').ch).toBeUndefined(); // spans: score 1 → skip
  });
});

describe('Snapshot generation: фильтры и стабильность (T1.1.6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('display:none исключает поддерево при извлечении; aria-hidden обрезает семантически', () => {
    const html = `
      <header data-rect="0,0,1280,64">
        <button data-rect="1100,16,160,32">Видимая</button>
      </header>
      <aside style="display:none" data-rect="0,64,300,400">
        <button data-rect="16,80,268,40">Скрытая кнопка</button>
      </aside>
      <div aria-hidden="true" data-rect="0,500,1280,100">
        <img data-rect="16,516,80,68" alt="Декор">
      </div>
    `;
    const doc = buildFromHtml(html);
    validateVslDocument(doc);
    expect(flatObjects(doc.objects).map((o) => o.id)).toEqual(['header_0', 'button_0_0']);
  });

  it('стабильность ID: повторная сборка идентична; изменение текста не меняет ни одного id', () => {
    document.body.innerHTML = DASHBOARD_HTML;
    const first = buildVslDocument(segmentTree(extractDomTree()), OPTIONS);
    document.body.innerHTML = DASHBOARD_HTML;
    const second = buildVslDocument(segmentTree(extractDomTree()), OPTIONS);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    document.body.innerHTML = DASHBOARD_HTML.replace('Скачать', 'Экспортировать');
    const changed = buildVslDocument(segmentTree(extractDomTree()), OPTIONS);
    expect(byId(changed.objects, 'button_0_1_3_0').txt).toBe('Экспортировать');
    expect(
      flatObjects(changed.objects).map((o) => o.id).sort(),
    ).toEqual(flatObjects(first.objects).map((o) => o.id).sort());
  });
});