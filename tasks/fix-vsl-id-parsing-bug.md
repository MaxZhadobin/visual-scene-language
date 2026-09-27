# Fix VSL ID Parsing Bug in getSnapshot.ts

## Problem Summary

Клики и `vsl_get_visual` не работают ни на одном сайте (Google, Wikipedia, example.com). Атрибут `data-vsl-id` либо не устанавливается, либо устанавливается на неправильный элемент DOM.

## Root Cause Analysis

### Формат VSL ID

SDK генерирует VSL ID в формате:
id: `${el.tag}_${el.indexPath.join("_")}`
Примеры:
- `button_0_1` → tag=`button`, indexPath=[0, 1]
- `file_input_0_1` → tag=`file_input`, indexPath=[0, 1]
- `custom_widget_2_3_4` → tag=`custom_widget`, indexPath=[2, 3, 4]

### Баг в getSnapshot.ts (L396-399)

const parts = obj.id.split('_');
if (parts.length < 2) return;
const indexPath = parts.slice(1).map(Number);
**Проблема:** Некоторые VSL теги содержат underscore:
- `file_input`
- `dropdown_toggle`
- `scrollable_container`
- `form_field`
- `tab_bar`
- `custom_widget`

**Пример бага:**
- ID = `file_input_0_1`
- `split('_')` → `['file', 'input', '0', '1']`
- `slice(1).map(Number)` → `[NaN, 0, 1]` (потому что `'input'` не число)
- `elementChildren[NaN]` → `undefined`
- Элемент не найден, `data-vsl-id` не устанавливается!

### Полный список затронутых тегов

Из SDK (`index.d.ts` L91):
type VslType = 'button' | 'input' | 'file_input' | 'link' | 'nav' | 'header' | 
  'main' | 'container' | 'image' | 'select' | 'textarea' | 'modal' | 'tab' | 
  'dropdown_toggle' | 'heading' | 'footer' | 'scrollable_container' | 'toolbar' | 
  'list' | 'grid' | 'form_field' | 'tab_bar' | 'layout' | 'icon' | 'chart' | 
  'custom_widget' | 'unknown';
Теги с underscore (6 штук):
1. `file_input`
2. `dropdown_toggle`
3. `scrollable_container`
4. `form_field`
5. `tab_bar`
6. `custom_widget`

## Solution

### Вариант 1: Найти первый числовой индекс (рекомендуется)

function parseVslId(id: string): { tag: string; indexPath: number[] } | null {
  // Находим позицию первого числового индекса
  const match = id.match(/^(.+?)_(\d+(?:_\d+)*)$/);
  if (!match) return null;
  
  const tag = match[1];
  const indexPath = match[2].split('_').map(Number);
  
  return { tag, indexPath };
}
**Преимущества:**
- Простое и надёжное решение
- Работает для всех тегов, включая теги с underscore
- Не требует изменений в SDK
- Минимальные изменения в getSnapshot.ts

### Вариант 2: Использовать XPath (альтернатива)

Более сложный подход, требующий значительных изменений. Не рекомендуется.

## Implementation Plan

### Шаг 1: Добавить функцию парсинга VSL ID

В `packages/mcp-server/src/tools/getSnapshot.ts` добавить:

/**
 * Парсит VSL ID в формат { tag, indexPath }.
 * Корректно обрабатывает теги с underscore (file_input, custom_widget и т.д.).
 * 
 * @param id - VSL ID в формате `${tag}_${indexPath.join("_")}`
 * @returns Объект с tag и indexPath, или null если ID невалиден
 */
function parseVslId(id: string): { tag: string; indexPath: number[] } | null {
  const match = id.match(/^(.+?)_(\d+(?:_\d+)*)$/);
  if (!match) return null;
  
  const tag = match[1];
  const indexPath = match[2].split('_').map(Number);
  
  return { tag, indexPath };
}
### Шаг 2: Заменить баговую логику в visit()

Заменить строки 396-399:

// БЫЛО (баг):
const parts = obj.id.split('_');
if (parts.length < 2) return;
const indexPath = parts.slice(1).map(Number);

// СТАЛО (фикс):
const parsed = parseVslId(obj.id);
if (!parsed) return;
const indexPath = parsed.indexPath;
### Шаг 3: Добавить тесты

Создать тесты в `packages/mcp-server/src/tools/__tests__/getSnapshot.test.ts`:

describe('parseVslId', () => {
  it('should parse simple tag', () => {
    expect(parseVslId('button_0_1')).toEqual({
      tag: 'button',
      indexPath: [0, 1]
    });
  });

  it('should parse tag with underscore', () => {
    expect(parseVslId('file_input_0_1')).toEqual({
      tag: 'file_input',
      indexPath: [0, 1]
    });
  });

  it('should parse complex tag with underscore', () => {
    expect(parseVslId('custom_widget_2_3_4')).toEqual({
      tag: 'custom_widget',
      indexPath: [2, 3, 4]
    });
  });

  it('should return null for invalid ID', () => {
    expect(parseVslId('invalid')).toBeNull();
    expect(parseVslId('button')).toBeNull();
    expect(parseVslId('button_abc')).toBeNull();
  });
});
## Acceptance Criteria

- [ ] Клики и `vsl_get_visual` корректно работают на сайтах Google, Wikipedia и example.com
- [ ] Атрибут `data-vsl-id` корректно устанавливается для элементов с тегами `file_input`, `dropdown_toggle`, `scrollable_container`, `form_field`, `tab_bar`, `custom_widget`
- [ ] Функция `parseVslId` корректно парсит все форматы VSL ID
- [ ] Добавлены юнит-тесты для функции `parseVslId`
- [ ] Все существующие тесты проходят

## Constraints

- Не нарушать существующую функциональность других инструментов MCP-сервера
- Новый метод парсинга должен быть производительным (regex match O(n))
- Код должен быть чистым, хорошо задокументированным и соответствовать стандартам проекта
- Не изменять SDK (@thinkingos/vsl-sdk)

## Files to Modify

1. `packages/mcp-server/src/tools/getSnapshot.ts` — добавить `parseVslId`, исправить `visit()`
2. `packages/mcp-server/src/tools/__tests__/getSnapshot.test.ts` — добавить тесты (если файл не существует, создать)

## Related Code References

- `packages/mcp-server/src/tools/getSnapshot.ts:L392-420` — баговая логика записи VSL ID
- `packages/mcp-server/node_modules/@thinkingos/vsl-sdk/dist/index.js:L440-455` — генерация VSL ID в SDK
- `packages/mcp-server/node_modules/@thinkingos/vsl-sdk/dist/index.d.ts:L91` — список всех VSL типов

## Notes

- SDK доступен только в виде скомпилированных артефактов в `node_modules/@thinkingos/vsl-sdk/dist/`
- Исходные TypeScript файлы SDK отсутствуют в репозитории
- Любые изменения должны выполняться в коде MCP-сервера, а не в SDK