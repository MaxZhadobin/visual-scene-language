# Feature: Coordinate-Based Clicking for VSL MCP Server

## Problem Statement

Current VSL MCP server can **see** reCAPTCHA/hCaptcha challenge iframes via `vsl_get_visual`, but cannot **click on specific images** inside them. The challenge iframe is treated as a single element, and individual images within the grid are not exposed as separate clickable elements.

When attempting to click on challenge images, the modal closes (likely due to clicking wrong elements like "Skip" button, or timeout issues).

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
    snapshot: { /* New VSL snapshot */ }
  }
}
### 2. Enhanced `vsl_get_visual` with Coordinate Grid

Add optional parameter to render coordinate grid overlay on screenshot, making it easier for LLM to determine exact click coordinates.

**New Parameters:**
{
  element_id: string,
  show_grid?: boolean,         // Render coordinate grid overlay (default: false)
  grid_size?: "3x3" | "4x4" | "auto",  // Grid dimensions (default: "auto")
  grid_labels?: "coordinates" | "letters" | "numbers",  // Label format (default: "coordinates")
  grid_color?: string          // Grid line color (default: "rgba(255,0,0,0.5)")
}
**Example Usage:**
vsl_get_visual({
  element_id: "ifr_2",
  show_grid: true,
  grid_size: "3x3",
  grid_labels: "coordinates"
})
**Visual Output:**
┌─────────┬─────────┬─────────┐
│  (50,50)│ (150,50)│ (250,50)│
│         │         │         │
├─────────┼─────────┼─────────┤
│ (50,150)│(150,150)│(250,150)│
│         │         │         │
├─────────┼─────────┼─────────┤
│ (50,250)│(150,250)│(250,250)│
│         │         │         │
└─────────┴─────────┴─────────┘
## Workflow Example: Solving reCAPTCHA Image Challenge

### Current Workflow (Broken)
1. vsl_execute_action(click, iframe_0:spn_0)  // Click checkbox
2. vsl_get_visual(ifr_2)                       // Get challenge screenshot
3. LLM analyzes images
4. vsl_execute_action(click, iframe_1:btn_0)  // ❌ Challenge closes (wrong element)
### New Workflow (Proposed)
1. vsl_execute_action(click, iframe_0:spn_0)  // Click checkbox
2. vsl_get_visual(ifr_2, show_grid=true, grid_size="3x3")  // Get challenge with grid
3. LLM analyzes images with grid overlay, determines coordinates
4. vsl_click_coordinates(ifr_2, clicks=[
     {x: 50, y: 50},   // Click image A1
     {x: 150, y: 50}   // Click image B1
   ])
5. LLM sees new screenshot (via return_state), verifies selections
6. vsl_execute_action(click, verify_button_id)  // Click "Verify" button
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

**Mitigation:**
- Use percentage-based coordinates (0-100%) as alternative to pixels
- Auto-detect grid size from element dimensions

## Implementation Plan

### Phase 1: `vsl_click_coordinates` Tool
1. Create Puppeteer helper function for coordinate-based clicking
2. Implement sequential click execution with delays
3. Add diff + snapshot return logic
4. Write unit tests
5. Update MCP server tool registry

### Phase 2: `vsl_get_visual` Grid Overlay
1. Add canvas drawing logic for grid lines
2. Implement coordinate/letter/number labels
3. Add grid_size auto-detection (optional)
4. Write unit tests
5. Update documentation

### Phase 3: Integration Testing
1. Test on reCAPTCHA v2 image challenge
2. Test on hCaptcha image challenge
3. Verify coordinate accuracy across different viewport sizes
4. Document best practices for LLM usage

## Technical Considerations

### Coordinate System
- **Origin:** Top-left corner of target element (0, 0)
- **Units:** Pixels (relative to element, not viewport)
- **Bounds:** Automatically clamped to element dimensions

### Puppeteer Implementation
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
### Grid Overlay Rendering
function drawGridOverlay(
  canvas: HTMLCanvasElement,
  gridSize: "3x3" | "4x4",
  labels: "coordinates" | "letters" | "numbers"
) {
  const ctx = canvas.getContext('2d');
  const [cols, rows] = gridSize.split('x').map(Number);
  const cellWidth = canvas.width / cols;
  const cellHeight = canvas.height / rows;
  
  // Draw grid lines
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
  ctx.lineWidth = 2;
  
  for (let i = 1; i <cols; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellWidth, 0);
    ctx.lineTo(i * cellWidth, canvas.height);
    ctx.stroke();
  }
  
  for (let i = 1; i <rows; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * cellHeight);
    ctx.lineTo(canvas.width, i * cellHeight);
    ctx.stroke();
  }
  
  // Draw labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '14px Arial';
  
  for (let row = 0; row <rows; row++) {
    for (let col = 0; col <cols; col++) {
      const centerX = (col + 0.5) * cellWidth;
      const centerY = (row + 0.5) * cellHeight;
      
      let label: string;
      if (labels === 'coordinates') {
        label = `(${Math.round(centerX)}, ${Math.round(centerY)})`;
      } else if (labels === 'letters') {
        label = `${String.fromCharCode(65 + row)}${col + 1}`;
      } else {
        label = `${row * cols + col + 1}`;
      }
      
      ctx.fillText(label, centerX - 20, centerY);
    }
  }
}
## Acceptance Criteria

- [ ] `vsl_click_coordinates` tool accepts target_id and array of clicks
- [ ] Each click supports optional delay_after_ms parameter
- [ ] Tool returns diff + new snapshot when return_state=true
- [ ] Coordinates are relative to target element (not viewport)
- [ ] `vsl_get_visual` supports show_grid parameter
- [ ] Grid overlay renders correctly for 3x3 and 4x4 grids
- [ ] Grid labels support coordinates, letters, and numbers formats
- [ ] Tested on reCAPTCHA v2 image challenge — successfully clicks multiple images
- [ ] Tested on hCaptcha image challenge — successfully clicks multiple images
- [ ] Documentation updated with usage examples

## Open Questions

1. **Should we support percentage-based coordinates?** (e.g., x: 25%, y: 25%)
   - Pro: More resilient to size changes
   - Con: Less precise for small elements

2. **Should grid overlay be a separate tool?** (e.g., `vsl_get_visual_with_grid`)
   - Pro: Cleaner API, doesn't bloat existing tool
   - Con: More tools to maintain

3. **Should we add "batch actions" tool?** (click + type + scroll in one call)
   - Pro: Reduces round trips for complex workflows
   - Con: More complex error handling

## Priority

**HIGH** — This feature is critical for solving image-based captchas, which are the most common type encountered in web automation tasks.

## Estimated Effort

- Phase 1 (vsl_click_coordinates): 4-6 hours
- Phase 2 (grid overlay): 3-4 hours
- Phase 3 (testing): 2-3 hours
- **Total:** 9-13 hours

## Dependencies

- Puppeteer `page.mouse.click()` API
- Canvas API for grid overlay rendering
- Existing VSL element identification system

## Related Notes

- reCAPTCHA image challenge is fully accessible via VSL (cross-origin policy does NOT block VSL)
- Current limitation: cannot click on specific images inside challenge iframe
- Solution: coordinate-based clicking with relative coordinates