/**
 * Юнит-тесты VSL Builder (T1.1.5).
 * Контракты: ARCHITECTURE.md §2.3 (структура), DESIGN_SYSTEM.md §4 (формат),
 * README_AI §4.2/§4.4 (короткие ключи, относительные p, умные дефолты act),
 * Semantic Density (адаптация к L1/L2).
 */
import { extractDomTree } from '../capture/domExtractor';
import { segmentTree, type SegmentedElement } from '../segmentation/segmenter';
import { VSL_VERSION, type VslDocument, type VslObject } from '../types/vsl';
import { buildVslDocument, isIncludedInVsl, type BuildOptions } from './vslBuilder';

const OPTIONS: BuildOptions = {
  viewport: { width: 1000, height: 500 },
  timestamp: '2026-01-01T00:00:00.000Z',
  url: 'https://example.com/test',
  title: 'Тестовая страница',
};

function buildFromHtml(html: string, options: BuildOptions = OPTIONS): VslDocument {
  document.body.innerHTML = html;
  return buildVslDocument(segmentTree(extractDomTree()), options);
}

function flatObjects(objects: readonly VslObject[]): VslObject[] {
  return objects.flatMap((o) => [o, ...flatObjects(o.ch ?? [])]);
}

describe('buildVslDocument: canvas (DESIGN_SYSTEM §4.1)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('vsl_version 1.0.0; canvas из options: viewport/px/scale/background/orientation/timestamp/url/title', () => {
    const doc = buildFromHtml('<button data-rect="0,0,100,40">OK</button>');
    expect(doc.vsl_version).toBe(VSL_VERSION);
    expect(doc.vsl_version).toBe('1.0.0');
    expect(doc.canvas.viewport).toEqual({ width: 1000, height: 500, unit: 'px' });
    expect(doc.canvas.background).toBe('#ffffff');
    expect(doc.canvas.scale).toBe(1);
    expect(doc.canvas.orientation).toBe('landscape');
    expect(doc.canvas.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(doc.canvas.url).toBe('https://example.com/test');
    expect(doc.canvas.title).toBe('Тестовая страница');
  });

  it('portrait при height > width; дефолт url из location.href; пустой title опускается', () => {
    const doc = buildFromHtml('<button data-rect="0,0,100,40">OK</button>', {
      viewport: { width: 500, height: 1000 },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(doc.canvas.orientation).toBe('portrait');
    expect(doc.canvas.url).toBe('http://localhost/');
    expect(doc.canvas.title).toBeUndefined();
  });

  it('viewport по умолчанию — window.inner* (1920x1080 из jest.setup)', () => {
    const doc = buildVslDocument([], { timestamp: '2026-01-01T00:00:00.000Z' });
    expect(doc.canvas.viewport).toEqual({ width: 1920, height: 1080, unit: 'px' });
  });
});

describe('buildVslDocument: объекты (id/t/r/p/s/st/txt/act/ch)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('детерминированный id из DOM-пути; p относительные [0..1]; s в px (округл.); txt/act-дефолты', () => {
    const doc = buildFromHtml('<button data-rect="100,50,120.6,40" id="submit">OK</button>');
    expect(doc.objects).toHaveLength(1);
    const btn = doc.objects[0]!;
    expect(btn.id).toBe('button_0');
    expect(btn.t).toBe('button');
    expect(btn.p).toEqual([0.1, 0.1]);
    expect(btn.s).toEqual([121, 40]);
    expect(btn.txt).toBe('OK');
    expect(btn.act).toEqual(['click']);
    expect(btn.ch).toBeUndefined();
  });

  it('p округляется до 4 знаков (333/1000=0.333; 111/500=0.222)', () => {
    const doc = buildFromHtml('<button data-rect="333,111,100,40">OK</button>');
    expect(doc.objects[0]!.p).toEqual([0.333, 0.222]);
  });

  it('вложенность: id отражает DOM-путь (button_0_0); нетипизированный родитель → container-обёртка', () => {
    const doc = buildFromHtml(`
      <div data-rect="0,0,1000,500">
        <button data-rect="100,50,120,40">OK</button>
      </div>
    `);
    expect(doc.objects).toHaveLength(1);
    const wrapper = doc.objects[0]!;
    expect(wrapper.id).toBe('div_0');
    expect(wrapper.t).toBe('container');
    expect(wrapper.ch).toHaveLength(1);
    expect(wrapper.ch![0]!.id).toBe('button_0_0');
    expect(wrapper.ch![0]!.t).toBe('button');
  });

  it('role → r; aria-pressed → st: checked; aria-label → txt', () => {
    const doc = buildFromHtml(
      '<div role="button" aria-pressed="true" aria-label="Тоггл" data-rect="0,0,80,32"></div>',
    );
    const obj = doc.objects[0]!;
    expect(obj.id).toBe('div_0');
    expect(obj.t).toBe('button');
    expect(obj.r).toBe('button');
    expect(obj.st).toBe('checked');
    expect(obj.txt).toBe('Тоггл');
  });

  it('Semantic Density: role (score 3) включает нетипизированный лист; span с одним txt (score 1) — нет', () => {
    const doc = buildFromHtml(`
      <div data-rect="0,0,400,200">
        <span data-rect="0,0,100,20">декоративная подпись</span>
        <div role="navigation" data-rect="0,30,400,40"></div>
      </div>
    `);
    const objs = flatObjects(doc.objects);
    // span: score=txt(1)<3, детей нет → исключён; div[navigation]: role(3)≥3 → включён
    // (t=container, r=navigation); внешний div: есть включённый ребёнок → обёртка.
    expect(objs.map((o) => o.id)).toEqual(['div_0', 'div_0_1']);
    expect(objs[0]!.t).toBe('container');
    expect(objs[1]!.r).toBe('navigation');
  });

  it('декоративная ветка исключается целиком, если внутри нет включённых', () => {
    const doc = buildFromHtml(`
      <button data-rect="0,0,100,40">OK</button>
      <div data-rect="0,100,100,40"><span data-rect="0,100,50,20">оформление</span></div>
    `);
    // div score=0 (без txt/role), span score=1 → оба мимо порога.
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]!.id).toBe('button_0');
  });

  it('умные дефолты act по типам (README_AI §4.4)', () => {
    const doc = buildFromHtml(`
      <button data-rect="0,0,80,32">b</button>
      <a data-rect="0,40,80,32" href="/x">l</a>
      <input data-rect="0,80,80,32" type="text">
      <input data-rect="0,120,80,32" type="checkbox">
      <select data-rect="0,160,80,32"><option>1</option></select>
      <textarea data-rect="0,200,80,32"></textarea>
      <div role="dialog" aria-label="Диалог" data-rect="0,240,80,32"></div>
    `);
    const byId = new Map(flatObjects(doc.objects).map((o) => [o.id, o]));
    expect(byId.get('button_0')!.act).toEqual(['click']);
    expect(byId.get('a_1')!.act).toEqual(['click']);
    expect(byId.get('input_2')!.act).toEqual(['click', 'type', 'clear']);
    expect(byId.get('input_3')!.act).toEqual(['click', 'check', 'uncheck']);
    expect(byId.get('select_4')!.act).toEqual(['click', 'select']);
    expect(byId.get('textarea_5')!.act).toEqual(['click', 'type', 'clear']);
    expect(byId.get('div_6')!.act).toEqual(['close']);
    expect(byId.get('div_6')!.t).toBe('modal');
  });

  it('st=disabled убирает act (взаимодействие недоступно)', () => {
    const doc = buildFromHtml('<button aria-disabled="true" data-rect="0,0,80,32">X</button>');
    const btn = doc.objects[0]!;
    expect(btn.st).toBe('disabled');
    expect(btn.act).toBeUndefined();
  });

  it('пустая страница → objects: []', () => {
    const doc = buildFromHtml('');
    expect(doc.objects).toEqual([]);
  });

  it('детерминизм: две сборки одного DOM идентичны (база M1.2 diff)', () => {
    const html = `
      <header data-rect="0,0,1000,80"><img data-rect="10,10,120,40" alt="logo"></header>
      <main data-rect="0,80,1000,420">
        <button data-rect="100,100,120,40">OK</button>
      </main>
    `;
    expect(JSON.stringify(buildFromHtml(html))).toBe(JSON.stringify(buildFromHtml(html)));
  });
});

describe('buildVslDocument: visual_fragments (T1.5.4, AC[5])', () => {
  const VF_META = {
    type: 'icon',
    format: 'webp',
    size: [104, 104] as [number, number],
    hash: 'hash1',
    cached_at: '2026-01-01T00:00:00.000Z',
  };

  /** Синтетический аннотированный элемент (как после enrichWithVision: t + vf/vf_meta). */
  function enrichedElement(indexPath: number[]): SegmentedElement {
    return {
      tag: 'canvas',
      indexPath,
      rect: { x: 10, y: 20, width: 100, height: 100 },
      attributes: {},
      t: 'icon',
      txt: null,
      st: null,
      ch: [],
      vf: 'emb_abc123def456',
      vf_meta: { ...VF_META },
    };
  }

  it('аннотированный enrich-элемент: vf/vf_meta на объекте + запись в реестре (инвариант vf→map)', () => {
    const doc = buildVslDocument([enrichedElement([0])], OPTIONS);
    expect(doc.objects).toHaveLength(1);
    const obj = doc.objects[0]!;
    expect(obj.t).toBe('icon');
    expect(obj.vf).toBe('emb_abc123def456');
    expect(obj.vf_meta).toEqual(VF_META);
    expect(doc.visual_fragments).toEqual({
      emb_abc123def456: {
        type: 'icon',
        format: 'webp',
        size: [104, 104],
        hash: 'hash1',
        cached_at: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('документ без vf-объектов → visual_fragments undefined (обратно-совместимость optional-полей)', () => {
    const plain: SegmentedElement = {
      tag: 'button',
      indexPath: [0],
      rect: { x: 0, y: 0, width: 100, height: 40 },
      attributes: {},
      t: 'button',
      txt: 'OK',
      st: null,
      ch: [],
    };
    const doc = buildVslDocument([plain], OPTIONS);
    expect(doc.objects).toHaveLength(1);
    expect(doc.visual_fragments).toBeUndefined();
  });

  it('дубликаты vf (одинаковый фрагмент на разных объектах) дедуплицируются одной записью', () => {
    const doc = buildVslDocument([enrichedElement([0]), enrichedElement([1])], OPTIONS);
    expect(doc.objects).toHaveLength(2);
    expect(Object.keys(doc.visual_fragments ?? {})).toEqual(['emb_abc123def456']);
  });

  it('vf без классификации (t=null) не спасает элемент — builder отбрасывает как раньше', () => {
    const orphan: SegmentedElement = {
      tag: 'div',
      indexPath: [0],
      rect: { x: 0, y: 0, width: 50, height: 50 },
      attributes: {},
      t: null,
      txt: null,
      st: null,
      ch: [],
      vf: 'emb_orphan',
      vf_meta: { type: 'unknown', format: 'webp', size: [50, 50], hash: 'h', cached_at: 'x' },
    };
    const doc = buildVslDocument([orphan], OPTIONS);
    expect(doc.objects).toEqual([]);
    expect(doc.visual_fragments).toBeUndefined();
  });

  it('vf-запись собирается из вложенных объектов (обход поддерева, AC[5])', () => {
    const child: SegmentedElement = {
      tag: 'canvas',
      indexPath: [0, 0],
      rect: { x: 0, y: 0, width: 50, height: 50 },
      attributes: {},
      t: 'chart',
      txt: null,
      st: null,
      ch: [],
      vf: 'emb_chart',
      vf_meta: { type: 'chart', format: 'webp', size: [50, 50], hash: 'h2', cached_at: 'x' },
    };
    const parent: SegmentedElement = {
      tag: 'div',
      indexPath: [0],
      rect: { x: 0, y: 0, width: 400, height: 200 },
      attributes: {},
      t: 'container',
      txt: null,
      st: null,
      ch: [child],
    };
    const doc = buildVslDocument([parent], OPTIONS);
    expect(doc.visual_fragments?.['emb_chart']).toEqual({
      type: 'chart',
      format: 'webp',
      size: [50, 50],
      hash: 'h2',
      cached_at: 'x',
    });
  });
});

describe('isIncludedInVsl: отбор vision-кандидатов (T1.5.4)', () => {
  const base = (overrides: Partial<SegmentedElement> = {}): SegmentedElement => ({
    tag: 'div',
    indexPath: [0],
    rect: { x: 0, y: 0, width: 100, height: 100 },
    attributes: {},
    t: null,
    txt: null,
    st: null,
    ch: [],
    ...overrides,
  });

  it('типизированный элемент → true (включён, не vision-кандидат)', () => {
    expect(isIncludedInVsl(base({ t: 'button' }))).toBe(true);
  });

  it('нетипизированный score=0 без детей → false (будет отброшен — vision-кандидат)', () => {
    expect(isIncludedInVsl(base())).toBe(false);
  });

  it('нетипизированный с role (score 3 ≥ 3) → true (контейнер по Semantic Density)', () => {
    expect(isIncludedInVsl(base({ attributes: { role: 'navigation' } }))).toBe(true);
  });

  it('нетипизированный с txt (score 1 < 3) и без детей → false', () => {
    expect(isIncludedInVsl(base({ txt: 'подпись' }))).toBe(false);
  });

  it('нетипизированный с включённым ребёнком → true (контейнер-обёртка)', () => {
    const el = base({ ch: [base({ t: 'button', indexPath: [0, 0] })] });
    expect(isIncludedInVsl(el)).toBe(true);
  });

  it('включённый потомок через промежуточный нетипизированный уровень → true (рекурсия)', () => {
    const deep = base({ tag: 'span', indexPath: [0, 0, 0], t: 'button' });
    const middle = base({ tag: 'section', indexPath: [0, 0], ch: [deep] });
    const el = base({ ch: [middle] });
    expect(isIncludedInVsl(el)).toBe(true);
  });
});

describe('buildVslDocument: lazy text loading (M1.7, DEC-026)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('текст <= 200 символов остаётся в txt (без lazy loading)', () => {
    const shortText = 'a'.repeat(200);
    const doc = buildFromHtml(`<button data-rect="0,0,400,40">${shortText}</button>`);
    expect(doc.objects).toHaveLength(1);
    const obj = doc.objects[0]!;
    expect(obj.txt).toBe(shortText);
    expect(obj.txt_preview).toBeUndefined();
    expect(obj.txt_ref).toBeUndefined();
    expect(doc.text_blocks).toBeUndefined();
  });
  it('текст > 200 символов заменяется на txt_preview + txt_ref', () => {
    const longText = 'a'.repeat(201);
    const doc = buildFromHtml(`<button data-rect="0,0,400,40">${longText}</button>`);
    expect(doc.objects).toHaveLength(1);
    const obj = doc.objects[0]!;
    expect(obj.txt).toBeUndefined();
    expect(obj.txt_preview).toBe('a'.repeat(50) + '…');
    expect(obj.txt_ref).toBe('tb_000');
    expect(doc.text_blocks).toBeDefined();
    expect(doc.text_blocks!['tb_000']).toBe(longText);
  });
  it('несколько длинных текстов получают инкрементные ID (tb_000, tb_001)', () => {
    const longText1 = 'x'.repeat(250);
    const longText2 = 'y'.repeat(300);
    const doc = buildFromHtml(`
      <button data-rect="0,0,400,40">${longText1}</button>
      <button data-rect="0,50,400,40">${longText2}</button>
    `);
    expect(doc.objects).toHaveLength(2);
    expect(doc.objects[0]!.txt_ref).toBe('tb_000');
    expect(doc.objects[1]!.txt_ref).toBe('tb_001');
    expect(doc.text_blocks!['tb_000']).toBe(longText1);
    expect(doc.text_blocks!['tb_001']).toBe(longText2);
  });
  it('смешанные тексты: короткие в txt, длинные в text_blocks', () => {
    const shortText = 'Короткий текст';
    const longText = 'Длинный текст '.repeat(20);
    const doc = buildFromHtml(`
      <button data-rect="0,0,100,40">${shortText}</button>
      <a data-rect="0,50,400,40" href="/x">${longText}</a>
    `);
    expect(doc.objects).toHaveLength(2);
    const btn = doc.objects[0]!;
    const link = doc.objects[1]!;
    expect(btn.txt).toBe(shortText);
    expect(link.txt).toBeUndefined();
    expect(link.txt_ref).toBe('tb_000');
    // HTML parser (jsdom) trims trailing whitespace, so compare trimmed
    expect(doc.text_blocks!['tb_000']).toBe(longText.trim());
  });
});