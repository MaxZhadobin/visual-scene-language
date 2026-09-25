/**
 * Tool: vsl_get_snapshot (T1.6.3).
 *
 * Получает текущий VSL snapshot страницы.
 * Если URL указан — переходит по нему, затем делает snapshot.
 * Если URL не указан — использует текущую страницу в браузере.
 *
 * Flow:
 *  1. Навигация по URL (если указан)
 *  2. Извлечение DOM-дерева через evaluate() → ExtractedElement[]
 *  3. Сегментация → VslDocument (через SDK: segmentTree → buildVslDocument)
 *  4. Запись data-vsl-id атрибутов в DOM для execute_action
 *  5. Сохранение в ServerSession
 *  6. Возврат VSL JSON
 */

import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';
import { segmentTree, buildVslDocument, type VslDocument, type VslObject } from '@thinkingos/vsl-sdk';

/** Аргументы vsl_get_snapshot. */
export interface GetSnapshotArgs {
  url?: string;
}

/** Результат vsl_get_snapshot. */
export interface GetSnapshotResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

/**
 * Извлекает DOM-дерево в формате ExtractedElement[] (SDK-совместимый).
 * Выполняется в браузерном контексте через Playwright evaluate().
 */
function extractDomTreeInBrowser(): unknown[] {
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

  const body = document.body;
  if (!body) return [];
  return collectVisibleChildren(body, []);
}

/**
 * Записывает VSL ID обратно в DOM через data-vsl-id атрибуты.
 * Выполняется в браузерном контексте через Playwright evaluate().
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function writeVslIdsToDom(objects: readonly VslObject[]): void {
  function visit(obj: VslObject): void {
    // ID формат: tag_indexPath (например, button_0_0)
    // indexPath можно восстановить из ID, но проще искать по tag + позиции
    // Используем CSS selector с data-vsl-id для точного соответствия
    const parts = obj.id.split('_');
    if (parts.length < 2) return;
    
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const tag = parts[0];
    const indexPath = parts.slice(1).map(Number);
    
    // Находим элемент по indexPath
    let current: Element | null = document.body;
    for (const idx of indexPath) {
      if (!current) break;
      const elementChildren = Array.from(current.children);
      current = elementChildren[idx] || null;
    }
    
    if (current) {
      current.setAttribute('data-vsl-id', obj.id);
    }
    
    // Рекурсия для детей
    if (obj.ch) {
      for (const child of obj.ch) {
        visit(child);
      }
    }
  }
  
  for (const obj of objects) {
    visit(obj);
  }
}

/**
 * Обработчик vsl_get_snapshot.
 *
 * @param args - Аргументы инструмента (url опционально)
 * @param browser - Browser Manager
 * @param session - Server Session
 * @param config - Конфигурация сервера
 */
export async function handleGetSnapshot(
  args: GetSnapshotArgs,
  browser: BrowserManager,
  session: ServerSession,
  _config: McpServerConfig,
): Promise<GetSnapshotResult> {
  try {
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
          'Playwright is not installed. Install it with: npm install playwright\n' +
          'Or use vsl_read_page with mode="http" for static pages.',
      };
    }

    // 3. Извлекаем DOM-дерево в формате ExtractedElement[] (SDK-совместимый)
    const extractedElements = await browser.evaluate(extractDomTreeInBrowser);

    // 4. Получаем viewport размеры
    const viewport = await browser.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    // 5. Сегментация и построение VSL через SDK
    const segmentedElements = segmentTree(extractedElements as never);
    const vslDocument: VslDocument = buildVslDocument(segmentedElements, {
      viewport: viewport as { width: number; height: number },
      url: args.url || (await browser.evaluate(() => window.location.href)) as string,
      timestamp: new Date().toISOString(),
    });

    // 6. Записываем VSL ID обратно в DOM для execute_action
    await browser.evaluate(
      (objects: VslObject[]) => {
        function visit(obj: VslObject): void {
          const parts = obj.id.split('_');
          if (parts.length < 2) return;
          
          const indexPath = parts.slice(1).map(Number);
          
          let current: Element | null = document.body;
          for (const idx of indexPath) {
            if (!current) break;
            const elementChildren = Array.from(current.children);
            current = elementChildren[idx] || null;
          }
          
          if (current) {
            current.setAttribute('data-vsl-id', obj.id);
          }
          
          if (obj.ch) {
            for (const child of obj.ch) {
              visit(child);
            }
          }
        }
        
        for (const obj of objects) {
          visit(obj);
        }
      },
      vslDocument.objects,
    );

    // 7. Сохраняем в ServerSession
    session.setSnapshot(vslDocument as never);

    return {
      status: 'success',
      data: vslDocument,
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}