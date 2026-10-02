/**
 * Inject data-vsl-id attributes into the DOM for Playwright element lookup.
 *
 * This function is shared between getSnapshot, navigate, and executeAction
 * to ensure that VSL IDs are always available in the DOM after snapshot creation.
 *
 * Supports both main page and iframe contexts (M2.1).
 *
 * Fallback strategy (reCAPTCHA/hCaptcha support):
 * 1. Try indexPath navigation (current behavior)
 * 2. If fails → try semantic selectors (role, aria-label, aria-labelledby)
 * 3. If fails → log warning
 */

import type { BrowserManager, PlaywrightFrame } from '../browser/manager.js';
import type { VslObject } from '@thinkingos/vsl-sdk';

/** Semantic attributes for fallback selectors. */
export interface SemanticAttributes {
  role?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

/** Map from indexPath string (e.g., '0_2_1') to semantic attributes. */
export type SemanticMap = Map<string, SemanticAttributes>;

/**
 * Shared browser-side injection logic with semantic fallback.
 * Walks VSL objects by indexPath and sets data-vsl-id attributes.
 * If indexPath fails, tries semantic selectors (role, aria-label, aria-labelledby).
 */
function buildInjectionScript(): (objects: VslObject[], semanticMap: Record<string, SemanticAttributes>) => void {
  return (objects: VslObject[], semanticMap: Record<string, SemanticAttributes>) => {
    // Defense-in-depth: защита от undefined аргументов (может произойти при ошибке сериализации через page.evaluate)
    if (!objects || !Array.isArray(objects)) {
      console.warn('[VSL] injectVslIds: objects is undefined or not an array, skipping injection');
      return;
    }
    if (!semanticMap || typeof semanticMap !== 'object') {
      console.warn('[VSL] injectVslIds: semanticMap is undefined or not an object, using empty map');
      semanticMap = {} as Record<string, SemanticAttributes>;
    }
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

    /**
     * Try to find element by indexPath (current behavior).
     * Returns null if not found.
     */
    function findByIndexPath(indexPath: number[]): Element | null {
      let current: Element | null = document.body;
      for (const idx of indexPath) {
        if (!current) break;
        const elementChildren: Element[] = Array.from(current.children);
        current = elementChildren[idx] || null;
      }
      return current;
    }

    /**
     * Try to find element by semantic attributes (fallback for reCAPTCHA/hCaptcha).
     * Priority: role+aria-label → role+aria-labelledby → role → aria-label.
     * Returns null if not found.
     */
    function findBySemantic(semantic: SemanticAttributes): Element | null {
      try {
        // Priority 1: role + aria-label (most specific)
        if (semantic.role && semantic.ariaLabel) {
          const selector = `[role="${semantic.role}"][aria-label="${semantic.ariaLabel}"]`;
          const el = document.querySelector(selector);
          if (el) return el as Element;
        }

        // Priority 2: role + aria-labelledby
        if (semantic.role && semantic.ariaLabelledBy) {
          const selector = `[role="${semantic.role}"][aria-labelledby="${semantic.ariaLabelledBy}"]`;
          const el = document.querySelector(selector);
          if (el) return el as Element;
        }

        // Priority 3: role only
        if (semantic.role) {
          const selector = `[role="${semantic.role}"]`;
          const el = document.querySelector(selector);
          if (el) return el as Element;
        }

        // Priority 4: aria-label only
        if (semantic.ariaLabel) {
          const selector = `[aria-label="${semantic.ariaLabel}"]`;
          const el = document.querySelector(selector);
          if (el) return el as Element;
        }

        return null;
      } catch (error) {
        console.warn('[VSL] Semantic selector error:', error);
        return null;
      }
    }

    function visit(obj: VslObject): void {
      const parsed = parseVslId(obj.id);
      if (!parsed) return;
      const indexPath = parsed.indexPath;
      const indexPathKey = indexPath.join('_');

      // Strategy 1: Try indexPath (current behavior)
      let target = findByIndexPath(indexPath);

      // Strategy 2: Fallback to semantic selectors if indexPath fails
      if (!target) {
        const semantic = semanticMap[indexPathKey];
        if (semantic) {
          target = findBySemantic(semantic);
          if (target) {
            console.log(`[VSL] Fallback to semantic selector for ${obj.id}: indexPath=[${indexPathKey}] → semantic={role:${semantic.role}, ariaLabel:${semantic.ariaLabel}}`);
          }
        }
      }

      // Set data-vsl-id attribute
      if (target) {
        target.setAttribute('data-vsl-id', obj.id);
      } else {
        console.warn(`[VSL] Failed to inject data-vsl-id="${obj.id}": element not found at indexPath [${indexPathKey}] and no semantic fallback available`);
      }

      // Recurse into children
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
 * Uses semantic fallback for dynamic DOM (reCAPTCHA, hCaptcha).
 */
export async function injectVslIdsIntoDom(
  browser: BrowserManager,
  objects: VslObject[],
  semanticMap: SemanticMap = new Map(),
  sessionId?: string,
): Promise<void> {
  const page = await browser.getPage(sessionId!);
  await page.waitForTimeout(50);
  // Convert Map to plain object for serialization
  const semanticMapObj: Record<string, SemanticAttributes> = {};
  for (const [key, value] of semanticMap) {
    semanticMapObj[key] = value;
  }
  await browser.evaluate(buildInjectionScript(), sessionId!, objects, semanticMapObj);
}

/**
 * Injects data-vsl-id attributes into iframe DOM elements (M2.1).
 * Uses Playwright frame.evaluate() to run in the iframe's context.
 * Uses semantic fallback for dynamic DOM (reCAPTCHA, hCaptcha).
 * Best-effort: errors are logged but do not throw.
 */
export async function injectVslIdsIntoFrame(
  browser: BrowserManager,
  frame: PlaywrightFrame,
  objects: VslObject[],
  semanticMap: SemanticMap = new Map(),
  sessionId?: string,
): Promise<void> {
  try {
    // Convert Map to plain object for serialization
    const semanticMapObj: Record<string, SemanticAttributes> = {};
    for (const [key, value] of semanticMap) {
      semanticMapObj[key] = value;
    }
    await browser.evaluateInFrame(frame, buildInjectionScript(), sessionId!, objects, semanticMapObj);
  } catch (error) {
    console.warn('[VSL] Failed to inject data-vsl-id into iframe:', error);
  }
}

