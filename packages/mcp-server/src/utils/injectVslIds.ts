/**
 * Inject data-vsl-id attributes into the DOM for Playwright element lookup.
 *
 * This function is shared between getSnapshot, navigate, and executeAction
 * to ensure that VSL IDs are always available in the DOM after snapshot creation.
 *
 * @param browser - BrowserManager instance
 * @param objects - VSL objects from the snapshot
 */

import type { BrowserManager } from '../browser/manager.js';
import type { VslObject } from '@thinkingos/vsl-sdk';

/**
 * Injects data-vsl-id attributes into DOM elements based on VSL object indexPath.
 * Must be called after snapshot creation to enable Playwright element lookup.
 *
 * @param browser - BrowserManager instance
 * @param objects - VSL objects array from the snapshot
 */
export async function injectVslIdsIntoDom(
  browser: BrowserManager,
  objects: VslObject[],
): Promise<void> {
  // DOM stabilization delay — wait for dynamic DOM changes to complete
  const page = await browser.getPage();
  await page.waitForTimeout(50);

  await browser.evaluate(
    (objects: VslObject[]) => {
      /**
       * Parses VSL ID into { tag, indexPath } format.
       * Correctly handles tags with underscores (file_input, custom_widget, etc.).
       *
       * @param id - VSL ID in format `${tag}_${indexPath.join("_")}`
       * @returns Object with tag and indexPath, or null if ID is invalid
       */
      function parseVslId(id: string): { tag: string; indexPath: number[] } | null {
        // Regex: tag starts with letter, can contain letters/digits, underscore only before
        // a segment starting with a letter (not before a number). indexPath is purely numeric.
        const match = id.match(/^([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*)_(\d+(?:_\d+)*)$/);
        if (!match) return null;

        const tag = match[1];
        const indexPath = match[2].split('_').map(Number);

        return { tag, indexPath };
      }

      function visit(obj: VslObject): void {
        const parsed = parseVslId(obj.id);
        if (!parsed) return;
        const indexPath = parsed.indexPath;

        let current: Element | null = document.body;
        for (const idx of indexPath) {
          if (!current) break;
          const elementChildren: Element[] = Array.from(current.children);
          current = elementChildren[idx] || null;
        }

        if (current) {
          current.setAttribute('data-vsl-id', obj.id);
        } else {
          // Warning logging when element not found during injection
          console.warn(`[VSL] Failed to inject data-vsl-id="${obj.id}": element not found at indexPath [${indexPath.join(', ')}]`);
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
    objects,
  );
}