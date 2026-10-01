# Handoff: VSL Coordinate-Based Clicking Feature

## Task Summary
Реализовать coordinate-based clicking для VSL MCP server, чтобы LLM мог кликать на отдельные изображения внутри reCAPTCHA/hCaptcha challenge iframes.

## Current State
✅ **Спецификация готова:** `tasks/vsl-coordinate-clicking-feature.md`
✅ **Пользователь одобрил подход:** coordinate clicking + grid overlay
✅ **Техническая feasibility подтверждена:** Puppeteer может кликать по координатам, cross-origin policy НЕ блокирует VSL

## What Needs to Be Done

### Phase 1: `vsl_click_coordinates` Tool (4-6 hours)
1. Создать Puppeteer helper function для coordinate-based clicking
2. Реализовать последовательное выполнение кликов с задержками
3. Добавить логику возврата diff + snapshot после всех кликов
4. Написать unit tests
5. Обновить MCP server tool registry

### Phase 2: `vsl_get_visual` Grid Overlay (3-4 hours)
1. Добавить canvas drawing логику для grid lines
2. Реализовать coordinate/letter/number labels
3. Добавить grid_size auto-detection (опционально)
4. Написать unit tests
5. Обновить документацию

### Phase 3: Integration Testing (2-3 hours)
1. Тестировать на reCAPTCHA v2 image challenge
2. Тестировать на hCaptcha image challenge
3. Проверить точность координат на разных viewport sizes
4. Документировать best practices для LLM usage

## Key Technical Details

### Coordinate System
- **Origin:** Top-left corner of target element (0, 0)
- **Units:** Pixels (relative to element, not viewport)
- **Reliability:** VERY HIGH — reCAPTCHA/hCaptcha have fixed grid dimensions

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

## Open Questions (for developer to decide)
1. **Should we support percentage-based coordinates?** (e.g., x: 25%, y: 25%)
   - Pro: More resilient to size changes
   - Con: Less precise for small elements

2. **Should grid overlay be a separate tool?** (e.g., `vsl_get_visual_with_grid`)
   - Pro: Cleaner API, doesn't bloat existing tool
   - Con: More tools to maintain

3. **Should we add "batch actions" tool?** (click + type + scroll in one call)
   - Pro: Reduces round trips for complex workflows
   - Con: More complex error handling

## Estimated Effort
- Phase 1 (vsl_click_coordinates): 4-6 hours
- Phase 2 (grid overlay): 3-4 hours
- Phase 3 (testing): 2-3 hours
- **Total:** 9-13 hours

## Priority
**HIGH** — This feature is critical for solving image-based captchas, which are the most common type encountered in web automation tasks.

## Related Files
- **Spec:** `tasks/vsl-coordinate-clicking-feature.md`
- **VSL MCP Server:** `/Users/maxzhadobin/TaoAI_TRAE/VSL/visual-scene-language/packages/mcp-server/`

## Key Discoveries from Testing
1. ✅ reCAPTCHA image challenge is fully accessible via VSL (cross-origin policy does NOT block VSL)
2. ✅ VSL can get screenshots of challenge images via `vsl_get_visual`
3. ⚠️ Current limitation: cannot click on specific images inside challenge iframe
4. ✅ Solution: coordinate-based clicking with relative coordinates (VERY HIGH reliability)

## Next Steps
1. Switch to development/execution mode
2. Implement `vsl_click_coordinates` tool (Phase 1)
3. Implement grid overlay in `vsl_get_visual` (Phase 2)
4. Test on real captchas (Phase 3)
5. Update documentation

## Contact
User approved this approach and is ready to proceed with implementation.