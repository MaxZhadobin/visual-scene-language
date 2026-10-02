/**
 * Detail Level Filter — фильтрация VSL-объектов по уровню детализации (DEC-027).
 *
 * Портивано из MCP (packages/mcp-server/src/utils/detailLevelFilter.ts)
 * для parity Extension ↔ MCP (dev_7).
 *
 * Уровни детализации:
 *  - 'low': только интерактивные элементы (button, link, input, select, textarea,
 *    file_input, tab, modal, dropdown_toggle);
 *  - 'medium': интерактивные + контейнеры (container, scrollable_container, layout,
 *    list, grid, toolbar, tab_bar, form_field, nav, header, main, footer, iframe);
 *  - 'high': все объекты (без фильтрации).
 *
 * Порядок композиции: сначала viewport filter, затем detail_level.
 *
 * Runtime-строки — на английском (решение 22.09.2026).
 */

import type { VslObject } from '../types/vsl.js';
import type { VslDiff, VslModifiedObject } from '../diff/diffEngine.js';

/** Detail level for VSL filtering. */
export type DetailLevel = 'low' | 'medium' | 'high';

/**
 * Interactive VSL types (L1-L2 semantic types that users interact with).
 */
export const INTERACTIVE_TYPES: ReadonlySet<string> = new Set<string>([
  'button',
  'link',
  'input',
  'select',
  'textarea',
  'file_input',
  'tab',
  'modal',
  'dropdown_toggle',
]);

/**
 * Container VSL types (structural/layout elements).
 */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set<string>([
  'container',
  'scrollable_container',
  'layout',
  'list',
  'grid',
  'toolbar',
  'tab_bar',
  'form_field',
  'nav',
  'header',
  'main',
  'footer',
  'iframe', // M2.1: iframe objects contain sub-VSL documents
]);

/**
 * Filter VSL objects by detail level.
 *
 * @param objects - Array of VslObject to filter
 * @param level - Detail level: 'low', 'medium', or 'high'
 * @param options - Optional settings (stripStyles: remove sty field for low/medium)
 * @returns Filtered array of VslObject
 */
export function filterObjectsByDetailLevel(
  objects: readonly VslObject[],
  level: DetailLevel,
  options?: { stripStyles?: boolean },
): VslObject[] {
  if (level === 'high') return [...objects];

  const shouldStripStyles = options?.stripStyles ?? true;

  function filterRecursive(obj: VslObject): VslObject | null {
    const type = obj.t || '';

    if (level === 'low') {
      if (!INTERACTIVE_TYPES.has(type)) {
        if (obj.ch && obj.ch.length > 0) {
          const filteredChildren = obj.ch
            .map(filterRecursive)
            .filter((child): child is VslObject => child !== null);
          if (filteredChildren.length > 0) {
            const result = { ...obj, ch: filteredChildren };
            if (shouldStripStyles) delete result.sty;
            return result;
          }
        }
        return null;
      }
      if (shouldStripStyles && obj.sty) {
        const { sty: _sty, ...rest } = obj;
        return rest as VslObject;
      }
      return obj;
    }

    if (level === 'medium') {
      if (INTERACTIVE_TYPES.has(type) || CONTAINER_TYPES.has(type)) {
        if (obj.ch && obj.ch.length > 0) {
          const filteredChildren = obj.ch
            .map(filterRecursive)
            .filter((child): child is VslObject => child !== null);
          const result = { ...obj, ch: filteredChildren };
          if (shouldStripStyles) delete result.sty;
          return result;
        }
        if (shouldStripStyles && obj.sty) {
          const { sty: _sty, ...rest } = obj;
          return rest as VslObject;
        }
        return obj;
      }
      if (obj.ch && obj.ch.length > 0) {
        const filteredChildren = obj.ch
          .map(filterRecursive)
          .filter((child): child is VslObject => child !== null);
        if (filteredChildren.length > 0) {
          const result = { ...obj, ch: filteredChildren };
          if (shouldStripStyles) delete result.sty;
          return result;
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
 * Filter VSL document by detail level.
 */
export function applyDetailLevelFilter<T extends { objects?: readonly VslObject[] }>(
  document: T,
  level: DetailLevel,
  options?: { stripStyles?: boolean },
): T {
  if (level === 'high') return document;

  const objects = document.objects;
  if (!objects || !Array.isArray(objects)) return document;

  const filteredObjects = filterObjectsByDetailLevel(objects, level, options);

  return { ...document, objects: filteredObjects };
}

/**
 * Check if a VSL type is interactive.
 */
export function isInteractiveType(type: string): boolean {
  return INTERACTIVE_TYPES.has(type);
}

/**
 * Check if a VSL type is a container.
 */
export function isContainerType(type: string): boolean {
  return CONTAINER_TYPES.has(type);
}

/**
 * Filter a diff by detail level (дополнение к filterDiffByViewport,
 * единый пайплайн отдачи: сначала вьюпорт-фильтр, затем детализация).
 *
 *  - added — поддеревья фильтруются по типам;
 *  - modified / unchanged_refs — только id, остающиеся после детал-фильтрации next-документа;
 *  - removed — остаются как есть.
 */
export function filterDiffByDetailLevel(
  diff: VslDiff,
  nextDoc: { readonly objects: readonly VslObject[] },
  level: DetailLevel,
  options?: { stripStyles?: boolean },
): VslDiff {
  if (level === 'high') return diff;

  const visibleIds = new Set<string>();
  const collectIds = (objects: readonly VslObject[]): void => {
    for (const obj of objects) {
      visibleIds.add(obj.id);
      if (obj.ch && obj.ch.length > 0) collectIds(obj.ch);
    }
  };
  collectIds(filterObjectsByDetailLevel([...nextDoc.objects], level, options));

  return {
    ...diff,
    changes: {
      added: filterObjectsByDetailLevel([...diff.changes.added], level, options),
      modified: diff.changes.modified.filter((m: VslModifiedObject) => visibleIds.has(m.id)),
      removed: diff.changes.removed,
      unchanged_refs: diff.changes.unchanged_refs.filter((id: string) => visibleIds.has(id)),
    },
  };
}