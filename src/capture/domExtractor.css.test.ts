/**
 * Unit-тесты захвата CSS-подмножества (ElementCss) для Level 3 (T1.5.1, dev_2).
 *
 * captureCss (domExtractor) вызывается для каждого видимого элемента при
 * extraction: computed styles через портативный viewOf/getComputedStyle,
 * пустые значения '' → undefined. Отдельный файл по прецеденту
 * index.test.ts/index.llm.test.ts — прямое покрытие новой функции captureCss.
 *
 * jsdom-ограничения (negative_knowledge note_1790213529352): инлайн-стили
 * надёжны; layout-зависимые значения (height от auto) не вычисляются;
 * реальный computed CSS из таблиц стилей — Playwright (integration, T1.5.6).
 */

import { extractDomTree } from './domExtractor';
import { isPointerInvisible, resolveLevel3Type } from '../segmentation/level3';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('capture/domExtractor — захват ElementCss для Level 3 (T1.5.1, dev_2)', () => {
  it('инлайн-стили попадают в css-захват (computed styles)', () => {
    setBody(
      '<div data-rect="10,20,300,40" style="cursor: pointer; position: fixed; top: 0px" onclick="go()">x</div>',
    );
    const [el] = extractDomTree();
    expect(el).toBeDefined();
    expect(el?.css?.cursor).toBe('pointer');
    expect(el?.css?.position).toBe('fixed');
    expect(el?.css?.top).toBe('0px');
  });

  it('css-захват кормит resolveLevel3Type end-to-end: cursor:pointer+onclick → button', () => {
    setBody('<div data-rect="10,20,300,40" style="cursor: pointer" onclick="go()">x</div>');
    const [el] = extractDomTree();
    expect(resolveLevel3Type(el?.css, el?.attributes ?? {})).toBe('button');
  });

  it('opacity:0 + pointer-events:none захватывается → isPointerInvisible (skip-паттерн L3)', () => {
    setBody('<div data-rect="0,0,10,10" style="opacity: 0; pointer-events: none">x</div>');
    const [el] = extractDomTree();
    expect(el?.css?.opacity).toBe('0');
    expect(isPointerInvisible(el?.css)).toBe(true);
  });

  it('элемент без интерактивных стилей: css определён, pointer-курсора нет', () => {
    setBody('<div data-rect="0,0,10,10">x</div>');
    const [el] = extractDomTree();
    expect(el?.css).toBeDefined();
    expect(el?.css?.cursor).not.toBe('pointer');
  });

  it('пустые значения свойств не попадают в css (отсутствие поддержки ≠ значение)', () => {
    // gap — проба: поддержан средой → '8px', нет → поле отсутствует; '' недопустимо.
    setBody('<div data-rect="0,0,10,10" style="gap: 8px">x</div>');
    const [el] = extractDomTree();
    const entries = Object.entries(el?.css ?? {});
    for (const [, value] of entries) {
      expect(value).not.toBe('');
    }
  });
});