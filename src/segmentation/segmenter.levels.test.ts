/**
 * Unit-тесты интеграции Level 3/4 в segmenter (dev_5, T1.5.1/T1.5.2):
 *  - итоговый приоритет L1 > L2 > L3 > L4 (через segmentTree на синтетических деревьях);
 *  - isPointerInvisible (opacity:0 + pointer-events:none) как skip-поддерево.
 *
 * Все 8 CSS-паттернов и 6 структурных паттернов покрыты в level3.test.ts /
 * level4.test.ts; здесь — только проводка уровней в движке сегментации
 * (детерминированно, без jsdom layout — синтетические ExtractedElement).
 */
import type { ExtractedElement } from '../capture/domExtractor';
import { segmentTree } from './segmenter';

/** Строит ExtractedElement с дефолтами (rect/text/attributes/children). */
function el(
  partial: Partial<ExtractedElement> & { tag: string; indexPath: number[] },
): ExtractedElement {
  return {
    rect: { x: 0, y: 0, width: 100, height: 40 },
    text: null,
    attributes: {},
    children: [],
    ...partial,
  };
}

/** Три кнопки в ряд (x=0/120/240, одинаковая высота 40) — вход L4 toolbar. */
function threeButtonsRow(prefix: number[]): ExtractedElement[] {
  return [0, 1, 2].map((i) =>
    el({
      tag: 'button',
      indexPath: [...prefix, i],
      rect: { x: i * 120, y: 0, width: 100, height: 40 },
    }),
  );
}

describe('segmenter: приоритет L1 > L2 > L3', () => {
  it('L3 применяется, когда L1/L2 не дали тип: div cursor:pointer + onclick → button', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        css: { cursor: 'pointer' },
        attributes: { onclick: 'go()' },
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('button');
  });

  it('L2 сильнее L3: div role=dialog (→modal) с cursor:pointer+onclick остаётся modal', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        attributes: { role: 'dialog', onclick: 'x()' },
        css: { cursor: 'pointer' },
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('modal');
  });

  it('L1 сильнее L3: nav с bold+font-size>20px остаётся nav (не heading)', () => {
    const tree = [
      el({
        tag: 'nav',
        indexPath: [0],
        css: { fontWeight: 'bold', fontSize: '24px' },
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('nav');
  });
});

describe('segmenter: skip-поддерево isPointerInvisible', () => {
  it('opacity:0 + pointer-events:none вырезает элемент вместе с поддеревом', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        children: [el({ tag: 'button', indexPath: [0, 0] })],
      }),
      el({
        tag: 'div',
        indexPath: [1],
        css: { opacity: '0', pointerEvents: 'none' },
        children: [el({ tag: 'button', indexPath: [1, 0] })],
      }),
    ];
    const result = segmentTree(tree);
    expect(result).toHaveLength(1);
    expect(result[0]!.indexPath).toEqual([0]);
  });

  it('opacity:0 без pointer-events:none — НЕ skip: элемент остаётся, t=null', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        css: { opacity: '0' },
        children: [el({ tag: 'button', indexPath: [0, 0] })],
      }),
    ];
    const result = segmentTree(tree);
    expect(result).toHaveLength(1);
    expect(result[0]!.t).toBeNull(); // 1 ребёнок: структурные паттерны L4 не применяются
  });
});

describe('segmenter: приоритет над L4 и post-order применение', () => {
  it('L4 post-order: div с 3 кнопками в ряд → toolbar (дети аннотированы раньше родителя)', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        rect: { x: 0, y: 0, width: 340, height: 40 },
        children: threeButtonsRow([0]),
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('toolbar');
  });

  it('L1 сильнее L4: nav с 3 кнопками в ряд остаётся nav (не toolbar)', () => {
    const tree = [
      el({
        tag: 'nav',
        indexPath: [0],
        rect: { x: 0, y: 0, width: 340, height: 40 },
        children: threeButtonsRow([0]),
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('nav');
  });

  it('L3 сильнее L4: div display:flex+gap>0 с 3 кнопками → container (не toolbar)', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        rect: { x: 0, y: 0, width: 340, height: 40 },
        css: { display: 'flex', gap: '8px' },
        children: threeButtonsRow([0]),
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('container');
  });

  it('L4 form_field: span-подпись рядом с input (gap 10px, порог 16px) → form_field', () => {
    const tree = [
      el({
        tag: 'div',
        indexPath: [0],
        rect: { x: 0, y: 0, width: 400, height: 40 },
        children: [
          el({
            tag: 'span',
            indexPath: [0, 0],
            rect: { x: 0, y: 0, width: 100, height: 40 },
            text: 'Email',
          }),
          el({
            tag: 'input',
            indexPath: [0, 1],
            rect: { x: 110, y: 0, width: 290, height: 40 },
          }),
        ],
      }),
    ];
    expect(segmentTree(tree)[0]!.t).toBe('form_field');
  });
});