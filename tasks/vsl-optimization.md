# VSL Optimization Task

## Problem Statement

VSL snapshots are excessively large, burning ~700k tokens for 10-20 pages. Current detail levels (low/medium/high) don't help enough because:
- Low level is unusable (too sparse)
- Medium level still includes massive bloat

## Root Cause Analysis

### 1. Critical Bug in Detail Level Filters
**Files:** `packages/mcp-server/src/tools/getSnapshot.ts:93-100`, `packages/mcp-server/src/tools/readPage.ts:347-355`

**Issue:** `INTERACTIVE_TYPES` and `CONTAINER_TYPES` contain non-existent VSL types:
- `INTERACTIVE_TYPES` includes: `'checkbox'`, `'radio'`, `'file'`, `'submit'`, `'reset'` (these don't exist in VSL)
- `CONTAINER_TYPES` includes HTML tags: `'div'`, `'section'`, `'article'`, `'aside'`, `'fieldset'` (should be VSL types)

**Impact:** Medium filter doesn't actually filter `container` — the most frequent type!

**Fix:** Use correct VSL types from `src/types/vsl.ts`:
const INTERACTIVE_TYPES = new Set([
  'button', 'link', 'input', 'select', 'textarea', 'file_input'
]);

const CONTAINER_TYPES = new Set([
  'container', 'layout', 'list', 'grid', 'toolbar', 'tab_bar', 
  'form_field', 'nav', 'header', 'main', 'footer'
]);
### 2. No Viewport Culling
**Files:** `src/capture/domExtractor.ts:197-228`

**Issue:** Elements outside visible area (y > viewport.height) are included in snapshot. Only filters display:none/visibility:hidden/zero-box.

**Impact:** On long pages (articles, lists, dashboards), this doubles/triples object count.

**Fix:** Add viewport culling in `domExtractor.ts`:
- **Architecture:** Extract ALL elements from DOM first (including offscreen), assign IDs to ALL, THEN apply viewport culling
- Include elements that are at least partially visible: `y <viewport.height && y + height > 0`
- Add parameter `include_offscreen` (default: false) for cases when full content is needed
- Add metadata `culled_count: N` for debugging

**Critical:** ID generation happens BEFORE culling to ensure stability:
1. Extract ALL elements from DOM (including offscreen)
2. Assign IDs to ALL elements (global counter, independent of culling)
3. Apply viewport culling (filter offscreen)
4. Return filtered snapshot to agent

**Trade-off:** Agent must scroll explicitly, but this is the correct workflow. Saves 50-80% tokens on long pages.

### 3. Excessive Style Data (sty)
**Files:** `src/builder/vslBuilder.ts:111-161`

**Issue:** `extractVisualStyles` adds bg/fg/border/radius/shadow/font for EVERY element with non-zero computed styles. Hundreds of objects × 3-6 style fields = thousands of tokens.

**Impact:** LLM agent rarely needs computed styles (doesn't see page visually).

**Fix:** Remove `sty` field from medium/low detail levels, keep only for high. Agent uses `vsl_get_visual` for visual understanding.

**Decision confirmed:** User agreed to remove styles from medium/low.

### 4. Excessive Coordinate Precision
**Files:** `src/builder/vslBuilder.ts:58-61`

**Issue:** Coordinates use 4 decimal places (0.1234). Sub-pixel precision unnecessary for LLM agent.

**Impact:** Wastes ~30% tokens on coordinates.

**Fix:** Round to 2 decimal places (0.12). No functional loss.

### 5. Verbose Element IDs
**Files:** `src/builder/vslBuilder.ts:136`, `packages/mcp-server/src/tools/httpExtractor.ts:336`

**Issue:** Current ID generation is inconsistent and verbose:
- **Browser path:** `tag_indexPath` → `button_0_1_2_3`, `div_0_1_2_3_4_5_6_7_8_9` (long strings with underscores)
- **HTTP path:** `tag_counter` → `button_123` (shorter but still verbose)

**Impact:** IDs consume significant space in JSON, especially with long indexPath values.

**Fix:** Unified ID generation strategy for both paths:

**Priority 1: Use existing DOM `id` if present**
- ✅ Stable between page reloads
- ✅ Readable for debugging
- ⚠️ Unpredictable length (but rare — most elements don't have id)

**Priority 2: Fallback to short generated IDs with abbreviated types**
- `btn_1`, `inp_2`, `link_3`, `cont_4` instead of `button_0_1_2_3`
- ✅ Deterministic (DOM traversal order is stable)
- ✅ Short (abbreviated types: btn/inp/link/cont/img/sel/txt)
- ✅ Readable (element type is clear)
- ✅ Unique (global counter for entire snapshot)

**Type mapping:**
const TYPE_ABBREVIATIONS = {
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
  main: 'main'
};
**Implementation:**
// Global counter for entire snapshot
let idCounter = 0;

function generateId(element: Element, type: string): string {
  // Priority: use existing DOM id
  if (element.id) return element.id;
  
  // Fallback: short ID with abbreviated type
  const shortType = TYPE_ABBREVIATIONS[type] || 'el';
  return `${shortType}_${++idCounter}`;
}
**Economy:** ~50-70% reduction in ID size.

### 6. Code Duplication
**Files:** `getSnapshot.ts:87-152` vs `readPage.ts:338-411`

**Issue:** Two identical filter functions with different type signatures:
- `filterObjectsByDetailLevel(objects: VslObject[], level: DetailLevel): VslObject[]`
- `applyDetailLevelFilter(document: Record<string, unknown>, level: DetailLevel): Record<string, unknown>`

**Impact:** Bugs fixed in one place but not the other. Logic divergence over time.

**Fix:** Create `packages/mcp-server/src/utils/detailLevelFilter.ts` with universal implementation. Use in both tools.

**User confirmed:** Merge into shared utility.

## Implementation Plan

### Phase 1: Critical Fixes (High Priority)

1. **Fix filter bugs** (both files)
   - Replace incorrect types with correct VSL types
   - Test with real page snapshots

2. **Create shared utility**
   - Extract filter logic to `packages/mcp-server/src/utils/detailLevelFilter.ts`
   - Implement generic version working with any object type
   - Update `getSnapshot.ts` and `readPage.ts` to use shared utility

### Phase 2: ID Optimization (High Impact)

3. **Unify ID generation**
   - Create shared utility `packages/mcp-server/src/utils/idGenerator.ts`
   - Implement type abbreviation mapping
   - Update `vslBuilder.ts` (browser path) to use new ID generator
   - Update `httpExtractor.ts` (HTTP path) to use new ID generator
   - Ensure IDs are generated BEFORE viewport culling (stability)

### Phase 3: Size Optimizations (High Impact)

4. **Add viewport culling**
   - Modify `domExtractor.ts` to filter offscreen elements AFTER ID assignment
   - Add `include_offscreen` parameter (default: false)
   - Add `culled_count` to metadata
   - Test scrolling workflow

5. **Remove styles from medium/low**
   - Modify `vslBuilder.ts` to skip `extractVisualStyles` for medium/low
   - Keep styles only for high detail level
   - Verify agent can still use `vsl_get_visual` when needed

### Phase 4: Minor Optimizations

6. **Round coordinates**
   - Modify `vslBuilder.ts:58-61` to round to 2 decimal places
   - Verify no precision loss in element targeting

## Acceptance Criteria

- [ ] Fix bug in `filterObjectsByDetailLevel` and `applyDetailLevelFilter` with incorrect INTERACTIVE_TYPES and CONTAINER_TYPES
- [ ] Implement unified ID generation strategy (DOM id priority + short fallback)
- [ ] Implement viewport culling to exclude offscreen elements from snapshot (with IDs generated before culling)
- [ ] Round element coordinates to 2 decimal places
- [ ] Extract duplicate filtering logic into shared utility
- [ ] Significantly reduce VSL size on medium detail level (target: < 100k tokens for 10-20 pages)

## Constraints

- Preserve necessary functionality for LLM agent
- Don't break backward compatibility of existing VSL types
- Eliminate code duplication in filtering logic
- IDs must be stable (not affected by viewport culling)

## Expected Impact

**Before optimization:**
- Medium level: ~700k tokens for 10-20 pages
- Includes all offscreen elements
- Includes all computed styles
- Filter bugs make medium level ineffective
- Verbose IDs (button_0_1_2_3, div_0_1_2_3_4_5_6_7_8_9)

**After optimization:**
- Medium level: < 100k tokens for 10-20 pages (85%+ reduction)
- Only visible elements included (50-80% reduction on long pages)
- No styles in medium/low (thousands of tokens saved)
- Working filters properly reduce object count
- Short, readable IDs (btn_1, inp_2, cont_3)
- Cleaner, maintainable codebase

## Testing Strategy

1. **Unit tests:** Verify filter logic with correct VSL types
2. **Unit tests:** Verify ID generation (DOM id priority + fallback)
3. **Integration tests:** Measure token reduction on real pages
4. **Workflow tests:** Verify agent can still scroll and interact with elements
5. **Regression tests:** Ensure no breaking changes to existing functionality

## Rollout Plan

1. Implement all optimizations in feature branch
2. Test on representative pages (dashboards, articles, forms)
3. Measure token reduction
4. Deploy to staging
5. Monitor agent performance