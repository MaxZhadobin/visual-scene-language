# Таск: Исправление извлечения визуальных фрагментов для элементов вне viewport

## Проблема

При вызове `vsl_get_visual` для элементов, находящихся вне текущего viewport, возвращается ошибка:
"Clipped area is either empty or outside the resulting image"
Это происходит потому что:
1. VSL snapshot строится один раз и хранит координаты `p` как `el.rect.x / viewport.width` и `el.rect.y / viewport.height` (viewport-relative, 0.0–1.0)
2. `getBoundingClientRect()` возвращает viewport-relative координаты, но для элементов вне viewport значения могут быть < 0 или > 1
3. `vsl_get_visual` пытается сделать скриншот элемента по его bounding box, но элемент физически не виден на экране
4. После скролла координаты в snapshot **не обновляются** — snapshot нужно пересобирать заново

## Воспроизведение

1. Открыть длинную страницу (например, github.com)
2. Получить snapshot через `vsl_get_snapshot`
3. Найти элемент с типом `image`, который находится в нижней части страницы (координата `p[1]` > 1.0)
4. Вызвать `vsl_get_visual` для этого элемента
5. Получить ошибку "Clipped area is either empty or outside the resulting image"

## Анализ текущего кода

### vslBuilder.ts (src/builder/vslBuilder.ts)

// Строки 174-176: координаты вычисляются как viewport-relative
p: [relative(el.rect.x, viewport.width), relative(el.rect.y, viewport.height)],
s: [Math.round(el.rect.width), Math.round(el.rect.height)],
- `el.rect` — это `getBoundingClientRect()`, который возвращает viewport-relative координаты
- Для элементов вне viewport: `el.rect.y` может быть отрицательным (выше viewport) или > viewport.height (ниже)
- После нормализации через `relative()`: `p[1]` может быть < 0 или > 1

### actionExecutor.ts (src/executor/actionExecutor.ts)

// Строки 351-356: scroll через window.scrollBy
case 'scroll': {
  const amount = options.defaultScrollAmount ?? DEFAULT_SCROLL_AMOUNT;
  const { dx, dy } = parseScrollValue(requireValue(action), amount);
  window.scrollBy(dx, dy);
  break;
}
- Scroll работает корректно — страница прокручивается
- Но snapshot не пересчитывается автоматически после скролла
- LLM должен вызвать `vsl_get_snapshot` заново после скролла, чтобы получить обновлённые координаты

### types/vsl.ts (src/types/vsl.ts)

// Строки 127-128: контракт поля p
/** Позиция [x, y] — относительные координаты 0.0–1.0 от viewport. */
p: [number, number];
- Контракт говорит "0.0–1.0 от viewport", но на практике значения могут выходить за этот диапазон

## Предлагаемое решение

### Вариант 1: Автоматический скролл в vsl_get_visual (рекомендуемый)

Добавить в `vsl_get_visual` автоматический скролл к целевому элементу перед извлечением скриншота:

1. Найти DOM-элемент по `element_id` через `resolveTarget`
2. Вызвать `element.scrollIntoView({ block: 'center', behavior: 'instant' })`
3. Подождать завершения скролла (requestAnimationFrame или setTimeout)
4. Пересчитать bounding box через `getBoundingClientRect()`
5. Извлечь скриншот

**Преимущества:**
- Минимально инвазивное изменение — не ломает существующий контракт
- LLM не нужно вручную скроллить перед `vsl_get_visual`
- Работает для любых элементов, независимо от их позиции в документе

**Недостатки:**
- Скролл меняет viewport — после `vsl_get_visual` страница будет в другом положении
- Нужно документировать это поведение

### Вариант 2: Viewport-relative координаты + автопересчёт

Изменить подход к координатам:
1. Хранить document-relative координаты в snapshot (через `getBoundingClientRect() + window.scrollY`)
2. При запросе `vsl_get_visual` вычислять viewport-relative координаты на лету
3. Автоматически скроллить к элементу если он вне viewport

**Преимущества:**
- Координаты стабильны между скроллами
- Можно определить, какие элементы вне viewport (p[1] < 0 или > 1)

**Недостатки:**
- Ломает существующий контракт VSL (breaking change)
- Требует миграции всех тестов и downstream-кода

### Вариант 3: Гибридный — добавить поле `doc_p` (document-relative)

Добавить опциональное поле `doc_p` в VslObject:
/** Document-relative координаты [x, y] в px (для элементов вне viewport). */
doc_p?: [number, number];
- `p` остаётся viewport-relative (обратно-совместимость)
- `doc_p` — document-relative, всегда стабильны
- `vsl_get_visual` использует `doc_p` для позиционирования и автоматически скроллит

**Преимущества:**
- Обратно-совместимо
- LLM может определить, какие элементы вне viewport
- Явное разделение viewport vs document координат

**Недостатки:**
- Увеличивает размер JSON (~8 байт на элемент)
- Два источника координат — может запутать

## Рекомендуемый план реализации

### Шаг 1: Автоматический скролл в vsl_get_visual (MVP)

**Файл:** `src/mcp/tools/vslGetVisual.ts` (или аналогичный)

async function vslGetVisual(elementId: string): Promise<VisualResult> {
  // 1. Найти элемент
  const element = resolveTarget(elementId, { root: document.body });
  
  // 2. Проверить, виден ли элемент
  const rect = element.getBoundingClientRect();
  const isVisible = 
    rect.top >= 0 && 
    rect.left >= 0 && 
    rect.bottom <= window.innerHeight && 
    rect.right <= window.innerWidth;
  
  // 3. Если не виден — скроллить к элементу
  if (!isVisible) {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Подождать завершения скролла
    await new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    }));
  }
  
  // 4. Пересчитать bounding box после скролла
  const newRect = element.getBoundingClientRect();
  
  // 5. Извлечь скриншот
  return captureElementScreenshot(element, newRect);
}
### Шаг 2: Добавить флаг `auto_scroll` в vsl_get_visual

Добавить опциональный параметр `auto_scroll` (default: true):
interface VslGetVisualParams {
  element_id: string;
  auto_scroll?: boolean; // default: true
}
- `auto_scroll: true` — автоматически скроллить к элементу (default)
- `auto_scroll: false` — не скроллить, вернуть ошибку если элемент вне viewport (для backwards compatibility)

### Шаг 3: Возвращать scroll offset в результате

Добавить в результат `vsl_get_visual` информацию о скролле:
interface VisualResult {
  mediaType: string;
  data: string;
  scrolled?: boolean; // true если был выполнен автоскролл
  scroll_offset?: { x: number; y: number }; // новый scroll offset
}
### Шаг 4: Обновить документацию

Обновить DESIGN_SYSTEM.md и MCP tool documentation:
- Описать поведение `auto_scroll`
- Указать, что после `vsl_get_visual` с автоскроллом viewport может измениться
- Рекомендовать вызывать `vsl_get_snapshot` после `vsl_get_visual` для получения актуальных координат

### Шаг 5: Добавить тесты

1. Тест: элемент в viewport — скролл не выполняется
2. Тест: элемент ниже viewport — автоскролл срабатывает, скриншот извлекается
3. Тест: элемент выше viewport — автоскролл срабатывает
4. Тест: `auto_scroll: false` + элемент вне viewport — возвращается ошибка
5. Тест: после автоскролла `scrolled: true` в результате

### Шаг 6: (Опционально) Добавить поле `doc_p` для document-relative координат

Если потребуется стабильность координат между скроллами:
1. Добавить `doc_p?: [number, number]` в `VslObject` (types/vsl.ts)
2. Заполнять в `vslBuilder.ts` при сборке
3. Использовать в `vsl_get_visual` для определения необходимости скролла

## Acceptance Criteria

- [ ] `vsl_get_visual` успешно извлекает скриншоты элементов, находящихся вне viewport
- [ ] Автоскролл выполняется прозрачно для LLM (не требует дополнительных вызовов)
- [ ] Результат `vsl_get_visual` содержит флаг `scrolled` если был выполнен автоскролл
- [ ] Параметр `auto_scroll: false` позволяет отключить автоскролл (backwards compatibility)
- [ ] Все существующие тесты проходят
- [ ] Добавлены новые тесты для автоскролла
- [ ] Документация обновлена

## Связанные файлы

- `src/builder/vslBuilder.ts` — сборка VSL JSON, вычисление координат
- `src/executor/actionExecutor.ts` — исполнение scroll действия
- `src/types/vsl.ts` — типы VslObject, VslDocument
- `src/mcp/tools/vslGetVisual.ts` (или аналог) — MCP tool для извлечения визуальных фрагментов
- `DESIGN_SYSTEM.md` — документация VSL формата

## Приоритет

**Высокий** — проблема блокирует извлечение визуальных фрагментов для длинных страниц, что критично для LLM-агента.

## Оценка сложности

**Medium** — изменение локализовано в одном-двух файлах, не требует изменения контракта VSL (если выбрать Вариант 1).