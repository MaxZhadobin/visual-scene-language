# Fix: console.log() в stdout ломает JSON-RPC парсинг MCP клиента

## Проблема

VSL MCP сервер пишет логи (`[VSL] Found...`, `[VSL] ✅ Matched...`) в **stdout** вместо **stderr**. 

`StdioClientTransport` из MCP SDK ожидает в stdout **только JSON-RPC сообщения** и пытается парсить каждую строку как JSON. Когда видит `[VSL]...` — падает с ошибкой парсинга.

### MCP протокол строго разделяет каналы:

- **stdout** — только JSON-RPC (requests, responses, notifications)
- **stderr** — логи, отладочная информация

## Контекст

Проблема обнаружена в файле `packages/mcp-server/src/tools/getSnapshot.ts` в секции iframe extraction.

### Найденные проблемы:

**7 вызовов `console.log()`** (все в `getSnapshot.ts`):
1. Строка 501: `console.log(\`[VSL] Found ${iframeElements.length} iframe elements:\`);`
2. Строка 503: `console.log(\`  - URL: ${iframe.url}, name: ${iframe.name}, id: ${iframe.id}\`);`
3. Строка 527: `console.log(\`[VSL] Available frames:\`, allFrames.map(f => f.url()));`
4. Строка 530: `console.log(\`[VSL] ✅ Matched Playwright frame for iframe: ${iframeInfo.url} → ${frame.url()}\`);`
5. Строка 553: `console.log(\`[VSL] ✅ Successfully extracted DOM from iframe: ${iframeInfo.url} (${iframeDoc.objects.length} objects)\`);`
6. Строка 586: `console.log(\`[VSL] Adding ${iframeSubDocs.length} iframe objects to snapshot\`);`

**Безопасные вызовы** (не требуют изменений):
- `console.warn()` на строках 526 и 556 — в Node.js пишут в stderr
- 18 вызовов `console.error()` в других файлах проекта — уже корректны
- 0 вызовов `process.stdout.write()` — проблем нет

## Требования

### Функциональные требования:

1. **Заменить все `console.log()` на `console.error()`** в файле `packages/mcp-server/src/tools/getSnapshot.ts`
2. **Сохранить всю логику и функциональность** — меняется только канал вывода
3. **Не изменять текст логов** — только метод вывода

### Нефункциональные требования:

1. **Не изменять core logic** MCP server tools
2. **Строгое соблюдение MCP протокола** — разделение stdout/stderr
3. **Не допустить утечки чувствительной информации** в stderr логи

## Решение

Заменить все 6 вызовов `console.log()` на `console.error()` в файле `packages/mcp-server/src/tools/getSnapshot.ts`:

// Было:
console.log(`[VSL] Found ${iframeElements.length} iframe elements:`);

// Станет:
console.error(`[VSL] Found ${iframeElements.length} iframe elements:`);
Аналогично для всех остальных вызовов.

## Критерии приёмки

- [ ] Все `console.log()` и `process.stdout.write()` вызовы в VSL MCP сервере заменены на `console.error()` и `process.stderr.write()`
- [ ] MCP клиент больше не выбрасывает JSON parse errors из-за лог-сообщений в stdout
- [ ] Логи и отладочная информация корректно пишутся в stderr
- [ ] Только валидные JSON-RPC сообщения пишутся в stdout

## Ограничения

- Не изменять core logic или функциональность MCP server tools
- Обеспечить строгое соблюдение MCP протокола для разделения stdout/stderr
- Не допускать утечки чувствительной информации в stderr логи

## Затронутые файлы

- `packages/mcp-server/src/tools/getSnapshot.ts` — 6 замен `console.log()` → `console.error()`

## Тестирование

После внесения изменений:
1. Запустить MCP сервер
2. Выполнить операции, которые вызывают iframe extraction логи
3. Проверить, что логи появляются в stderr, а не в stdout
4. Убедиться, что MCP клиент не выбрасывает JSON parse errors

## Приоритет

**Высокий** — проблема блокирует нормальную работу MCP клиента при наличии iframe на странице.