# Fix VSL Execute Action Bugs

## 📋 Summary

Исправление трёх багов в инструменте `vsl_execute_action`:
- **CRITICAL-1**: check/uncheck не реализованы (возвращают "not yet implemented")
- **CRITICAL-2**: VSL ID маппинг резолвится в неправильные DOM-элементы
- **MEDIUM-3**: Timeout 5000ms при клике по удалённому элементу

---

## 🔴 CRITICAL-1: check/uncheck не реализованы

### Описание
Документация заявляет поддержку `check`/`uncheck`, но вызов возвращает `"Action check is not yet implemented"`.

### Root Cause
В `packages/mcp-server/src/tools/executeAction.ts`:
- `check` и `uncheck` есть в `VALID_ACTIONS` (строки 44-45)
- **НО** case handlers для них ОТСУТСТВУЮТ в switch statement (строки 421-1105)
- Они падают в `default` case (строка 1106) и возвращают ошибку

### Сравнение с SDK
В `src/executor/actionExecutor.ts` (строки 371-376) эти действия реализованы:
case 'check':
  setChecked(resolveTargetOf(action, options), action, true);
  break;
case 'uncheck':
  setChecked(resolveTargetOf(action, options), action, false);
  break;
### Решение
Добавить case handlers для `check` и `uncheck` в MCP server `executeAction.ts`, используя Playwright API:

case 'check':
case 'uncheck': {
  const shouldBeChecked = args.action === 'check';
  // Frame-aware: используем target.evaluate или browser.evaluate
  if (targetFrame) {
    await browser.evaluateInFrame(targetFrame, ({ sel, checked }: { sel: string; checked: boolean }) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el) {
        if (el.type !== 'checkbox' && el.type !== 'radio') {
          throw new Error(`Element is not a checkbox or radio: ${el.tagName}`);
        }
        el.checked = checked;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, sessionId, { sel: selector, checked: shouldBeChecked });
  } else {
    await browser.evaluate(({ sel, checked }: { sel: string; checked: boolean }) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el) {
        if (el.type !== 'checkbox' && el.type !== 'radio') {
          throw new Error(`Element is not a checkbox or radio: ${el.tagName}`);
        }
        el.checked = checked;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, sessionId, { sel: selector, checked: shouldBeChecked });
  }
  break;
}
---

## 🔴 CRITICAL-2: VSL ID маппинг резолвится в неправильные DOM-элементы

### Описание
`inp_3` (txt:"Search Wikipedia", act:["click","type","clear"]) резолвится в `<input type="radio">` вместо текстового инпута.

### Root Cause
1. **data-vsl-id инжектируется ОДИН РАЗ** при создании snapshot (в `extractDomTreeInBrowser`)
2. Если DOM динамически меняется (SPA, React re-render), indexPath становится невалидным
3. `executeAction` проверяет `hasVslIds` (строка 359) — если true, **переинжект НЕ происходит**
4. Результат: selector `[data-vsl-id="input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0"]` находит неправильный элемент

### Детальный анализ
// executeAction.ts строки 359-375
const hasVslIds = await browser.evaluate(() => {
  return document.querySelector('[data-vsl-id]') !== null;
}, sessionId);

if (!hasVslIds) {
  // Автоматическое создание snapshot — ТОЛЬКО если атрибутов НЕТ
  const extraction = await extractDomTree(browser, sessionId);
  // ...
}
Проблема: проверка `hasVslIds` возвращает true, если ХОТЯ БЫ ОДИН элемент имеет data-vsl-id. Это не гарантирует, что ВСЕ элементы имеют корректные атрибуты.

### Решение
**Вариант A (рекомендуемый)**: Всегда переинжектировать data-vsl-id перед каждым действием
- Убрать проверку `hasVslIds`
- Всегда вызывать `extractDomTree` + `injectVslIdsIntoDom` перед действием
- Минус: дополнительная производительность (evaluate в браузере)

**Вариант B**: Проверять конкретный target_id
- Перед действием проверять, существует ли элемент с `[data-vsl-id="${resolvedId}"]`
- Если не существует — переинжектировать
- Минус: не решает проблему устаревших indexPath

**Вариант C (оптимальный)**: Комбинация — проверять конкретный элемент + валидация tag
// Проверка: существует ли элемент с нужным data-vsl-id И совпадает ли tag
const elementValid = await browser.evaluate(({ sel, expectedTag }: { sel: string; expectedTag: string }) => {
  const el = document.querySelector(sel);
  if (!el) return { exists: false, valid: false };
  const actualTag = el.tagName.toLowerCase();
  return { exists: true, valid: actualTag === expectedTag };
}, sessionId, { sel: selector, expectedTag: expectedTagFromId });

if (!elementValid.exists || !elementValid.valid) {
  // Переинжектировать все data-vsl-id
  const extraction = await extractDomTree(browser, sessionId);
  // ...
}
### Реализация (Вариант C)
1. Извлечь expected tag из resolvedId (формат `tag_indexPath`)
2. Проверить существование элемента с `[data-vsl-id="${resolvedId}"]`
3. Проверить совпадение tag
4. Если проверка не пройдена — переинжектировать

---

## 🟡 MEDIUM-3: Timeout при клике по удалённому элементу

### Описание
Клик по элементу, удалённому из DOM, вызывает timeout 5000ms вместо быстрой ошибки "element not found".

### Root Cause
// executeAction.ts строка 430
await target.locator(selector).click({ timeout: 5000 });
Playwright locator.click() ждёт появления элемента до timeout. Если элемент удалён, ждёт полный timeout.

### Решение
**Вариант A**: Уменьшить timeout до 500ms для быстрого fail
await target.locator(selector).click({ timeout: 500 });
**Вариант B (рекомендуемый)**: Проверять наличие элемента ПЕРЕД кликом
// Быстрая проверка существования элемента
const elementExists = await target.locator(selector).count();
if (elementExists === 0) {
  return {
    status: 'error',
    error: `Element not found: ${args.target_id} (selector: ${selector})`,
  };
}
await target.locator(selector).click({ timeout: 1000 });
**Вариант C**: Комбинация — проверка + уменьшенный timeout
const elementExists = await target.locator(selector).count();
if (elementExists === 0) {
  return {
    status: 'error',
    error: `Element not found: ${args.target_id}. The element may have been removed from the DOM.`,
  };
}
await target.locator(selector).click({ timeout: 1000 });
### Реализация (Вариант C)
Применить ко всем действиям, использующим locator:
- click (строка 430)
- fill/type (строка 499)
- upload (строка 776)

---

## 📁 Затронутые файлы

| Файл | Изменения |
|------|-----------|
| `packages/mcp-server/src/tools/executeAction.ts` | Добавить check/uncheck handlers, переинжект data-vsl-id, проверка существования элемента |

---

## ✅ Acceptance Criteria

1. **AC-1**: `vsl_execute_action` поддерживает `check` и `uncheck` действия без ошибки "not yet implemented"
2. **AC-2**: VSL ID маппинг корректно резолвится в intended DOM элементы (текстовые инпуты вместо radio buttons)
3. **AC-3**: Клик по удалённому DOM элементу возвращает быструю ошибку "element not found" вместо timeout 5000ms
4. **AC-4**: Существующие действия (click, type, clear, etc.) продолжают работать без регрессий
5. **AC-5**: Error messages для отсутствующих элементов понятны и actionable

---

## 🚫 Constraints

- Не ломать существующие действия (click, type, clear, etc.)
- Сохранять backward compatibility с существующими VSL ID маппингами
- Error messages для отсутствующих элементов должны быть понятными

---

## 📊 Priority

| Bug | Priority | Impact |
|-----|----------|--------|
| CRITICAL-1 | 🔴 High | Функциональность полностью недоступна |
| CRITICAL-2 | 🔴 High | Неправильное поведение на динамических страницах |
| MEDIUM-3 | 🟡 Medium | Ухудшение UX, но функциональность работает |

---

## 🧪 Testing Strategy

1. **CRITICAL-1**: Вызвать `{action: "check", target_id: "checkbox_id"}` и проверить успешное выполнение
2. **CRITICAL-2**: Открыть динамическую страницу (Wikipedia), вызвать snapshot, изменить DOM, вызвать fill — проверить корректный резолв
3. **MEDIUM-3**: Вызвать snapshot, удалить элемент из DOM через JS, вызвать click — проверить быструю ошибку

---

## 📝 Implementation Notes

- Все изменения в `packages/mcp-server/src/tools/executeAction.ts`
- Использовать существующие паттерны (frame-aware evaluate, selector construction)
- Добавить логирование для отладки (console.warn для переинжекта)
- Сохранить positional mapping fallback для click (reCAPTCHA support)