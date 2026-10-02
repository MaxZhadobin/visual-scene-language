# Fix: visit() TypeError crash in vsl_get_snapshot

## Проблема

`vsl_get_snapshot` падает с `TypeError: Cannot read properties of undefined (reading 'N')` на сложных страницах (например, Wikipedia 'Visual programming language'). Ошибка воспроизводится стабильно для ВСЕХ `detail_level` (low/medium/high/full=true) после `vsl_clear_cache`.

### Баг-1: visit() crash в buildSemanticMap()

Функция `visit()` в `packages/mcp-server/src/tools/getSnapshot.ts` (строки 124-155) обходит дерево DOM-элементов для построения semantic map. При обходе детей (`elem.children`) некоторые элементы могут быть `undefined` или не иметь ожидаемых свойств, что приводит к TypeError.

**Корневая причина:** В `buildSemanticMap()` функция `visit()` не проверяет `child` на `undefined`/`null` перед рекурсивным вызовом. Если `elem.children` содержит `undefined` элементы (возможно из-за edge cases в DOM или сериализации), то `visit(undefined)` падает при обращении к `elem.indexPath`.

### Баг-2: State extraction после click action

Аналогичный crash происходит при извлечении состояния после клика (`vsl_execute_action` с `return_state=true`). Сам клик работает (`success:true`), но получение diff/snapshot после действия ломается.

### Почему vsl_navigate работает

`navigate.ts` импортирует `extractDomTree` из `getSnapshot.ts`, но оборачивает вызов в `try/catch` с graceful fallback — возвращает warning вместо crash. `vsl_get_snapshot` не имеет такой защиты на уровне SDK-вызова.

## Контекст

### Архитектура потока данных

browser.evaluate(extractDomTreeInBrowser)
  → extractDomTree() — разворачивает обёртку, фильтрует malformed elements
  → buildSemanticMap() — строит semantic map (ЗДЕСЬ ПАДАЕТ visit())
  → session.snapshotFromElements() — SDK pipeline: segmentTree → buildVslDocument
  → injectVslIdsIntoDom() — записывает data-vsl-id в DOM
  → filterObjectsByViewport() + filterObjectsByDetailLevel()
  → return VSL JSON
### SDK расположение

SDK `@thinkingos/vsl-sdk` находится в `packages/mcp-server/node_modules/@thinkingos/vsl-sdk`. Это внешний пакет (не workspace-пакет). Минифицированное свойство `'N'` в ошибке — это SDK-внутреннее свойство, к которому обращается `segmentTree()` при обработке элементов без `attributes`.

### Существующие защиты

- `extractDomTree()` уже фильтрует элементы без поля `attributes` (L436-440)
- `filterMalformedElements()` рекурсивно удаляет некорректные элементы (L466-480)
- Но фильтрация происходит ПОСЛЕ `extractDomTreeInBrowser()` — а crash может происходить ВНУТРИ браузерного контекста

## Требования

### 1. Исправить visit() в buildSemanticMap() [ROOT CAUSE FIX]

Добавить проверку на `undefined`/`null` перед обращением к свойствам элемента:

function visit(el: unknown): void {
  if (!el || typeof el !== 'object') return; // ← ДОБАВИТЬ
  const elem = el as { ... };
  if (!elem.indexPath) return;
  // ...
  if (elem.children && Array.isArray(elem.children)) {
    for (const child of elem.children) {
      visit(child); // child может быть undefined
    }
  }
}
### 2. Добавить try/catch в vsl_get_snapshot [DEFENSE-IN-DEPTH]

**Важно:** Try/catch НЕ маскирует ошибки — он логирует их и возвращает partial data + warning.
Root cause исправлен ОТДЕЛЬНО через null checks (пункт 1).

Паттерн (аналогично `vsl_navigate`):
- Если `buildSemanticMap()` падает → `console.error` + продолжить без semantic map
- Если `snapshotFromElements()` падает → вернуть ошибку с понятным сообщением + stack trace
- Warning добавляется в `metadata.warning` для диагностики

Это **defense-in-depth** — если один edge case проскочит через null checks, система не упадёт полностью. Аналогично `vsl_navigate` — там try/catch не мешает находить и фиксить баги.

### 3. Документировать vsl_get_visual

Обновить документацию, чтобы явно указать: `vsl_get_visual` работает ТОЛЬКО с ID из `vsl_get_snapshot` (browser DOM IDs), а НЕ с semantic IDs из `vsl_read_page`.

### 4. Добавить явную маркировку HTTP-пути в vsl_read_page [ID CLARITY]

**Проблема:** HTTP-путь `vsl_read_page` генерирует другие ID (sequential counters), чем browser-путь (indexPath-based). Агент может попытаться использовать HTTP-ID для `vsl_execute_action` — это не сработает, потому что HTTP-путь не инжектит `data-vsl-id` в DOM.

**Решение (Вариант B — выбран пользователем):** Возвращать VSL для HTTP-пути, но с явной маркировкой в metadata.

**Изменения в `readPage.ts` (HTTP-путь, ~строка 271-288):**

const data = {
  url: args.url,
  mode: 'http' as const,
  content: httpResult.textContent,
  vslDocument: replaceIdsInDocument(rawSnapshot as VslDocument, reverseIdMap),
  snapshot: finalSnapshot,
  diff: finalDiff,
  hasDiff,
  metadata: {
    title: httpResult.title,
    wordCount: httpResult.wordCount,
    isSpa: httpResult.isSpa,
    readableApplied: httpResult.readableApplied,
    detail_level: detailLevel,
    // ↓ НОВЫЕ ПОЛЯ ↓
    id_scheme: 'counter',
    warning: 'HTTP mode: IDs are sequential counters (btn_0, btn_1). For interactive actions (click, type), call vsl_get_snapshot to get browser DOM IDs compatible with vsl_execute_action.',
    ...computeVslMetrics(fullSnapshot),
    scrollable,
  },
};
**Почему это работает:**
- Агент видит структуру страницы (есть кнопки, инпуты) — не теряем семантику
- Поле `id_scheme: "counter"` объясняет, почему ID другие
- Warning явно говорит: "для кликов нужен vsl_get_snapshot"
- Не ломает API — VSL всё ещё возвращается

**Анализ ID-схем:**

| Инструмент | Путь | Генератор ID | Формат | Можно кликать? |
|---|---|---|---|---|
| `vsl_get_snapshot` | Browser | SDK `createIdGenerator()` → `tag_indexPath` | `button_0_0_0_2` → `btn_0` | ✅ Да |
| `vsl_read_page` (render) | Browser | **Тот же** SDK pipeline | Те же ID | ✅ Да |
| `vsl_read_page` (HTTP) | HTTP/cheerio | SDK `createIdGenerator(htmlId, type)` | `btn_0`, `lnk_1` (другая нумерация!) | ❌ Нет |

## Ограничения

- Изменения в `packages/mcp-server/src/tools/getSnapshot.ts`
- Изменения в `packages/mcp-server/src/tools/readPage.ts` (HTTP metadata)
- Не ломать `vsl_navigate` и другие инструменты, использующие `extractDomTree`
- Решение должно работать для всех `detail_level` (low, medium, high, full=true)
- Не менять SDK (`@thinkingos/vsl-sdk`) — это внешний пакет

## Acceptance Criteria

- [ ] **AC-1**: `visit()` в `buildSemanticMap()` включает проверку на `undefined`/`null` для каждого элемента и его детей, предотвращая `TypeError: Cannot read properties of undefined`
- [ ] **AC-2**: `vsl_get_snapshot` реализует try/catch вокруг DOM extraction и semantic map building для graceful degradation (возвращает warning вместо crash)
- [ ] **AC-3**: Документация обновлена: `vsl_get_visual` работает только с ID из `vsl_get_snapshot` (browser DOM), не с semantic IDs из `vsl_read_page`
- [ ] **AC-4**: Баг не воспроизводится на Wikipedia 'Visual programming language' после `vsl_clear_cache` для всех `detail_level`
- [ ] **AC-5**: `vsl_navigate` продолжает работать без регрессий
- [ ] **AC-6**: `vsl_execute_action` с `return_state=true` не падает с TypeError на сложных страницах
- [ ] **AC-7**: `vsl_read_page` HTTP-путь возвращает `metadata.id_scheme: "counter"` и `metadata.warning` с инструкцией для агента

## Файлы для изменения

1. `packages/mcp-server/src/tools/getSnapshot.ts` — основной фикс (visit() null checks, try/catch)
2. `packages/mcp-server/src/utils/injectVslIds.ts` — возможно, аналогичная защита в visit() (L103-140)
3. `packages/mcp-server/src/tools/readPage.ts` — добавить `id_scheme` и `warning` в HTTP metadata
4. Документация (README.md или inline JSDoc) — AC-3

## Тестирование

1. `vsl_clear_cache` → `vsl_get_snapshot` на Wikipedia 'Visual programming language' — не должен падать
2. `vsl_execute_action` с click → state extraction — не должен падать
3. Все `detail_level` (low/medium/high/full=true) — работают без ошибок
4. `vsl_navigate` — работает без регрессий
5. `vsl_read_page` на статической странице — возвращает `metadata.id_scheme: "counter"` + warning