/**
 * Shared utility for VSL object filtering by detail level (DEC-027, M1.7 optimization).
 * 
 * Replaces duplicated logic in getSnapshot.ts and readPage.ts.
 * Fixes critical bug: uses correct VSL types instead of non-existent HTML tags.
 * 
 * Detail levels:
 *  - 'low': only interactive elements (button, link, input, select, textarea, file_input, tab, modal, dropdown_toggle)
 *  - 'medium': interactive + containers (container, scrollable_container, layout, list, grid, toolbar, tab_bar, form_field, nav, header, main, footer)
 *  - 'high': all objects (no filtering)
 */

import type { VslDiff, VslObject } from '@thinkingos/vsl-sdk';

/** Detail level for VSL filtering. */
export type DetailLevel = 'low' | 'medium' | 'high';

/**
 * Interactive VSL types (L1-L2 semantic types that users interact with).
 * 
 * Correct types from src/types/vsl.ts:
 *  - button (L1: button, L2: role=button)
 *  - link (L1: a)
 *  - input (L1: input)
 *  - select (L1: select)
 *  - textarea (L1: textarea)
 *  - file_input (L1: input[type=file])
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
 * 
 * Correct types from src/types/vsl.ts:
 *  - container (L1: section, L3: display:flex+gap)
 *  - layout (L4: structural pattern)
 *  - list (L4: vertical list pattern)
 *  - grid (L4: grid pattern)
 *  - toolbar (L4: horizontal button row)
 *  - tab_bar (L4: tab pattern)
 *  - form_field (L4: label+input pair)
 *  - nav (L1: nav)
 *  - header (L1: header, L3: position:fixed+top:0)
 *  - main (L1: main)
 *  - footer (L1: footer, L3: position:fixed+bottom:0)
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
]);

/**
 * Filter VSL objects by detail level (typed version).
 * 
 * @param objects - Array of VslObject to filter
 * @param level - Detail level: 'low', 'medium', or 'high'
 * @returns Filtered array of VslObject
 */
export function filterObjectsByDetailLevel(
  objects: VslObject[],
  level: DetailLevel,
  options?: { stripStyles?: boolean }
 ): VslObject[] {
  if (level === 'high') return objects;

  // Strip styles for low/medium levels (DEC-027 optimization)
  const shouldStripStyles = options?.stripStyles ?? true;

  function filterRecursive(obj: VslObject): VslObject | null {
    const type = obj.t || '';

    if (level === 'low') {
      // Only interactive elements
      if (!INTERACTIVE_TYPES.has(type)) {
        // Check children — if there are interactive descendants, keep container
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
      // Interactive element — strip styles if needed
      if (shouldStripStyles && obj.sty) {
        const { sty: _sty, ...rest } = obj;
        return rest as VslObject;
      }
      return obj;
    }

    if (level === 'medium') {
      // Interactive + containers
      if (INTERACTIVE_TYPES.has(type) || CONTAINER_TYPES.has(type)) {
        if (obj.ch && obj.ch.length > 0) {
          const filteredChildren = obj.ch
            .map(filterRecursive)
            .filter((child): child is VslObject => child !== null);
          const result = { ...obj, ch: filteredChildren };
          if (shouldStripStyles) delete result.sty;
          return result;
        }
        // Leaf element — strip styles if needed
        if (shouldStripStyles && obj.sty) {
          const { sty: _sty, ...rest } = obj;
          return rest as VslObject;
        }
        return obj;
      }
      // Check children
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
 * Filter VSL document by detail level (generic version for any document type).
 * 
 * Works with VslDocument, VslDiff, or Record<string, unknown>.
 * 
 * @param document - VSL document with optional `objects` field
 * @param level - Detail level: 'low', 'medium', or 'high'
 * @param options - Optional settings (stripStyles: remove sty field for low/medium)
 * @returns Filtered VSL document (same type as input)
 */
export function applyDetailLevelFilter<T extends { objects?: VslObject[] }>(
  document: T,
  level: DetailLevel,
  options?: { stripStyles?: boolean }
 ): T {
  if (level === 'high') return document;

  const objects = document.objects;
  if (!objects || !Array.isArray(objects)) return document;

  const filteredObjects = filterObjectsByDetailLevel(objects, level, options);

  return { ...document, objects: filteredObjects };
}

/**
 * Check if a VSL type is interactive.
 * 
 * @param type - VSL type string
 * @returns true if type is interactive
 */
export function isInteractiveType(type: string): boolean {
  return INTERACTIVE_TYPES.has(type);
}

/**
 * Check if a VSL type is a container.
 * 
 * @param type - VSL type string
 * @returns true if type is a container
 */
export function isContainerType(type: string): boolean {
  return CONTAINER_TYPES.has(type);
}

/**
 * Filter a diff by detail level (дополнение к filterDiffByViewport,
 * единый пайплайн отдачи: сначала вьюпорт-фильтр, затем детализация).
 *
 *  - added — поддеревья фильтруются по типам (как в filterObjectsByDetailLevel);
 *  - modified / unchanged_refs — только id, остающиеся после детал-фильтрации next-документа;
 *  - removed — остаются как есть (id без типа; вьюпорт-фильтрация уже применена).
 */
export function filterDiffByDetailLevel(
  diff: VslDiff,
  nextDoc: { readonly objects: readonly VslObject[] },
  level: DetailLevel,
  options?: { stripStyles?: boolean },
): VslDiff {
  if (level === 'high') return diff;

  // id, остающиеся после детал-фильтрации полного next-документа
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
      modified: diff.changes.modified.filter((m) => visibleIds.has(m.id)),
      removed: diff.changes.removed,
      unchanged_refs: diff.changes.unchanged_refs.filter((id) => visibleIds.has(id)),
    },
  };
}