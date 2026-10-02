# Fix: vslDocument возвращает длинные ID в vsl_read_page

## Проблема

При вызове `vsl_read_page` поле `vslDocument` в ответе содержит длинные ID (формат `tag_indexPath`, например `button_0_0_0_2_0_0_0`), тогда как поле `snapshot` содержит короткие ID (формат `prefix_counter`, например `btn_0`).

Это создаёт путаницу для LLM-агента: он видит два разных формата ID в одном ответе, что затрудняет взаимодействие с элементами.

### Пример из ответа:

{
  "vslDocument": {
    "objects": [{
      "id": "button_0_0_0_2_0_0_0",  // ← длинный ID
      ...
    }]
  },
  "snapshot": {
    "objects": [{
      "id": "btn_0",  // ← короткий ID
      ...
    }]
  }
}
## Корневая причина

В файле `packages/mcp-server/src/tools/readPage.ts`:

1. **Render path (строки 210-227):**
   - `vslDocument: rawSnapshot` — возвращается сырой snapshot с длинными ID
   - `snapshot: finalSnapshot` — применяется `replaceIdsInDocument()` для коротких ID

2. **HTTP path (строки 270-287):**
   - `vslDocument: httpResult.vslDocument` — возвращается документ из HTTP-извлечения с длинными ID
   - `snapshot: finalSnapshot` — применяется `replaceIdsInDocument()` для коротких ID

Маппинг через `replaceIdsInDocument()` применяется только к `snapshot`, но не к `vslDocument`.

## Решение

Применить `replaceIdsInDocument()` к обоим полям: `vslDocument` и `snapshot`.

### Изменения в `readPage.ts`:

#### Render path (строка 214):
// Было:
vslDocument: rawSnapshot,

// Станет:
vslDocument: replaceIdsInDocument(rawSnapshot, reverseIdMap),
#### HTTP path (строка 274):
// Было:
vslDocument: httpResult.vslDocument,

// Станет:
vslDocument: replaceIdsInDocument(httpResult.vslDocument as VslDocument, reverseIdMap),
## Затронутые файлы

- `packages/mcp-server/src/tools/readPage.ts` — основное исправление

## Критерии приёмки

1. [ ] `vslDocument` в ответе `vsl_read_page` содержит короткие ID (формат `prefix_counter`)
2. [ ] `snapshot` в ответе `vsl_read_page` содержит короткие ID (без изменений)
3. [ ] ID в `vslDocument` и `snapshot` совпадают для одних и тех же элементов
4. [ ] HTTP path возвращает `vslDocument` с короткими ID
5. [ ] Render path возвращает `vslDocument` с короткими ID
6. [ ] Существующие тесты проходят
7. [ ] Добавлен тест на проверку коротких ID в `vslDocument`

## Ограничения

- Не менять логику маппинга в `idMapper.ts` — он работает корректно
- Не менять структуру ответа — только применять маппинг к `vslDocument`
- Сохранить обратную совместимость: `diff` также должен содержать короткие ID (уже работает)

## Контекст

- Маппинг длинных ID в короткие реализован в `src/utils/idMapper.ts`
- Функция `replaceIdsInDocument()` рекурсивно заменяет ID во всём документе
- `reverseIdMap` (longId → shortId) получается из `session.getReverseIdMap()`
- Проблема обнаружена при вызове `vsl_read_page` на habr.com