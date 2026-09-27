# Fix: ARIA Role Mapping (combobox) & Navigation Timeout (google.com)

**Created:** 2026-09-27  
**Priority:** High  
**Estimated Effort:** 2-3 hours

---

## Problem Summary

### Problem 1: DuckDuckGo combobox не работает
**Симптом:** Click/type на элементах с ролью `combobox` не работают корректно.

**Корень проблемы:** `ARIA_ROLE_TYPE_MAP` в `src/segmentation/level2.ts:17-22` содержит только 4 роли:
- `button` → `button`
- `dialog` → `modal`
- `tab` → `tab`
- `tabpanel` → `container`

Роль `combobox` **отсутствует**. Элемент `<div role="combobox">` получает `t=null` от L2, L1 не типизирует `div` → score=3 (role) → тип `container`.

**Важно:** `data-vsl-id` инжектится корректно (injectVslIds не зависит от ARIA-роли). Playwright находит элемент по `[data-vsl-id="..."]` — **locator работает**. Проблема в том, что агент не знает семантику элемента (что это input с dropdown).

**Для `dropdown_toggle`:** определяется через `aria-haspopup="menu|listbox"`, а НЕ через `role="combobox"`. Если DuckDuckGo использует `<input role="combobox">` без `aria-haspopup` — `dropdown_toggle` не определится.

### Problem 2: Google timeout
**Симптом:** `page.goto` на google.com падает по `networkidle` (30s timeout).

**Корень проблемы:** `packages/mcp-server/src/browser/manager.ts:169-172` использует `waitUntil: 'networkidle'`. Google.com имеет постоянные фоновые запросы (analytics, suggestions API), поэтому `networkidle` (500мс без сетевых запросов) может не наступить → таймаут 30с.

---

## Solution Plan

### Task 1: Extend ARIA Role Mapping

**Files to modify:**
- `src/segmentation/level2.ts` — добавить роли в `ARIA_ROLE_TYPE_MAP`
- `src/segmentation/level2.test.ts` — добавить тесты для новых ролей

**Changes:**
// src/segmentation/level2.ts
export const ARIA_ROLE_TYPE_MAP: Readonly<Record<string, VslType>> = {
  button: 'button',
  dialog: 'modal',
  tab: 'tab',
  tabpanel: 'container',
  // Новые роли:
  combobox: 'input',      // combobox — это input с dropdown
  listbox: 'select',      // выпадающий список
  searchbox: 'input',     // поисковый input
  spinbutton: 'input',    // числовой input
  slider: 'input',        // slider (range input)
};
**Тесты:**
// src/segmentation/level2.test.ts
it('role="combobox" → input', () => {
  expect(resolveAriaRoleType('combobox')).toBe('input');
});

it('role="listbox" → select', () => {
  expect(resolveAriaRoleType('listbox')).toBe('select');
});

it('role="searchbox" → input', () => {
  expect(resolveAriaRoleType('searchbox')).toBe('input');
});

it('role="spinbutton" → input', () => {
  expect(resolveAriaRoleType('spinbutton')).toBe('input');
});

it('role="slider" → input', () => {
  expect(resolveAriaRoleType('slider')).toBe('input');
});
**Опционально (если нужно):**
Добавить обработку `role="combobox"` + `aria-expanded` для определения `dropdown_toggle`:
// src/segmentation/level2.ts
export function resolveDropdownToggle(attributes: Record<string, string>): VslType | null {
  const hasPopup = attributes['aria-haspopup'];
  if (hasPopup === 'menu' || hasPopup === 'listbox') {
    return 'dropdown_toggle';
  }
  // Дополнительная проверка: combobox + aria-expanded
  const role = attributes['role']?.toLowerCase();
  if (role === 'combobox' && attributes['aria-expanded'] === 'true') {
    return 'dropdown_toggle';
  }
  return null;
}
---

### Task 2: Fix Navigation Timeout

**File to modify:**
- `packages/mcp-server/src/browser/manager.ts` — изменить `waitUntil`

**Changes:**
// packages/mcp-server/src/browser/manager.ts:169-172
async navigate(url: string): Promise<void> {
  const page = await this.getPage();
  await page.goto(url, {
    timeout: this.config.navigationTimeout,
    waitUntil: 'domcontentloaded',  // было: 'networkidle'
  });
}
**Обоснование:** `domcontentloaded` достаточно для извлечения DOM-дерева и не ждёт завершения всех сетевых запросов. Это стандартная практика для SPA и сайтов с постоянными фоновыми запросами.

**Альтернатива (fallback-логика):**
Если нужна более надёжная стратегия:
async navigate(url: string): Promise<void> {
  const page = await this.getPage();
  try {
    await page.goto(url, {
      timeout: this.config.navigationTimeout,
      waitUntil: 'networkidle',
    });
  } catch (error) {
    // Fallback: если networkidle таймаут — пробуем domcontentloaded
    await page.goto(url, {
      timeout: this.config.navigationTimeout,
      waitUntil: 'domcontentloaded',
    });
  }
}
---

## Acceptance Criteria

- [ ] Click and type actions successfully execute on elements with `role="combobox"`.
- [ ] VSL ID correctly maps to Playwright locators for `combobox`, `listbox`, `searchbox`, `spinbutton`, `slider` roles.
- [ ] Navigation to google.com completes successfully without hitting the 30s networkidle timeout.
- [ ] Unit tests pass for new ARIA role mappings.
- [ ] Backward compatibility maintained — existing ARIA role mappings (button, dialog, tab, tabpanel) continue to work.

---

## Testing Strategy

### Unit Tests
- Добавить тесты для новых ARIA-ролей в `src/segmentation/level2.test.ts`.
- Проверить, что существующие тесты не ломаются.

### Integration Tests
- Протестировать DuckDuckGo: открыть `https://duckduckgo.com`, получить snapshot, проверить что combobox типизируется как `input`.
- Протестировать Google: открыть `https://google.com`, проверить что навигация завершается без таймаута.

### Manual Testing
// Пример ручного тестирования через MCP
const snapshot = await vsl_get_snapshot({ url: 'https://duckduckgo.com' });
// Найти combobox в snapshot, проверить что t='input'

const snapshot2 = await vsl_get_snapshot({ url: 'https://google.com' });
// Проверить что snapshot получен без таймаута
---

## Risks & Considerations

1. **Backward compatibility:** Добавление новых ролей не должно сломать существующую логику. `ARIA_ROLE_TYPE_MAP` — это маппинг, добавление новых ключей безопасно.

2. **Type compatibility:** Убедиться что `VslType` включает `'input'` и `'select'`. Проверить `src/types/vsl.ts`.

3. **Performance:** Изменение `waitUntil` с `networkidle` на `domcontentloaded` может привести к тому, что некоторые динамические элементы не загрузятся. Но для извлечения DOM-дерева это не критично — VSL snapshot делается после `domcontentloaded`.

4. **Dropdown toggle:** Если DuckDuckGo использует `role="combobox"` без `aria-haspopup`, то `dropdown_toggle` не определится. Опциональное решение — добавить проверку `role="combobox"` + `aria-expanded`.

---

## References

- `src/segmentation/level2.ts:17-22` — `ARIA_ROLE_TYPE_MAP`
- `src/segmentation/level2.test.ts:14-48` — тесты `resolveAriaRoleType`
- `packages/mcp-server/src/browser/manager.ts:169-172` — `navigate` с `waitUntil: 'networkidle'`
- `src/builder/vslBuilder.ts:203-205` — `dropdown_toggle` определяется через `aria-haspopup`
- `src/executor/resolveTarget.ts:1-15` — VSL ID resolution contract

---

## Notes

- `injectVslIds.ts` работает через indexPath обход по element children — НЕ зависит от ARIA-роли или типа VSL. Проблема combobox не в инжекте, а в типизации и семантике взаимодействия.
- `data-vsl-id` инжектится корректно для всех элементов, включая combobox. Playwright locator `[data-vsl-id="..."]` работает.
- Проблема в том, что агент не знает семантику элемента (что это input с dropdown), потому что `combobox` маппится на `container` вместо `input`.