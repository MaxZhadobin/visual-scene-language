/**
 * Inject data-vsl-id attributes into the DOM for Playwright element lookup.
 *
 * This function is shared between getSnapshot, navigate, and executeAction
 * to ensure that VSL IDs are always available in the DOM after snapshot creation.
 *
 * Supports both main page and iframe contexts (M2.1).
 */

import type { BrowserManager, PlaywrightFrame } from '../browser/manager.js';
import type { VslObject } from '@thinkingos/vsl-sdk';

/**
 * Shared browser-side injection logic.
 * Walks VSL objects by indexPath and sets data-vsl-id attributes.
 */
function buildInjectionScript(): (objects: VslObject[]) => void {
  return (objects: VslObject[]) => {
    /**
     * Parses VSL ID into { tag, indexPath } format.
     * Correctly handles tags with underscores (file_input, custom_widget, etc.).
     */
    function parseVslId(id: string): { tag: string; indexPath: number[] } | null {
      const match = id.match(/^([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*)_(\d+(?:_\d+)*)$/);
      if (!match) return null;
      const tag = match[1]!;
      const indexPath = match[2]!.split('_').map(Number);
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
  };
}

/**
 * Injects data-vsl-id attributes into main page DOM elements.
 * Must be called after snapshot creation to enable Playwright element lookup.
 */
export async function injectVslIdsIntoDom(
  browser: BrowserManager,
  objects: VslObject[],
): Promise<void> {
  const page = await browser.getPage();
  await page.waitForTimeout(50);
  await browser.evaluate(buildInjectionScript(), objects);
}

/**
 * Injects data-vsl-id attributes into iframe DOM elements (M2.1).
 * Uses Playwright frame.evaluate() to run in the iframe's context.
 * Best-effort: errors are logged but do not throw.
 */
export async function injectVslIdsIntoFrame(
  browser: BrowserManager,
  frame: PlaywrightFrame,
  objects: VslObject[],
): Promise<void> {
  try {
    await browser.evaluateInFrame(frame, buildInjectionScript(), objects);
  } catch (error) {
    console.warn('[VSL] Failed to inject data-vsl-id into iframe:', error);
  }
}
