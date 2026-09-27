# Fix data-vsl-id Injection Bug in getSnapshot.ts

## Problem Description

`vsl_execute_action click` fails with timeout because `data-vsl-id` attributes are not correctly injected into DOM elements. The issue manifests on example.com (element `a_0_2_0` with indexPath `[0, 2, 0]`) and Wikipedia, but works on Google.

## Root Cause Analysis

### Current Implementation (getSnapshot.ts L392-424)

The code parses `obj.id` to extract `indexPath` and traverses the DOM:

const parts = obj.id.split('_');
if (parts.length < 2) return;

const indexPath = parts.slice(1).map(Number);

let current: Element | null = document.body;
for (const idx of indexPath) {
  if (!current) break;
  const elementChildren: Element[] = Array.from(current.children);
  current = elementChildren[idx] || null;
}

if (current) {
  current.setAttribute('data-vsl-id', obj.id);
}
### Identified Issues

#### Issue 1: Incorrect Parsing of Tags with Underscores

The code uses `parts.slice(1).map(Number)` to extract `indexPath`, which fails for tags containing underscores (e.g., `file_input`, `custom_widget`).

**Example:**
- `obj.id = "file_input_0_2_0"`
- `parts = ["file", "input", "0", "2", "0"]`
- `parts.slice(1) = ["input", "0", "2", "0"]`
- `parts.slice(1).map(Number) = [NaN, 0, 2, 0]` ❌

This causes `document.body.children[NaN]` → `undefined`, and the element is not found.

**Note:** While this doesn't affect the specific example.com case (tag `a` has no underscore), it's a critical bug for other element types.

#### Issue 2: Mismatch Between VSL Tree and DOM Traversal

The `extractDomTreeInBrowser` function filters elements based on visibility:

if (NON_RENDERABLE_TAGS.has(tag) || isDisplayNone(child)) {
  return; // Skips element AND its children
}

if (isVisibilityHidden(child) || hasZeroBox(rect)) {
  result.push(...collectVisibleChildren(child, path)); // Skips element but includes children
  return;
}
The `indexPath` is computed using real DOM indices (`Array.from(parent.children).forEach((child, index) => ...)`), which includes all elements (visible and invisible).

The reverse traversal in the injection code also uses `document.body.children[idx]`, which should match. However, there may be edge cases where:

1. **DOM changes between extraction and injection**: If the page dynamically modifies the DOM between `extractDomTreeInBrowser` and the injection `browser.evaluate()`, indices may shift.

2. **Shadow DOM or iframes**: Not handled by the current implementation.

3. **Race conditions**: The `await browser.evaluate()` should be synchronous, but there may be timing issues with page stabilization.

### Why Google Works but example.com/Wikipedia Don't

**Hypothesis:**
- Google's page is highly dynamic and may stabilize after initial load, allowing the injection to succeed.
- example.com and Wikipedia have static DOMs, but there may be subtle differences in structure (e.g., hidden elements, different root element handling) that cause the mismatch.

## Proposed Solution

### Fix 1: Use `parseVslId` Function

Replace the manual parsing with the existing `parseVslId` function (mentioned in comments but not used):

function parseVslId(id: string): { tag: string; indexPath: number[] } | null {
  const underscoreIndex = id.indexOf('_');
  if (underscoreIndex === -1) return null;
  
  const tag = id.slice(0, underscoreIndex);
  const indexPathStr = id.slice(underscoreIndex + 1);
  const indexPath = indexPathStr.split('_').map(Number);
  
  if (indexPath.some(isNaN)) return null;
  
  return { tag, indexPath };
}
**Usage:**
const parsed = parseVslId(obj.id);
if (!parsed) return;

const { indexPath } = parsed;
let current: Element | null = document.body;
for (const idx of indexPath) {
  if (!current) break;
  const elementChildren: Element[] = Array.from(current.children);
  current = elementChildren[idx] || null;
}

if (current) {
  current.setAttribute('data-vsl-id', obj.id);
}
### Fix 2: Add Validation and Logging

Add validation to ensure the element is found before setting the attribute:

if (current) {
  current.setAttribute('data-vsl-id', obj.id);
} else {
  console.warn(`[VSL] Failed to inject data-vsl-id: element not found for id=${obj.id}, indexPath=${JSON.stringify(indexPath)}`);
}
### Fix 3: Ensure DOM Stability

Add a small delay or wait for DOM stabilization before injection:

// Wait for DOM to stabilize
await browser.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

// Then inject data-vsl-id
await browser.evaluate(...);
## Implementation Plan

1. **Replace manual parsing with `parseVslId`** (Fix 1)
   - Location: `packages/mcp-server/src/tools/getSnapshot.ts` L392-424
   - Ensure correct handling of tags with underscores

2. **Add validation and logging** (Fix 2)
   - Log warnings when elements are not found
   - Help diagnose future issues

3. **Add DOM stabilization wait** (Fix 3)
   - Prevent race conditions on dynamic pages

4. **Test on multiple pages**
   - example.com (simple static page)
   - Google (dynamic page)
   - Wikipedia (complex static page)
   - Pages with `file_input` elements

## Acceptance Criteria

- [ ] `data-vsl-id` attributes are correctly injected for all elements, including those with tags containing underscores (e.g., `file_input`)
- [ ] `vsl_execute_action click` works on example.com, Google, and Wikipedia without timeout errors
- [ ] Warnings are logged when elements cannot be found (for debugging)
- [ ] No regression in existing functionality (snapshot generation, other tools)

## Constraints

- Do not modify the VSL tree structure or SDK pipeline
- Maintain performance (avoid excessive delays)
- Ensure compatibility with Playwright test framework
- Do not restore files from git without explicit user permission

## Files to Modify

- `packages/mcp-server/src/tools/getSnapshot.ts` (L392-424)

## Testing Strategy

1. **Unit test**: Verify `parseVslId` correctly handles tags with underscores
2. **Integration test**: Run `vsl_get_snapshot` → `vsl_execute_action click` on example.com, Google, Wikipedia
3. **Edge case test**: Test pages with `file_input` elements
4. **Regression test**: Ensure existing tests still pass

## References

- Bug location: `packages/mcp-server/src/tools/getSnapshot.ts` L380-424
- SDK pipeline: `packages/mcp-server/node_modules/@thinkingos/vsl-sdk/dist/index.js` L837-840
- `extractDomTreeInBrowser`: `packages/mcp-server/src/tools/getSnapshot.ts` L177-286
- `parseVslId` (mentioned but not used): `packages/mcp-server/src/tools/getSnapshot.ts` (see ref `d6bd4743`)