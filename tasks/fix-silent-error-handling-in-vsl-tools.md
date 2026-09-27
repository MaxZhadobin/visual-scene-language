# Fix Silent Error Handling in VSL MCP Tools

## Expected Flow

### vsl_navigate
1. Валидация URL
2. **browser.navigate(url)** — ЖДЁТ полной загрузки (waitUntil: 'networkidle')
3. Получает title
4. Извлекает DOM через extractDomTreeInBrowser
5. Обрабатывает через VSL SDK (session.snapshotFromElements)
6. **Возвращает snapshot агенту**

**Ожидаемое поведение:**
- Успех → `{status: "success", data: {url, title, snapshot: {...}}}`
- Ошибка извлечения → `{status: "success", data: {url, title, snapshot: null}, warning: "Failed to extract snapshot: ..."}`

### vsl_execute_action
1. Валидация аргументов
2. Проверка snapshot
3. Lazy navigation (если URL изменился)
4. Поиск элемента по target_id
5. Выполнение действия (click, fill, etc.)
6. **ЖДЁТ стабилизации DOM** (100ms timeout)
7. Извлекает обновлённый DOM
8. Вычисляет diff через VSL SDK
9. **Возвращает diff + snapshot агенту**

**Ожидаемое поведение:**
- Успех → `{status: "success", data: {action, target_id, success: true, state: {diff: {...}, snapshot: {...}}}}`
- Ошибка извлечения → `{status: "success", data: {action, target_id, success: true, state: {error: "..."}, warning: "State extraction failed: ..."}}`

---

## Problem Statement

Агент вызывает `vsl_navigate` или `vsl_execute_action` и получает `{status: "success"}` без snapshot/diff, даже когда извлечение состояния страницы не удалось. Это приводит к тому, что агент не видит изменений на странице и не может продолжать работу.

## Root Cause Analysis

### 1. `navigate.ts:82-100` — Snapshot Extraction Silently Fails

let snapshot: unknown;
try {
  const elements = await browser.evaluate(extractDomTreeInBrowser);
  const viewport = await browser.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const input: SnapshotInput = {
    viewport: viewport as { width: number; height: number },
    url: args.url,
    title: title as string,
    timestamp: new Date().toISOString(),
  };
  session.snapshotFromElements(elements as unknown[], input);
  snapshot = session.getSnapshot();
} catch {
  // Snapshot extraction is best-effort  ← PROBLEM: Error silently ignored
}
**Проблема:** Если `extractDomTreeInBrowser` или `snapshotFromElements` падает с ошибкой, агент получает `{status: "success", data: {url, title, snapshot: undefined}}`. Агент не знает, что snapshot не был получен.

### 2. `executeAction.ts:85-116` — `getStateAfterAction` Returns `undefined` on Error

async function getStateAfterAction(
  session: ServerSession,
  browser: BrowserManager,
  url: string,
): Promise<{ diff?: unknown; snapshot?: unknown } | undefined> {
  try {
    const elements = await browser.evaluate(extractDomTreeInBrowser);
    const viewport = await browser.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const input: SnapshotInput = {
      viewport: viewport as { width: number; height: number },
      url,
      title: '',
      timestamp: new Date().toISOString(),
    };
    session.snapshotFromElements(elements as unknown[], input);
    const diff = session.getDiff();
    const snapshot = session.getSnapshot();
    return { diff, snapshot };
  } catch (error) {
    console.warn('Failed to get state after action:', error);
    return undefined;  ← PROBLEM: Returns undefined, caller doesn't know why
  }
}
**Проблема:** Функция возвращает `undefined` при ошибке, но caller не проверяет, почему state не был получен.

### 3. `executeAction.ts:435-444` — State Extraction Errors Silently Ignored (Default Case)

try {
  const currentUrl = await browser.evaluate(() => window.location.href);
  const state = await getStateAfterAction(session, browser, currentUrl as string);
  if (state && result.data) {
    result.data.state = state;
  }
} catch {
  // Gracefully ignore getStateAfterAction errors  ← PROBLEM: Error silently ignored
}
**Проблема:** Если `getStateAfterAction` падает (или возвращает `undefined`), агент получает `{status: "success", data: {action, target_id, success: true}}` без `state`. Агент не знает, что state не был получен.

### 4. `executeAction.ts:348-358` — Download Case

Аналогичная проблема в download case — ошибки от `getStateAfterAction` молча игнорируются.

### 5. `executeAction.ts:403-413` — Upload Case

Аналогичная проблема в upload case — ошибки от `getStateAfterAction` молча игнорируются.

## Impact

- Агент получает `{status: "success"}` без snapshot/diff
- Агент не может увидеть изменения на странице
- Агент тратит дополнительные ходы на вызов `vsl_get_snapshot` или `vsl_get_diff`
- В некоторых случаях агент может зациклиться, не понимая, что действие не сработало

## Solution

### Principle

**Не молчать об ошибках.** Если state extraction не удался — агент должен знать об этом. Но мы не должны падать с ошибкой, если само действие выполнилось успешно.

### Approach

1. **Добавить `warning` поле в результат** — если state extraction не удался, но действие выполнилось успешно.
2. **Логировать ошибки** — использовать `console.error` вместо `console.warn` для критических ошибок.
3. **Возвращать `state: null` вместо `undefined`** — чтобы агент явно видел, что state не был получен.
4. **Добавить `error_message` в `state`** — если state extraction не удался, включить причину.

### Changes

#### 1. `navigate.ts` — Snapshot Extraction

**Текущий код:**
let snapshot: unknown;
try {
  // ... extraction logic
} catch {
  // Snapshot extraction is best-effort
}
**Новый код:**
let snapshot: unknown;
let snapshotError: string | undefined;
try {
  const elements = await browser.evaluate(extractDomTreeInBrowser);
  const viewport = await browser.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const input: SnapshotInput = {
    viewport: viewport as { width: number; height: number },
    url: args.url,
    title: title as string,
    timestamp: new Date().toISOString(),
  };
  session.snapshotFromElements(elements as unknown[], input);
  snapshot = session.getSnapshot();
} catch (error) {
  snapshotError = `Failed to extract snapshot: ${error instanceof Error ? error.message : String(error)}`;
  console.error('[vsl_navigate]', snapshotError, error);
}

const data = {
  url: args.url,
  title: title as string,
  snapshot,
  ...(snapshotError && { warning: snapshotError }),
};
#### 2. `executeAction.ts` — `getStateAfterAction`

**Текущий код:**
} catch (error) {
  console.warn('Failed to get state after action:', error);
  return undefined;
}
**Новый код:**
} catch (error) {
  const errorMessage = `Failed to get state after action: ${error instanceof Error ? error.message : String(error)}`;
  console.error('[vsl_execute_action]', errorMessage, error);
  return { error: errorMessage };
}
**Изменение типа возврата:**
export interface StateAfterAction {
  diff?: unknown;
  snapshot?: unknown;
  error?: string;
}

async function getStateAfterAction(
  session: ServerSession,
  browser: BrowserManager,
  url: string,
): Promise<StateAfterAction> {
  // ...
}
#### 3. `executeAction.ts` — State Extraction in Action Handlers

**Текущий код:**
try {
  const currentUrl = await browser.evaluate(() => window.location.href);
  const state = await getStateAfterAction(session, browser, currentUrl as string);
  if (state && result.data) {
    result.data.state = state;
  }
} catch {
  // Gracefully ignore getStateAfterAction errors
}
**Новый код:**
try {
  const currentUrl = await browser.evaluate(() => window.location.href);
  const state = await getStateAfterAction(session, browser, currentUrl as string);
  if (result.data) {
    if (state.error) {
      result.data.state = { error: state.error };
      result.data.warning = `State extraction failed: ${state.error}`;
    } else {
      result.data.state = state;
    }
  }
} catch (error) {
  const errorMessage = `Unexpected error getting state: ${error instanceof Error ? error.message : String(error)}`;
  console.error('[vsl_execute_action]', errorMessage, error);
  if (result.data) {
    result.data.warning = errorMessage;
  }
}
#### 4. `executeAction.ts` — Download and Upload Cases

Аналогичные изменения для download (lines 348-358) и upload (lines 403-413) cases.

### Result Structure

**Успех с state:**
{
  "status": "success",
  "data": {
    "action": "click",
    "target_id": "btn_1",
    "success": true,
    "state": {
      "diff": { ... },
      "snapshot": { ... }
    }
  }
}
**Успех без state (ошибка извлечения):**
{
  "status": "success",
  "data": {
    "action": "click",
    "target_id": "btn_1",
    "success": true,
    "state": {
      "error": "Failed to extract DOM: ..."
    },
    "warning": "State extraction failed: Failed to extract DOM: ..."
  }
}
**Навигация без snapshot:**
{
  "status": "success",
  "data": {
    "url": "https://example.com",
    "title": "Example",
    "snapshot": null,
    "warning": "Failed to extract snapshot: ..."
  }
}
## Acceptance Criteria

1. ✅ `getStateAfterAction` возвращает `{error: string}` вместо `undefined` при ошибке
2. ✅ `navigate.ts` добавляет `warning` поле в результат, если snapshot extraction не удался
3. ✅ `executeAction.ts` добавляет `warning` поле в результат, если state extraction не удался
4. ✅ Все ошибки логируются через `console.error` с префиксом `[vsl_*]`
5. ✅ Агент получает явное указание, что state не был получен (через `state.error` или `warning`)
6. ✅ Backward compatibility: если state extraction успешен, структура ответа не меняется

## Constraints

- Не менять core logic инструментов
- Не менять сигнатуры публичных API (только добавлять опциональные поля)
- Обеспечить backward compatibility
- Добавить логирование для отладки

## Testing Strategy

1. **Unit tests:**
   - Mock `browser.evaluate` to throw error → verify `warning` field is present
   - Mock `session.snapshotFromElements` to throw error → verify `warning` field is present
   - Verify successful case still returns `state` without `warning`

2. **Integration tests:**
   - Call `vsl_navigate` with invalid URL → verify error message
   - Call `vsl_execute_action` on page that crashes DOM extraction → verify `warning` field
   - Verify agent receives proper error information

## Files to Modify

1. `packages/mcp-server/src/tools/navigate.ts`
2. `packages/mcp-server/src/tools/executeAction.ts`

## Implementation Steps

1. [ ] Update `getStateAfterAction` return type and error handling
2. [ ] Update `navigate.ts` to add `warning` field on snapshot extraction failure
3. [ ] Update `executeAction.ts` default case to handle `state.error`
4. [ ] Update `executeAction.ts` download case to handle `state.error`
5. [ ] Update `executeAction.ts` upload case to handle `state.error`
6. [ ] Add unit tests for error scenarios
7. [ ] Verify backward compatibility with existing tests
8. [ ] Update documentation (if needed)

## References

- [ref:53cb7173-70e9-46c2-ad40-ef2242920705] — `navigate.ts:82-100` silent error handling
- [ref:47b6c7a5-9565-4255-8602-e20864ec9ff0] — `executeAction.ts:435-444` silent error handling
- [ref:0f1e43fe-67ec-4271-aceb-6ed952cfa295] — `executeAction.ts:85-116` `getStateAfterAction` returns undefined