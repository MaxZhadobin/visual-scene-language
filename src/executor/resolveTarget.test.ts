/**
 * Тесты резолва target_id (resolveTarget.ts): парсинг формата "tag_indexPath",
 * обход DOM от корня по индексам элементных детей, ошибки ActionExecutionError
 * (ARCHITECTURE.md §7.4, ROADMAP.md M1.4 T1.4.1).
 *
 * Среда: jsdom. Резолв не использует координаты — data-rect фикстурам не нужен;
 * индексы считаются по Element.children (текстовые узлы не учитываются) —
 * конвенция domExtractor, whitespace в разметке на индексы не влияет.
 */

import { resolveTarget } from './resolveTarget';
import { ActionExecutionError } from './types';

/** Фикстура: root + элементы на глубинах 1–2 (индексы по элементным детям). */
const FIXTURE_HTML = [
  '<div class="level1-a">',
  '  <span class="deep-span">text</span>',
  '  <p class="level1-a-p">paragraph</p>',
  '</div>',
  '<button class="level1-b">Click</button>',
].join('');

function createRoot(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = FIXTURE_HTML;
  return root;
}

describe('resolveTarget', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it('резолвит элемент первого уровня (button_1)', () => {
    const el = resolveTarget('button_1', { root });
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('class')).toBe('level1-b');
  });

  it('резолвит элемент на глубине 2 (span_0_0)', () => {
    const el = resolveTarget('span_0_0', { root });
    expect(el.tagName).toBe('SPAN');
    expect(el.getAttribute('class')).toBe('deep-span');
  });

  it('резолвит соседний элемент глубины 2 (p_0_1)', () => {
    const el = resolveTarget('p_0_1', { root });
    expect(el.getAttribute('class')).toBe('level1-a-p');
  });

  it('текстовые узлы (whitespace) не влияют на индексы — обход по Element.children', () => {
    const el = resolveTarget('div_0', { root });
    expect(el.getAttribute('class')).toBe('level1-a');
  });

  it('root из ExecutorOptions приоритетнее document.body', () => {
    document.body!.innerHTML = '<section class="decoy"></section>';
    const el = resolveTarget('div_0', { root });
    expect(el.getAttribute('class')).toBe('level1-a');
  });

  it('дефолтный root — document.body (options опущены)', () => {
    document.body!.innerHTML = FIXTURE_HTML;
    const el = resolveTarget('span_0_0');
    expect(el.getAttribute('class')).toBe('deep-span');
  });

  it('невалидный формат: пустая строка — missing tag', () => {
    expect(() => resolveTarget('', { root })).toThrow(ActionExecutionError);
    expect(() => resolveTarget('', { root })).toThrow(/missing tag/);
  });

  it('невалидный формат: без indexPath — missing index path', () => {
    expect(() => resolveTarget('div', { root })).toThrow(/missing index path/);
  });

  it('невалидный формат: нечисловой сегмент ("div_x_1")', () => {
    expect(() => resolveTarget('div_x_1', { root })).toThrow(/not a non-negative integer/);
  });

  it('невалидный формат: отрицательный ("div_-1") и пустой ("div_") сегменты', () => {
    expect(() => resolveTarget('div_-1', { root })).toThrow(/not a non-negative integer/);
    expect(() => resolveTarget('div_', { root })).toThrow(/not a non-negative integer/);
  });

  it('индекс вне диапазона первого уровня — DOM may have changed', () => {
    expect(() => resolveTarget('div_5', { root })).toThrow(ActionExecutionError);
    expect(() => resolveTarget('div_5', { root })).toThrow(
      /DOM may have changed since the snapshot/,
    );
  });

  it('индекс вне диапазона на глубине — DOM may have changed', () => {
    expect(() => resolveTarget('span_0_9', { root })).toThrow(/DOM may have changed/);
  });

  it('несовпадение tag — элемент найден, но тег другой', () => {
    expect(() => resolveTarget('span_1', { root })).toThrow(
      /found <button>, expected tag "span"/,
    );
    expect(() => resolveTarget('span_1', { root })).toThrow(/DOM may have changed/);
  });

  it('document.body === null → ActionExecutionError (не ReferenceError)', () => {
    Object.defineProperty(document, 'body', { value: null, configurable: true });
    try {
      expect(() => resolveTarget('div_0')).toThrow(ActionExecutionError);
    } finally {
      delete (document as unknown as { body?: unknown }).body;
    }
  });
});