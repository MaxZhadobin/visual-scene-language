/**
 * DOM extraction (T1.1.2, ROADMAP.md M1.1).
 *
 * Обходит дерево от корня (по умолчанию document.body) и извлекает все видимые
 * элементы с координатами (getBoundingClientRect), собственным текстом, атрибутами и CSS-подмножеством (Level 3, T1.5.1).
 * Покрывает тот же набор элементов, что и root.querySelectorAll('*'), минус отфильтрованные.
 *
 * Фильтр невидимых (семантика ARCHITECTURE.md; CSS-уровень 3 вне scope M1.1):
 *  - непрендеримые теги (script/style/link/meta/noscript/template/head/title/base) —
 *    никогда не отрисовываются → пропуск поддерева;
 *  - display: none → элемент и всё поддерево не отрисованы → пропуск поддерева;
 *  - visibility: hidden → сам элемент невидим, но дети могут быть видимы
 *    (visibility: visible) → элемент не включается, поддерево обходится;
 *  - нулевой прямоугольник (width <= 0 || height <= 0) → нет видимого бокса, но дети
 *    (например, overflow) могут быть видимы → элемент не включается, поддерево обходится.
 *
 * indexPath — индексы среди ЭЛЕМЕНТНЫХ детей на каждом уровне, вычисляются по
 * структуре DOM ДО фильтрации: позиция стабильна независимо от фильтров — основа
 * детерминированных ID VSL (решение note_1789916091535: без Date.now()/Math.random(),
 * база для diffing в M1.2).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedElement {
  /** Имя тега в нижнем регистре (например, 'button'). */
  tag: string;
  /** Путь от корня обхода: индексы среди элементных детей каждого уровня (до фильтрации). */
  indexPath: number[];
  /** Координаты и размеры из getBoundingClientRect (px, viewport). */
  rect: Rect;
  /** Собственный текст (только прямые текстовые узлы), нормализованный; null если пуст. */
  text: string | null;
  /** Все атрибуты элемента (verbatim). */
  attributes: Record<string, string>;
  /** CSS-подмножество для Level 3 (computed styles в момент extraction, T1.5.1). */
  css?: ElementCss;
  /** Видимые дочерние элементы. */
  children: ExtractedElement[];
}

/**
 * CSS-подмножество для Segmentation Level 3 (T1.5.1): computed styles,
 * захваченные в момент extraction (viewOf/getComputedStyle). Все поля
 * optional: отсутствие значения или поддержки свойства средой → поле
 * просто не задано.
 */
export interface ElementCss {
  cursor?: string;
  position?: string;
  top?: string;
  bottom?: string;
  display?: string;
  gap?: string;
  fontWeight?: string;
  fontSize?: string;
  opacity?: string;
  pointerEvents?: string;
  overflow?: string;
  height?: string;
}

/** Теги, которые никогда не отрисовываются визуально. */
const NON_RENDERABLE_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'head',
  'title',
  'base',
]);

/**
 * Окно (контекст стилей) элемента: ownerDocument.defaultView — портативно в
 * браузере, jsdom и любом DOM-окружении без глобального window (фикс
 * packaging-smoke demo:cache-diff: ReferenceError: window is not defined).
 */
function viewOf(el: Element): Window | null {
  return el.ownerDocument.defaultView;
}

function isDisplayNone(el: Element): boolean {
  return viewOf(el)?.getComputedStyle(el).display === 'none';
}

function isVisibilityHidden(el: Element): boolean {
  return viewOf(el)?.getComputedStyle(el).visibility === 'hidden';
}

/** nodeType текстового узла по DOM-спецификации (3) — без зависимости от глобального Node. */
const TEXT_NODE_TYPE = 3;

/** Собственный текст элемента: только прямые текстовые узлы, whitespace-нормализация. */
export function ownText(el: Element): string {
  let raw = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT_NODE_TYPE) {
      raw += node.textContent ?? '';
    }
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function extractAttributes(el: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attributes[attr.name] = attr.value;
  }
  return attributes;
}

/** CSS-свойства для ElementCss (уровень 3): camelCase-ключ → kebab-case-свойство. */
const CSS_PROPERTIES: ReadonlyArray<[keyof ElementCss, string]> = [
  ['cursor', 'cursor'],
  ['position', 'position'],
  ['top', 'top'],
  ['bottom', 'bottom'],
  ['display', 'display'],
  ['gap', 'gap'],
  ['fontWeight', 'font-weight'],
  ['fontSize', 'font-size'],
  ['opacity', 'opacity'],
  ['pointerEvents', 'pointer-events'],
  ['overflow', 'overflow'],
  ['height', 'height'],
];

/**
 * Захватывает CSS-подмножество элемента (computed styles) для Level 3 (T1.5.1).
 * Пустое значение ('' — свойство не поддержано средой) → undefined, чтобы
 * классификация не принимала отсутствие поддержки за значение.
 */
function captureCss(el: Element): ElementCss {
  const view = viewOf(el);
  if (view === null) return {};
  const style = view.getComputedStyle(el);
  const css: ElementCss = {};
  for (const [key, property] of CSS_PROPERTIES) {
    const value = style.getPropertyValue(property);
    if (value !== '') css[key] = value;
  }
  return css;
}

function toRect(rect: DOMRect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function hasZeroBox(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

function collectVisibleChildren(parent: Element, parentPath: readonly number[]): ExtractedElement[] {
  const result: ExtractedElement[] = [];
  Array.from(parent.children).forEach((child, index) => {
    const path = [...parentPath, index];
    const tag = child.tagName.toLowerCase();

    // Никогда не отрисовывается / display:none — пропускаем всё поддерево.
    if (NON_RENDERABLE_TAGS.has(tag) || isDisplayNone(child)) {
      return;
    }

    const rect = toRect(child.getBoundingClientRect());

    // Сам элемент без видимого бокса, но дети могут быть видимы —
    // не включаем его, поддерево обходим.
    if (isVisibilityHidden(child) || hasZeroBox(rect)) {
      result.push(...collectVisibleChildren(child, path));
      return;
    }

    result.push({
      tag,
      indexPath: path,
      rect,
      text: ownText(child) || null,
      attributes: extractAttributes(child),
      css: captureCss(child),
      children: collectVisibleChildren(child, path),
    });
  });
  return result;
}

function defaultRoot(): Element {
  const body = document.body;
  if (!body) {
    throw new Error('extractDomTree: document.body is null — call after the DOM is loaded');
  }
  return body;
}

/**
 * Извлекает видимое поддерево DOM, начиная с root (по умолчанию document.body).
 * Сам root не включается — возвращается лес его видимых потомков.
 */
export function extractDomTree(root: Element = defaultRoot()): ExtractedElement[] {
  return collectVisibleChildren(root, []);
}