# Fix Snapshot TypeError in vsl_get_snapshot

## Problem Statement

`vsl_get_snapshot` падает с `TypeError: Cannot read properties of undefined (reading 'aria-hidden')` при извлечении DOM-дерева с некоторых страниц (например, Habr). При этом `vsl_read_page` с `readable:true` успешно извлекает контент, автоматически определяя SPA и используя render-режим.

## Root Cause Analysis

### Архитектура Pipeline

vsl_get_snapshot
  ↓
extractDomTreeInBrowser() [browser context]
  ↓ возвращает [{ __type, elements, viewport, scroll }]
extractDomTree() [Node.js context]
  ↓ разворачивает обёртку, возвращает extraction.elements
session.snapshotFromElements(extractedElements, input)
  ↓
segmentTree(elements) ← TypeError здесь
  ↓
buildVslDocument(segmented, options)
### Точка отказа

**Файл:** `src/segmentation/segmenter.ts:83-96`

export function segmentTree(elements: readonly ExtractedElement[]): SegmentedElement[] {
  const result: SegmentedElement[] = [];
  for (const el of elements) {
    if (isAriaHidden(el.attributes)) continue;  // ← TypeError если el.attributes undefined
    if (isPointerInvisible(el.css)) continue;
    const segmented = segmentOne(el);
    segmented.ch = segmentTree(el.children);
    if (segmented.t === null) {
      segmented.t = resolveLevel4Type(segmented);
    }
    result.push(segmented);
  }
  return result;
}
**Файл:** `src/segmentation/segmenter.ts:49-52`

export function isAriaHidden(attributes: Record<string, string>): boolean {
  return attributes['aria-hidden'] === 'true';  // ← TypeError если attributes undefined
}
### Почему возникает undefined

1. **Ошибка сериализации через `browser.evaluate()`**: Playwright сериализует DOM-дерево из браузерного контекста в Node.js. Если какой-то элемент не может быть корректно сериализован (например, из-за кросс-доменных ограничений, динамического изменения DOM во время извлечения, или специфических браузерных API), поле `attributes` может отсутствовать.

2. **Рекурсивная обработка в `collectVisibleChildren()`**: Функция `extractDomTreeInBrowser()` (строки 166-328 в `getSnapshot.ts`) рекурсивно обходит DOM. Если вложенный элемент возвращается без поля `attributes` (например, из-за бага в логике или edge case), это распространяется на родительские элементы.

3. **Комментарий в коде подтверждает риск** (строки 411-422 в `getSnapshot.ts`):
      *  - Извлечение возвращает обёртку [{ __type, elements, viewport, scroll }].
   *    Потребители ОБЯЗАНЫ передавать в snapshotFromElements именно `elements`,
   *    иначе SDK segmentTree получит объект-обёртку без поля attributes и упадёт
   *    с "Cannot read properties of undefined (reading 'aria-hidden')".
   ### Подтверждение стабильности vsl_read_page

`vsl_read_page` с `readable:true` успешно извлёк статью с Хабра:
- Автоматически определил SPA-маркеры
- Переключился на render-режим через BrowserManager
- Извлёк полный текст статьи без TypeError

**Файл:** `packages/mcp-server/src/tools/readPage.ts:1-20`
/**
 * Tool: vsl_read_page (T1.6.6, M1.6).
 *
 * Гибридное чтение веб-страниц с автоматической стратегией:
 * HTTP-first для статических страниц, автоматическое переключение на рендер для SPA.
 *
 * Архитектура: HTTP-логика вынесена в httpExtractor.ts (M1.6, DEC-024).
 * Агент НЕ выбирает режим — нет параметра `mode` (DEC-024).
 */
## Recommendations

### Вариант 1: Защитная проверка в segmentTree() (Рекомендуется)

Добавить проверку на `undefined` в `segmentTree()` для graceful degradation:

export function segmentTree(elements: readonly ExtractedElement[]): SegmentedElement[] {
  const result: SegmentedElement[] = [];
  for (const el of elements) {
    // Защитная проверка: если элемент некорректен (нет attributes), пропускаем
    if (!el || !el.attributes) {
      console.warn('[VSL] Skipping malformed element (missing attributes):', el);
      continue;
    }
    if (isAriaHidden(el.attributes)) continue;
    if (isPointerInvisible(el.css)) continue;
    const segmented = segmentOne(el);
    segmented.ch = segmentTree(el.children || []);
    if (segmented.t === null) {
      segmented.t = resolveLevel4Type(segmented);
    }
    result.push(segmented);
  }
  return result;
}
**Преимущества:**
- Минимальное изменение кода
- Graceful degradation: некорректные элементы пропускаются, остальное дерево обрабатывается
- Логирование помогает отладить источник проблемы

**Риски:**
- Может скрыть баг в `extractDomTreeInBrowser()` — нужно добавить логирование

### Вариант 2: Валидация в extractDomTree()

Добавить проверку после разворачивания обёртки:

export async function extractDomTree(browser: BrowserManager): Promise<DomExtractionResult> {
  const extractionResult = await browser.evaluate(
    extractDomTreeInBrowser,
  ) as Array<{ __type: string } & DomExtractionResult>;

  const extraction = Array.isArray(extractionResult) ? extractionResult[0] : undefined;
  if (!extraction || !Array.isArray(extraction.elements)) {
    throw new Error('Failed to extract DOM tree: empty result');
  }
  
  // Валидация: проверить, что все элементы имеют поле attributes
  const invalidElements = extraction.elements.filter(el => !el.attributes);
  if (invalidElements.length > 0) {
    console.warn(`[VSL] Found ${invalidElements.length} elements without attributes field`);
    // Фильтруем некорректные элементы
    extraction.elements = extraction.elements.filter(el => el.attributes);
  }
  
  return extraction;
}
**Преимущества:**
- Раннее обнаружение проблемы
- Явное логирование количества некорректных элементов

**Риски:**
- Не решает проблему рекурсивно (вложенные элементы могут быть некорректны)

### Вариант 3: Try-catch в segmentTree() для полной изоляции

export function segmentTree(elements: readonly ExtractedElement[]): SegmentedElement[] {
  const result: SegmentedElement[] = [];
  for (const el of elements) {
    try {
      if (isAriaHidden(el.attributes)) continue;
      if (isPointerInvisible(el.css)) continue;
      const segmented = segmentOne(el);
      segmented.ch = segmentTree(el.children || []);
      if (segmented.t === null) {
        segmented.t = resolveLevel4Type(segmented);
      }
      result.push(segmented);
    } catch (error) {
      console.warn('[VSL] Error processing element, skipping:', error, el);
      // Продолжаем обработку остальных элементов
    }
  }
  return result;
}
**Преимущества:**
- Полная изоляция: любая ошибка в одном элементе не ломает весь pipeline
- Логирование помогает отладить

**Риски:**
- Может скрыть другие баги
- Производительность: try-catch в цикле может быть медленнее (но для DOM-дерева это не критично)

### Рекомендуемая стратегия

**Комбинация Варианта 1 + Варианта 2:**

1. Добавить защитную проверку в `segmentTree()` (Вариант 1) — это основная защита
2. Добавить валидацию в `extractDomTree()` (Вариант 2) — это раннее обнаружение и логирование
3. Добавить логирование в `extractDomTreeInBrowser()` для отладки источника некорректных элементов

Это обеспечивает defense-in-depth: проблема обнаруживается рано, обрабатывается gracefully, и логируется для отладки.

## Implementation Steps

1. **Изменить `src/segmentation/segmenter.ts`:**
   - Добавить проверку `if (!el || !el.attributes)` в начало цикла в `segmentTree()`
   - Добавить логирование: `console.warn('[VSL] Skipping malformed element:', el)`
   - Добавить защиту для `el.children`: `segmentTree(el.children || [])`

2. **Изменить `packages/mcp-server/src/tools/getSnapshot.ts`:**
   - В функции `extractDomTree()` добавить валидацию после разворачивания обёртки
   - Проверить, что все элементы в `extraction.elements` имеют поле `attributes`
   - Отфильтровать некорректные элементы и залогировать количество

3. **Добавить тесты:**
   - Тест для `segmentTree()` с элементом без `attributes` — должен пропустить элемент
   - Тест для `extractDomTree()` с некорректными элементами — должен отфильтровать и залогировать
   - Интеграционный тест: `vsl_get_snapshot` не должен падать с TypeError на странице с некорректными элементами

4. **Обновить документацию:**
   - Добавить раздел в ARCHITECTURE.md о graceful degradation в segmentation pipeline
   - Обновить README_AI.md с информацией о стабилизации snapshot extraction

## Acceptance Criteria

- [x] `vsl_read_page` с `readable:true` успешно извлекает полный текст статьи с Хабре без TypeError
- [x] Корневая причина TypeError в `vsl_get_snapshot` идентифицирована и задокументирована
- [ ] Добавлена защитная проверка в `segmentTree()` — элементы без `attributes` пропускаются с логированием
- [ ] Добавлена валидация в `extractDomTree()` — некорректные элементы фильтруются до передачи в SDK
- [ ] Добавлены тесты для graceful degradation в segmentation pipeline
- [ ] `vsl_get_snapshot` не падает с TypeError на страницах с некорректными элементами

## Files to Modify

- `src/segmentation/segmenter.ts` — защитная проверка в `segmentTree()`
- `packages/mcp-server/src/tools/getSnapshot.ts` — валидация в `extractDomTree()`
- `src/segmentation/segmenter.test.ts` — тесты для graceful degradation
- `packages/mcp-server/src/tools/getSnapshot.test.ts` — интеграционные тесты
- `ARCHITECTURE.md` — документация о graceful degradation

## Related Code References

- `src/segmentation/segmenter.ts:83-96` — функция `segmentTree()`, точка отказа
- `src/segmentation/segmenter.ts:49-52` — функция `isAriaHidden()`, вызывает TypeError
- `packages/mcp-server/src/tools/getSnapshot.ts:166-328` — функция `extractDomTreeInBrowser()`
- `packages/mcp-server/src/tools/getSnapshot.ts:411-433` — функция `extractDomTree()`, разворачивает обёртку
- `src/session/snapshotSession.ts:150-169` — метод `snapshotFromElements()`, передаёт элементы в `segmentTree()`

## Notes

- `vsl_read_page` с `readable:true` успешно работает на Хабре, автоматически определяя SPA
- Параметра `mode='render'` в VSL MCP нет (DEC-024) — режим определяется автоматически
- TypeError изолирован в snapshot extraction pipeline, не влияет на другие инструменты