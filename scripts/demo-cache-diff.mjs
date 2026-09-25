/**
 * Demo: Cache & Diff (M1.2, ROADMAP.md T1.2.5; решение dc_7).
 *
 * Запуск: npm run demo:cache-diff (= npm run build && node scripts/demo-cache-diff.mjs).
 * Plain-JS ESM поверх dist/index.mjs — заодно packaging-smoke ESM-пути (рекомендация
 * аудита M1.1). DOM — jsdom: JSDOM + локальный data-rect-полифилл по образцу
 * jest.setup.ts (jsdom не имеет layout-движка).
 *
 * Сценарий (§5.3): дашборд-фикстура → full → идентичный повтор → diff →
 * точечная мутация txt кнопки → diff. Размеры — Buffer.byteLength(JSON.stringify(x));
 * вывод человекочитаемый: [full] X.XX KB / [diff] Y.YY KB (−Z.Z%).
 */

import { JSDOM } from 'jsdom';
import { createCacheStore, VslSnapshotSession } from '../dist/index.mjs';

const VIEWPORT = { width: 1280, height: 800 };
const PAGE_URL = 'https://example.test/dashboard';
const TIMESTAMP = '2026-09-22T09:00:00.000Z';

// Дашборд-фикстура M1.1 (та же, что в src/cache-diff.integration.test.ts).
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

// ——— Локальный data-rect-полифилл (по образцу jest.setup.ts) ———

const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0 };

function parseDataRect(el) {
  const raw = el.getAttribute('data-rect');
  if (!raw) return null;
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  return { x, y, width, height };
}

function toDOMRect(window, r) {
  if (typeof window.DOMRect === 'function') {
    return new window.DOMRect(r.x, r.y, r.width, r.height);
  }
  // Защитный фолбэк для сборок jsdom без конструктора DOMRect.
  return {
    ...r,
    top: r.y,
    left: r.x,
    right: r.x + r.width,
    bottom: r.y + r.height,
    toJSON: () => ({ ...r }),
  };
}

/** data-rect-полифилл на прототипе Element КОНКРЕТНОГО jsdom-window. */
function installDataRectPolyfill(window) {
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return toDOMRect(window, parseDataRect(this) ?? ZERO_RECT);
  };
}

// ——— Измерение и вывод (dc_7) ———

function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function kb(bytes) {
  return (bytes / 1024).toFixed(2);
}

function savedPct(fullBytes, diffBytes) {
  return ((1 - diffBytes / fullBytes) * 100).toFixed(1);
}

// ——— Сценарий ———

const dom = new JSDOM(DASHBOARD_HTML);
installDataRectPolyfill(dom.window);
const { document } = dom.window;

const store = createCacheStore();
const session = new VslSnapshotSession(store);
const input = () => ({ url: PAGE_URL, viewport: { ...VIEWPORT }, timestamp: TIMESTAMP });

// 1) Первый вызов — полный документ
const full = session.snapshot(document.body, input());
const fullBytes = bytesOf(full);
console.log(`[full] ${kb(fullBytes)} KB`);

// 2) Идентичный повтор — пустой дифф (все объекты в unchanged_refs)
const diffIdle = session.snapshot(document.body, input());
const idleBytes = bytesOf(diffIdle);
console.log(`[diff] идентичный повтор: ${kb(idleBytes)} KB (−${savedPct(fullBytes, idleBytes)}%)`);

// 3) Точечная мутация: txt кнопки «Скачать» → «Экспортировать»
const download = document.querySelector('[role="dialog"] button');
download.textContent = 'Экспортировать';
const diffMutation = session.snapshot(document.body, input());
const mutationBytes = bytesOf(diffMutation);
console.log(
  `[diff] мутация txt кнопки: ${kb(mutationBytes)} KB (−${savedPct(fullBytes, mutationBytes)}%)`,
);