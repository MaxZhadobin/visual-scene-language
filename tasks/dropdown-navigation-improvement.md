# Задача: Улучшение обработки dropdown меню в VSL

## Проблема

При навигации по сайту через VSL LLM сталкивается с проблемой: клик по кнопке навигации (например, "Platform" на GitHub) открывает dropdown меню, а не выполняет переход на новую страницу. LLM видит кнопку с `act: ["click"]`, кликает по ней, но URL не меняется — открывается dropdown с подпунктами.

**Пример из практики:**
- Клик по `button_0_4_28_1_0_0_2_1_0_0` (Platform) → dropdown открывается
- URL остаётся `https://github.com`
- LLM не понимает, что нужно кликнуть по ссылке внутри dropdown

## Анализ кода

### 1. Типы VSL (`src/types/vsl.ts`)

Текущие типы:
export type VslType =
  | 'button'
  | 'input'
  | 'link'
  | 'nav'
  | 'header'
  | 'main'
  | 'container'
  | 'image'
  | 'select'
  | 'textarea'
  | 'modal'
  | 'tab'
  | 'heading'
  | 'footer'
  | 'scrollable_container'
  | 'toolbar'
  | 'list'
  | 'grid'
  | 'form_field'
  | 'tab_bar'
  | 'layout'
  | 'icon'
  | 'chart'
  | 'custom_widget'
  | 'unknown';
**Проблема:** Нет типа для dropdown toggle / menu button.

### 2. Segmentation Level 1 (`src/segmentation/level1.ts`)

export const LEVEL1_TAG_MAP: Readonly<Record<string, VslType>> = {
  button: 'button',
  input: 'input',
  a: 'link',
  nav: 'nav',
  header: 'header',
  main: 'main',
  section: 'container',
  img: 'image',
  select: 'select',
  textarea: 'textarea',
};
**Проблема:** Все `<button>` теги → `'button'`, независимо от их функции (навигация, dropdown, submit).

### 3. Segmentation Level 2 (`src/segmentation/level2.ts`)

export const ARIA_ROLE_TYPE_MAP: Readonly<Record<string, VslType>> = {
  button: 'button',
  dialog: 'modal',
  tab: 'tab',
  tabpanel: 'container',
};

export function resolveSt(attributes: Record<string, string>): VslState | null {
  if (attributes['aria-pressed'] === TRUE) return 'checked';
  if (attributes['aria-expanded'] === TRUE) return 'expanded';
  if (attributes['aria-disabled'] === TRUE) return 'disabled';
  return null;
}
**Проблема:** 
- `aria-expanded` → состояние `'expanded'`, но это не указывает, что элемент — dropdown toggle
- `aria-haspopup` не обрабатывается вообще

### 4. VSL Builder (`src/builder/vslBuilder.ts`)

function defaultActions(
  t: VslType,
  st: VslState | null,
  attributes: Record<string, string>,
): string[] | undefined {
  if (st === 'disabled') return undefined;
  switch (t) {
    case 'button':
    case 'link':
    case 'tab':
      return ['click'];
    // ...
  }
}
**Проблема:** Для `button` всегда возвращается `['click']` — нет различия между кнопкой навигации и dropdown toggle.

### 5. Action Executor (`src/executor/actionExecutor.ts`)

function clickElement(el: Element): void {
  if (typeof (el as HTMLElement).click === 'function') {
    (el as HTMLElement).click();
    return;
  }
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
**Проблема:** Executor просто кликает — нет логики для обработки dropdown (ожидание появления подменю, автоматический выбор пункта).

## Решение

### Вариант 1: Новый тип `dropdown_toggle` (рекомендуется)

Добавить новый тип VSL для кнопок, открывающих dropdown меню.

**Изменения:**

1. **`src/types/vsl.ts`** — добавить тип:
export type VslType =
  // ... существующие типы
  | 'dropdown_toggle'  // НОВОЕ
  | 'menu_button';     // Альтернативное имя
2. **`src/segmentation/level2.ts`** — определить dropdown toggle:
export function resolveAriaRoleType(role: string | undefined): VslType | null {
  if (!role) return null;
  return ARIA_ROLE_TYPE_MAP[role.toLowerCase()] ?? null;
}

// НОВАЯ ФУНКЦИЯ
export function resolveDropdownToggle(attributes: Record<string, string>): VslType | null {
  // aria-haspopup="menu" или aria-haspopup="listbox" → dropdown toggle
  if (attributes['aria-haspopup'] === 'menu' || attributes['aria-haspopup'] === 'listbox') {
    return 'dropdown_toggle';
  }
  return null;
}
3. **`src/segmentation/segmenter.ts`** — интегрировать проверку:
function segmentOne(el: ExtractedElement): SegmentedElement {
  const { attributes } = el;
  const isFileInput = el.tag === 'input' && attributes['type'] === 'file';
  
  // НОВОЕ: проверка dropdown toggle
  const dropdownType = resolveDropdownToggle(attributes);
  
  return {
    tag: el.tag,
    indexPath: el.indexPath,
    rect: el.rect,
    attributes,
    t: isFileInput
      ? 'file_input'
      : (dropdownType ??  // НОВОЕ: приоритет dropdown
         resolveLevel1Type(el.tag) ??
         resolveAriaRoleType(attributes['role']) ??
         resolveLevel3Type(el.css, attributes)),
    txt: attributes['aria-label'] ?? el.text,
    st: resolveSt(attributes),
    css: el.css,
    ch: [],
  };
}
4. **`src/builder/vslBuilder.ts`** — добавить actions для dropdown:
function defaultActions(
  t: VslType,
  st: VslState | null,
  attributes: Record<string, string>,
): string[] | undefined {
  if (st === 'disabled') return undefined;
  switch (t) {
    case 'button':
    case 'link':
    case 'tab':
      return ['click'];
    case 'dropdown_toggle':  // НОВОЕ
      return ['click', 'expand', 'collapse'];
    // ...
  }
}
5. **`src/types/vsl.ts`** — добавить атрибут `hasPopup` в VslObject:
export interface VslObject {
  // ... существующие поля
  /** Атрибут aria-haspopup — указывает на dropdown/menu (для LLM). */
  hasPopup?: string;  // НОВОЕ
}
6. **`src/builder/vslBuilder.ts`** — извлекать `aria-haspopup`:
function toVslObject(
  el: SegmentedElement,
  viewport: { width: number; height: number },
  includedChildren: VslObject[],
  textBlocks: Map<string, string>,
  counter: { value: number },
): VslObject {
  // ... существующий код
  
  // НОВОЕ: извлечение aria-haspopup
  const hasPopup = el.attributes['aria-haspopup'];
  if (hasPopup !== undefined) object.hasPopup = hasPopup;
  
  return object;
}
### Вариант 2: Атрибут `hasPopup` без нового типа (более лёгкий)

Не добавлять новый тип, но извлекать `aria-haspopup` как атрибут VSL объекта.

**Изменения:**

1. **`src/types/vsl.ts`** — добавить поле:
export interface VslObject {
  // ... существующие поля
  hasPopup?: string;  // 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'
}
2. **`src/builder/vslBuilder.ts`** — извлекать атрибут:
const hasPopup = el.attributes['aria-haspopup'];
if (hasPopup !== undefined) object.hasPopup = hasPopup;
**Плюсы:**
- Минимальные изменения
- LLM видит `hasPopup: "menu"` и понимает, что это dropdown

**Минусы:**
- LLM всё равно должен сам догадаться, что после клика нужно кликнуть по ссылке внутри dropdown
- Нет явного указания в типе элемента

### Вариант 3: Автоматическое раскрытие dropdown в executor

Добавить в executor логику: после клика на dropdown toggle — автоматически ждать появления подменю и возвращать список доступных пунктов.

**Изменения:**

1. **`src/executor/actionExecutor.ts`** — модифицировать `click`:
case 'click': {
  const el = resolveTargetOf(action, options);
  clickElement(el);
  
  // НОВОЕ: если это dropdown toggle — ждать появления подменю
  if (el.getAttribute('aria-haspopup')) {
    // Ждать появления дочерних элементов с role="menuitem" или role="option"
    await waitForDropdownMenu(el, options);
  }
  break;
}
2. **`src/executor/actionExecutor.ts`** — добавить функцию:
async function waitForDropdownMenu(
  toggle: Element,
  options: ExecutorOptions,
): Promise<void> {
  const timeout = options.waitTimeout ?? 1000;
  const start = Date.now();
  
  while (Date.now() - start <timeout) {
    // Ищем элементы с role="menuitem" или role="option"
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
    if (menuItems.length > 0) {
      return;  // Подменю появилось
    }
    await sleep(50);
  }
  // Таймаут — не критично, просто продолжаем
}
**Плюсы:**
- LLM получает готовое подменю после клика
- Не нужно делать дополнительный клик

**Минусы:**
- Сложная логика в executor
- Не все dropdown используют `role="menuitem"` — нужны фолбэки
- Может замедлить выполнение

## Рекомендуемое решение

**Комбинация Варианта 1 и Варианта 2:**

1. Добавить новый тип `dropdown_toggle` в `VslType`
2. Извлекать `aria-haspopup` как атрибут VSL объекта
3. Добавить actions `['click', 'expand', 'collapse']` для dropdown toggle
4. (Опционально) Добавить в executor ожидание появления подменю

**Ожидаемый результат:**

LLM видит в VSL JSON:
{
  "id": "button_0_4_28_1_0_0_2_1_0_0",
  "t": "dropdown_toggle",
  "txt": "Platform",
  "act": ["click", "expand", "collapse"],
  "hasPopup": "menu",
  "st": "expanded"  // если меню открыто
}
LLM понимает:
- Это dropdown toggle (не обычная кнопка)
- После клика откроется меню с подпунктами
- Нужно кликнуть по ссылке внутри dropdown для навигации

## Acceptance Criteria

- [ ] Новый тип `dropdown_toggle` добавлен в `VslType`
- [ ] Функция `resolveDropdownToggle` определяет элементы с `aria-haspopup`
- [ ] VSL Builder извлекает `aria-haspopup` как атрибут `hasPopup`
- [ ] VSL Builder добавляет actions `['click', 'expand', 'collapse']` для dropdown toggle
- [ ] Тесты покрывают определение dropdown toggle
- [ ] Тесты покрывают извлечение `hasPopup` атрибута
- [ ] Документация обновлена (DESIGN_SYSTEM.md, ARCHITECTURE.md)

## Constraints

- Не ломать существующую функциональность
- Обратная совместимость: старые VSL JSON остаются валидными
- Минимальные изменения в executor (опционально)
- Производительность: не замедлять snapshot более чем на 5%

## Files to modify

1. `src/types/vsl.ts` — добавить тип `dropdown_toggle`, поле `hasPopup`
2. `src/segmentation/level2.ts` — добавить функцию `resolveDropdownToggle`
3. `src/segmentation/segmenter.ts` — интегрировать проверку dropdown
4. `src/builder/vslBuilder.ts` — извлекать `aria-haspopup`, добавить actions
5. `src/segmentation/level2.test.ts` — тесты для `resolveDropdownToggle`
6. `src/builder/vslBuilder.test.ts` — тесты для `hasPopup` и actions
7. `DESIGN_SYSTEM.md` — документация нового типа
8. `ARCHITECTURE.md` — обновление таблицы типов

## Priority

**Высокий** — критично для улучшения навигации LLM по сайтам с dropdown меню.

## Estimated effort

2-3 дня (включая тесты и документацию).