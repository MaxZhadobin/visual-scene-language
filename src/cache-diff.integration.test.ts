/**
 * Интеграционные тесты Cache & Diff (T1.2.5, ROADMAP.md M1.2; §5.2/§5.3/§6.2).
 *
 * Реальный пайплайн без моков (extract → segment → build → cache → diff) на
 * трёх DOM-фикстурах M1.1 (лендинг/форма/дашборд, data-rect-координаты):
 *  - пары 1–4 (решение dc_6) — точечные мутации только в VSL-включённых
 *    элементах, добавления/удаления только в конец списков детей
 *    (id = tag_indexPath стабильны);
 *  - агрегированная экономия: сумма байт диффов пар 1–4 ≤ 40% суммы байт
 *    полных документов — консервативная проверка цели 60–80% из §5.3 на
 *    точечных мутациях (дифф ≤ 40% ⇔ экономия ≥ 60%);
 *  - пара 5 — валидность пустого диффа (идентичный повтор), вне ассерта
 *    экономии (нулевой числитель занизил бы честный агрегат);
 *  - resize-пара — отдельный тест: session вызывает invalidateCoordinates,
 *    дифф содержит modified только {id, p} (s — абсолютные px), объекты в
 *    p=[0,0] инвариантны к viewport и остаются unchanged.
 *
 * Отклонение от буквы dc_6 (пара 3): txt «Скачать»→«Экспортировать» и
 * удаление dialog разведены по двум последовательным диффам — объект
 * удалённого поддерева не может быть одновременно modified и removed в одном
 * диффе; последовательность покрывает обе мутации содержательно.
 */

import { VslSnapshotSession, isVslDiff } from './session/snapshotSession';
import type { SnapshotInput, SnapshotResult } from './session/snapshotSession';
import { createCacheStore } from './cache/cacheStore';
import type { CacheStore } from './cache/cacheStore';
import type { VslDiff } from './diff/diffEngine';
import type { VslDocument } from './types/vsl';

const TS = '2026-09-22T09:00:00.000Z';
const VIEWPORT = { width: 1280, height: 800 };
const URL_LANDING = 'https://example.test/landing';
const URL_FORM = 'https://example.test/form';
const URL_DASHBOARD = 'https://example.test/dashboard';

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

function makeInput(url: string): SnapshotInput {
  return { url, viewport: { ...VIEWPORT }, timestamp: TS };
}

function asDoc(result: SnapshotResult): VslDocument {
  expect(isVslDiff(result)).toBe(false);
  return result as VslDocument;
}

function asDiff(result: SnapshotResult): VslDiff {
  expect(isVslDiff(result)).toBe(true);
  return result as VslDiff;
}

interface PairRun {
  store: CacheStore;
  full: VslDocument;
  diffs: VslDiff[];
}

/** Независимые store/session: полный документ + последовательные диффы. */
function runPair(url: string, baseHtml: string, mutations: Array<() => void>): PairRun {
  const store = createCacheStore();
  const session = new VslSnapshotSession(store);
  document.body.innerHTML = baseHtml;
  const full = asDoc(session.snapshot(document.body, makeInput(url)));
  const diffs = mutations.map((mutate) => {
    mutate();
    return asDiff(session.snapshot(document.body, makeInput(url)));
  });
  return { store, full, diffs };
}

// ——— Точечные мутации dc_6 (только VSL-включённые элементы, DOM API) ———

function mutateLandingTxt(): void {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === 'Войти',
  )!;
  btn.textContent = 'Войти в систему';
}

function mutateFormAriaDisabled(): void {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === 'Войти через GitHub',
  )!;
  btn.removeAttribute('aria-disabled');
}

function mutateDashboardFields(): void {
  document.querySelector('button[aria-expanded]')!.removeAttribute('aria-expanded');
  const download = document.querySelector('[role="dialog"] button')!;
  download.textContent = 'Экспортировать';
}

function mutateRemoveDialog(): void {
  document.querySelector('[role="dialog"]')!.remove();
}

function mutateAppendToDashboard(): void {
  const link = document.createElement('a');
  link.setAttribute('data-rect', '16,180,208,40');
  link.setAttribute('href', '/settings');
  link.textContent = 'Настройки';
  document.querySelector('nav[aria-label="Боковое меню"]')!.appendChild(link);

  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Подтверждение');
  modal.setAttribute('data-rect', '440,520,400,160');
  const ok = document.createElement('button');
  ok.setAttribute('data-rect', '600,600,160,40');
  ok.textContent = 'ОК';
  modal.appendChild(ok);
  document.querySelector('main')!.appendChild(modal);
}

describe('Cache & Diff интеграция — фикстурные пары (T1.2.5, dc_6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('пара 1 (лендинг): txt кнопки → modified только {id, txt}', () => {
    const { full, diffs } = runPair(URL_LANDING, LANDING_HTML, [mutateLandingTxt]);

    expect(full.objects.length).toBeGreaterThan(0);
    const diff = diffs[0];
    expect(diff?.diff_version).toBe(2);
    expect(diff?.base_version).toBe(1);
    expect(diff?.timestamp).toBe(TS);
    expect(diff?.changes.added).toEqual([]);
    expect(diff?.changes.removed).toEqual([]);
    expect(diff?.changes.modified).toEqual([{ id: 'button_0_2', txt: 'Войти в систему' }]);
  });

  it('пара 2 (форма): снятие aria-disabled → modified {id, st: null, act}; кэш обновлён', () => {
    const { diffs, store } = runPair(URL_FORM, FORM_HTML, [mutateFormAriaDisabled]);
    const diff = diffs[0];

    expect(diff?.changes.added).toEqual([]);
    expect(diff?.changes.removed).toEqual([]);
    expect(diff?.changes.modified).toEqual([{ id: 'button_0_0_7', st: null, act: ['click'] }]);

    // изменённый объект перезаписан в store из fresh-документа (§5.2)
    const entry = store.get('button_0_0_7');
    expect(entry?.object.st).toBeUndefined();
    expect(entry?.object.act).toEqual(['click']);
    expect(entry?.coordHash).not.toBe('');
  });

  it('пара 3 (дашборд, два последовательных диффа): modified×2 → removed×2 (tree order prev)', () => {
    const { diffs, store } = runPair(URL_DASHBOARD, DASHBOARD_HTML, [
      mutateDashboardFields,
      mutateRemoveDialog,
    ]);
    const [diffA, diffB] = diffs;

    expect(diffA?.diff_version).toBe(2);
    expect(diffA?.base_version).toBe(1);
    expect(diffA?.changes.added).toEqual([]);
    expect(diffA?.changes.removed).toEqual([]);
    expect(diffA?.changes.modified).toEqual([
      { id: 'button_0_1_1', st: null },
      { id: 'button_0_1_3_0', txt: 'Экспортировать' },
    ]);

    expect(diffB?.diff_version).toBe(3);
    expect(diffB?.base_version).toBe(2);
    expect(diffB?.changes.modified).toEqual([]);
    expect(diffB?.changes.removed).toEqual([{ id: 'div_0_1_3' }, { id: 'button_0_1_3_0' }]);

    // удалённые инвалидируются, изменённые — обновлены из fresh-документа
    expect(store.has('div_0_1_3')).toBe(false);
    expect(store.has('button_0_1_3_0')).toBe(false);
    expect(store.get('button_0_1_1')?.object.st).toBeUndefined();
  });

  it('пара 4 (дашборд): добавления в конец списков → added только корни поддеревьев', () => {
    const { diffs, store } = runPair(URL_DASHBOARD, DASHBOARD_HTML, [mutateAppendToDashboard]);
    const diff = diffs[0];

    expect(diff?.changes.modified).toEqual([]);
    expect(diff?.changes.removed).toEqual([]);
    expect(diff?.changes.added.map((o) => o.id)).toEqual(['a_0_0_2', 'div_0_1_4']);
    // потомок добавленного корня внутри ch, отдельной added-записи нет (§6.2)
    expect(diff?.changes.added[1]?.ch?.map((o) => o.id)).toEqual(['button_0_1_4_0']);
    expect(diff?.changes.unchanged_refs).not.toContain('button_0_1_4_0');

    // добавленные поддеревья сохранены в store пообъектно
    expect(store.has('a_0_0_2')).toBe(true);
    expect(store.has('div_0_1_4')).toBe(true);
    expect(store.has('button_0_1_4_0')).toBe(true);
  });

  it('пара 5: идентичный повтор → валидный пустой дифф, все id в unchanged_refs (tree order next)', () => {
    const store = createCacheStore();
    const session = new VslSnapshotSession(store);
    document.body.innerHTML = DASHBOARD_HTML;
    asDoc(session.snapshot(document.body, makeInput(URL_DASHBOARD)));
    const diff = asDiff(session.snapshot(document.body, makeInput(URL_DASHBOARD)));

    expect(diff.diff_version).toBe(2);
    expect(diff.base_version).toBe(1);
    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.modified).toEqual([]);
    expect(diff.changes.removed).toEqual([]);
    expect(diff.changes.unchanged_refs).toEqual([
      'div_0',
      'nav_0_0',
      'a_0_0_0',
      'a_0_0_1',
      'main_0_1',
      'div_0_1_0',
      'div_0_1_0_0',
      'div_0_1_0_1',
      'button_0_1_1',
      'div_0_1_2',
      'section_0_1_2_0',
      'section_0_1_2_1',
      'div_0_1_3',
      'button_0_1_3_0',
    ]);
  });

  it('агрегированная экономия пар 1–4: дифф ≤ 40% байт полного (⇔ экономия ≥ 60%, §5.3)', () => {
    const runs = [
      runPair(URL_LANDING, LANDING_HTML, [mutateLandingTxt]),
      runPair(URL_FORM, FORM_HTML, [mutateFormAriaDisabled]),
      runPair(URL_DASHBOARD, DASHBOARD_HTML, [mutateDashboardFields, mutateRemoveDialog]),
      runPair(URL_DASHBOARD, DASHBOARD_HTML, [mutateAppendToDashboard]),
    ];

    const fullBytes = runs.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r.full)), 0);
    const diffBytes = runs.reduce(
      (sum, r) => sum + r.diffs.reduce((acc, d) => acc + Buffer.byteLength(JSON.stringify(d)), 0),
      0,
    );

    expect(fullBytes).toBeGreaterThan(0);
    expect(diffBytes).toBeGreaterThan(0);
    expect(diffBytes).toBeLessThanOrEqual(0.4 * fullBytes);
    expect((1 - diffBytes / fullBytes) * 100).toBeGreaterThanOrEqual(60);
  });

  it('resize 1280×800 → 1920×1080: modified только {id, p}; p=[0,0] unchanged; coordHash-инвалидация', () => {
    const store = createCacheStore();
    const session = new VslSnapshotSession(store);
    document.body.innerHTML = DASHBOARD_HTML;
    asDoc(session.snapshot(document.body, makeInput(URL_DASHBOARD)));

    const diff = asDiff(
      session.snapshot(document.body, {
        url: URL_DASHBOARD,
        viewport: { width: 1920, height: 1080 },
        timestamp: TS,
      }),
    );

    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.removed).toEqual([]);
    // p = [0, 0] у div_0 и nav_0_0 инвариантны к viewport
    expect(diff.changes.unchanged_refs).toEqual(['div_0', 'nav_0_0']);
    expect(diff.changes.modified.map((m) => m.id)).toEqual([
      'a_0_0_0',
      'a_0_0_1',
      'main_0_1',
      'div_0_1_0',
      'div_0_1_0_0',
      'div_0_1_0_1',
      'button_0_1_1',
      'div_0_1_2',
      'section_0_1_2_0',
      'section_0_1_2_1',
      'div_0_1_3',
      'button_0_1_3_0',
    ]);
    // s — абсолютные px (не зависят от viewport) → в modified только {id, p}
    for (const m of diff.changes.modified) {
      expect(Object.keys(m).sort()).toEqual(['id', 'p']);
    }

    // session вызвал invalidateCoordinates: unchanged-записи с обнулённым
    // coordHash, modified — обновлены свежими значениями из нового документа
    expect(store.get('div_0')?.coordHash).toBe('');
    expect(store.get('main_0_1')?.coordHash).not.toBe('');
  });
});