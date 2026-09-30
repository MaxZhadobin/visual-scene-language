# Задача: Исправление кликов внутри cross-origin iframe

## Проблема

VSL успешно извлекает DOM из cross-origin iframe (reCAPTCHA) и включает элементы в snapshot, но **клики внутри iframe не работают** — Playwright locator падает с timeout.

### Симптомы
- Snapshot показывает элементы внутри iframe (например, `span_3_2_0_0_0_0` с `role="checkbox"`)
- Попытка `vsl_execute_action click` на элемент внутри iframe падает:
    locator.click: Timeout 5000ms exceeded.
  waiting for locator('[data-vsl-id="span_3_2_0_0_0_0"], #span_3_2_0_0_0_0, .span_3_2_0_0_0_0')
  ## Корневая причина

**Критический баг в idMapper.buildIdMap()**: функция обрабатывает только `obj.ch` (children), но **НЕ обрабатывает** `obj.iframe.vsl.objects` — вложенные объекты iframe.

### Последствия
1. Элементы внутри iframe получают **длинные ID** (например, `span_3_2_0_0_0_0`), но **не получают короткие ID** через idMapper
2. Frame routing в `executeAction` ожидает формат `iframe_N:localId`, но этот формат **нигде не формируется**
3. LLM видит длинные ID элементов iframe в snapshot, но idMap не содержит маппинга для них
4. `executeAction` не может маршрутизировать клик в правильный iframe

### Анализ кода

**getSnapshot.ts L587-597** — создание iframe objects:
const iframeObjects = iframeSubDocs.map((iframeInfo, index) => ({
  id: `iframe_${index}`,
  t: 'iframe' as const,
  p: [iframeInfo.rect.x, iframeInfo.rect.y] as [number, number],
  s: [iframeInfo.rect.width, iframeInfo.rect.height] as [number, number],
  iframe: {
    url: iframeInfo.url,
    frameId: index,
    vsl: iframeInfo.doc,  // ← Вложенные объекты iframe
  },
}));
**idMapper.ts L89-115** — buildIdMap():
function visit(obj: VslObject): void {
  const tag = extractTag(obj.id);
  const prefix = tagPrefix(tag);
  const counter = counters.get(prefix) ?? 0;
  counters.set(prefix, counter + 1);

  const shortId = `${prefix}_${toBase36(counter)}`;
  map.set(shortId, obj.id);

  if (obj.ch) {  // ← Обрабатывает только children
    for (const child of obj.ch) {
      visit(child);
    }
  }
  // ❌ НЕ обрабатывает obj.iframe.vsl.objects!
}
**executeAction.ts L356-398** — frame routing:
const frameMatch = resolvedId.match(/^iframe_(\d+):(.+)$/);
if (frameMatch) {
  const frameIndex = parseInt(frameMatch[1]!, 10);
  localId = frameMatch[2]!;
  // ... маршрутизация в iframe
}
Ожидает формат `iframe_N:localId`, но idMapper не формирует такой формат.

## Решение

### Вариант 1: Модификация idMapper (РЕКОМЕНДУЕМЫЙ)

**Изменить `idMapper.buildIdMap()`** для обработки вложенных iframe objects:

function visit(obj: VslObject, framePrefix?: string): void {
  const tag = extractTag(obj.id);
  const prefix = tagPrefix(tag);
  const counter = counters.get(prefix) ?? 0;
  counters.set(prefix, counter + 1);

  // Формируем shortId с frame prefix если внутри iframe
  const shortId = framePrefix 
    ? `${framePrefix}:${prefix}_${toBase36(counter)}`
    : `${prefix}_${toBase36(counter)}`;
  
  map.set(shortId, obj.id);

  // Рекурсия для children
  if (obj.ch) {
    for (const child of obj.ch) {
      visit(child, framePrefix);
    }
  }

  // Рекурсия для iframe.vsl.objects с frame prefix
  if (obj.iframe?.vsl?.objects) {
    const frameIndex = obj.iframe.frameId;
    const iframeFramePrefix = `iframe_${frameIndex}`;
    for (const iframeObj of obj.iframe.vsl.objects) {
      visit(iframeObj, iframeFramePrefix);
    }
  }
}
**Результат**: элементы внутри iframe получат короткие ID формата `iframe_0:span_0_1`, которые:
- Правильно парсятся frame routing в `executeAction`
- Маршрутизируются в нужный iframe через `browser.getFrames()`
- Находятся через `target.locator('[data-vsl-id="span_0_1"]')`

### Преимущества варианта 1
- ✅ Минимальные изменения (только idMapper.ts)
- ✅ Соответствует существующей архитектуре frame routing
- ✅ Не требует изменений в executeAction
- ✅ LLM получит корректные короткие ID с frame prefix

### Альтернативные варианты (отклонены)

**Вариант 2: Coordinate-based clicks**
- Клики по визуальным координатам из скриншота
- ❌ Требует полной переработки executeAction
- ❌ Менее надежен (координаты могут смещаться)
- ❌ Не использует преимущества DOM-based подхода

**Вариант 3: Playwright frameLocator API**
- Использование `page.frameLocator()` вместо ручного frame routing
- ❌ Требует изменений в executeAction
- ❌ Не решает проблему с idMapper
- ❌ Избыточно для текущей архитектуры

## План реализации

### Шаг 1: Модификация idMapper.buildIdMap()
**Файл**: `packages/mcp-server/src/utils/idMapper.ts`

Изменить функцию `visit()` для:
1. Добавления параметра `framePrefix?: string`
2. Формирования `shortId` с frame prefix при обработке iframe объектов
3. Рекурсивного обхода `obj.iframe.vsl.objects` с передачей frame prefix

### Шаг 2: Тестирование
**Файл**: `packages/mcp-server/src/utils/idMapper.test.ts`

Добавить тесты:
- Элементы внутри iframe получают короткие ID с frame prefix
- Формат ID: `iframe_N:localId`
- Вложенные children внутри iframe также получают frame prefix
- Обычные элементы (вне iframe) не затрагиваются

### Шаг 3: Интеграционное тестирование
**Сценарий**: reCAPTCHA demo
1. Открыть reCAPTCHA demo
2. Получить snapshot
3. Проверить, что элементы внутри iframe имеют короткие ID формата `iframe_0:span_0_1`
4. Выполнить клик по элементу внутри iframe
5. Убедиться, что клик успешно выполнен

## Acceptance Criteria

- [ ] `idMapper.buildIdMap()` обрабатывает `obj.iframe.vsl.objects`
- [ ] Элементы внутри iframe получают короткие ID формата `iframe_N:localId`
- [ ] Frame routing в `executeAction` корректно парсит формат `iframe_N:localId`
- [ ] Клики внутри cross-origin iframe работают без timeout
- [ ] Существующие тесты idMapper проходят
- [ ] Добавлены новые тесты для iframe ID mapping

## Ограничения

- Решение должно быть совместимо с текущей архитектурой VSL
- Необходимо учитывать, что `injectVslIdsIntoFrame()` уже инъектит `data-vsl-id` в iframe DOM
- Frame routing в `executeAction` уже реализован и ожидает формат `iframe_N:localId`
- Изменения должны быть минимальными и локализованными в idMapper

## Связанные файлы

- `packages/mcp-server/src/utils/idMapper.ts` — основная модификация
- `packages/mcp-server/src/tools/getSnapshot.ts` — создание iframe objects (без изменений)
- `packages/mcp-server/src/tools/executeAction.ts` — frame routing (без изменений)
- `packages/mcp-server/src/utils/injectVslIds.ts` — инъекция data-vsl-id (без изменений)

## Зависимости

- Playwright frame API уже используется в `getSnapshot.ts` и `executeAction.ts`
- `injectVslIdsIntoFrame()` уже инъектит `data-vsl-id` в iframe DOM
- Frame routing в `executeAction` уже ожидает формат `iframe_N:localId`

## Риски

- **Риск**: Изменение формата ID может сломать существующие интеграции
  - **Митигация**: Формат `iframe_N:localId` уже документирован в README_AI.md и ожидается executeAction
  
- **Риск**: Вложенные iframe (iframe внутри iframe) могут не обрабатываться
  - **Митигация**: Рекурсивная функция `visit()` естественно обрабатывает вложенность

- **Риск**: Производительность при большом количестве iframe объектов
  - **Митигация**: Рекурсия ограничена глубиной вложенности iframe (обычно 1-2 уровня)