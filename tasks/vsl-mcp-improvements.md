# VSL MCP Server — Улучшения и исправления

**Дата:** 26.09.2026  
**Статус:** Draft  
**Приоритет:** High

## Контекст

Проведён анализ исходников VSL MCP server (`/opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server/dist/index.js`, 1927 строк) и тестирование на реальном сайте (Wikipedia). Выявлены критические проблемы и области для улучшения.

---

## 🔴 Критические проблемы

### 1. execute_action не возвращает обновлённое состояние страницы

**Проблема:**  
`vsl_execute_action` (L524-531) возвращает только:
{
  "status": "success",
  "data": {
    "action": "click",
    "target_id": "a_3_0_2_0_3_1_0_0_6_0_3_1_0_0_0_1",
    "success": true
  }
}
**Почему это плохо:**  
- Агент не видит, что изменилось после действия (новая страница, обновлённый DOM, модальное окно)
- Нужно вручную вызывать `vsl_get_snapshot` или `vsl_get_diff` после каждого действия
- Увеличивается количество вызовов и время выполнения

**Предложение:**  
Добавить опциональный параметр `return_state: boolean` (default: false):
{
  "action": "click",
  "target_id": "btn_1",
  "return_state": true
}
При `return_state: true` возвращать:
{
  "status": "success",
  "data": {
    "action": "click",
    "target_id": "btn_1",
    "success": true,
    "diff": { /* vsl_get_diff результат */ },
    "snapshot": { /* опционально, если нужен полный snapshot */ }
  }
}
**Сложность:** Medium  
**Файлы:** `src/tools/executeAction.ts`

---

### 2. vsl_get_visual не работает после навигации/действий

**Проблема:**  
`vsl_get_visual` (L567-575) ищет элементы через `[data-vsl-id="${element_id}"]` в DOM. Атрибуты `data-vsl-id` инжектятся только при вызове `vsl_get_snapshot` (L204-230) и **устаревают** после:
- Навигации на другую страницу
- Кликов, которые изменяют DOM (модальные окна, динамический контент)
- Любых мутаций DOM (сдвиг индексов детей)

**Пример ошибки:**
Error: Element not found: img_3_0_2_0_3_1_0_0_6_0_3_1_0_0_0_1. 
Note: vsl_get_visual works with IDs from vsl_get_snapshot (browser DOM), 
not vsl_read_page (semantic IDs).
**Почему это плохо:**  
- Агент должен помнить, что после каждого действия нужно вызывать `vsl_get_snapshot` заново
- ID генерируются как путь индексов в DOM (например, `div_3_0_2_0_3_1_0_0_6_0_3_1_0_0_0_1`), что хрупко
- Ошибка неочевидна для пользователя

**Предложение (варианты):**

**Вариант A — Автообновление snapshot:**  
Добавить параметр `auto_refresh: boolean` (default: false):
{
  "element_id": "img_3_0_2_0_3_1_0_0_6_0_3_1_0_0_0_1",
  "auto_refresh": true
}
При `auto_refresh: true` автоматически вызывать `vsl_get_snapshot` перед поиском элемента.

**Вариант B — Улучшенная ошибка:**  
Если элемент не найден, возвращать более полезную ошибку:
{
  "error": "Element not found. Possible causes:",
  "suggestions": [
    "Call vsl_get_snapshot to refresh DOM IDs",
    "Element may have been removed from DOM",
    "DOM structure changed after navigation/action"
  ]
}
**Вариант C — Стабильные ID:**  
Генерировать ID на основе семантических атрибутов (data-testid, aria-label, role) вместо индексного пути. Это требует изменений в snapshot generator.

**Рекомендация:** Реализовать Вариант A + Вариант B. Вариант C — долгосрочное улучшение.

**Сложность:** Medium (A+B), High (C)  
**Файлы:** `src/tools/getVisual.ts`, `src/tools/snapshot.ts`

---

### 3. Lazy text loading НЕ реализован

**Проблема:**  
Tool `vsl_get_text_block` зарегистрирован (L1309-1321) и описан как работающий с `txt_ref` из lazy text loading (M1.7), но **сама функциональность не реализована**:
- Поиск `txt_preview|txt_ref|truncated` дал 0 результатов
- Поиск `text_blocks|textBlocks|tb_` дал 0 результатов

**Почему это плохо:**  
- Tool `vsl_get_text_block` существует, но не работает
- Длинные тексты (>200 символов) включаются в основной JSON, увеличивая размер
- Агент не может использовать lazy loading для экономии токенов

**Предложение:**  
Реализовать lazy text loading в snapshot generator:
1. При генерации snapshot проверять длину текста
2. Если текст > 200 символов, заменять на:
      {
     "id": "txt_3_0_2",
     "type": "text",
     "txt_preview": "First 50 characters...",
     "txt_ref": "tb_001"
   }
   3. Хранить полные тексты в `text_blocks` map:
      {
     "text_blocks": {
       "tb_001": "Full text content..."
     }
   }
   4. Реализовать `handleGetTextBlock` для возврата полного текста по `txt_ref`

**Сложность:** High  
**Файлы:** `src/tools/snapshot.ts`, `src/tools/getTextBlock.ts` (новый)

---

### 4. Метрики токенов не добавляются в ответы

**Проблема:**  
Пользователь запрашивал добавить метаданные о размере JSON в токенах в ответ каждого вызова, но поиск `token|tokenCount` дал 0 результатов.

**Почему это плохо:**  
- Агент не видит, сколько токенов потребляет каждый вызов
- Невозможно оптимизировать использование токенов
- Пользователь не может отслеживать расход

**Предложение:**  
Добавить в каждый ответ метаданные:
{
  "status": "success",
  "data": { /* ... */ },
  "metadata": {
    "json_size_bytes": 45230,
    "estimated_tokens": 11307,
    "object_count": 342,
    "timestamp": "2026-09-26T07:15:23.456Z"
  }
}
**Алгоритм оценки токенов:**
- Использовать формулу: `tokens ≈ bytes / 4` (приблизительно для английского текста)
- Или использовать библиотеку типа `tiktoken` для точного подсчёта

**Сложность:** Low  
**Файлы:** `src/utils/responseFormatter.ts` (новый), все `src/tools/*.ts`

---

## 🟡 Улучшения

### 5. Улучшить обработку ошибок

**Проблема:**  
Ошибки часто неинформативны:
Error: Element not found: img_3_0_2_0_3_1_0_0_6_0_3_1_0_0_0_1
**Предложение:**  
Добавить контекст в ошибки:
{
  "error": "Element not found",
  "element_id": "img_3_0_2_0_3_1_0_0_6_0_3_1_0_0_0_1",
  "possible_causes": [
    "DOM structure changed after navigation/action",
    "Element was removed from DOM",
    "Snapshot is outdated"
  ],
  "suggestions": [
    "Call vsl_get_snapshot to refresh DOM IDs",
    "Verify element still exists on page"
  ],
  "last_snapshot_time": "2026-09-26T07:10:15.123Z"
}
**Сложность:** Low  
**Файлы:** `src/utils/errorHandler.ts` (новый)

---

### 6. Компрессия/агрегация VSL JSON для сложных страниц

**Проблема:**  
Wikipedia генерирует ~15-20K токенов на snapshot. Для сложных страниц это слишком много.

**Предложение (реалистичные стратегии):**

**Стратегия A — Фильтрация невидимых элементов:**
- Пропускать элементы с `display: none`, `visibility: hidden`, `opacity: 0`
- Пропускать элементы вне viewport (опционально)

**Стратегия B — Агрегация повторяющихся элементов:**
- Группировать одинаковые элементы (например, списки, таблицы)
- Возвращать шаблон + данные:
    {
    "type": "list",
    "template": { "type": "li", "text": "{item}" },
    "items": ["Item 1", "Item 2", "..."]
  }
  **Стратегия C — Уровни детализации:**
- Добавить параметр `detail_level: "low" | "medium" | "high"` (default: "high")
- `low`: только интерактивные элементы (кнопки, ссылки, input)
- `medium`: интерактивные + заголовки + параграфы
- `high`: все элементы (текущее поведение)

**Стратегия D — Ленивая загрузка детей:**
- Возвращать только первые 2 уровня иерархии
- Добавлять параметр `depth: number` для контроля глубины
- Позволять догружать детей по запросу: `vsl_get_children(parent_id)`

**Рекомендация:** Реализовать Стратегию C (уровни детализации) + Стратегию A (фильтрация невидимых). Это даст наибольший выигрыш при минимальной сложности.

**Сложность:** Medium (A+C), High (B+D)  
**Файлы:** `src/tools/snapshot.ts`, `src/utils/compressor.ts` (новый)

---

### 7. Добавить валидацию input параметров

**Проблема:**  
Некоторые tools не валидируют входные параметры, что приводит к неочевидным ошибкам.

**Предложение:**  
Добавить строгую валидацию:
function validateExecuteAction(args: any) {
  if (!args.action) throw new ValidationError("action is required");
  if (!["click", "type", "fill", "scroll", "select"].includes(args.action)) {
    throw new ValidationError(`Invalid action: ${args.action}`);
  }
  if (!args.target_id) throw new ValidationError("target_id is required");
  if (["type", "fill", "select"].includes(args.action) && !args.value) {
    throw new ValidationError(`value is required for action: ${args.action}`);
  }
}
**Сложность:** Low  
**Файлы:** `src/utils/validators.ts` (новый), все `src/tools/*.ts`

---

## 🟢 Опциональные улучшения

### 8. Кеширование snapshot

**Проблема:**  
Каждый вызов `vsl_get_snapshot` генерирует новый snapshot, даже если страница не изменилась.

**Предложение:**  
Добавить кеширование с TTL:
class SnapshotCache {
  private cache: Map<string, { snapshot: VSLDocument, timestamp: number }>;
  private ttl: number = 5000; // 5 секунд
  
  get(url: string): VSLDocument | null {
    const cached = this.cache.get(url);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(url);
      return null;
    }
    return cached.snapshot;
  }
}
**Сложность:** Medium  
**Файлы:** `src/utils/cache.ts` (новый), `src/tools/snapshot.ts`

---

### 9. Добавить метрики производительности

**Предложение:**  
Добавить в ответы время выполнения:
{
  "status": "success",
  "data": { /* ... */ },
  "metadata": {
    "execution_time_ms": 234,
    "dom_query_time_ms": 45,
    "screenshot_time_ms": 189
  }
}
**Сложность:** Low  
**Файлы:** `src/utils/performance.ts` (новый), все `src/tools/*.ts`

---

## Приоритеты реализации

### Phase 1 — Критические исправления (1-2 недели)
1. ✅ execute_action: добавить `return_state` параметр
2. ✅ vsl_get_visual: автообновление snapshot + улучшенные ошибки
3. ✅ Метрики токенов в ответах

### Phase 2 — Важные улучшения (2-3 недели)
4. ✅ Lazy text loading (реализация txt_preview/txt_ref)
5. ✅ Уровни детализации snapshot (detail_level)
6. ✅ Фильтрация невидимых элементов

### Phase 3 — Опциональные улучшения (1-2 недели)
7. ✅ Улучшенная обработка ошибок
8. ✅ Валидация input параметров
9. ✅ Кеширование snapshot
10. ✅ Метрики производительности

---

## Оценка эффекта

### До улучшений:
- Snapshot Wikipedia: ~15-20K токенов
- Количество вызовов на действие: 2-3 (action + snapshot + diff)
- Время на действие: 3-5 секунд
- Ошибки неинформативны

### После улучшений (Phase 1+2):
- Snapshot Wikipedia с detail_level="medium": ~5-8K токенов (экономия 50-60%)
- Количество вызовов на действие: 1 (action с return_state)
- Время на действие: 1-2 секунды
- Ошибки содержат контекст и предложения

---

## Следующие шаги

1. Обсудить приоритеты с командой
2. Создать отдельные issues для каждой задачи
3. Начать с Phase 1 (критические исправления)
4. Написать тесты для новых функциональностей
5. Обновить документацию

---

## Связанные файлы

- `/opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server/dist/index.js` — основной файл MCP server
- `src/tools/executeAction.ts` — execute_action
- `src/tools/getVisual.ts` — vsl_get_visual
- `src/tools/snapshot.ts` — vsl_get_snapshot
- `src/tools/getTextBlock.ts` — vsl_get_text_block (требует реализации)

---

## Примечания

- Все пути к файлам указаны относительно корня проекта VSL MCP server
- Оценка токенов приблизительная (bytes / 4)
- Для точного подсчёта токенов рекомендуется использовать `tiktoken`
- ID элементов генерируются как путь индексов в DOM (хрупкая схема)