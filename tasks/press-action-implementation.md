# Task: Реализация 'press' action в MCP-сервере

## Контекст

**Проблема:** Агент не может отправить форму на Google, так как:
- `click` по кнопке submit заблокирован оверлеем
- `press` action не реализован в MCP-сервере (возвращает ошибку "Action press is not yet implemented")

**Текущее состояние кода:**
- `press` есть в `VALID_ACTIONS` (packages/mcp-server/src/tools/executeAction.ts:42)
- Но отсутствует в `switch` statement (строки 274-451)
- При вызове попадает в `default` case и возвращает ошибку

**Решение:** Реализовать `press` action через Playwright `keyboard.press()` API

---

## Acceptance Criteria

- [ ] Действие 'press' реализовано в MCP-сервере (packages/mcp-server/src/tools/executeAction.ts)
- [ ] press принимает value параметр с названием клавиши (Enter, Tab, Escape и т.д.)
- [ ] press использует Playwright keyboard.press() API для корректной эмуляции нажатия
- [ ] Отправка форм работает через press Enter на input/button элементах
- [ ] Отсутствие регрессий в уже реализованных действиях (click, type, scroll и др.)

---

## Constraints

- Следовать существующей архитектуре executeAction.ts (switch statement pattern)
- Использовать Playwright keyboard API (page.keyboard.press())
- Не нарушать обратную совместимость с другими действиями
- Добавить валидацию value параметра (обязателен для press)
- Обновить документацию в MCP tool description

---

## Implementation Plan

### Шаг 1: Добавить валидацию value для press

**Файл:** `packages/mcp-server/src/tools/executeAction.ts`

**Место:** После валидации `return_state` (строка 177), добавить блок валидации для press:

// Валидация value для press (DEC-XXX)
if (args.action === 'press' && args.value !== undefined) {
  if (typeof args.value !== 'string') {
    return {
      status: 'error',
      error: 'value must be a string for press action',
    };
  }
}
**Обоснование:** press требует обязательный value параметр с названием клавиши.

---

### Шаг 2: Реализовать case 'press' в switch statement

**Файл:** `packages/mcp-server/src/tools/executeAction.ts`

**Место:** После case 'blur' (строка 344), добавить новый case:

case 'press': {
  if (!args.value) {
    return {
      status: 'error',
      error: 'value is required for press action (key name, e.g. "Enter", "Tab", "Escape")',
    };
  }
  await page.keyboard.press(args.value, { delay: 0 });
  await page.waitForTimeout(50); // Даём время на обработку события
  break;
}
**Обоснование:**
- `page.keyboard.press()` — нативный Playwright API для эмуляции нажатия клавиши
- `delay: 0` — мгновенное нажатие (можно добавить параметр для задержки в будущем)
- `waitForTimeout(50)` — даём время на обработку события (аналогично другим действиям)

**Поддерживаемые клавиши (Playwright Key Definitions):**
- Enter, Tab, Escape, Space, Backspace, Delete
- ArrowUp, ArrowDown, ArrowLeft, ArrowRight
- Home, End, PageUp, PageDown
- F1-F12
- И другие (полный список: https://playwright.dev/docs/api/class-keyboard)

---

### Шаг 3: Обновить документацию в MCP tool description

**Файл:** `packages/mcp-server/src/index.ts` (или где определены tool descriptions)

**Изменение:** Добавить описание действия press в список поддерживаемых действий:

Поддерживаемые действия: click, type, fill, scroll, select, hover, focus, blur, check, uncheck, press, download, upload.

press — нажатие клавиши на клавиатуре. Требует value параметр с названием клавиши (например, "Enter", "Tab", "Escape").
Используется для отправки форм (Enter), навигации (Tab), закрытия модальных окон (Escape) и других клавиатурных взаимодействий.
---

### Шаг 4: Добавить тесты

**Файл:** `packages/mcp-server/test/executeAction.test.ts` (или аналогичный)

**Тесты:**

describe('press action', () => {
  it('should press Enter key', async () => {
    const result = await handleExecuteAction(
      { action: 'press', target_id: 'input_search', value: 'Enter' },
      browser,
      session
    );
    expect(result.status).toBe('success');
  });

  it('should require value parameter', async () => {
    const result = await handleExecuteAction(
      { action: 'press', target_id: 'input_search' },
      browser,
      session
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('value is required');
  });

  it('should validate value type', async () => {
    const result = await handleExecuteAction(
      { action: 'press', target_id: 'input_search', value: 123 as any },
      browser,
      session
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('value must be a string');
  });
});
---

## Testing Checklist

- [ ] press Enter на input поле отправляет форму
- [ ] press Tab перемещает фокус между элементами
- [ ] press Escape закрывает модальные окна
- [ ] press ArrowDown/ArrowUp работает в dropdown/select
- [ ] Отсутствие регрессий: click, type, scroll, select работают как раньше
- [ ] Валидация: press без value возвращает ошибку
- [ ] Валидация: press с невалидным типом value возвращает ошибку

---

## References

- Playwright Keyboard API: https://playwright.dev/docs/api/class-keyboard
- Playwright keyboard.press(): https://playwright.dev/docs/api/class-keyboard#keyboard-press
- Key definitions: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/usKeyboardLayout.ts
- Текущий код: `packages/mcp-server/src/tools/executeAction.ts`

---

## Notes

**Альтернативные решения (отклонены):**
- Использовать `submit` action вместо `press` — реализован в executor, но не в MCP
- Использовать `click` по submit кнопке — может быть заблокирован оверлеем

**Почему press лучше:**
- Универсальное решение для всех клавиатурных взаимодействий
- Работает даже когда click заблокирован (оверлей, disabled состояние)
- Соответствует поведению пользователя (нажатие Enter для отправки формы)

---

## Implementation Notes

**Важно:** `target_id` для press action не используется (клавиатурные события глобальные), но оставляем для совместимости с API. В будущем можно оптимизировать, чтобы не требовать target_id для press.

**Порядок реализации:**
1. Добавить валидацию value
2. Реализовать case 'press' в switch
3. Обновить документацию
4. Добавить тесты
5. Проверить на реальных сценариях (Google Forms, login forms)

---

**Создано:** 27.09.2026
**Автор:** TaoCoder (AI agent)
**Статус:** Ready for implementation