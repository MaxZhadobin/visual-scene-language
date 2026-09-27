# Fix Detail Level Default Inconsistency Between vsl_get_snapshot and vsl_read_page

## Problem Statement

Два инструмента VSL MCP сервера имеют **несогласованные значения по умолчанию** для параметра `detail_level`:

- `vsl_get_snapshot`: default = **`high`** (полный DOM)
- `vsl_read_page`: default = **`medium`** (интерактивные + контейнеры)

Это приводит к непредсказуемому поведению: агент получает разный уровень детализации в зависимости от того, какой инструмент он использует, даже если явно не указывает `detail_level`.

## Root Cause Analysis

### 1. `getSnapshot.ts:307` — Default is 'high'

const detailLevel = args.detail_level || 'high';
**Проблема:** По умолчанию возвращается полный DOM без фильтрации, что может быть избыточно для большинства задач агента.

### 2. `readPage.ts:117` — Default is 'medium'

const detailLevel = args.detail_level || 'medium';
**Проблема:** Здесь default другой — `medium`, что создаёт несогласованность.

### 3. Tool Definition in `index.ts:51`

detail_level: {
  type: 'string',
  enum: ['low', 'medium', 'high'],
  description: "Уровень детализации snapshot. 'low': только интерактивные элементы (кнопки, ссылки, инпуты). 'medium': интерактивные + контейнеры. 'high': все объекты (полный DOM). Default: 'high'.",
}
**Проблема:** В описании инструмента указано `Default: 'high'`, что соответствует `vsl_get_snapshot`, но не `vsl_read_page`.

## Impact

- Агент получает **разный уровень детализации** в зависимости от инструмента
- Непредсказуемое поведение при использовании обоих инструментов
- Избыточный объём данных при использовании `vsl_get_snapshot` (полный DOM vs. отфильтрованный)
- Путаница для разработчиков, ожидающих консистентного поведения

## Solution

### Principle

**Консистентность по умолчанию.** Оба инструмента должны использовать одинаковое значение `detail_level` по умолчанию. Рекомендуемое значение: **`medium`** (интерактивные + контейнеры), так как:
- Достаточно для большинства задач агента (поиск и взаимодействие с элементами)
- Не перегружает контекст избыточными данными (в отличие от `high`)
- Уже используется в `vsl_read_page` как default

### Approach

1. Изменить default в `vsl_get_snapshot` с `high` на `medium`
2. Обновить описание инструмента в `index.ts`, чтобы отражало новый default
3. Убедиться, что тесты учитывают новое поведение

### Changes

#### 1. `getSnapshot.ts` — Change Default

**Текущий код (L307):**
const detailLevel = args.detail_level || 'high';
**Новый код:**
const detailLevel = args.detail_level || 'medium';
#### 2. `index.ts` — Update Tool Description

**Текущий код (L51):**
description: "Уровень детализации snapshot. 'low': только интерактивные элементы (кнопки, ссылки, инпуты). 'medium': интерактивные + контейнеры. 'high': все объекты (полный DOM). Default: 'high'.",
**Новый код:**
description: "Уровень детализации snapshot. 'low': только интерактивные элементы (кнопки, ссылки, инпуты). 'medium': интерактивные + контейнеры (default). 'high': все объекты (полный DOM). Default: 'medium'.",
## Acceptance Criteria

1. ✅ `vsl_get_snapshot` по умолчанию использует `detail_level = 'medium'`
2. ✅ Описание инструмента в `index.ts` отражает новый default (`medium`)
3. ✅ `vsl_read_page` продолжает использовать `detail_level = 'medium'` по умолчанию (без изменений)
4. ✅ Оба инструмента имеют консистентное поведение по умолчанию
5. ✅ Явное указание `detail_level: 'high'` по-прежнему работает и возвращает полный DOM
6. ✅ Backward compatibility: агенты, которые явно указывают `detail_level`, не затрагиваются

## Constraints

- Не менять логику фильтрации (только default значение)
- Не менять сигнатуры публичных API
- Обеспечить backward compatibility для явных значений параметра
- Обновить документацию/описание инструмента

## Testing Strategy

1. **Unit tests:**
   - Вызов `vsl_get_snapshot` без `detail_level` → проверка, что применяется `medium` фильтрация
   - Вызов `vsl_get_snapshot` с `detail_level: 'high'` → проверка, что возвращается полный DOM
   - Вызов `vsl_get_snapshot` с `detail_level: 'low'` → проверка, что возвращаются только интерактивные элементы

2. **Integration tests:**
   - Сравнить результаты `vsl_get_snapshot` и `vsl_read_page` на одной странице без указания `detail_level` → должны быть одинаковыми
   - Проверить, что агент получает ожидаемый уровень детализации по умолчанию

## Files to Modify

1. `packages/mcp-server/src/tools/getSnapshot.ts` (L307)
2. `packages/mcp-server/src/tools/index.ts` (L51)

## Implementation Steps

1. [ ] Изменить default в `getSnapshot.ts` с `'high'` на `'medium'`
2. [ ] Обновить описание инструмента в `index.ts` (указать `Default: 'medium'`)
3. [ ] Проверить и обновить тесты, если они зависят от старого default
4. [ ] Запустить тесты для проверки backward compatibility
5. [ ] Обновить документацию (если есть отдельная документация по инструментам)

## References

- [ref:1e8b0e04-1d15-47a1-874e-694e4bd970ea] — `getSnapshot.ts:305-317` default detail_level is 'high'
- [ref:3a1d43de-7143-4230-862d-72e61bf6d074] — `readPage.ts:23-37` DetailLevel type and default 'medium'
- [ref:e189f705-28ae-4c7d-ae87-3f0dd4a206f5] — `index.ts:38-58` vsl_get_snapshot tool definition with detail_level parameter
- [note:note_1790433785303_ac577008ec60] — Анализ уровней детализации (DEC-027) завершён