/**
 * Бюджетный тест пайплайна — «имитация Хабра» (рв5_сайз, АС[10]).
 *
 * Синтетический документ в масштабе реального снапшота habr.com
 * (высота ~24400пх, 20 статей, глубокая вложенность контейнеров,
 * панель настроек ленты, футер, ленивые тексты тб_ххх) прогоняется
 * через реальный пайплайн отдачи: вьюпорт-фильтр (видимое окно
 * [0, 720]) → детал_левел лоу.
 *
 * Цель: размер ДжСОН меньше 50КБ (базлайн до фикса — 173КБ).
 * Живой МЦП-процесс исполняет старый код до рестарта, поэтому бюджет
 * верифицируется оффлайн на структуре, повторяющей реальный Хабр.
 */

import {
  computeVisibleWindow,
  filterObjectsByViewport,
  type ScrollContext,
} from './viewportFilter.js';
import { filterObjectsByDetailLevel } from './detailLevelFilter.js';
import type { VslDocument, VslObject } from '@thinkingos/vsl-sdk';

/** Вьюпорт Хабра (реальный снапшот): 1280х720. */
const VIEWPORT = { width: 1280, height: 720 };

/** Полная высота документа (Хабр: ~24390). */
const DOC_HEIGHT = 24390;

/** Скролл в начале страницы. */
const SCROLL_TOP: ScrollContext = { x: 0, y: 0, width: VIEWPORT.width, height: DOC_HEIGHT };

/** Интерактивные типы (соответствуют ИНТЕРАКТИВ_ТАЙПС деталЛевелФильтра). */
const INTERACTIVE = new Set<string>([
  'button', 'input', 'file_input', 'link', 'select', 'textarea',
  'tab', 'modal', 'dropdown_toggle',
]);

let seq = 0;

/** Создать объект с уникальным ид (формат сыройТег_Н — рв2_ид_маппинг). */
function o(
  t: VslObject['t'],
  p: [number, number],
  s: [number, number],
  extra: Partial<VslObject> = {},
  ch?: VslObject[],
): VslObject {
  const obj: VslObject = { id: `${t}_${seq++}`, t, p, s, ...extra };
  if (ch && ch.length > 0) obj.ch = ch;
  return obj;
}

// ---------- Фрагменты документа (структура, близкая к реальному Хабру) ----------

function makeHeader(): VslObject {
  return o('header', [0, 0], [1280, 56], {}, [
    o('button', [92, 14], [24, 24], { txt: 'Toggle menu', act: ['click'] }),
    o('link', [227, 11], [75, 34], { txt: 'Все потоки', act: ['click'] }),
    o('link', [1000, 12], [24, 24], { act: ['click'] }),
    o('link', [1120, 12], [68, 32], { r: 'button', txt: 'Войти', act: ['click'] }),
  ]);
}

/** Панель настроек ленты: 13 инпутов + 2 ссылки + кнопка (видима при скролле 0). */
function makeSettingsPanel(): VslObject {
  const checkboxes = [0, 1, 2].map((k) =>
    o('container', [112, 370], [73, 21], {}, [
      o('input', [111 + k * 93, 395], [18, 21], { act: ['click', 'check', 'uncheck'] }),
    ]),
  );
  const scoreRadios = ['all', '0', '10', '25', '50', '100'].map((v, k) =>
    o('input', [111 + k * 52, 458], [44, 32], { id: `radio-score-${v}`, act: ['click', 'check', 'uncheck'] }),
  );
  const complexityRadios = ['all', 'easy', 'medium', 'hard'].map((v, k) =>
    o('input', [111 + k * 80, 532], [72, 32], { id: `radio-complexity-${v}`, act: ['click', 'check', 'uncheck'] }),
  );
  return o('container', [92, 354], [780, 347], {}, [
    o('container', [112, 370], [740, 47], {}, checkboxes),
    o('container', [112, 433], [740, 58], {}, scoreRadios),
    o('container', [112, 507], [740, 58], {}, complexityRadios),
    o('container', [112, 581], [740, 52], {}, [
      o('link', [161, 598], [61, 18], { txt: 'Войдите', act: ['click'] }),
      o('link', [256, 598], [139, 18], { txt: 'зарегистрируйтесь', act: ['click'] }),
    ]),
    o('button', [112, 649], [104, 32], { txt: 'Применить', act: ['click'] }),
  ]);
}

/** Статья ленты (~680пх высоты, глубокая вложенность как на Хабре: конт > конт > лист). */
function makeArticle(y: number): VslObject {
  const avatar = o('container', [112, y + 24], [24, 24]);
  const authorBar = o('container', [112, y + 24], [740, 32], {}, [
    o('link', [112, y + 24], [24, 24], { act: ['click'] }, [avatar]),
    o('link', [144, y + 29], [140, 15], { txt: 'author', act: ['click'] }),
  ]);
  const title = o('link', [112, y + 60], [674, 26], { act: ['click'] });
  const hubs = o('container', [112, y + 96], [740, 24], {}, [
    o('link', [112, y + 96], [130, 24], { txt: 'Хаб', act: ['click'] }),
    o('link', [252, y + 96], [48, 24], { txt: 'Блог', act: ['click'] }),
  ]);
  const body = o('container', [112, y + 134], [740, 417], {
    txt_preview: 'Длинный текст статьи (первые пятьдесят символов)…',
    txt_ref: `tb_${y}`,
  });
  const readMore = o('link', [112, y + 560], [113, 38], { act: ['click'] });
  const actionBar = o('container', [112, y + 620], [740, 25], {}, [
    o('button', [183, y + 625], [33, 16], { act: ['click'] }),
    o('button', [248, y + 625], [24, 24], { act: ['click'] }),
    o('link', [304, y + 625], [35, 24], { act: ['click'] }),
  ]);
  const inner = o('container', [92, y], [780, 660], {}, [
    o('list', [112, y + 16], [740, 640], {}, [
      o('container', [112, y + 16], [740, 640], {}, [authorBar, title, hubs, body, readMore, actionBar]),
    ]),
  ]);
  return o('container', [92, y], [780, 680], {}, [inner]);
}

function makeFooter(footerY: number): VslObject {
  const links = Array.from({ length: 26 }, (_, k) =>
    o('link', [92 + (k % 4) * 240, footerY + 40 + Math.floor(k / 4) * 28], [110, 16], { txt: 'Раздел', act: ['click'] }),
  );
  return o('container', [0, footerY], [1280, 288], {}, [
    o('container', [92, footerY + 20], [1096, 248], {}, links),
  ]);
}

/** Полный документ-имитация Хабра: шапка + настройки + 20 статей + футер. */
function makeHabrDocument(): VslDocument {
  seq = 0;
  const textBlocks: Record<string, string> = {};
  const articles: VslObject[] = [];
  let y = 824;
  for (let i = 0; i < 20; i += 1) {
    articles.push(makeArticle(y));
    // Ленивый текст ~450 символов — как реальные тб_ххх блоки Хабра
    textBlocks[`tb_${y}`] = 'Длинный текст статьи о разных вещах. '.repeat(12);
    y += 1180;
  }
  const footerY = y;
  const root = o('container', [0, 0], [1280, footerY + 336], { id: 'mount' }, [
    o('container', [0, 0], [1280, footerY + 336], { id: 'app' }, [
      o('list', [0, 0], [1280, footerY + 288], {}, [
        makeHeader(),
        o('container', [0, 56], [1280, footerY - 56 + 288], {}, [
          o('main', [0, 56], [1280, footerY - 56 + 288], {}, [
            o('container', [92, 256], [780, 98], {}, [
              o('button', [92, 312], [780, 42], { txt: 'Настройки ленты', act: ['click'] }),
            ]),
            makeSettingsPanel(),
            ...articles,
          ]),
        ]),
        makeFooter(footerY),
      ]),
    ]),
  ]);
  return {
    vsl_version: '1.0.0',
    canvas: {
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height, unit: 'px' },
      background: '#ffffff',
      scale: 1,
      orientation: 'landscape',
      timestamp: '2026-09-28T13:00:00.000Z',
      url: 'https://habr.com/',
      title: 'Публикации / Хабр',
    },
    objects: [root],
    text_blocks: textBlocks,
  };
}

// ---------- Обходы для ассертов ----------

function countObjects(objects: readonly VslObject[]): number {
  return objects.reduce((acc, obj) => acc + 1 + (obj.ch ? countObjects(obj.ch) : 0), 0);
}

function maxBottom(objects: readonly VslObject[]): number {
  let max = 0;
  for (const obj of objects) {
    if (obj.p && obj.s) max = Math.max(max, obj.p[1] + obj.s[1]);
    if (obj.ch) max = Math.max(max, maxBottom(obj.ch));
  }
  return max;
}

/** Максимальный верх (p[1]) среди всех объектов — инвариант отсечки оффскрина. */
function maxTop(objects: readonly VslObject[]): number {
  let max = 0;
  for (const obj of objects) {
    if (obj.p) max = Math.max(max, obj.p[1]);
    if (obj.ch) max = Math.max(max, maxTop(obj.ch));
  }
  return max;
}

function hasInteractiveDescendant(obj: VslObject): boolean {
  return (obj.ch ?? []).some((child) => INTERACTIVE.has(child.t) || hasInteractiveDescendant(child));
}

/** Инвариант лоу: каждый неинтерактивный узел имеет интерактивного потомка. */
function assertLowInvariant(objects: readonly VslObject[]): void {
  for (const obj of objects) {
    if (INTERACTIVE.has(obj.t)) continue; // поддеревья интерактивных сохраняются как есть
    expect(hasInteractiveDescendant(obj)).toBe(true);
    if (obj.ch) assertLowInvariant(obj.ch);
  }
}

// ---------- Тесты ----------

describe('пайплайнБаджет: имитация Хабра (рв5_сайз, АС[10])', () => {
  const doc = makeHabrDocument();
  const win = computeVisibleWindow(VIEWPORT, SCROLL_TOP);

  it('документ в масштабе реальности: больше 300 объектов, высота больше 24000пх', () => {
    expect(countObjects(doc.objects)).toBeGreaterThan(300);
    expect(maxBottom(doc.objects)).toBeGreaterThan(24000);
  });

  it('вьюпорт-фильтр вырезает всё вне окна [0, 720] (регрессия рв3)', () => {
    const filtered = filterObjectsByViewport(doc.objects, win);
    // Корневые контейнеры покрывают всю страницу (верх 0) и остаются легитимно:
    // инвариант — ни один объект не начинается ниже окна (оффскрин вырезан).
    expect(maxTop(filtered)).toBeLessThan(VIEWPORT.height);
    expect(countObjects(filtered)).toBeLessThan(countObjects(doc.objects));
  });

  it('лоу: ДжСОН меньше 50КБ, только видимое окно, инвариант лоу (АС[10])', () => {
    const visible = filterObjectsByViewport(doc.objects, win);
    const low = filterObjectsByDetailLevel(visible, 'low');
    const result: VslDocument = { ...doc, objects: low };
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');

    const fullBytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    // Информационный вывод для контроля бюджета
    // eslint-disable-next-line no-console
    console.log(`Имитация Хабра: полный=${fullBytes}Б, лоу=${bytes}Б (${Math.round((bytes / fullBytes) * 100)}%)`);

    expect(maxTop(low)).toBeLessThan(VIEWPORT.height);
    assertLowInvariant(low);
    expect(bytes).toBeLessThan(50 * 1024);
  });
});