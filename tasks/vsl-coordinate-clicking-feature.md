# Feature: Coordinate-Based Clicking for VSL MCP Server

## Problem Statement

Current VSL MCP server can **see** reCAPTCHA/hCaptcha challenge iframes via `vsl_get_visual`, but cannot **click on specific images** inside them. The challenge iframe is treated as a single element, and individual images within the grid are not exposed as separate clickable elements.

When attempting to click on challenge images, the modal closes (likely due to clicking wrong elements like "Skip" button, or timeout issues).

## Core Requirements (from user feedback)

1. **Автоматическая отдача координат (bbox)** в snapshot для всех элементов — УЖЕ РЕАЛИЗОВАНО (не требует изменений)
2. **Новый tool `vsl_click_coordinates`** для множественных кликов по координатам с задержками
3. **Возврат diff + screenshot** после кликов (того же элемента/страницы)

## Proposed Solution

### 1. New Tool: `vsl_click_coordinates`

Execute multiple coordinate-based clicks on a target element, with optional delays between clicks. Returns diff + new screenshot after all clicks complete.

**Parameters:**
{
  target_id: string,           // Element ID (e.g., "ifr_2" for reCAPTCHA challenge)
  clicks: Array<{
    x: number,                 // X coordinate RELATIVE to element (pixels from left edge)
    y: number,                 // Y coordinate RELATIVE to element (pixels from top edge)
    delay_after_ms?: number    // Optional delay after this click (default: 0)
  }>,
  return_state?: boolean       // Return diff + new screenshot (default: true)
}
**Example Usage:**
vsl_click_coordinates({
  target_id: "ifr_2",
  clicks: [
    { x: 50, y: 50 },         // Click top-left image in 3x3 grid
    { x: 150, y: 50, delay_after_ms: 200 },  // Click top-middle, wait 200ms
    { x: 250, y: 50 }         // Click top-right
  ],
  return_state: true
})
**Returns:**
{
  status: "success",
  data: {
    actions_completed: 3,
    diff: { /* VSL diff after all clicks */ },
    snapshot: { /* New VSL snapshot */ },
    screenshot: {
      type: "image",
      data: "base64...",
      mimeType: "image/png"
    }
  }
}
## Workflow Example: Solving reCAPTCHA Image Challenge

### Current Workflow (Broken)
1. `vsl_execute_action(click, iframe_0:spn_0)` — Click checkbox
2. `vsl_get_visual(ifr_2)` — Get challenge screenshot
3. LLM analyzes images
4. `vsl_execute_action(click, iframe_1:btn_0)` — ❌ Challenge closes (wrong element)

### New Workflow (Proposed)
1. `vsl_execute_action(click, iframe_0:spn_0)` — Click checkbox
2. `vsl_get_visual(ifr_2)` — Get challenge screenshot (bbox координаты уже в snapshot)
3. LLM анализирует скриншот, определяет координаты нужных изображений по bbox из snapshot
4. `vsl_click_coordinates(ifr_2, clicks=[{x: 50, y: 50}, {x: 150, y: 50}])` — Кликает по изображениям
5. LLM видит новый screenshot (через return_state), проверяет выбор
6. `vsl_execute_action(click, verify_button_id)` — Click "Verify" button

## Reliability Analysis

### Coordinate Reliability: **VERY HIGH** ✅

**Why relative coordinates are reliable:**
- ✅ Independent of viewport size
- ✅ Independent of scroll position
- ✅ Independent of iframe position on page
- ✅ Fixed challenge grid dimensions (reCAPTCHA ~400x400px, hCaptcha similar)
- ✅ Coordinates (50, 50), (150, 50), (250, 50) for 3x3 grid are always consistent

**Potential risks:**
- ⚠️ Dynamic iframe resizing (rare for captchas)
- ⚠️ Responsive design changes (captcha providers rarely change grid sizes)

## Implementation Plan

### Phase 1: `vsl_click_coordinates` Tool
1. Create new file `packages/mcp-server/src/tools/clickCoordinates.ts`
2. Implement sequential click execution with delays using Playwright API (`page.mouse.click`)
3. Add diff + snapshot return logic (reuse `getStateAfterAction` from executeAction.ts)
4. Add screenshot return logic (reuse `handleGetVisual` from getVisual.ts)
5. Register new tool in MCP server (`packages/mcp-server/src/index.ts`)
6. Write unit tests

### Phase 2: Integration Testing
1. Test on reCAPTCHA v2 image challenge
2. Test on hCaptcha image challenge
3. Verify coordinate accuracy across different viewport sizes
4. Document best practices for LLM usage

## Technical Considerations

### Coordinate System
- **Origin:** Top-left corner of target element (0, 0)
- **Units:** Pixels (relative to element, not viewport)
- **Bounds:** Automatically clamped to element dimensions

### Playwright Implementation
async function clickAtCoordinates(page: Page, elementId: string, clicks: Click[]) {
  const element = await page.$(`[data-vsl-id="${elementId}"]`);
  const box = await element.boundingBox();
  
  for (const click of clicks) {
    const absoluteX = box.x + click.x;
    const absoluteY = box.y + click.y;
    
    await page.mouse.click(absoluteX, absoluteY);
    
    if (click.delay_after_ms) {
      await page.waitForTimeout(click.delay_after_ms);
    }
  }
}
### Existing Code Reuse
- **Positional mapping fallback** (executeAction.ts:396-462): уже реализован `elementFromPoint` + click по координатам. Можно адаптировать для множественных кликов.
- **getStateAfterAction** (executeAction.ts): возвращает diff + snapshot после действия. Переиспользовать для возврата состояния.
- **handleGetVisual** (getVisual.ts): делает скриншот элемента по element_id. Переиспользовать для возврата screenshot.

## Acceptance Criteria

- [ ] `vsl_click_coordinates` tool accepts target_id and array of clicks
- [ ] Each click supports optional delay_after_ms parameter
- [ ] Coordinates are relative to target element (pixels, not viewport)
- [ ] Tool returns diff + new snapshot when return_state=true
- [ ] Tool returns new screenshot of the same element/page after clicks
- [ ] Tested on reCAPTCHA v2 image challenge — successfully clicks multiple images
- [ ] Tested on hCaptcha image challenge — successfully clicks multiple images
- [ ] Documentation updated with usage examples

## Design Decisions (from user feedback)

### ✅ Pixels over Percentages
**Decision:** Use pixel coordinates (not percentages) for coordinate-based clicking.

**Rationale:**
- Pixels are more reliable for captcha (fixed dimensions ~400x400px)
- Percentages add complexity without benefit for fixed-size elements
- LLM can calculate pixel coordinates from bbox in snapshot

### ✅ No Grid Overlay
**Decision:** Do NOT implement grid overlay feature.

**Rationale:**
- LLM can calculate coordinates from bbox in snapshot (already provided)
- Grid overlay adds complexity without significant benefit
- Simpler API = easier to maintain

### ✅ Playwright API (not Puppeteer)
**Decision:** Use Playwright API for implementation.

**Rationale:**
- Project uses Playwright (not Puppeteer as in original spec)
- Playwright has equivalent functionality (`page.mouse.click`)
- Consistency with existing codebase

## Priority

**HIGH** — This feature is critical for solving image-based captchas, which are the most common type encountered in web automation tasks.

## Estimated Effort

- Phase 1 (vsl_click_coordinates): 4-6 hours
- Phase 2 (testing): 2-3 hours
- **Total:** 6-9 hours

## Dependencies

- Playwright `page.mouse.click()` API
- Existing VSL element identification system
- Existing `getStateAfterAction` logic (executeAction.ts)
- Existing `handleGetVisual` logic (getVisual.ts)

## Related Notes

- reCAPTCHA image challenge is fully accessible via VSL (cross-origin policy does NOT block VSL)
- Current limitation: cannot click on specific images inside challenge iframe
- Solution: coordinate-based clicking with relative coordinates
- Bbox coordinates are already provided in snapshot (no changes needed to getSnapshot.ts)

## Out of Scope (explicitly excluded)

- ❌ Percentage-based coordinates (pixels are more reliable)
- ❌ Grid overlay for `vsl_get_visual` (LLM calculates from bbox)
- ❌ Batch actions tool (click + type + scroll in one call) — may be added later
- ❌ Changes to `vsl_get_snapshot` (bbox already provided)