/**
 * Tool: vsl_get_snapshot (T1.6.3, M1.7).
 *
 * Извлекает VSL snapshot из текущей страницы браузера.
 *
 * Flow:
 *  1. Проверка доступности браузера
 *  2. Извлечение DOM-дерева через browser.evaluate(extractDomTreeInBrowser)
 *  3. Передача в ServerSession.snapshotFromElements() → SDK pipeline:
 *     segmentTree → buildVslDocument → cache → diff
 *  4. Запись data-vsl-id атрибутов в DOM для execute_action
 *  5. Возврат VSL JSON (полный документ или diff)
 */

import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';
import type { VslDocument, VslObject, SnapshotInput, SnapshotResult } from '@thinkingos/vsl-sdk';
import { isVslDiff } from '@thinkingos/vsl-sdk';
import { injectVslIdsIntoDom } from '../utils/injectVslIds.js';

/** Уровни детализации snapshot (DEC-027). */
export type DetailLevel = 'low' | 'medium' | 'high';

/** TTL кэша snapshot по умолчанию (5 секунд). */
const DEFAULT_SNAPSHOT_TTL_MS = 5000;

/** Запись кэша snapshot. */
interface SnapshotCacheEntry {
  result: GetSnapshotResult;
  timestamp: number;
  url: string;
  detailLevel: DetailLevel;
}

/** Кэш snapshot (ключ: URL + detail_level). */
const snapshotCache = new Map<string, SnapshotCacheEntry>();


/** Аргументы vsl_get_snapshot. */
export interface GetSnapshotArgs {
  url?: string;
  /**
   * Уровень детализации snapshot (default: 'high').
   * - 'low': только интерактивные элементы (кнопки, ссылки, инпуты)
   * - 'medium': интерактивные + контейнеры
   * - 'high': все объекты (полный DOM)
   */
  detail_level?: DetailLevel;
  /**
   * TTL кэша в миллисекундах (default: 5000 = 5s).
   * Если snapshot был получен менее TTL назад, возвращается из кэша.
   * Установите 0 для отключения кэширования.
   */
  ttl?: number;
}

/** Результат vsl_get_snapshot. */
export interface GetSnapshotResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: SnapshotMetadata;
}

/** Метрики snapshot (DEC-029). */
export interface SnapshotMetadata {
  /** Размер JSON в байтах. */
  json_size_bytes: number;
  /** Приблизительное количество токенов (size / 4). */
  estimated_tokens: number;
  /** Количество объектов в snapshot. */
  object_count: number;
  /** Timestamp генерации snapshot (ISO 8601). */
  timestamp: string;
  /** Время выполнения в миллисекундах. */
  execution_time_ms: number;
}

/**
 * Фильтрует объекты VSL по уровню детализации (DEC-027).
 * - 'low': только интерактивные элементы (кнопки, ссылки, инпуты)
 * - 'medium': интерактивные + контейнеры
 * - 'high': все объекты (без фильтрации)
 */
function filterObjectsByDetailLevel(
  objects: VslObject[],
  level: DetailLevel,
  ): VslObject[] {
  if (level === 'high') return objects;

  const INTERACTIVE_TYPES = new Set([
    'button', 'link', 'input', 'select', 'checkbox', 'radio',
    'textarea', 'file', 'submit', 'reset',
  ]);

  const CONTAINER_TYPES = new Set([
    'div', 'section', 'article', 'nav', 'header', 'footer',
    'main', 'aside', 'form', 'fieldset',
  ]);

  function filterRecursive(obj: VslObject): VslObject | null {
    const type = obj.t || '';

    if (level === 'low') {
      // Только интерактивные элементы
      if (!INTERACTIVE_TYPES.has(type)) {
        // Проверяем детей — если есть интерактивные дети, возвращаем контейнер
        if (obj.ch && obj.ch.length > 0) {
          const filteredChildren = obj.ch
            .map(filterRecursive)
            .filter((child): child is VslObject => child !== null);
          if (filteredChildren.length > 0) {
            return { ...obj, ch: filteredChildren };
          }
        }
        return null;
      }
      return obj;
    }

    if (level === 'medium') {
      // Интерактивные + контейнеры
      if (INTERACTIVE_TYPES.has(type) || CONTAINER_TYPES.has(type)) {
        if (obj.ch && obj.ch.length > 0) {
          const filteredChildren = obj.ch
            .map(filterRecursive)
            .filter((child): child is VslObject => child !== null);
          return { ...obj, ch: filteredChildren };
        }
        return obj;
      }
      // Проверяем детей
      if (obj.ch && obj.ch.length > 0) {
        const filteredChildren = obj.ch
          .map(filterRecursive)
          .filter((child): child is VslObject => child !== null);
        if (filteredChildren.length > 0) {
          return { ...obj, ch: filteredChildren };
        }
      }
      return null;
    }

    return obj;
  }

  return objects
    .map(filterRecursive)
    .filter((obj): obj is VslObject => obj !== null);
}

/**
 * Рекурсивно подсчитывает количество объектов в дереве VSL.
 */
function countObjects(objects: VslObject[]): number {
  let count = 0;
  for (const obj of objects) {
    count++;
    if (obj.ch && obj.ch.length > 0) {
      count += countObjects(obj.ch);
    }
  }
  return count;
}

/**
 * Извлекает DOM-дерево в формате ExtractedElement[] (SDK-совместимый).
 * Выполняется в браузерном контексте через Playwright evaluate().
 * Экспортируется для использования в других tools (executeAction с return_state).
 */
export function extractDomTreeInBrowser(): unknown[] {
  // Интерфейсы (копия из SDK для типизации в browser context)
  interface Rect { x: number; y: number; width: number; height: number; }
  interface ElementCss {
    cursor?: string; position?: string; top?: string; bottom?: string;
    display?: string; gap?: string; fontWeight?: string; fontSize?: string;
    opacity?: string; pointerEvents?: string; overflow?: string; height?: string;
  }
  interface ExtractedElement {
    tag: string; indexPath: number[]; rect: Rect; text: string | null;
    attributes: Record<string, string>; css?: ElementCss; children: ExtractedElement[];
  }

  const NON_RENDERABLE_TAGS = new Set([
    'script', 'style', 'link', 'meta', 'noscript', 'template', 'head', 'title', 'base',
  ]);

  function viewOf(el: Element): Window | null {
    return el.ownerDocument.defaultView;
  }

  function isDisplayNone(el: Element): boolean {
    return viewOf(el)?.getComputedStyle(el).display === 'none';
  }

  function isVisibilityHidden(el: Element): boolean {
    return viewOf(el)?.getComputedStyle(el).visibility === 'hidden';
  }

  const TEXT_NODE_TYPE = 3;

  function ownText(el: Element): string {
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

  const CSS_PROPERTIES: Array<[keyof ElementCss, string]> = [
    ['cursor', 'cursor'], ['position', 'position'], ['top', 'top'], ['bottom', 'bottom'],
    ['display', 'display'], ['gap', 'gap'], ['fontWeight', 'font-weight'],
    ['fontSize', 'font-size'], ['opacity', 'opacity'], ['pointerEvents', 'pointer-events'],
    ['overflow', 'overflow'], ['height', 'height'],
  ];

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

      if (NON_RENDERABLE_TAGS.has(tag) || isDisplayNone(child)) {
        return;
      }

      const rect = toRect(child.getBoundingClientRect());

      if (isVisibilityHidden(child) || hasZeroBox(rect)) {
        result.push(...collectVisibleChildren(child, path));
        return;
      }

      const attributes = extractAttributes(child);
      const css = captureCss(child);

      // Skip aria-hidden elements (matches segmentTree behavior)
      if (attributes['aria-hidden'] === 'true') {
        return;
      }

      // Skip pointer-invisible elements (matches segmentTree behavior)
      if (css.opacity === '0' && css.pointerEvents === 'none') {
        return;
      }

      const children = collectVisibleChildren(child, path);

      // Generate VSL ID from tag and indexPath, inject data-vsl-id directly into DOM
      const vslId = `${tag}_${path.join('_')}`;
      child.setAttribute('data-vsl-id', vslId);

      result.push({
        tag,
        indexPath: path,
        rect,
        text: ownText(child) || null,
        attributes,
        css,
        children,
      });
    });
    return result;
  }

  const body = document.body;
  if (!body) return [];
  return collectVisibleChildren(body, []);
}

/**
 * Обработчик vsl_get_snapshot.
 *
 * Использует SDK pipeline через ServerSession.snapshotFromElements().
 * MCP сервер не вызывает segmentTree/buildVslDocument напрямую —
 * всю работу делает SDK.
 *
 * @param args - Аргументы инструмента (url опционально)
 * @param browser - Browser Manager
 * @param session - Server Session (обёртка над VslSnapshotSession из SDK)
 * @param _config - Конфигурация сервера
 */
export async function handleGetSnapshot(
  args: GetSnapshotArgs,
  browser: BrowserManager,
  session: ServerSession,
  _config: McpServerConfig,
  ): Promise<GetSnapshotResult> {
  const startTime = Date.now();
  const detailLevel = args.detail_level || 'medium';
  const ttl = args.ttl ?? DEFAULT_SNAPSHOT_TTL_MS;

  // Валидация параметров (DEC-030)
  const VALID_DETAIL_LEVELS: DetailLevel[] = ['low', 'medium', 'high'];
  if (args.detail_level !== undefined && !VALID_DETAIL_LEVELS.includes(args.detail_level)) {
    return {
      status: 'error',
      error: 'Invalid detail_level: ' + args.detail_level + '. Valid values: ' + VALID_DETAIL_LEVELS.join(', '),
    };
  }

  if (args.ttl !== undefined && (typeof args.ttl !== 'number' || args.ttl < 0)) {
    return {
      status: 'error',
      error: 'Invalid ttl: ' + args.ttl + '. Must be a non-negative number (milliseconds).',
    };
  }

  try {
    // 0. Проверяем кэш snapshot (если TTL > 0)
    if (ttl > 0) {
      const cacheKey = `${args.url || 'current'}:${detailLevel}`;
      const cached = snapshotCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) <ttl) {
        return {
          ...cached.result,
          metadata: {
            ...cached.result.metadata,
            json_size_bytes: cached.result.metadata?.json_size_bytes ?? 0,
            estimated_tokens: cached.result.metadata?.estimated_tokens ?? 0,
            object_count: cached.result.metadata?.object_count ?? 0,
            execution_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }

    // 1. Навигация по URL (если указан)
    if (args.url) {
      await browser.navigate(args.url);
    }

    // 2. Проверяем, что браузер доступен
    const isAvailable = await browser.isAvailable();
    if (!isAvailable) {
      return {
        status: 'error',
        error:
          'Playwright is not installed. Install it with: npm install playwright',
      };
    }

    // 3. Извлекаем DOM-дерево в формате ExtractedElement[] (SDK-совместимый)
    const extractedElements = await browser.evaluate(extractDomTreeInBrowser);

    // 4. Получаем viewport размеры, URL и title страницы для SnapshotInput
    const viewport = await browser.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const url = args.url || (await browser.evaluate(() => window.location.href)) as string;
    const title = await browser.evaluate(() => document.title);

    // 5. Формируем SnapshotInput и передаём в SDK через ServerSession
    const input: SnapshotInput = {
      viewport: viewport as { width: number; height: number },
      url,
      title: title as string,
      timestamp: new Date().toISOString(),
    };

    // 6. SDK pipeline: segmentTree → buildVslDocument → cache → diff
    //    Первый вызов возвращает VslDocument, последующие — VslDiff.
    const result: SnapshotResult = session.snapshotFromElements(
      extractedElements as never,
      input,
    );

    // 7. Определяем текущий документ для записи VSL ID в DOM
    const currentDoc: VslDocument = isVslDiff(result)
      ? session.getSnapshot()
      : result;

    // 7.5. Inject data-vsl-id attributes into DOM for execute_action
    // Shared utility ensures consistent injection across getSnapshot, navigate, executeAction
    await injectVslIdsIntoDom(browser, currentDoc.objects);

    // 9. Применяем фильтрацию по detail_level (DEC-027)
    const filteredObjects = filterObjectsByDetailLevel(currentDoc.objects, detailLevel);

    // 10. Формируем результат с отфильтрованными объектами
    const filteredResult = isVslDiff(result)
      ? { ...result, objects: filteredObjects }
      : { ...result, objects: filteredObjects };

    // 11. Вычисляем метрики (DEC-029)
    const executionTimeMs = Date.now() - startTime;
    const resultJson = JSON.stringify(filteredResult);
    const jsonSizeBytes = Buffer.byteLength(resultJson, 'utf-8');
    const estimatedTokens = Math.ceil(jsonSizeBytes / 4);
    const objectCount = countObjects(filteredObjects);

    const metadata: SnapshotMetadata = {
      json_size_bytes: jsonSizeBytes,
      estimated_tokens: estimatedTokens,
      object_count: objectCount,
      timestamp: new Date().toISOString(),
      execution_time_ms: executionTimeMs,
    };

    // 12. Сохраняем результат в кэш (если TTL > 0)
    if (ttl > 0) {
      const cacheKey = `${args.url || 'current'}:${detailLevel}`;
      const resultToCache: GetSnapshotResult = {
        status: 'success',
        data: filteredResult,
        metadata,
      };
      snapshotCache.set(cacheKey, {
        result: resultToCache,
        timestamp: Date.now(),
        url: args.url || 'current',
        detailLevel,
      });
    }

    return {
      status: 'success',
      data: filteredResult,
      metadata,
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}