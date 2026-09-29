/**
 * Unified ID Generator for VSL (M1.7 optimization).
 *
 * Strategy:
 *  1. Priority: use existing DOM `id` if present (stable, readable)
 *  2. Fallback: short generated IDs with abbreviated types (btn_1, inp_2, cont_3)
 *
 * Works for both browser path (SegmentedElement) and HTTP path (cheerio elements).
 * IDs are deterministic (DOM traversal order is stable) and unique within a snapshot.
 */

/** Type abbreviations for short ID generation. */
export const TYPE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  button: 'btn',
  input: 'inp',
  link: 'link',
  container: 'cont',
  image: 'img',
  select: 'sel',
  textarea: 'txt',
  heading: 'h',
  text: 'txt',
  file_input: 'file',
  modal: 'modal',
  tab: 'tab',
  dropdown_toggle: 'dropdown',
  footer: 'footer',
  scrollable_container: 'scroll',
  toolbar: 'toolbar',
  list: 'list',
  grid: 'grid',
  form_field: 'form',
  tab_bar: 'tabs',
  layout: 'layout',
  nav: 'nav',
  header: 'header',
  main: 'main',
  icon: 'icon',
  chart: 'chart',
  custom_widget: 'widget',
  unknown: 'el',
};

/**
 * ID Generator class for a single snapshot.
 * Maintains a global counter to ensure uniqueness across the entire snapshot.
 */
export class IdGenerator {
  private typeCounters: Map<string, number> = new Map();

  /**
   * Generate ID for an element.
   *
   * @param elementId - Existing DOM id attribute (if present)
   * @param vslType - VSL type of the element (for fallback abbreviation)
   * @returns Generated ID string
   */
  generate(elementId: string | null | undefined, vslType: string | null): string {
    // Priority 1: use existing DOM id if present and non-empty
    if (elementId && elementId.trim().length > 0) {
      return elementId;
    }

    // Priority 2: fallback to short generated ID with per-type counter
    // Per-type counters ensure stability: adding a new button doesn't shift
    // nav/link/container IDs. Only elements of the same type are affected.
    const shortType = vslType ? (TYPE_ABBREVIATIONS[vslType] || 'el') : 'el';
    const count = (this.typeCounters.get(shortType) || 0) + 1;
    this.typeCounters.set(shortType, count);
    return `${shortType}_${count}`;
  }

  /** Reset counters (for testing or new snapshot). */
  reset(): void {
    this.typeCounters.clear();
  }

  /** Get current counter value for a type (for debugging). */
  getCounter(type?: string): number {
    if (type) {
      return this.typeCounters.get(type) || 0;
    }
    // Return total count across all types
    let total = 0;
    for (const count of this.typeCounters.values()) {
      total += count;
    }
    return total;
  }
}

/**
 * Create a new ID generator for a snapshot.
 */
export function createIdGenerator(): IdGenerator {
  return new IdGenerator();
}