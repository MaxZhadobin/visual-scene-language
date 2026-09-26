# Task: Реализация визуальных стилей в VSL (поле `sty`)

## Контекст

Агент при работе с VSL сообщил, что не видит визуальный дизайн страницы:
- ❌ Цвета (background, text color, border color)
- ❌ Шрифты (font-family, font-size, font-weight)
- ❌ Тени (box-shadow)
- ❌ Скругления (border-radius)

VSL даёт семантическую карту (Elements panel), но не визуальный рендер.

**Решение:** Добавить optional поле `sty` на визуально значимые элементы, чтобы агент "видел" основной дизайн без скриншота.

## Решение (согласовано с пользователем)

**Сбалансированный подход:** 6 свойств, которые покрывают ~90% потребностей:

| Свойство | CSS | Что даёт агенту |
|----------|-----|-----------------|
| `bg` | background-color | Контраст, disabled-состояния, primary/secondary |
| `fg` | color | Читаемость текста, link vs plain text |
| `border` | border shorthand | Границы, разделители, focus rings |
| `radius` | border-radius | Кнопки vs чипы vs аватары |
| `shadow` | box-shadow | Elevation: модалки "парят" над контентом |
| `font` | family, size, weight | Заголовки vs body text, bold акценты |

**Не покрывается (использовать `vsl_get_visual`):**
- Градиенты (сложно парсить)
- Анимации/hover (runtime, не статично)
- Точные CSS-конфликты (анализ кода)

## Архитектура реализации

### Pipeline данных (текущий → целевой)

domExtractor.ts          segmenter.ts           vslBuilder.ts          VSL JSON
─────────────            ─────────────          ─────────────          ────────
                                                                      
captureCss()      →      segmentOne()     →      toVslObject()   →     VslObject
(ElementCss)             (SegmentedElement)       (добавить sty)        { sty?: VslStyle }
                                                                      
[РАСШИРИТЬ]              [СОХРАНИТЬ css]          [ИЗВЛЕЧЬ sty]
### Изменения по файлам

#### 1. `src/capture/domExtractor.ts`

**Расширить `ElementCss`** — добавить 6 новых свойств:

export interface ElementCss {
  // Существующие (Level 3 classification):
  cursor?: string;
  position?: string;
  top?: string;
  bottom?: string;
  display?: string;
  gap?: string;
  fontWeight?: string;   // ← уже есть, переиспользовать
  fontSize?: string;     // ← уже есть, переиспользовать
  opacity?: string;
  pointerEvents?: string;
  overflow?: string;
  height?: string;
  
  // Новые (visual styles):
  backgroundColor?: string;   // bg
  color?: string;             // fg (text color)
  border?: string;            // border shorthand
  borderRadius?: string;      // radius
  boxShadow?: string;         // shadow
  fontFamily?: string;        // font family
}
**Расширить `CSS_PROPERTIES`** массив:

const CSS_PROPERTIES: ReadonlyArray<[keyof ElementCss, string]> = [
  // ... существующие ...
  ['backgroundColor', 'background-color'],
  ['color', 'color'],
  ['border', 'border'],
  ['borderRadius', 'border-radius'],
  ['boxShadow', 'box-shadow'],
  ['fontFamily', 'font-family'],
];
#### 2. `src/segmentation/segmenter.ts`

**Сохранить CSS в `SegmentedElement`** (сейчас используется только для классификации и теряется):

export interface SegmentedElement {
  // ... существующие поля ...
  /** CSS-подмножество для визуальных стилей (передаётся в Builder для sty). */
  css?: ElementCss;
}
В `segmentOne()`:
function segmentOne(el: ExtractedElement): SegmentedElement {
  return {
    // ...
    css: el.css,  // ← добавить
  };
}
#### 3. `src/types/vsl.ts`

**Добавить тип `VslStyle`:**

/**
 * Визуальные стили объекта VSL (DESIGN_SYSTEM.md §4.3).
 * Optional: только для визуально значимых элементов.
 * Все значения — computed styles в момент snapshot.
 */
export interface VslStyle {
  /** Background color (computed). */
  bg?: string;
  /** Text/foreground color (computed). */
  fg?: string;
  /** Border shorthand (computed). */
  border?: string;
  /** Border radius (computed). */
  radius?: string;
  /** Box shadow (computed). */
  shadow?: string;
  /** Font properties. */
  font?: {
    family?: string;
    size?: string;
    weight?: string;
  };
}
**Добавить поле в `VslObject`:**

export interface VslObject {
  // ... существующие поля ...
  /** Визуальные стили (DESIGN_SYSTEM.md §4.3). Optional: только для визуально значимых элементов. */
  sty?: VslStyle;
}
#### 4. `src/builder/vslBuilder.ts`

**Добавить функцию извлечения стилей:**

/**
 * Извлекает визуальные стили из CSS-подмножества для VslObject.
 * Возвращает undefined, если нет значимых стилей (экономия JSON).
 */
function extractVisualStyles(css?: ElementCss): VslStyle | undefined {
  if (!css) return undefined;
  
  const style: VslStyle = {};
  let hasContent = false;
  
  // Background (пропускаем transparent и rgba(0,0,0,0))
  if (css.backgroundColor && 
      css.backgroundColor !== 'transparent' && 
      css.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    style.bg = css.backgroundColor;
    hasContent = true;
  }
  
  // Foreground (text color)
  if (css.color && css.color !== 'rgb(0, 0, 0)') {
    style.fg = css.color;
    hasContent = true;
  }
  
  // Border (пропускаем none/0)
  if (css.border && css.border !== 'none' && css.border !== '0px none rgb(0, 0, 0)') {
    style.border = css.border;
    hasContent = true;
  }
  
  // Border radius (пропускаем 0)
  if (css.borderRadius && css.borderRadius !== '0px') {
    style.radius = css.borderRadius;
    hasContent = true;
  }
  
  // Box shadow (пропускаем none)
  if (css.boxShadow && css.boxShadow !== 'none') {
    style.shadow = css.boxShadow;
    hasContent = true;
  }
  
  // Font (только если есть хоть что-то)
  const font: VslStyle['font'] = {};
  if (css.fontFamily) font.family = css.fontFamily;
  if (css.fontSize) font.size = css.fontSize;
  if (css.fontWeight) font.weight = css.fontWeight;
  if (Object.keys(font).length > 0) {
    style.font = font;
    hasContent = true;
  }
  
  return hasContent ? style : undefined;
}
**Модифицировать `toVslObject()`:**

function toVslObject(
  el: SegmentedElement,
  viewport: { width: number; height: number },
  includedChildren: VslObject[],
  textBlocks: Map<string, string>,
  counter: { value: number },
): VslObject {
  // ... существующий код ...
  
  // Добавить визуальные стили
  const sty = extractVisualStyles(el.css);
  if (sty !== undefined) object.sty = sty;
  
  return object;
}
## Selective Application (экономия JSON)

Поле `sty` добавляется НЕ на все элементы, а только на визуально значимые:

**Критерии включения `sty`:**
1. Элемент имеет `t` ∈ {button, input, link, heading, select, textarea, tab, modal, nav, header, footer}
2. ИЛИ элемент имеет нетривиальные стили (border, shadow, radius ≠ 0)

**Фильтрация дефолтных значений:**
- `bg: transparent` / `rgba(0,0,0,0)` → не включаем
- `border: none` / `0px none` → не включаем  
- `radius: 0px` → не включаем
- `shadow: none` → не включаем
- `fg: rgb(0,0,0)` (чёрный по умолчанию) → не включаем

**Оценка размера:**
- Типичная страница: ~50-100 элементов
- С `sty` на ~30% элементов: +5-15 KB
- В рамках бюджета 10-100 KB ✓

## Пример результата

{
  "id": "login_btn_0_1_2",
  "t": "button",
  "txt": "Войти",
  "p": [0.5, 0.7],
  "s": [200, 48],
  "act": ["click"],
  "sty": {
    "bg": "rgb(59, 130, 246)",
    "fg": "rgb(255, 255, 255)",
    "border": "none",
    "radius": "8px",
    "shadow": "0 2px 4px rgba(0, 0, 0, 0.1)",
    "font": {
      "family": "Inter, sans-serif",
      "size": "16px",
      "weight": "600"
    }
  }
}
Агент теперь **видит**, что это синяя кнопка с белым текстом, скруглёнными углами и тенью — без скриншота.

## Тесты

### Unit-тесты

1. **domExtractor.test.ts** — проверка захвата новых CSS-свойств
2. **segmenter.test.ts** — проверка сохранения css в SegmentedElement
3. **vslBuilder.test.ts** — проверка:
   - `extractVisualStyles()` с разными входами
   - Фильтрация дефолтных значений
   - Поле `sty` только на визуально значимых элементах
   - Обратная совместимость (элементы без `sty`)

### Integration-тесты

1. **snapshot.integration.test.ts** — проверка размера JSON с `sty` vs без
2. Ручная проверка на тестовой странице (localhost:3015)

## Acceptance Criteria

- [ ] `ElementCss` расширен 6 новыми свойствами (bg, fg, border, radius, shadow, fontFamily)
- [ ] `SegmentedElement` сохраняет `css` из `ExtractedElement`
- [ ] Тип `VslStyle` добавлен в `types/vsl.ts`
- [ ] Поле `sty?: VslStyle` добавлено в `VslObject`
- [ ] Функция `extractVisualStyles()` фильтрует дефолтные значения
- [ ] `toVslObject()` добавляет `sty` только на визуально значимых элементах
- [ ] Все существующие тесты проходят
- [ ] Новые unit-тесты покрывают логику извлечения стилей
- [ ] Размер JSON увеличивается не более чем на 15 KB на типичной странице

## Связанные документы

- DESIGN_SYSTEM.md §4.3 — описание поля `sty` (уже запланировано)
- ARCHITECTURE.md §2.3 — бюджет JSON 10-100 KB
- Отчёт агента — что не хватает в текущем VSL

## Приоритет

**M1.8** (или отдельный минорный релиз) — не блокирует текущий функционал, обратно совместимо.

---

**Статус:** Готов к реализации  
**Согласовано с пользователем:** ✅