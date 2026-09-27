# Задача: Расширить scroll API в vsl_execute_action (MCP-сервер)

## Контекст проблемы

В MCP-сервере (`packages/mcp-server/src/tools/executeAction.ts`) действие `scroll` принимает только `"up"` и `"down"` с фиксированным шагом 500px. При этом в SDK (`src/executor/actionExecutor.ts`) уже реализован полный API скролла:
- Направления: `up`, `down`, `left`, `right`
- Опциональный amount через `:amount` (например `"down:300"`)
- Парсинг через `parseScrollValue()` с валидацией

**Ошибка агента:**
{"action": "scroll", "target_id": "div_2", "value": "top"}
→ {"status":"error","error":"Invalid scroll value: top. Valid values: up, down"}
Агент не может:
- Скроллить горизонтально (`left`/`right`)
- Указывать произвольную амплитуду (`down:1000`)
- Использовать `"top"`/`"bottom"` (не поддерживается ни в MCP, ни в SDK)

## Решение

**Вариант 1: Полная совместимость с SDK** — расширить MCP-сервер до уровня `actionExecutor.ts`.

### Изменения в `packages/mcp-server/src/tools/executeAction.ts`

#### 1. Валидация scroll value (строки 179–188)

**Было:**
if (args.action === 'scroll' && args.value !== undefined) {
  const VALID_SCROLL_VALUES = ['up', 'down'];
  if (!VALID_SCROLL_VALUES.includes(args.value)) {
    return { status: 'error', error: 'Invalid scroll value: ...' };
  }
}
**Стало:**
if (args.action === 'scroll' && args.value !== undefined) {
  const SCROLL_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
  const parts = args.value.trim().split(':');
  const dir = parts[0] ?? '';
  const amountPart = parts[1];
  
  if (!SCROLL_DIRECTIONS.has(dir)) {
    return {
      status: 'error',
      error: `Invalid scroll direction: "${dir}". Valid: up, down, left, right. Optional amount: "down:300"`
    };
  }
  if (parts.length > 2) {
    return { status: 'error', error: 'Invalid scroll value format. Use "dir" or "dir:amount" (e.g. "down:300")' };
  }
  if (amountPart !== undefined && !/^\d+(?:\.\d+)?$/.test(amountPart)) {
    return { status: 'error', error: `Invalid scroll amount: "${amountPart}". Must be a positive number` };
  }
}
#### 2. Исполнение scroll (строки 279–289)

**Было:**
case 'scroll':
  await browser.evaluate((val: string) => {
    if (val === 'down') {
      window.scrollBy(0, 500);
    } else if (val === 'up') {
      window.scrollBy(0, -500);
    }
  }, args.value || 'down');
  await page.waitForTimeout(50);
  break;
**Стало:**
case 'scroll': {
  const DEFAULT_SCROLL_AMOUNT = 500; // MCP default (SDK uses 300, но MCP работает с реальным браузером)
  const scrollValue = args.value || 'down';
  const parts = scrollValue.trim().split(':');
  const dir = parts[0];
  const amount = parts[1] !== undefined ? Number(parts[1]) : DEFAULT_SCROLL_AMOUNT;
  
  const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
  const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
  
  await browser.evaluate(({ dx, dy }: { dx: number; dy: number }) => {
    window.scrollBy(dx, dy);
  }, { dx, dy });
  await page.waitForTimeout(50);
  break;
}
#### 3. Обновление описания инструмента (MCP tool description)

В описании `vsl_execute_action` обновить секцию scroll:

**Было:**
scroll (прокрутка)
**Стало:**
scroll (прокрутка: "up", "down", "left", "right" или с амплитудой "down:300", "left:500")
### Обновление документации MCP-сервера

Если есть README или описание инструментов — обновить примеры:
{"action": "scroll", "target_id": "div_2", "value": "down:1000"}
{"action": "scroll", "target_id": "div_2", "value": "left"}
{"action": "scroll", "target_id": "div_2", "value": "right:200"}
## Acceptance Criteria

- [ ] Валидация принимает `up`, `down`, `left`, `right` как направления
- [ ] Валидация принимает формат `dir:amount` (например `down:300`)
- [ ] Валидация отклоняет невалидные направления с понятным сообщением
- [ ] Валидация отклоняет невалидный amount (не число, отрицательное)
- [ ] Исполнение корректно вычисляет dx/dy для всех 4 направлений
- [ ] Дефолтный amount = 500px (если не указан)
- [ ] Обновлённое описание инструмента в MCP tool definition
- [ ] Обратная совместимость: `value: "up"` и `value: "down"` работают как раньше

## Implementation Steps

1. Обновить валидацию scroll value в `executeAction.ts` (строки 179–188)
2. Обновить исполнение scroll в `executeAction.ts` (строки 279–289)
3. Обновить описание инструмента в MCP server registration (если есть отдельное описание)
4. Добавить тесты на новые форматы scroll value
5. Проверить обратную совместимость (up/down без amount)

## Constraints

- Сохранить обратную совместимость с существующими вызовами `"up"`/`"down"`
- Дефолтный amount в MCP = 500px (не 300px как в SDK, т.к. MCP работает с реальным браузером)
- Сообщения об ошибках — на английском (публичный API)
- Не менять SDK (`actionExecutor.ts`) — только MCP-сервер

## Decision

**Выбран Вариант 1**: полная совместимость с SDK `actionExecutor.ts` — `up/down/left/right` + опциональный `:amount`.

**Обоснование:**
- Единый API между SDK и MCP — меньше когнитивной нагрузки на агента
- Горизонтальный скролл нужен для таблиц, каруселей, horizontal scroll containers
- Произвольная амплитуда позволяет агенту адаптироваться к размеру viewport
- Парсинг уже реализован в SDK (`parseScrollValue`) — можно переиспользовать логику

**Не поддерживается:**
- `"top"`/`"bottom"` — нет в SDK, агент может использовать `scrollTo` через `evaluate` если нужно
- Скролл к элементу (`scrollIntoView`) — отдельная фича, не входит в scope