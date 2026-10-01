# Fix Google reCAPTCHA iframe interaction failure

## Problem Statement

VSL (Visual Scene Language) successfully supports cross-origin iframes for hCaptcha but fails to interact with Google reCAPTCHA elements. The issue manifests as Playwright locator timeouts when attempting to click elements inside reCAPTCHA iframes.

### Symptoms
- ✅ **hCaptcha**: Full support — snapshot detects iframe, clicks work, challenge modal appears
- ❌ **reCAPTCHA**: Partial support — VSL sees DOM elements (role='checkbox'), but clicks timeout
- Challenge modal with 3x3 grid doesn't appear automatically for reCAPTCHA

### Root Cause Analysis

**Core Issue**: The `indexPath` mechanism for DOM element identification is fragile for dynamic DOM structures.

#### Technical Details

1. **Snapshot Generation** (`getSnapshot.ts` L207-257):
   - `extractDomTreeInBrowser()` builds `indexPath` based on child element indices
   - Example: `button_0_0_0_2` means "button at body[0].children[0].children[0].children[2]"
   - Injects `data-vsl-id` attributes directly into DOM during extraction

2. **ID Injection** (`injectVslIds.ts` L31-47):
   - Parses VSL ID to extract `indexPath`
   - Navigates DOM using: `for (const idx of indexPath) { current = current.children[idx] }`
   - Sets `data-vsl-id` attribute on the found element

3. **The Problem**:
   - reCAPTCHA iframe has **highly dynamic DOM** — elements are added/removed between snapshot and action execution
   - `indexPath` points to wrong element or element not found → Playwright timeout
   - hCaptcha works because its DOM is more stable

#### Why hCaptcha Works but reCAPTCHA Doesn't

- **hCaptcha**: DOM structure is relatively stable between snapshot and action
- **reCAPTCHA**: 
  - Uses shadow DOM and dynamic element creation
  - Elements may be recreated with different indices
  - Challenge modal (3x3 grid) appears only after user interaction
  - Timing/loading issues compound the indexPath mismatch

## Current Architecture

### Iframe Support Flow

1. **Snapshot** (`getSnapshot.ts` L489-558):
   - `extractIframesInBrowser()` finds all iframe elements
   - For each iframe: `extractDomTreeFromFrame()` extracts DOM via `frame.evaluate()`
   - Creates sub-VslDocument for each iframe
   - Stores in `iframeSubDocs` array

2. **ID Mapping** (`idMapper.ts` L100-119):
   - Creates shortId with `iframe_N:` prefix for iframe elements
   - Example: `iframe_0:spn_1`, `iframe_1:div_2`
   - `buildIdMap()` recursively processes iframe objects

3. **Action Execution** (`executeAction.ts` L352-387):
   - Frame routing: extracts frame index from `iframe_N:localId` format
   - URL-based frame matching via `iframeFrameRegistry`
   - Resolves local shortId → longId via idMap
   - Executes action on target frame

4. **ID Injection into Iframes** (`getSnapshot.ts` L602-605):
   - `injectVslIdsIntoFrame()` runs injection script in iframe context
   - Uses same `indexPath`-based navigation as main page

## Proposed Solution: Hybrid Approach (Robust Selectors + Positional Mapping)

### Strategy: "Don't break what works"

**Automatic fallback (transparent to user):**
1. First try `indexPath` (current behavior) → works for 99% of elements
2. If `indexPath` fails → automatically try semantic selectors (role, aria-label, text)
3. If semantic selectors fail → use positional mapping (`elementFromPoint`)
4. If nothing works → error (same as current)

**Safety guarantees:**
- All changes wrapped in try-catch
- If new code fails → fallback to old `indexPath`
- Log which selector worked (for debugging)
- hCaptcha continues working without changes

### Implementation Plan

#### Phase 1: Enhance Extraction (getSnapshot.ts)

1. **Collect semantic attributes** during `extractDomTreeInBrowser()`:
      interface ExtractedElement {
     // ... existing fields
     role?: string;
     ariaLabel?: string;
     ariaLabelledBy?: string;
     textContent?: string;
     stableClasses?: string[];  // Filter out dynamic classes
   }
   2. **Extract accessibility attributes**:
      function extractSemanticInfo(el: Element): Partial<ExtractedElement> {
     return {
       role: el.getAttribute('role') || undefined,
       ariaLabel: el.getAttribute('aria-label') || undefined,
       ariaLabelledBy: el.getAttribute('aria-labelledby') || undefined,
       textContent: ownText(el) || undefined,
       stableClasses: getStableClasses(el),  // Filter dynamic classes
     };
   }
   #### Phase 2: Enhance Injection (injectVslIds.ts)

1. **Build robust selector** from VSL object metadata:
      function buildRobustSelector(obj: VslObject): string {
     const selectors: string[] = [];
     
     // Priority 1: Semantic selectors
     if (obj.role) selectors.push(`[role="${obj.role}"]`);
     if (obj.ariaLabel) selectors.push(`[aria-label="${obj.ariaLabel}"]`);
     
     // Priority 2: Text-based (for buttons/links)
     if (obj.txt && ['button', 'a', 'span'].includes(obj.t)) {
       selectors.push(`${obj.t}:has-text("${obj.txt}")`);
     }
     
     // Priority 3: Current indexPath-based (fallback)
     selectors.push(`[data-vsl-id="${obj.id}"]`);
     
     return selectors.join(', ');  // CSS selector list
   }
   2. **Inject using robust selector with automatic fallback**:
      function visit(obj: VslObject): void {
     // 1. First try indexPath (current behavior)
     const element = findByIndexPath(obj.indexPath);
     
     if (element) {
       element.setAttribute('data-vsl-id', obj.id);
       return; // ✅ Works — exit
     }
     
     // 2. indexPath failed → automatically try semantic selectors
     const selector = buildRobustSelector(obj);
     const semanticElement = document.querySelector(selector);
     
     if (semanticElement) {
       semanticElement.setAttribute('data-vsl-id', obj.id);
       console.log(`[VSL] Injected ${obj.id} via semantic selector: ${selector}`);
       return; // ✅ Found via semantics — exit
     }
     
     // 3. Nothing worked → warning (same as current)
     console.warn(`[VSL] Failed to inject ${obj.id}`);
   }
   #### Phase 3: Positional Mapping for Dynamic Content (3x3 Grid)

**Problem**: reCAPTCHA challenge modal shows 3x3 image grid. DOM structure is highly dynamic, but bbox positions are stable within a single challenge.

**Solution**: Use `document.elementFromPoint()` to find element at bbox center coordinates.

**Why this works for 3x3 grid**:
- Each image in the grid has stable bbox coordinates
- Even if DOM rebuilds, images remain at same positions
- `elementFromPoint(centerX, centerY)` finds the correct image regardless of DOM structure
- Works for any grid-based challenge (3x3, 4x4, etc.)

1. **Store bbox in VSL object** (already available in `p` and `s` fields):
      // VSL object already has:
   // p: [x, y] - position
   // s: [width, height] - size
   2. **Positional fallback in executeAction.ts**:
      async function clickWithPositionalFallback(
     target: PlaywrightFrame | Page,
     obj: VslObject,
     selector: string
   ) {
     // Try 1: Semantic selector
     try {
       await target.locator(selector).click({ timeout: 2000 });
       return;
     } catch (error) {
       console.warn(`[VSL] Semantic selector failed: ${selector}`);
     }
     
     // Try 2: Positional mapping (elementFromPoint)
     if (obj.p && obj.s) {
       const centerX = obj.p[0] + obj.s[0] / 2;
       const centerY = obj.p[1] + obj.s[1] / 2;
       
       // Inject data-vsl-id at position
       await target.evaluate(({x, y, id}) => {
         const element = document.elementFromPoint(x, y);
         if (element) {
           element.setAttribute('data-vsl-id', id);
         }
       }, { x: centerX, y: centerY, id: obj.id });
       
       // Click the element
       await target.locator(`[data-vsl-id="${obj.id}"]`).click({ timeout: 2000 });
       console.log(`[VSL] Clicked ${obj.id} via positional mapping at (${centerX}, ${centerY})`);
       return;
     }
     
     throw new Error(`[VSL] All click strategies failed for ${obj.id}`);
   }
   3. **Usage in executeAction**:
      // For iframe elements with dynamic DOM (reCAPTCHA 3x3 grid)
   if (isIframeElement && isDynamicContent(targetFrame)) {
     await clickWithPositionalFallback(targetFrame, obj, selector);
   } else {
     // Standard flow: semantic selector → indexPath
     await target.locator(selector).click();
   }
   #### Phase 4: Testing

1. **Unit tests**:
   - Test robust selector generation
   - Test fallback to indexPath
   - Test positional mapping
   - Test retry logic

2. **Integration tests**:
   - hCaptcha: verify no regression
   - reCAPTCHA: verify checkbox click works
   - reCAPTCHA: verify challenge modal appears
   - reCAPTCHA: verify 3x3 grid image selection works

3. **Manual testing**:
   - Test on real reCAPTCHA demo page
   - Test on sites with dynamic iframes
   - Verify performance impact is acceptable

### Acceptance Criteria

- [ ] Root cause of reCAPTCHA iframe interaction failure is documented
- [ ] VSL snapshot includes semantic attributes (role, aria-label, text)
- [ ] ID injection uses robust selectors with indexPath fallback
- [ ] Positional mapping (elementFromPoint) is implemented for 3x3 grid
- [ ] Action execution uses semantic locators when available
- [ ] hCaptcha support remains fully functional