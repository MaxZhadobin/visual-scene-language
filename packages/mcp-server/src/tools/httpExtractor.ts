/**
 * HTTP Extractor (M1.6, DEC-024).
 *
 * HTTP-first режим для vsl_read_page: чтение статических страниц через HTTP GET
 * без браузера (миллисекунды). Используется для страниц без SPA-маркеров.
 *
 * Flow:
 *  1. fetch HTML через нативный fetch (Node.js 18+)
 *  2. Детекция SPA-маркеров (если найдены — нужен рендер через браузер)
 *  3. Readable-режим: фильтрация шума (nav, footer, cookie banners)
 *  4. Извлечение текстового контента
 *
 * Архитектура: отдельный модуль для переиспользования и тестирования.
 * Не зависит от Playwright — работает без браузера.
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

/** Результат HTTP-извлечения. */
export interface HttpExtractResult {
  /** URL страницы. */
  url: string;
  /** Сырой HTML (до фильтрации). */
  rawHtml: string;
  /** Отфильтрованный HTML (если readable=true). */
  filteredHtml: string;
  /** Текстовый контент (после удаления тегов). */
  textContent: string;
  /** Заголовок страницы (из <title>). */
  title?: string;
  /** Количество слов в тексте. */
  wordCount: number;
  /** Обнаружена ли SPA (по маркерам). */
  isSpa: boolean;
  /** Был ли применён readable-фильтр. */
  readableApplied: boolean;
  /** VSL JSON документ (семантическая структура страницы). */
  vslDocument: VslDocument;
}

/** Опции HTTP-извлечения. */
export interface HttpExtractOptions {
  /** Readable-режим: фильтрация шума (nav, footer, cookie banners). */
  readable?: boolean;
  /** User-Agent для HTTP-запроса. */
  userAgent?: string;
  /** Таймаут HTTP-запроса (мс). */
  timeout?: number;
}

/** SPA-маркеры: если найдены — нужен рендер через браузер. */
const SPA_MARKERS = [
  'id="app"',
  'id="root"',
  'data-reactroot',
  'data-vue-root',
  'ng-app',
];
/** Шумные элементы для readable-режима. */
const NOISY_SELECTORS = [
  'nav',
  'footer',
  'header',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.cookie-banner',
  '.cookie-consent',
  '#cookie-banner',
  '.ad',
  '.advertisement',
  '[aria-hidden="true"]',
];

/**
 * Извлекает контент страницы через HTTP GET (без браузера).
 *
 * @param url - URL страницы для чтения
 * @param options - Опции извлечения (readable, userAgent, timeout)
 * @returns HttpExtractResult с HTML, текстом, метаданными
 * @throws Error если HTTP-запрос не удался
 */
export async function extractViaHttp(
  url: string,
  options: HttpExtractOptions = {},
): Promise<HttpExtractResult> {
  const { readable = false, userAgent = 'VSL-MCP-Server/1.0 (compatible; AI Agent)', timeout = 10000 } = options;

  // 1. HTTP-запрос через fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`HTTP request timeout (${timeout}ms): ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const rawHtml = await response.text();

  // 2. Детекция SPA
  const isSpa = detectSpa(rawHtml);

  // 3. Readable-фильтр
  const filteredHtml = readable ? applyReadableFilter(rawHtml) : rawHtml;

  // 4. Извлечение текста
  const textContent = extractTextContent(filteredHtml);

  // 5. Метаданные
  const title = extractTitle(rawHtml);
  const wordCount = countWords(textContent);

  // 6. Построение VSL JSON из DOM (HTTP-путь)
  const vslDocument = buildVslFromDom(rawHtml, { url, title });

  return {
    url,
    rawHtml,
    filteredHtml,
    textContent,
    title,
    wordCount,
    isSpa,
    readableApplied: readable,
    vslDocument,
  };
}

/**
 * Детектирует SPA по маркерам в HTML.
 *
 * @param html - HTML-контент страницы
 * @returns true если найдены SPA-маркеры
 */
export function detectSpa(html: string): boolean {
  return SPA_MARKERS.some((marker) => html.includes(marker));
}

/**
 * Применяет readable-фильтр: удаляет шумные элементы.
 *
 * @param html - HTML-контент
 * @returns Отфильтрованный HTML
 */
export function applyReadableFilter(html: string): string {
  let filtered = html;

  for (const selector of NOISY_SELECTORS) {
    // Удаление тегов по селектору (упрощённая версия через regex)
    const tagName = selector.replace(/^[.#\[]+/, '').replace(/[\]"]$/g, '');
    const regex = new RegExp(`<${tagName}[^>]*>.*?</${tagName}>`, 'gis');
    filtered = filtered.replace(regex, '');
  }

  return filtered;
}

/**
 * Извлекает текстовый контент из HTML.
 *
 * @param html - HTML-контент
 * @returns Текстовый контент (без тегов)
 */
export function extractTextContent(html: string): string {
  // Удаление script/style тегов
  let text = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
  text = text.replace(/<style[^>]*>.*?<\/style>/gis, '');

  // Удаление HTML-тегов
  text = text.replace(/<[^>]+>/g, ' ');

  // Нормализация пробелов
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Извлекает title из HTML.
 *
 * @param html - HTML-контент
 * @returns Заголовок страницы или undefined
 */
export function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match?.[1]?.trim();
}

/**
 * Подсчитывает количество слов в тексте.
 *
 * @param text - Текстовый контент
 * @returns Количество слов
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}
/**
 * VSL JSON структура (упрощённая версия для HTTP-пути).
 * Полная спецификация: DESIGN_SYSTEM.md §4.
 */
export interface VslDocument {
  vsl_version: string;
  canvas: {
    viewport: { width: number; height: number; unit: string };
    background: string;
    scale: number;
    orientation: string;
    timestamp: string;
    url?: string;
    title?: string;
  };
  objects: VslObject[];
  text_blocks?: Record<string, string>;
}

export interface VslObject {
  id: string;
  t: string; // тип элемента (button, link, input, container, etc.)
  p: [number, number] | null; // позиция [x, y] (null для HTTP-пути)
  s: [number, number] | null; // размер [width, height] (null для HTTP-пути)
  r?: string; // role (ARIA)
  st?: string; // state (disabled, expanded, etc.)
  txt?: string; // текст элемента
  txt_preview?: string; // preview для длинных текстов
  txt_ref?: string; // ссылка на text_blocks
  act?: string[]; // действия (click, type, etc.)
  ch?: VslObject[]; // дети
  attributes?: Record<string, string>; // HTML-атрибуты
}

/**
 * Строит VSL JSON из HTML через cheerio (HTTP-путь).
 *
 * Ограничения HTTP-пути (DEC-024):
 *  - bbox (координаты) = null (нет layout engine)
 *  - действия (act) определяются по семантике (role, tag, attributes)
 *  - текст извлекается из DOM
 *  - семантическая разметка по L1-L4 (tag, role, aria-*, CSS-паттерны)
 *
 * @param html - HTML-контент страницы
 * @param options - опции (url, title для метаданных)
 * @returns VslDocument с семантической структурой
 */
export function buildVslFromDom(
  html: string,
  options: { url?: string; title?: string } = {},
): VslDocument {
  const $ = cheerio.load(html);

  // Фильтр невидимых элементов (аналогично domExtractor.ts)
  $('script, style, link, meta, noscript, template, head, title, base').remove();
  $('[aria-hidden="true"]').remove();

  // Извлечение title
  const title = options.title || $('title').text().trim() || undefined;

  // Построение дерева VSL объектов
  const objects: VslObject[] = [];
  const textBlocks = new Map<string, string>();
  let textBlockCounter = 0;

  const LAZY_TEXT_THRESHOLD = 200;
  const LAZY_TEXT_PREVIEW_LENGTH = 50;

  /**
   * Рекурсивно обходит DOM и строит VslObject.
   */
  function extractElement(element: AnyNode): VslObject | null {
    if (!element || element.type !== 'tag') return null;

    const $el = $(element);
    const tag = element.tagName?.toLowerCase() || 'div';

    // Пропуск невидимых элементов
    const style = $el.attr('style') || '';
    if (style.includes('display: none') || style.includes('display:none')) {
      return null;
    }

    // Извлечение семантической информации
    const role = $el.attr('role');
    const ariaLabel = $el.attr('aria-label');
    const ariaPressed = $el.attr('aria-pressed');
    const ariaExpanded = $el.attr('aria-expanded');
    const ariaDisabled = $el.attr('aria-disabled');

    // Определение типа элемента (L1: tag → L2: role → L3: CSS patterns)
    const type = determineElementType(tag, role, $el);

    // Определение состояния
    let state: string | undefined;
    if (ariaDisabled === 'true') state = 'disabled';
    else if (ariaExpanded === 'true') state = 'expanded';
    else if (ariaPressed === 'true') state = 'pressed';

    // Извлечение текста
    const text = ariaLabel || $el.clone().children().remove().end().text().trim();

    // Извлечение детей
    const children: VslObject[] = [];
    $el.children().each((_: number, child: AnyNode) => {
      const childObj = extractElement(child);
      if (childObj) children.push(childObj);
    });

    // Построение VslObject
    const obj: VslObject = {
      id: `${tag}_${objects.length}`,
      t: type,
      p: null, // HTTP-путь: нет координат
      s: null, // HTTP-путь: нет размеров
    };

    if (role) obj.r = role;
    if (state) obj.st = state;

    if (text) {
      if (text.length > LAZY_TEXT_THRESHOLD) {
        obj.txt_preview = text.slice(0, LAZY_TEXT_PREVIEW_LENGTH) + '…';
        const refId = `tb_${String(textBlockCounter++).padStart(3, '0')}`;
        obj.txt_ref = refId;
        textBlocks.set(refId, text);
      } else {
        obj.txt = text;
      }
    }

    // Определение действий по семантике
    const actions = determineActions(type, state, $el);
    if (actions) obj.act = actions;

    if (children.length > 0) obj.ch = children;

    // Сохранение HTML-атрибутов (для отладки)
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries($el.attr() || {}) as Array<[string, string]>) {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        attributes[key] = value;
      }
    }
    if (Object.keys(attributes).length > 0) {
      obj.attributes = attributes;
    }

    return obj;
  }

  // Обход body
  $('body').children().each((_: number, child: AnyNode) => {
    const obj = extractElement(child);
    if (obj) objects.push(obj);
  });

  return {
    vsl_version: '1.0.0',
    canvas: {
      viewport: { width: 1280, height: 800, unit: 'px' },
      background: '#ffffff',
      scale: 1,
      orientation: 'landscape',
      timestamp: new Date().toISOString(),
      url: options.url,
      title,
    },
    objects,
    text_blocks: textBlocks.size > 0 ? Object.fromEntries(textBlocks) : undefined,
  };
}

/**
 * Определяет тип элемента по L1 (tag) → L2 (role) → L3 (CSS patterns).
 */
function determineElementType(tag: string, role: string | undefined, $el: cheerio.Cheerio<AnyNode>): string {
  // L2: ARIA role имеет приоритет
  if (role) {
    const roleMap: Record<string, string> = {
      button: 'button',
      link: 'link',
      input: 'input',
      checkbox: 'input',
      radio: 'input',
      textbox: 'input',
      select: 'select',
      textarea: 'textarea',
      modal: 'modal',
      dialog: 'modal',
      tab: 'tab',
      tabpanel: 'container',
      navigation: 'container',
      banner: 'container',
      contentinfo: 'container',
      main: 'container',
    };
    return roleMap[role] || 'container';
  }

  // L1: Tag-based
  const tagMap: Record<string, string> = {
    button: 'button',
    a: 'link',
    input: 'input',
    select: 'select',
    textarea: 'textarea',
    form: 'container',
    nav: 'container',
    header: 'container',
    footer: 'container',
    main: 'container',
    article: 'container',
    section: 'container',
    div: 'container',
    span: 'container',
    p: 'text',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    img: 'image',
    video: 'media',
    audio: 'media',
  };

  const baseType = tagMap[tag] || 'container';

  // L3: CSS patterns (упрощённо)
  const className = $el.attr('class') || '';
  if (className.includes('btn') || className.includes('button')) return 'button';
  if (className.includes('modal') || className.includes('dialog')) return 'modal';
  if (className.includes('tab')) return 'tab';

  // Input type detection
  if (tag === 'input') {
    const inputType = $el.attr('type') || 'text';
    if (inputType === 'checkbox' || inputType === 'radio') return 'input';
    return 'input';
  }

  return baseType;
}

/**
 * Определяет действия по типу элемента и состоянию.
 */
function determineActions(
  type: string,
  state: string | undefined,
  $el: cheerio.Cheerio<AnyNode>,
): string[] | undefined {
  if (state === 'disabled') return undefined;

  switch (type) {
    case 'button':
    case 'link':
    case 'tab':
      return ['click'];
    case 'modal':
      return ['close'];
    case 'input': {
      const inputType = $el.attr('type') || 'text';
      if (inputType === 'checkbox' || inputType === 'radio') {
        return ['click', 'check', 'uncheck'];
      }
      return ['click', 'type', 'clear'];
    }
    case 'select':
      return ['click', 'select'];
    case 'textarea':
      return ['click', 'type', 'clear'];
    default:
      return undefined;
  }
}
