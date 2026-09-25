/**
 * Unit-тесты Segmentation Level 4 (T1.5.2).
 *
 * resolveLevel4Type — чистая функция над bounding boxes (rect захвачен
 * domExtractor) → тесты полностью детерминированы: синтетические
 * Level4Input-деревья без jsdom layout (negative_knowledge
 * note_1790213529352). Реальная геометрия страниц — Playwright
 * (integration/e2e, T1.5.6).
 *
 * Контракт: ARCHITECTURE.md:L158-172 (6 паттернов), порядок проверки = таблице.
 */

import type { Level4Child, Level4Input } from './level4';
import { resolveLevel4Type } from './level4';

/** Фабрика ребёнка: rect [x, y, width, height] + опциональные t/attributes/txt. */
function child(
  rect: [number, number, number, number],
  extra: Partial<Level4Child> = {},
): Level4Child {
  const [x, y, width, height] = rect;
  return { rect: { x, y, width, height }, ...extra };
}

/** Фабрика входа: parent rect + дети. */
function input(rect: [number, number, number, number], ch: Level4Child[]): Level4Input {
  const [x, y, width, height] = rect;
  return { rect: { x, y, width, height }, ch };
}

describe('segmentation/level4 — resolveLevel4Type (6 паттернов ARCHITECTURE.md:L158-172)', () => {
  it('toolbar: ≥3 кнопок в ряд одинаковой высоты', () => {
    const el = input([0, 0, 600, 40], [
      child([0, 0, 100, 40], { t: 'button' }),
      child([200, 0, 100, 40], { t: 'button' }),
      child([400, 0, 100, 40], { t: 'button' }),
    ]);
    expect(resolveLevel4Type(el)).toBe('toolbar');
  });

  it('toolbar: 2 кнопки — не toolbar', () => {
    const el = input([0, 0, 400, 40], [
      child([0, 0, 100, 40], { t: 'button' }),
      child([200, 0, 100, 40], { t: 'button' }),
    ]);
    expect(resolveLevel4Type(el)).toBeNull();
  });

  it('toolbar: кнопки разной высоты — не toolbar', () => {
    const el = input([0, 0, 600, 60], [
      child([0, 0, 100, 40], { t: 'button' }),
      child([200, 0, 100, 60], { t: 'button' }),
      child([400, 0, 100, 40], { t: 'button' }),
    ]);
    expect(resolveLevel4Type(el)).toBeNull();
  });

  it('list: ≥3 детей одинаковой ширины вертикально', () => {
    const el = input([0, 0, 200, 150], [
      child([0, 0, 200, 40]),
      child([0, 50, 200, 40]),
      child([0, 100, 200, 40]),
    ]);
    expect(resolveLevel4Type(el)).toBe('list');
  });

  it('list: разная ширина — не list', () => {
    const el = input([0, 0, 300, 150], [
      child([0, 0, 200, 40]),
      child([0, 50, 300, 40]),
      child([0, 100, 200, 40]),
    ]);
    expect(resolveLevel4Type(el)).toBeNull();
  });

  it('grid: 4 элемента 2×2 одинакового размера', () => {
    const el = input([0, 0, 220, 120], [
      child([0, 0, 100, 50]),
      child([110, 0, 100, 50]),
      child([0, 60, 100, 50]),
      child([110, 60, 100, 50]),
    ]);
    expect(resolveLevel4Type(el)).toBe('grid');
  });

  it('form_field: label (txt) рядом с input', () => {
    const el = input([0, 0, 400, 40], [
      child([0, 0, 100, 40], { txt: 'Email' }),
      child([110, 0, 290, 40], { t: 'input' }),
    ]);
    expect(resolveLevel4Type(el)).toBe('form_field');
  });

  it('input без текстового соседа — не form_field', () => {
    const el = input([0, 0, 400, 40], [
      child([0, 0, 290, 40], { t: 'input' }),
      child([300, 0, 100, 40]),
    ]);
    // layout требует узкий слева + широкий справа — здесь наоборот → null.
    expect(resolveLevel4Type(el)).toBeNull();
  });

  it('tab_bar: ≥2 элементов role=tab в ряду', () => {
    const el = input([0, 0, 600, 40], [
      child([0, 0, 200, 40], { attributes: { role: 'tab' } }),
      child([200, 0, 200, 40], { attributes: { role: 'tab' } }),
      child([400, 0, 200, 40], { attributes: { role: 'tab' } }),
    ]);
    expect(resolveLevel4Type(el)).toBe('tab_bar');
  });

  it('ряд табов — tab_bar, НЕ toolbar (t=tab, а не button)', () => {
    const el = input([0, 0, 600, 40], [
      child([0, 0, 200, 40], { t: 'tab', attributes: { role: 'tab' } }),
      child([200, 0, 200, 40], { t: 'tab', attributes: { role: 'tab' } }),
      child([400, 0, 200, 40], { t: 'tab', attributes: { role: 'tab' } }),
    ]);
    expect(resolveLevel4Type(el)).toBe('tab_bar');
  });

  it('layout: узкий слева + широкий справа (sidebar + main)', () => {
    const el = input([0, 0, 1280, 800], [
      child([0, 0, 240, 800]),
      child([240, 0, 1040, 800]),
    ]);
    expect(resolveLevel4Type(el)).toBe('layout');
  });

  it('layout: равные половины — не layout (левый не узкий)', () => {
    const el = input([0, 0, 1280, 800], [
      child([0, 0, 640, 800]),
      child([640, 0, 640, 800]),
    ]);
    expect(resolveLevel4Type(el)).toBeNull();
  });

  it('сетка кнопок 2×3 — grid, не toolbar (кнопки в двух рядах)', () => {
    const el = input([0, 0, 320, 120], [
      child([0, 0, 100, 50], { t: 'button' }),
      child([110, 0, 100, 50], { t: 'button' }),
      child([220, 0, 100, 50], { t: 'button' }),
      child([0, 60, 100, 50], { t: 'button' }),
      child([110, 60, 100, 50], { t: 'button' }),
      child([220, 60, 100, 50], { t: 'button' }),
    ]);
    expect(resolveLevel4Type(el)).toBe('grid');
  });

  it('кнопки столбиком (одинаковая ширина, вертикально) → list, не toolbar', () => {
    const el = input([0, 0, 200, 150], [
      child([0, 0, 200, 40], { t: 'button' }),
      child([0, 50, 200, 40], { t: 'button' }),
      child([0, 100, 200, 40], { t: 'button' }),
    ]);
    expect(resolveLevel4Type(el)).toBe('list');
  });

  it('без детей — null (пустой ch и отсутствующий ch)', () => {
    expect(resolveLevel4Type(input([0, 0, 100, 100], []))).toBeNull();
    expect(resolveLevel4Type({ rect: { x: 0, y: 0, width: 100, height: 100 } })).toBeNull();
  });

  it('один ребёнок — null (нет групповых паттернов)', () => {
    const el = input([0, 0, 200, 40], [child([0, 0, 200, 40], { t: 'button' })]);
    expect(resolveLevel4Type(el)).toBeNull();
  });
});