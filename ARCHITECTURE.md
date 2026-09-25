# ARCHITECTURE.md — Visual Scene Language (VSL)

> Defensive Publication | Author: Maxim Zhadobin | Date: 28.05.2025 | Version: v0.1
> License: CC BY 4.0
>
> **Важно:** VSL — это JSON-формат и SDK для AI-агентов, а не UI-приложение.
> Данный документ описывает высокоуровневую архитектуру системы VSL.

---

## 1. Overview

ARCHITECTURE.md описывает архитектуру системы VSL — middleware/SDK для представления
визуальных сцен в виде структурированного JSON, понятного языковым моделям.

**Ключевая идея:** вместо отправки полных скриншотов (1–2 MB) в LLM, VSL извлекает
семантическую структуру экрана через DOM/accessibility API и передаёт компактный JSON
(10–100 KB) с визуальными фрагментами только для элементов, недоступных через A11y.

**Высокоуровневая схема:**

┌─────────────────────────────────────────────────────────────────────┐
│                        VSL System                                    │
│                                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐    │
│  │ Capture  │──▶│ Segment  │──▶│  Build   │──▶│  Cache &     │    │
│  │(DOM/A11y │   │(elements)│   │ VSL JSON │   │  Diff Engine │    │
│  │ + Visual)│   │          │   │          │   │              │    │
│  └──────────┘   └──────────┘   └──────────┘   └──────┬───────┘    │
│                                                       │             │
│                                                       ▼             │
│                                              ┌──────────────┐      │
│                                              │ LLM Adapter  │      │
│                                              │ (any model)  │      │
│                                              └──────┬───────┘      │
│                                                     │              │
│                                                     ▼              │
│                                              ┌──────────────┐      │
│                                              │   Action     │      │
│                                              │   Executor   │      │
│                                              └──────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
**Cross-references:**
- Концепция продукта → [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md)
- Целевая аудитория → [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md)
- Дизайн-система (JSON schema) → [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

---

## 2. System Architecture

Система VSL состоит из 6 основных компонентов, образующих pipeline:

### 2.1 Capture Layer

**Назначение:** извлечение данных из источника (экрана).

**Источники данных (гибридный подход):**

| Источник | Что извлекает | Когда используется |
|----------|---------------|-------------------|
| **DOM** | Структура, тексты, атрибуты, состояния | Основной источник для веб |
| **Accessibility API** | Роли, labels, состояния, иерархия | Когда DOM недоступен или недостаточен |
| **Visual Fragments** | Скриншоты отдельных элементов | Для элементов без A11y (images, canvas, custom widgets) |

**Принцип:** DOM/A11y — основной источник структурных данных. Скриншоты используются
**только** для визуальных фрагментов элементов, которые невозможно описать через
структурные данные (изображения, canvas, сложные кастомные виджеты).

**Веб-источники:**
- `document.querySelector` / `document.querySelectorAll` — DOM-дерево
- `getComputedStyle()` — стили элементов
- `element.getBoundingClientRect()` — координаты и размеры
- `element.getAttribute('aria-*')` — accessibility-атрибуты
- `window.getComputedStyle()` — computed styles
- `canvas.toDataURL()` — скриншоты canvas-элементов
- `img.src` → загрузка и конвертация в эмбеддинг

**Десктоп-источники:**
- macOS: AX API (AXUIElement)
- Windows: UI Automation (IUIAutomation)
- Linux: AT-SPI (Assistive Technology Service Provider Interface)

**Мобильные источники:**
- iOS: UIAccessibility API (VoiceOver data)
- Android: AccessibilityService (TalkBack data)

### 2.2 Segmentation Engine

**Назначение:** разбиение извлечённых данных на семантические объекты.

**Алгоритм:**

1. **DOM-based segmentation** (основной):
   - Обход DOM-дерева / accessibility tree
   - Определение типов элементов по тегам, ролям, ARIA-атрибутам
   - Извлечение текстов, значений, состояний
   - Построение иерархии (parent-child relationships)

2. **Vision model fallback** (для неструктурированных элементов):
   - Применяется только к элементам без A11y-данных
   - Vision model классифицирует визуальный фрагмент (кнопка? иконка? изображение?)
   - Результат: тип элемента + bounding box + опциональный label

3. **Merging**:
   - Объединение DOM-данных с vision model результатами
   - Разрешение конфликтов (DOM приоритетнее vision model)

**Результат:** массив семантических объектов с типами, координатами, состояниями.

### 2.2.1 Multi-Level Segmentation Algorithm

**Проблема:** DOM-дерево ≠ семантическое дерево. Один `<div>` может содержать 10 логических элементов.
Как их выделить? Решение — многоуровневая сегментация с нарастающей сложностью.

**Уровень 1: Семантические теги (бесплатно, ~40% элементов)**

| Тег | → Тип | Примеры |
|-----|-------|---------|
| `<button>` | `button` | Submit, Cancel, OK |
| `<input>` | `input` | Email, password, search |
| `<a>` | `link` | Navigation, external links |
| `<nav>` | `nav` | Main navigation, breadcrumbs |
| `<header>` | `header` | Page header, section header |
| `<main>` | `main` | Main content area |
| `<section>` | `container` | Content sections |
| `<img>` | `image` | Logos, photos, icons |
| `<select>` | `select` | Dropdown lists |
| `<textarea>` | `textarea` | Multi-line input |

**Уровень 2: ARIA-атрибуты (бесплатно, ещё ~20% элементов)**

| Атрибут | → Тип/Состояние | Пример |
|---------|-----------------|--------|
| `role="button"` | `button` | `<div role="button">` |
| `role="dialog"` | `modal` | `<div role="dialog">` |
| `role="tab"` | `tab` | `<div role="tab">` |
| `role="tabpanel"` | `container` | `<div role="tabpanel">` |
| `aria-label="Search"` | `txt: "Search"` | `<input aria-label="Search">` |
| `aria-pressed="true"` | `st: "checked"` | `<button aria-pressed="true">` |
| `aria-expanded="true"` | `st: "expanded"` | `<div aria-expanded="true">` |
| `aria-disabled="true"` | `st: "disabled"` | `<button aria-disabled="true">` |
| `aria-hidden="true"` | пропустить | Декоративные элементы |

**Уровень 3: CSS-анализ (10–50ms, ещё ~25% элементов)**

| CSS-паттерн | → Тип | Обоснование |
|------------|-------|-------------|
| `cursor: pointer` + `onclick` | `button` | Интерактивный элемент |
| `display: flex` + `gap > 0` | `container` | Контейнер с layout |
| `font-weight: bold` + `font-size > 20px` | `heading` | Заголовок |
| `position: fixed` + `top: 0` | `header` | Фиксированный header |
| `position: fixed` + `bottom: 0` | `footer` | Фиксированный footer |
| `overflow: hidden` + `height > 200px` | `scrollable_container` | Скроллируемый контейнер |
| `display: none` / `visibility: hidden` | пропустить | Невидимые элементы |
| `opacity: 0` + `pointer-events: none` | пропустить | Скрытые элементы |

**Уровень 4: Структурный анализ (50–100ms)**

Алгоритм:
1. Построить bounding box tree (каждый элемент → прямоугольник через `getBoundingClientRect()`)
2. Найти пересечения и вложенность прямоугольников
3. Определить паттерны:

| Паттерн | Условие | → Тип |
|---------|---------|-------|
| Горизонтальный ряд кнопок | ≥3 элемента с `t: button` в ряд, одинаковая высота | `toolbar` |
| Вертикальный список | ≥3 элемента с одинаковой шириной, вертикальное расположение | `list` |
| Сетка карточек | Элементы в строках и столбцах, одинаковый размер | `grid` |
| Label + input рядом | `text` элемент рядом с `input` элемент | `form_field` |
| Tab bar | Горизонтальный ряд элементов с `role="tab"` | `tab_bar` |
| Sidebar + main | Вертикальный split: узкий элемент слева + широкий справа | `layout` |

**Уровень 5: Vision model fallback (100–500ms, ~15% элементов)**

**Когда:** элемент без A11y, без семантических тегов, без понятного CSS.
**Пример:** `<div class="x7k9m2">` с `background-image`

**Решение:** vision model (CLIP/DINOv2) классифицирует визуальный фрагмент:
- Вход: cropped image (bounding box)
- Выход: `type` + `confidence` + опциональный `description`

**Ключевая эвристика: "Semantic Density"**

Для каждого DOM-элемента вычисляем score:


semantic_score = (has_role ? 3 : 0) + (has_aria_label ? 2 : 0) +
               (is_interactive ? 2 : 0) + (has_text ? 1 : 0) +
               (has_children_with_semantics ? 1 : 0)


| Score | Решение |
|-------|---------|
| ≥ 3 | Семантический объект — включаем в VSL JSON |
| == 0, нет детей с семантикой | Декоративный — пропускаем |
| == 0, есть дети с семантикой | Контейнер — включаем как grouping |

**Результативность:**
- ~85% элементов классифицируются без vision model (уровни 1–4)
- ~15% требуют vision model (уровень 5)
- Latency: 100–300ms для типичной страницы (100–200 элементов)


### 2.2.2 Visual Fragments Pipeline

**Проблема:** элементы без A11y (images, canvas, custom widgets) нужно описать визуально.
Как генерировать эмбеддинги эффективно?

**Шаг 1: Bounding box extraction (10–50ms)**

Для каждого элемента без A11y:
1. Получить bounding box через `getBoundingClientRect()`
2. Отступить 2px (чтобы захватить border)
3. Отрисовать в offscreen canvas
4. Экспортировать как WebP (компактнее JPEG на 25–30%)

**Шаг 2: Классификация через vision model (100–300ms batch)**

| Модель | Вход | Выход | Latency (batch 10) |
|--------|------|-------|---------------------|
| CLIP (ViT-B/32) | Cropped image | `type` + `confidence` | 100–300ms |
| DINOv2 | Cropped image | `type` + features | 150–400ms |

Выход:
- `type`: `"image"` | `"icon"` | `"chart"` | `"custom_widget"` | `"unknown"`
- `confidence`: 0.0–1.0
- `description`: опционально, например `"blue submit button with white text"`

**Шаг 3: Эмбеддинг генерация — 3 варианта**

| Вариант | Формат | Размер | Плюсы | Минусы |
|---------|--------|--------|-------|--------|
| **A: CLIP embedding** | 512-dim vector | ~2 KB | Семантический поиск, сравнение | LLM не "видит" напрямую |
| **B: Base64 image** | WebP, quality 60% | 5–50 KB | LLM vision model "видит" элемент | Дорого по токенам |
| **C: Hybrid (рекомендуемый)** | Embedding + lazy image | ~2 KB + image по запросу | Экономия 80% токенов | Сложнее реализация |

**Рекомендация: Hybrid approach (Вариант C)**
- CLIP embedding для сравнения и кэширования (всегда в JSON)
- Base64 image только по запросу LLM (lazy loading)
- Экономия: ~80% токенов если LLM не запрашивает визуал

**Шаг 4: Кэширование эмбеддингов**

Алгоритм:
1. Hash = `hash(bounding_box + pixel_content)`
2. Если hash совпадает → использовать кэшированный эмбеддинг
3. Если hash изменился → перегенерировать

Кэш:
- In-memory (`Map<string, VisualFragment>`) или SQLite
- TTL: до изменения страницы (URL change → полный сброс)
- Размер: ~2 KB на элемент × 10–50 элементов = 20–100 KB

**Таблица производительности:**

| Операция | Latency | Стоимость |
|----------|---------|-----------|
| Bounding box extraction | 10–50 ms | $0 |
| CLIP classification (batch 10) | 100–300 ms | ~$0.001 |
| CLIP embedding (512-dim) | 50–100 ms | $0 |
| WebP encoding (quality 60%) | 20–50 ms | $0 |
| **Итого для 10 элементов** | **200–500 ms** | **~$0.001** |

**Формат в VSL JSON:**


{
  "id": "chart_001",
  "t": "image",
  "r": "sales_chart",
  "p": [0.1, 0.3],
  "s": [800, 400],
  "vf": "emb_abc123"
}

// Visual fragment (lazy loaded):
"visual_fragments": {
  "emb_abc123": {
    "type": "image",
    "format": "webp",
    "size": [800, 400],
    "embedding": [0.12, -0.34, ...],  // 512-dim CLIP vector
    "data": "UklGRiQAAABXQVZFZm10..."  // base64 WebP (опционально, lazy)
### 2.3 VSL Builder

**Назначение:** построение JSON-дерева в формате VSL.

**Вход:** массив семантических объектов от Segmentation Engine.

**Выход:** VSL JSON-документ, соответствующий спецификации из [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

**Структура:**

{
  "vsl_version": "1.0.0",
  "canvas": {
    "viewport": { "width": 1920, "height": 1080, "unit": "px" },
    "background": "#ffffff",
    "scale": 1.0,
    "orientation": "landscape",
    "timestamp": "2025-05-28T12:00:00Z",
    "url": "https://example.com",
    "title": "Example Page"
  },
  "objects": [
    {
      "id": "btn_submit",
      "t": "button",
      "r": "submit",
      "p": [0.5, 0.9],
      "s": [120, 40],
      "st": "enabled",
      "txt": "Отправить",
      "act": ["click"],
      "vf": "emb_abc123"
    }
  ],
  "visual_fragments": {
    "emb_abc123": {
      "type": "image",
      "format": "webp",
      "size": [120, 40],
      "data": "base64..."
    }
  }
}
**Оптимизации:**
- Короткие ключи (t, r, p, s, st, txt, act, vf) — экономия токенов
- Относительные координаты (0.0–1.0) — компактность
- Умные дефолты — не пишем то, что можно вывести
- Нет избыточности — не дублируем информацию

#### 2.3.1 Lazy Text Loading (M1.7)

**Проблема:** контентные страницы (статьи, блоги, документация) содержат длинные тексты (50+ параграфов по 50-200 слов = 4000+ токенов). При этом LLM в 95% случаев достаточно заголовков и подзаголовков для навигации.

**Решение:** длинные тексты (> порога ~200 символов) не включаются в основной VSL JSON. Вместо этого:
- `txt_preview` — первые ~50 символов текста (для контекста)
- `txt_ref: "tb_xxx"` — ссылка на кэшированный текстовый блок
- Короткие тексты (кнопки, ссылки, labels) остаются в `txt` как обычно
- Полные тексты кэшируются в `text_blocks` и отдаются по запросу через MCP tool `vsl_get_text_block(block_id)`

**Классификация элементов:**
| Тип элемента | Поведение | Обоснование |
|--------------|-----------|-------------|
| `h1`–`h6` | Всегда в `txt` | Заголовки — короткие, критичны для навигации |
| `p`, `blockquote`, `li` | Lazy если > порога | Кандидаты на lazy loading |
| `button`, `a`, `label` | Всегда в `txt` | Короткие, интерактивные |

**Экономия:** 80–90% токенов для контентных страниц (4000+ → 400–800 токенов).

**Принцип:** "pay only for what you need" — аналогично lazy loading для visual fragments (`vf`). LLM вызывает `vsl_get_text_block(block_id)` только когда действительно нужен полный текст.

### 2.4 Cache & Diff Engine

**Назначение:** кэширование статических элементов и генерация диффов.

**Кэширование:**

| Тип элемента | Кэшируется? | TTL | Обоснование |
|--------------|-------------|-----|-------------|
| Фон (background) | ✅ Да | До изменения страницы | Редко меняется |
| Логотипы | ✅ Да | До изменения страницы | Статические |
| Иконки | ✅ Да | До изменения страницы | Статические |
| Навигация (header, footer) | ✅ Да | До изменения страницы | Статические |
| Текст (контент) | ❌ Нет | — | Динамический |
| Кнопки (state) | ❌ Нет | — | Могут меняться (enabled/disabled) |
| Поля ввода (value) | ❌ Нет | — | Динамические |
| Модальные окна | ❌ Нет | — | Появляются/исчезают |

**Алгоритм кэширования:**

1. При первом вызове: полный VSL JSON + визуальные фрагменты → кэш
2. При последующих вызовах:
   - Сравнение нового VSL JSON с кэшированным
   - Статические элементы: только ссылка на кэш (hash)
   - Динамические элементы: полные данные
   - Новые элементы: добавление в кэш
   - Удалённые элементы: пометка как удалённые

**Дифф-механизм:**

{
  "diff_version": 2,
  "base_version": 1,
  "timestamp": "2025-05-28T12:01:00Z",
  "changes": {
    "added": [
      { "id": "modal_001", "t": "modal", ... }
    ],
    "modified": [
      { "id": "btn_submit", "st": "disabled", "txt": "Отправка..." }
    ],
    "removed": [
      { "id": "loading_spinner" }
    ],
    "unchanged_refs": [
      "header_001", "nav_001", "footer_001"
    ]
  }
}
**Экономия:** 60–80% данных после первого вызова (10–100 KB дифф вместо 1–2 MB полного скриншота).

### 2.5 LLM Integration Layer

**Назначение:** адаптация VSL JSON для различных LLM-провайдеров.

**Model-agnostic дизайн:**

VSL работает с **любым LLM** через промпт-инжиниринг, без fine-tuning.

**Адаптеры:**

| Провайдер | Формат входа | Особенности |
|-----------|--------------|-------------|
| OpenAI (GPT-4) | JSON + system prompt | Поддержка function calling для действий |
| Anthropic (Claude) | JSON + system prompt | Поддержка tool use для действий |
| Google (Gemini) | JSON + system prompt | Поддержка function declarations |
| Open-source (Llama, Mistral) | JSON + prompt | Через стандартный chat API |

**Промпт-шаблон:**

You are a screen understanding agent. You receive a VSL JSON representation
of the current screen. Analyze the structure and decide what action to take
to accomplish the user's goal.

Current screen (VSL JSON):
{vsl_json}

User goal: {goal}

Respond with a JSON action object:
{
  "action": "click|type|scroll|navigate|...",
  "target_id": "element_id",
  "value": "optional_value"
}
**Оптимизации:**
- Передача только диффа (если кэш есть) — экономия токенов
- Visual fragments передаются только по запросу LLM (lazy loading)
- Компактный JSON (короткие ключи) — меньше токенов

### 2.6 Action Executor

**Назначение:** выполнение действий, возвращённых LLM.

**Базовые действия:**

| Действие | Описание | Параметры |
|----------|----------|-----------|
| `click` | Клик по элементу | `target_id` |
| `type` | Ввод текста | `target_id`, `value` |
| `clear` | Очистка поля | `target_id` |
| `scroll` | Скролл | `direction`, `amount` |
| `hover` | Наведение курсора | `target_id` |
| `select` | Выбор из списка | `target_id`, `option` |

**Расширенные действия:**

| Действие | Описание | Параметры |
|----------|----------|-----------|
| `drag` | Перетаскивание | `source_id`, `target_id` |
| `drop` | Отпускание | `target_id` |
| `submit` | Отправка формы | `form_id` |
| `wait` | Ожидание | `condition`, `timeout` |

**Навигационные действия:**

| Действие | Описание | Параметры |
|----------|----------|-----------|
| `navigate` | Переход по URL | `url` |
| `go_back` | Назад (history) | — |
| `go_forward` | Вперёд (history) | — |
| `refresh` | Обновление страницы | — |

**Маппинг LLM response → action:**

LLM response:
{
  "action": "click",
  "target_id": "btn_submit",
  "value": null
}

↓ Action Executor

1. Найти элемент по target_id в VSL JSON
2. Определить координаты (из position + size)
3. Выполнить действие:
   - Web: element.click() или dispatchEvent
   - Desktop: OS-level click (CGEvent / SendInput)
   - Mobile: Accessibility performAction
4. Подождать изменения экрана (debounce)
5. Запросить новый VSL-снэпшот → дифф

### 2.7 HTTP Extractor (M1.6, DEC-024)

**Назначение:** быстрое извлечение структуры статических веб-страниц без браузера (HTTP-first стратегия).

**Проблема:** Render-путь (Playwright) требует запуска браузера (1-3s latency, ~50MB RAM). Для статических страниц (блоги, документация, новости) это избыточно — DOM можно извлечь через обычный HTTP GET + HTML-парсер.

**Решение:** HTTP Extractor — лёгкий путь извлечения VSL JSON через `fetch()` + `cheerio` (HTML-парсер). Работает без браузера, latency ~100-500ms.

**Архитектура HTTP-first:**

vsl_read_page(url)
    ↓
1. HTTP-first: extractViaHttp(url)
   ├── fetch() → raw HTML
   ├── cheerio.load() → DOM tree
   ├── buildVslFromDom() → VSL JSON (без bbox)
   └── detectSpa() → проверка SPA-маркеров
    ↓
2. Если SPA обнаружена → автоматическое переключение на Render-путь
   └── BrowserManager.navigate() → Playwright render
    ↓
3. Если HTTP-first успешен → возврат VSL JSON (без браузера)
**Компоненты HTTP Extractor:**

| Функция | Назначение | Latency |
|---------|------------|---------|
| `extractViaHttp(url)` | HTTP GET + HTML-парсинг | 100-500ms |
| `buildVslFromDom(html)` | HTML → VSL JSON через cheerio | 10-50ms |
| `detectSpa(html)` | Проверка SPA-маркеров (id="root", data-reactroot) | <1ms |
| `applyReadableFilter()` | Фильтрация шума (nav, footer, ads) | 5-10ms |

**Критические ограничения HTTP-пути:**

| Возможность | HTTP-путь (cheerio) | Render-путь (Playwright) |
|-------------|---------------------|--------------------------|
| Структура DOM | ✅ Да | ✅ Да |
| VSL JSON | ✅ Да | ✅ Да |
| Координаты (bbox) | ❌ **НЕТ** (null) | ✅ Да (getBoundingClientRect) |
| Выполнение действий | ❌ **НЕТ** (нет браузера) | ✅ Да (click, type, scroll) |
| Скриншоты | ❌ НЕТ | ✅ Да |
| SPA-рендеринг | ❌ НЕТ | ✅ Да |

**Следствия:**

1. **HTTP-путь используется ТОЛЬКО для чтения** — получение структуры страницы, извлечение текста, навигация по контенту.
2. **Для выполнения действий (vsl_execute_action) ВСЕГДА используется Render-путь** — агент не может кликать кнопки через HTTP-путь.
3. **Автоматическая стратегия:** агент вызывает `vsl_read_page(url)` без параметра `mode` — система сама определяет, какой путь использовать (HTTP-first → auto-switch to Render для SPA).
4. **VSL JSON из HTTP-пути имеет ограниченные bbox** (все координаты `null`) — агент понимает структуру страницы, но не точное расположение элементов на экране.
5. **Lazy Navigation (DEC-028):** `vsl_execute_action` автоматически навигирует браузер на URL из snapshot, если текущий URL браузера отличается. Это позволяет агенту: (1) читать страницы через HTTP-путь (быстро), (2) выполнять действия на тех же страницах (автоматический переход в Render-путь). Проверка: `browser.evaluate(() => window.location.href)` vs `snapshot.canvas.url`.

**SPA-детекция:**

HTTP Extractor проверяет HTML на наличие SPA-маркеров:
- `id="app"`, `id="root"` (React, Vue)
- `data-reactroot` (React)
- `data-vue-root` (Vue)
- `ng-app` (Angular)

Если маркер найден → автоматическое переключение на Render-путь (Playwright).

**Интеграция с ServerSession:**

Оба пути (HTTP и Render) сохраняют VSL-снэпшот в `ServerSession` для вычисления диффов на повторных чтениях:
- HTTP-путь: `session.setSnapshot(httpResult.vslDocument)`
- Render-путь: `session.setSnapshot(vslDocument)`

**Пример использования:**

// Агент НЕ выбирает режим — система сама определяет стратегию
const result = await vsl_read_page({ url: 'https://example.com' });

// Если страница статическая → HTTP-путь (быстро, без браузера)
// Если страница SPA → автоматическое переключение на Render-путь (Playwright)

// Для выполнения действий — ВСЕГДА используется Render-путь
await vsl_execute_action({ action: 'click', target_id: 'btn_submit' });
**Cross-reference:** DEC-024 (автоматическая стратегия HTTP-first, агент НЕ выбирает режим).

---
---

## 3. Data Flow

Детальный поток данных от экрана до действия и обратно:

┌─────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW                                    │
│                                                                      │
│  1. SCREEN                                                           │
│     │                                                                │
│     ▼                                                                │
│  2. CAPTURE LAYER                                                    │
│     ├── DOM/A11y → структурные данные (теги, роли, тексты, состояния)│
│     └── Visual → скриншоты отдельных элементов (только не-A11y)      │
│     │                                                                │
│     ▼                                                                │
│  3. SEGMENTATION ENGINE                                              │
│     ├── DOM-based: обход дерева → семантические объекты              │
│     ├── Vision fallback: классификация не-A11y элементов             │
│     └── Merging: объединение результатов                             │
│     │                                                                │
│     ▼                                                                │
│  4. VSL BUILDER                                                      │
│     └── Построение JSON-дерева (canvas + objects + visual_fragments)  │
│     │                                                                │
│     ▼                                                                │
│  5. CACHE & DIFF ENGINE                                              │
│     ├── Первый вызов: полный JSON → кэш                              │
│     └── Последующие: дифф (added/modified/removed/unchanged_refs)    │
│     │                                                                │
│     ▼                                                                │
│  6. LLM INTEGRATION LAYER                                            │
│     ├── Формирование промпта (VSL JSON + goal)                       │
│     ├── Отправка в LLM API                                           │
│     └── Парсинг response → action object                             │
│     │                                                                │
│     ▼                                                                │
│  7. ACTION EXECUTOR                                                  │
│     ├── Найти элемент по target_id                                   │
│     ├── Выполнить действие (click/type/scroll/...)                   │
│     └── Подождать изменение экрана                                   │
│     │                                                                │
│     ▼                                                                │
│  8. NEW SCREEN STATE → repeat from step 2                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
**Цикл (loop):**

1. Экран → Capture → Segmentation → VSL Builder → Cache/Diff
2. VSL JSON/Diff → LLM → Action
3. Action → изменение экрана → новый VSL-снэпшот
4. Repeat until goal accomplished

**Время цикла:** ~1–3 секунды (capture + build + LLM call + action execution).

---

## 4. Hybrid Data Collection

VSL использует **гибридный подход** к сбору данных:

### 4.1 Основной источник: DOM + Accessibility API

**Что извлекается:**
- Структура элементов (иерархия, вложенность)
- Типы элементов (кнопка, поле ввода, ссылка, заголовок)
- Тексты (labels, placeholders, values)
- Состояния (enabled, disabled, focused, checked, expanded)
- Координаты и размеры (bounding boxes)
- Accessibility-атрибуты (ARIA roles, labels, descriptions)

**Преимущества:**
- ✅ Точность: семантическая информация из первых рук
- ✅ Компактность: JSON весит 10–100 KB вместо 1–2 MB скриншота
- ✅ Скорость: извлечение DOM быстрее, чем скриншот + vision model
- ✅ Надёжность: не зависит от vision model accuracy

### 4.2 Вспомогательный источник: Visual Fragments

**Когда используются:**
- Изображения (img, background-image)
- Canvas/WebGL элементы (графики, игры, кастомные виджеты)
- SVG-иконки (если нет A11y-описания)
- Кастомные виджеты (без стандартных A11y-ролей)
- Визуальные эффекты (анимации, переходы)

**Как работают:**
1. Элемент идентифицируется как "не-A11y" (нет роли, label, состояния)
2. Делается скриншот **только этого элемента** (не всего экрана)
3. Скриншот конвертируется в эмбеддинг (base64, WebP)
4. Эмбеддинг добавляется в `visual_fragments` с ссылкой из объекта

**Пример:**

{
  "objects": [
    {
      "id": "chart_001",
      "t": "canvas",
      "r": "sales_chart",
      "p": [0.1, 0.3],
      "s": [800, 400],
      "vf": "emb_chart_001"
    }
  ],
  "visual_fragments": {
    "emb_chart_001": {
      "type": "image",
      "format": "webp",
      "size": [800, 400],
      "data": "UklGRiQAAABXQVZFZm10IBAA..."
    }
  }
}
**Преимущества:**
- ✅ LLM получает визуальную информацию только когда нужно
- ✅ Экономия токенов: не передаём скриншоты статических элементов повторно
- ✅ Гибкость: LLM может игнорировать visual fragments и работать только со структурой

---

## 5. Caching Strategy

### 5.1 Что кэшируется

| Категория | Примеры | TTL | Стратегия |
|-----------|---------|-----|-----------|
| **Статические элементы** | Header, footer, navigation, logos, icons | До изменения страницы | Кэшируются после первого вызова |
| **Фон** | Background color, background image | До изменения страницы | Кэшируется |
| **Стили** | CSS-стили (если не меняются) | До изменения страницы | Кэшируются |
| **Визуальные фрагменты** | Изображения, canvas (если не меняются) | До изменения элемента | Кэшируются по hash |

### 5.2 Invalidation

**Автоматическая invalidation:**
- Изменение URL страницы → полный сброс кэша
- Изменение размера viewport → сброс кэша координат
- DOM mutation observer → invalidation изменённых элементов

**Ручная invalidation:**
- `cache.clear()` — полный сброс
- `cache.invalidate(element_id)` — invalidation конкретного элемента
- `cache.invalidateBySelector(selector)` — invalidation по CSS-селектору

### 5.3 Экономия токенов

**Пример:**

| Вызов | Без кэша | С кэшем | Экономия |
|-------|----------|---------|----------|
| 1-й | 100 KB (полный JSON) | 100 KB | 0% |
| 2-й | 100 KB | 15 KB (дифф) | 85% |
| 3-й | 100 KB | 10 KB (дифф) | 90% |
| 20-й | 100 KB | 12 KB (дифф) | 88% |

**Средняя экономия:** 60–80% после первого вызова.

---

## 6. Diff Mechanism

### 6.1 Обнаружение изменений

**Алгоритм:**

1. Получить новый VSL JSON
2. Загрузить предыдущий VSL JSON из кэша
3. Сравнить:
   - Новые элементы (есть в новом, нет в старом) → `added`
   - Удалённые элементы (есть в старом, нет в новом) → `removed`
   - Изменённые элементы (есть в обоих, но различаются) → `modified`
   - Неизменённые элементы (идентичны) → `unchanged_refs`

**Сравнение элементов:**
- По `id`: быстрый lookup
- По хэшу содержимого: если хэши совпадают → элемент не изменился
- По полям: если различаются `st`, `txt`, `p`, `s` → элемент изменён

### 6.2 Формат диффа

{
  "diff_version": 2,
  "base_version": 1,
  "timestamp": "2025-05-28T12:01:00Z",
  "changes": {
    "added": [
      {
        "id": "modal_001",
        "t": "modal",
        "r": "confirmation_dialog",
        "p": [0.3, 0.4],
        "s": [400, 300],
        "ch": [...]
      }
    ],
    "modified": [
      {
        "id": "btn_submit",
        "st": "disabled",
        "txt": "Отправка..."
      }
    ],
    "removed": [
      { "id": "loading_spinner" }
    ],
    "unchanged_refs": [
      "header_001",
      "nav_001",
      "footer_001",
      "sidebar_001"
    ]
  }
}
### 6.3 Версионирование состояний

Каждый VSL-снэпшот имеет версию:

{
  "vsl_version": "1.0.0",
  "snapshot_version": 5,
  "timestamp": "2025-05-28T12:05:00Z",
  ...
}
**История:**
- Хранится в памяти (in-memory) или на диске (SQLite, JSON files)
- Можно откатиться к любой версии: `cache.checkout(version)`
- Можно сравнить две версии: `cache.diff(v1, v2)`

**Использование:**
- Откат к предыдущему состоянию (если действие было ошибочным)
- Сравнение "было/стало" (для тестирования)
- Анализ изменений экрана (для debugging)

---

## 7. Action Model

### 7.1 Базовые действия

| Действие | Описание | Параметры | Пример |
|----------|----------|-----------|--------|
| `click` | Клик по элементу | `target_id` | `{"action": "click", "target_id": "btn_submit"}` |
| `type` | Ввод текста | `target_id`, `value` | `{"action": "type", "target_id": "input_email", "value": "user@example.com"}` |
| `clear` | Очистка поля | `target_id` | `{"action": "clear", "target_id": "input_search"}` |
| `scroll` | Скролл | `direction`, `amount` | `{"action": "scroll", "direction": "down", "amount": 300}` |
| `hover` | Наведение курсора | `target_id` | `{"action": "hover", "target_id": "menu_item"}` |
| `focus` | Установка фокуса | `target_id` | `{"action": "focus", "target_id": "input_email"}` |
| `blur` | Снятие фокуса | `target_id` | `{"action": "blur", "target_id": "input_email"}` |
| `select` | Выбор из списка | `target_id`, `option` | `{"action": "select", "target_id": "select_country", "option": "Russia"}` |
| `check` | Отметить чекбокс | `target_id` | `{"action": "check", "target_id": "checkbox_terms"}` |
| `uncheck` | Снять чекбокс | `target_id` | `{"action": "uncheck", "target_id": "checkbox_terms"}` |

### 7.2 Расширенные действия

| Действие | Описание | Параметры |
|----------|----------|-----------|
| `drag` | Перетаскивание | `source_id`, `target_id` |
| `drop` | Отпускание | `target_id` |
| `submit` | Отправка формы | `form_id` |
| `reset` | Сброс формы | `form_id` |
| `open` | Открытие (modal, dropdown) | `target_id` |
| `close` | Закрытие (modal, dropdown) | `target_id` |
| `expand` | Развёртывание | `target_id` |
| `collapse` | Свёртывание | `target_id` |
| `wait` | Ожидание | `condition`, `timeout` |
| `download` | Управление загрузкой файлов | `target_id` (клик по элементу) ИЛИ `value` (URL для прямого скачивания), `save_path` (опционально) |
### 7.3 Навигационные действия

| Действие | Описание | Параметры |
|----------|----------|-----------|
| `navigate` | Переход по URL | `url` |
| `go_back` | Назад (browser history) | — |
| `go_forward` | Вперёд (browser history) | — |
| `refresh` | Обновление страницы | — |

### 7.4 Маппинг LLM response → action

**LLM response format:**

{
  "action": "click",
  "target_id": "btn_submit",
  "value": null,
  "reasoning": "Clicking the submit button to send the form"
}
**Action Executor:**

1. **Валидация:** проверить, что `action` — валидное действие, `target_id` существует в VSL JSON
2. **Поиск элемента:** найти элемент по `target_id` в VSL JSON
3. **Определение координат:** вычислить центр элемента из `position` + `size`
4. **Выполнение действия:**
   - Web: `element.click()`, `element.value = value`, `element.dispatchEvent(...)`
   - Desktop: OS-level events (CGEvent on macOS, SendInput on Windows)
   - Mobile: Accessibility performAction
5. **Ожидание:** подождать изменение экрана (debounce 500ms–1s)
6. **Новый снэпшот:** запросить новый VSL-снэпшот → дифф

---

## 8. Platform Adapters

### 8.1 Web (MVP — Phase 1)

**Платформа:** браузерное расширение или desktop-приложение с webview

**Источники данных:**
- DOM API (`document.querySelector`, `getComputedStyle`, `getBoundingClientRect`)
- Accessibility API браузера (ARIA-атрибуты, computed accessibility tree)
- Canvas API (`canvas.toDataURL()` для визуальных фрагментов)
- Image loading (`img.src` → fetch → base64)

**Интеграция:**
- OpenAI API (GPT-4)
- Anthropic API (Claude)
- Google API (Gemini)
- Любой LLM через стандартный chat API

**Use cases:**
- Автоматизация веб-навигации
- Заполнение форм
- Сбор данных с сайтов
- Тестирование веб-приложений

### 8.2 Desktop (Phase 2)

**Платформа:** macOS / Windows / Linux

**Источники данных:**
- macOS: AX API (AXUIElement) — извлечение элементов из accessibility tree
- Windows: UI Automation (IUIAutomation) — извлечение элементов
- Linux: AT-SPI (Assistive Technology Service Provider Interface)
- Screenshot API (CGWindowListCreateImage / BitBlt / XGetImage) — для visual fragments

**Интеграция:**
- Кросс-приложная автоматизация
- OS-level action execution (CGEvent / SendInput / XTest)

**Use cases:**
- Автоматизация десктопных приложений
- Перенос данных между программами
- RPA-решения

### 8.3 Mobile (Phase 3)

**Платформа:** iOS / Android

**Источники данных:**
- iOS: UIAccessibility API (VoiceOver data)
- Android: AccessibilityService (TalkBack data)
- Screenshot API (UIImage / Bitmap) — для visual fragments

**Интеграция:**
- Мобильная автоматизация
- Accessibility performAction для выполнения действий

**Use cases:**
- Автоматизация мобильных приложений
- Тестирование мобильных UI

---

## 9. Integration API

SDK surface для интеграции VSL в другие продукты:

### 9.1 Snapshot Generation

// Получить полный VSL-снэпшот
const snapshot = await vsl.getSnapshot({
  source: 'web', // 'web' | 'desktop' | 'mobile'
  includeVisualFragments: true,
  compress: true
});

// Получить дифф от предыдущего снэпшота
const diff = await vsl.getDiff({
  source: 'web',
  baseVersion: 1
});
### 9.2 Cache Management

// Очистить кэш
await vsl.cache.clear();

// Invalidation конкретного элемента
await vsl.cache.invalidate('btn_submit');

// Invalidation по селектору
await vsl.cache.invalidateBySelector('.modal');

// Checkout к предыдущей версии
const oldSnapshot = await vsl.cache.checkout(3);

// Сравнить две версии
const diff = await vsl.cache.diff(1, 5);
### 9.3 Diff Subscription

// Подписаться на изменения экрана
const unsubscribe = vsl.onDiff((diff) => {
  console.log('Screen changed:', diff);
});

// Отписаться
unsubscribe();
### 9.4 LLM Provider Adapters

// OpenAI
const openaiAdapter = new OpenAIAdapter({
  apiKey: 'sk-...',
  model: 'gpt-4'
});
const action = await openaiAdapter.decide({
  vslJson: snapshot,
  goal: 'Fill the form and submit'
});

// Anthropic
const anthropicAdapter = new AnthropicAdapter({
  apiKey: 'sk-ant-...',
  model: 'claude-3-opus'
});
const action = await anthropicAdapter.decide({
  vslJson: snapshot,
  goal: 'Fill the form and submit'
});

// Custom LLM
const customAdapter = new CustomLLMAdapter({
  endpoint: 'https://my-llm.example.com/api',
  promptTemplate: '...'
});
const action = await customAdapter.decide({
  vslJson: snapshot,
  goal: 'Fill the form and submit'
});
### 9.5 Action Execution

// Выполнить действие
await vsl.executeAction({
  action: 'click',
  target_id: 'btn_submit'
});

// Выполнить действие с параметрами
await vsl.executeAction({
  action: 'type',
  target_id: 'input_email',
  value: 'user@example.com'
});

// Выполнить навигационное действие
await vsl.executeAction({
  action: 'navigate',
  url: 'https://example.com'
});
---

## 10. Error Handling & Resilience

### 10.1 Fallback Strategies

**DOM extraction failed:**
- Fallback: использовать только visual fragments + vision model
- Результат: менее точный, но работающий VSL JSON

**Vision model failed:**
- Fallback: пропустить visual fragment, добавить placeholder
- Результат: элемент без визуальной информации, но с координатами

**LLM API failed:**
- Retry: 3 попытки с exponential backoff
- Fallback: использовать предыдущее действие (если есть)
- Error: вернуть ошибку пользователю

**Action execution failed:**
- Retry: 2 попытки
- Fallback: попробовать альтернативный способ (координаты вместо selector)
- Error: вернуть ошибку LLM для повторного решения

### 10.2 Graceful Degradation

| Уровень | Что работает | Что не работает |
|---------|--------------|-----------------|
| **Full** | DOM + A11y + Visual fragments | — |
| **Degraded 1** | DOM + A11y (без visual fragments) | Элементы без A11y не видны |
| **Degraded 2** | Только visual fragments + vision model | Менее точная семантика |
| **Minimal** | Только DOM (без A11y, без visual) | Базовая структура без состояний |

### 10.3 Retry Logic

async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i <maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      await sleep(delay);
    }
  }
}
---

## 11. Performance Considerations

### 11.1 Latency Budget

| Компонент | Целевая latency | Обоснование |
|-----------|-----------------|-------------|
| Capture (DOM/A11y) | 50–200 ms | Зависит от размера DOM |
| Segmentation | 100–500 ms | Обход дерева + vision model (если нужен) |
| VSL Builder | 10–50 ms | Построение JSON |
| Cache/Diff | 10–50 ms | Сравнение хэшей |
| LLM API call | 500–2000 ms | Зависит от провайдера и размера контекста |
| Action execution | 50–200 ms | Зависит от действия |
| **Итого** | **~1–3 секунды** | Приемлемо для computer use agents |

### 11.2 Token Optimization

**Стратегии:**
- Короткие ключи (t, r, p, s, st, txt) — экономия ~30% токенов
- Относительные координаты (0.0–1.0) — компактнее абсолютных
- Диффы вместо полных снэпшотов — экономия 60–80% после первого вызова
- Visual fragments по запросу (lazy loading) — не передаём визуал, если не нужен
- Умные дефолты — не пишем то, что можно вывести

**Пример экономии:**

| Подход | Размер | Токены |
|--------|--------|--------|
| Полный скриншот (JPEG) | 1–2 MB | ~1000 токенов (vision) |
| Полный VSL JSON | 50–100 KB | ~500–1000 токенов |
| VSL дифф | 5–15 KB | ~50–150 токенов |

### 11.3 Throughput

**Целевая пропускная способность:**
- 1 цикл (snapshot → LLM → action) в 1–3 секунды
- 20–60 циклов в минуту
- Достаточно для большинства computer use задач

**Оптимизации:**
- Параллельная обработка: capture + segmentation могут работать асинхронно
- Кэширование: не пересчитываем статические элементы
- Debounce: не запрашиваем новый снэпшот слишком часто (500ms–1s после действия)

---

## 12. Security & Privacy

### 12.1 Data Handling

**Что обрабатывается:**
- Структура экрана (DOM, accessibility tree)
- Тексты на экране (могут содержать PII)
- Визуальные фрагменты (могут содержать чувствительную информацию)

**Принципы:**
- Все данные обрабатываются локально (на устройстве пользователя)
- Отправка в LLM API — только с явного согласия пользователя
- Возможность фильтрации PII перед отправкой

### 12.2 PII Filtering

**Автоматическое обнаружение:**
- Email-адреса
- Телефонные номера
- Кредитные карты
- Пароли
- Персональные данные (имена, адреса)

**Стратегии:**
- **Masking:** замена PII на placeholder (`user@example.com` → `[EMAIL]`)
- **Redaction:** полное удаление PII из VSL JSON
- **Encryption:** шифрование PII перед отправкой (если нужно сохранить)

**Конфигурация:**

const vsl = new VSLClient({
  piiFiltering: {
    enabled: true,
    strategy: 'mask', // 'mask' | 'redact' | 'encrypt'
    customPatterns: [
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/, replacement: '[SSN]' }
    ]
  }
});
### 12.3 Sandboxing

**Web (browser extension):**
- Content script работает в sandboxed environment
- Нет доступа к другим вкладкам без явного разрешения
- Изоляция от основной страницы (Content Security Policy)

**Desktop:**
- Приложение работает в изолированном процессе
- Ограниченные permissions (только accessibility API, без root/admin)
- Sandbox на macOS (App Sandbox), Windows (Low Integrity Level)

**Mobile:**
- Приложение работает в sandbox (iOS/Android)
- Ограниченные permissions (только accessibility service)
- Нет доступа к другим приложениям без явного разрешения
### 12.4 Audit Logging

**Что логируется:**
- Все действия (click, type, scroll, navigate)
- Все VSL-снэпшоты (опционально)
- Все LLM API calls (опционально)

**Хранение:**
- Локально (на устройстве пользователя)
- Шифрование at rest
- Автоматическая ротация (удаление старых логов)

**Использование:**
- Debugging
- Compliance
- Анализ производительности

### 12.5 Prompt Injection Filter (M1.8)

> **Обновлено:** DEC-027 уточнён — фильтр работает на входе (до сегментации), применяется ко всем источникам текста.

**Проблема:** VSL как middleware перехватывает весь текст с экранов до отправки в LLM. Prompt injection через веб-контент — реальная угроза: скрытые инструкции в `display:none`, alt-текстах, meta-тегах, комментариях HTML. Без фильтрации LLM может выполнить вредоносные инструкции, замаскированные под контент страницы.

**Решение:** Prompt Injection Filter — слой безопасности **на входе Capture Layer**, сразу после извлечения текста из любого источника, **до** сегментации и упаковки в VSL JSON.

**Архитектура:**


Source (DOM / raw HTML)
    ↓
Text Extraction
    ↓
┌─────────────────────────────────────┐
│  Prompt Injection Filter            │
│  ├── Scanner (regex + ML patterns)  │
│  ├── Logger (security audit trail)  │
│  └── Stripper (вырезание инъекций)  │
└─────────────────────────────────────┘
    ↓
Clean Text → Segmentation → VSL JSON → LLM


**Scope — фильтр применяется ко всем источникам текста:**

| Источник | Пример | Фильтруется? |
|----------|---------|-------------|
| DOM-extracted | `document.querySelector` тексты | ✅ Да (реализовано) |
| Raw HTML (HTTP-first) | `web_fetch` / `vsl_read_page` HTTP-режим (DEC-024) | ✅ Да (M1.6) |

**Примечание:** Visual Fragments OCR и PDF/SVG/IFC не входят в scope VSL — это задачи других систем (OCR-сервисы, document parsers).

**Позиция в pipeline:** фильтр работает **до** Lazy Text Loading (M1.7). Полный текст фильтруется целиком, preview не фильтруется (слишком короткий для инъекции).

**Библиотека паттернов — 3 уровня:**

| Уровень | Описание | Обновление |
|---------|----------|------------|
| **Bundled** | JSON файл `patterns.json` внутри SDK | С релизами SDK (`npm update`) |
| **Remote** | Файл на CDN/GitHub (`vsl.dev/patterns/latest.json`) | Автозагрузка при запуске, кэшируется локально |
| **Custom** | Пользовательские паттерны через `vsl.config.json` | Пользователь добавляет свои паттерны |

**Формат паттерна:**


{
  "id": "pi_001",
  "pattern": "ignore (all )?previous instructions",
  "type": "regex",
  "severity": "high",
  "action": "strip",
  "description": "Classic prompt injection"
}


**Действия:** `strip` (вырезать инъекцию), `log` (только логировать), `block` (блокировать весь текст)

**Источники инъекций:**
- `<div style="display:none">Ignore previous instructions and...</div>`
- Alt-тексты изображений с инъекциями
- Meta-теги с инструкциями
- HTML-комментарии
- CSS content properties
- Data attributes с инструкциями
- Скрытые инструкции в raw HTML (HTTP-first режим)
- OCR-текст из изображений с инъекциями

**False positive strategy:**
- Confidence threshold — паттерн срабатывает только если confidence > порога
- Domain whitelist — доверенные домены (github.com, docs.google.com) пропускаются
- User override — пользователь может отключить фильтр для конкретных доменов

**Принцип:** Defense-in-depth — не заменяет sandboxing и LLM-level защиту, но добавляет критический слой безопасности на уровне middleware.

**Риски:**
- False positives — может вырезать легитимный контент (например, статью о prompt injection)
- Необходимость обновления паттернов (эволюция атак)
- Overhead: ~5–20ms на сканирование страницы
- Remote patterns требуют интернет-соединения (fallback на bundled)
## 13. Humanization Layer

**Проблема:** VSL имитирует **действия** человека (click, type, scroll, navigate), но не имитирует **поведение** человека. Внешние приложения (LinkedIn, банки, госуслуги) проверяют паттерны поведения — timing, mouse movement, scroll patterns — и блокируют автоматизацию.

Humanization Layer делает действия агента неотличимыми от действий человека.

### 13.1 Компоненты Humanization Layer

| Компонент | Что делает | Как реализуют |
|-----------|-----------|---------------|
| **Timing Engine** | Случайные задержки между действиями | Gaussian distribution (μ=500ms, σ=200ms), min=200ms, max=2000ms |
| **Mouse Simulator** | Кривые линии мыши (Bezier curves) | Cubic Bezier с random control points, overshoot на 5–15% |
| **Scroll Randomizer** | Случайные паттерны скролла | Random step size (50–300px), random pauses, occasional scroll-back |
| **Rate Limiter** | Ограничение действий в час | Configurable: N actions/hour, N profiles/day |
| **Session Manager** | Управление сессиями | Random session duration (5–30 min), random breaks |
| **Fingerprint Rotator** | Ротация browser fingerprint | userAgent, WebGL, canvas hash, timezone |
| **Typing Simulator** | Человечный ввод текста | Random delay между keystrokes (50–200ms), occasional typos + backspace |

### 13.2 Архитектура


Action Executor → Humanization Layer → Browser/OS
                     ↓
              ┌──────────────┐
              │ Timing Engine │ ← Gaussian delay
              │ Mouse Sim     │ ← Bezier curves
              │ Scroll Rand   │ ← Random patterns
              │ Rate Limiter  │ ← Config limits
              │ Session Mgr   │ ← Session state
              │ Fingerprint   │ ← Rotation
              │ Typing Sim    │ ← Human-like typing
              └──────────────┘


### 13.3 Конфигурация per-site


{
  "humanization": {
    "linkedin.com": {
      "max_actions_per_hour": 30,
      "max_profiles_per_day": 50,
      "timing": { "min": 1000, "max": 3000, "mean": 1500 },
      "typing_speed": { "min": 80, "max": 150 }
    },
    "default": {
      "max_actions_per_hour": 100,
      "timing": { "min": 200, "max": 1000, "mean": 500 }
    }
  }
}


### 13.4 Когда НЕ нужен

- Внутренние приложения (корпоративные тулы)
- Тестовые среды
- Сайты без anti-bot detection
- Когда агент работает от имени пользователя (user-present mode)

### 13.5 Производительность

| Операция | Overhead |
|----------|----------|
| Timing delay | +200–2000ms (intentional) |
| Bezier mouse movement | +50–200ms |
| Scroll randomization | +10–50ms |
| Typing simulation | +50–500ms (зависит от длины текста) |
| **Итого overhead** | **+300–3000ms per action** |

### 13.6 Связь с VSL Pipeline

Humanization Layer встраивается **после** Action Executor и **до** Browser/OS:


VSL JSON → LLM → Action JSON → Action Executor → Humanization Layer → Browser/OS
                                                  ↑
                                          Добавляет задержки,
                                          кривые мыши, случайный
                                          скролл, ротацию fingerprint


**Важно:** Humanization Layer НЕ влияет на VSL JSON (snapshot, diff, caching).
Он влияет только на выполнение действий (action execution).

## 14. Extended Domains — 2D Чертежи и 3D Графика

**Цель:** Расширить VSL за пределы стандартных UI (web/desktop/mobile) для работы с архитектурными чертежами, инженерными схемами и 3D-сценами.

**Ключевая идея:** CAD/BIM/3D форматы УЖЕ содержат богатую семантику (типы элементов, слои, размеры, материалы, связи). В отличие от веб (где нужно ИНФЕРИТЬ семантику из DOM), здесь семантика уже заложена в формате. VSL только извлекает и унифицирует её.


### 14.1 2D Чертежи (SVG, PDF, DWG/DXF)

**Источники:**

| Формат | Что содержит | Как парсить |
|--------|-------------|-------------|
| **SVG** | Векторные примитивы (line, rect, circle, path, text) | DOM-парсинг (как обычный HTML) |
| **PDF** | Вектор + растр, слои, аннотации | PDF.js → извлечение объектов |
| **DWG/DXF** (AutoCAD) | Линии, дуги, размеры, блоки, слои | Библиотеки (libdxfrw, ODA) |
| **IFC 2D** (BIM) | Планы этажей, разрезы, фасады | IFC.js, IfcOpenShell |

**Новые типы элементов для 2D чертежей:**

| Тип | Описание | Пример |
|------|----------|--------|
| `line` | Линия (стена, ось) | Structural wall, dimension line |
| `arc` | Дуга | Curved wall, pipe bend |
| `circle` | Круг | Column, pipe cross-section |
| `polyline` | Ломаная линия | Boundary, path |
| `dimension` | Размерная линия | "3600 mm" с засечками |
| `annotation` | Текстовая пометка | Note, label, callout |
| `callout` | Выноска | Detail callout, section marker |
| `layer` | Слой чертежа | A-WALL, A-GLAZING, M-HVAC |
| `block` | Повторяющийся элемент | Window, door, symbol |
| `hatch` | Штриховка | Concrete, brick, earth |

**Пример VSL JSON для 2D чертежа:**


{
  "vsl_version": "1.0.0",
  "canvas": {
    "viewport": { "width": 297, "height": 210, "unit": "mm" },
    "scale": 0.01,
    "coordinate_system": "cartesian",
    "background": "#ffffff"
  },
  "objects": [
    {
      "id": "wall_001",
      "t": "line",
      "r": "structural_wall",
      "p": [0.1, 0.2],
      "s": [0.8, 0.0],
      "sty": { "stroke": "#000", "stroke_width": 2 },
      "meta": { "layer": "A-WALL", "thickness": 200 }
    },
    {
      "id": "dim_001",
      "t": "dimension",
      "r": "linear_dimension",
      "p": [0.1, 0.15],
      "s": [0.8, 0.05],
      "txt": "3600",
      "meta": { "measured_value": 3600, "unit": "mm" }
    },
    {
      "id": "annotation_001",
      "t": "text",
      "r": "note",
      "p": [0.5, 0.9],
      "txt": "Section A-A",
      "sty": { "font": { "size": 12, "weight": "bold" } }
    }
  ]
}


**Расширения canvas для 2D:**
- `coordinate_system`: "cartesian" | "polar" | "geographic"
- `scale`: масштаб чертежа (0.01 = 1:100)
- `unit`: "mm" | "cm" | "m" | "inch" | "ft"


### 14.2 3D Графика (Three.js, BIM, CAD)

**Источники:**

| Формат | Что содержит | Как парсить |
|--------|-------------|-------------|
| **Three.js/Babylon.js** | Scene graph (meshes, lights, cameras) | `scene.traverse()` → извлечение объектов |
| **WebGL** | GPU-рендеринг, нет scene graph | Framebuffer capture + depth buffer |
| **Unity/Unreal** | Game objects, components, transforms | Platform-specific API |
| **BIM 3D** (IFC) | Элементы здания с геометрией | IFC.js → извлечение IfcWall, IfcWindow, ... |
| **CAD 3D** (STEP, IGES) | B-rep геометрия, сборки | OpenCASCADE, FreeCAD |

**Новые поля для 3D:**

| Поле | Тип | Описание |
|------|-----|----------|
| `pos3d` | `[x, y, z]` | Позиция в 3D пространстве |
| `rot3d` | `[rx, ry, rz]` | Вращение (Euler angles или quaternion) |
| `scale3d` | `[sx, sy, sz]` | Масштаб |
| `camera` | `{...}` | Параметры камеры (position, target, fov, near, far) |
| `material` | `string` | Материал (concrete, glass, wood, metal) |
| `light` | `{...}` | Источник света (position, type, intensity, color) |

**Пример VSL JSON для 3D сцены:**


{
  "vsl_version": "1.0.0",
  "canvas": {
    "viewport": { "width": 1920, "height": 1080, "unit": "px" },
    "camera": {
      "type": "perspective",
      "position": [10, 5, 15],
      "target": [0, 0, 0],
      "up": [0, 1, 0],
      "fov": 60,
      "near": 0.1,
      "far": 1000
    },
    "coordinate_system": "right_handed_y_up"
  },
  "objects": [
    {
      "id": "wall_north",
      "t": "mesh",
      "r": "structural_wall",
      "p": [0.5, 0.3],
      "s": [10, 3, 0.3],
      "pos3d": [0, 1.5, -5],
      "rot3d": [0, 0, 0],
      "scale3d": [1, 1, 1],
      "sty": {
        "material": "concrete",
        "color": "#808080",
        "opacity": 1.0
      },
      "meta": {
        "layer": "A-WALL",
        "ifc_type": "IfcWall",
        "volume": 15.0,
        "area": 30.0
      }
    },
    {
      "id": "window_001",
      "t": "mesh",
      "r": "window",
      "p": [0.3, 0.4],
      "s": [1.2, 1.5, 0.1],
      "pos3d": [0, 1.5, -4.9],
      "sty": {
        "material": "glass",
        "color": "#87CEEB",
        "opacity": 0.3,
        "reflectivity": 0.5
      }
    }
  ]
}


**Расширения canvas для 3D:**
- `camera`: параметры камеры (type, position, target, up, fov, near, far)
- `coordinate_system`: "right_handed_y_up" | "left_handed_y_up" | "right_handed_z_up"


### 14.3 Расширения стилей и материалов

**Из extended_format_specs.md:**

| Расширение | Поля | Описание |
|------------|------|----------|
| **Style** | `opacity`, `shadow`, `font`, `stroke` | Прозрачность, тени, шрифты, обводка |
| **Material** | `texture`, `reflectivity`, `roughness` | Текстуры, отражение, шероховатость |
| **Animation** | `animate`, `duration`, `loop`, `trigger` | Ключевые кадры, длительность, цикл |
| **Behavior** | `on_click`, `on_hover`, `condition`, `stateful` | Интерактивность, условия, состояния |

**Пример material в VSL JSON:**


{
  "id": "floor_001",
  "t": "mesh",
  "r": "floor",
  "sty": {
    "material": "wood",
    "texture": "textures/oak_floor.jpg",
    "reflectivity": 0.2,
    "roughness": 0.8,
    "color": "#8B4513"
  }
}



### 14.4 3D-действия

**Новые действия для 3D-сцен:**

| Действие | Описание | Параметры |
|----------|----------|----------|
| `rotate_camera` | Поворот камеры | `target`, `angle`, `axis` |
| `zoom` | Приближение/удаление | `factor`, `target` |
| `pan` | Панорамирование | `direction`, `amount` |
| `isolate_layer` | Изолировать слой | `layer_name` |
| `hide_layer` | Скрыть слой | `layer_name` |
| `show_layer` | Показать слой | `layer_name` |
| `measure_distance` | Измерить расстояние | `point_a`, `point_b` |
| `measure_area` | Измерить площадь | `object_id` |
| `set_camera` | Установить камеру | `position`, `target`, `fov` |
| `explode_view` | Разнесённый вид | `factor`, `axis` |

**Пример действия:**


{
  "action": "isolate_layer",
  "target": "A-GLAZING",
  "description": "Show only windows and glass elements"
}



### 14.5 Ключевые проблемы и решения

| Проблема | Сложность | Решение |
|----------|-----------|---------|
| **Извлечение scene graph из WebGL** | 🔴 Высокая | Intercept Three.js/Babylon.js API calls |
| **Окклюзия (перекрытие объектов)** | 🟡 Средняя | Depth buffer analysis + raycasting |
| **Большие модели (100K+ объектов)** | 🔴 Высокая | LOD (Level of Detail) + frustum culling + lazy loading |
| **Точные размеры** | 🟢 Низкая | CAD/BIM форматы содержат точные метаданные |
| **Слои и фильтры** | 🟢 Низкая | Метаданные из форматов (layer, category) |


### 14.6 Фазы реализации

**Phase 1: 2D чертежи (SVG/PDF)** — 🟢 2-4 недели
- Расширить VSL types: `line`, `arc`, `dimension`, `annotation`, `layer`
- Добавить `coordinate_system`, `scale`, `unit` в canvas
- Парсеры: SVG DOM, PDF.js

**Phase 2: 3D веб-сцены (Three.js/Babylon.js)** — 🟡 4-8 недель
- Расширить VSL: `pos3d`, `rot3d`, `scale3d`, `camera`, `material`
- Scene graph extraction через JS API
- Парсеры: Three.js scene.traverse(), Babylon.js scene.meshes

**Phase 3: BIM/CAD (IFC, DWG)** — 🟡 4-6 недель
- Специализированные парсеры (IFC.js, libdxfrw)
- Маппинг IFC types → VSL types (IfcWall → mesh + r: "wall")
- Сохранение метаданных (volume, area, material properties)


### 14.7 Примеры использования

**Сценарий 1: AI читает архитектурный чертёж**


Пользователь: "Найди все окна на северном фасаде и рассчитай площадь остекления"

AI читает VSL JSON:
→ objects с r: "window", meta.layer: "A-GLAZING", meta.orientation: "north"
→ Находит 12 окон
→ Суммирует meta.area каждого
→ Ответ: "12 окон, общая площадь остекления: 28.8 м²"


**Сценарий 2: AI управляет BIM-моделью**


Пользователь: "Покажи все несущие стены и изолируй их"

AI генерирует действия:
→ { action: "isolate_layer", target: "A-WALL" }
→ { action: "set_camera", position: [...], target: "building_center" }
→ Ответ: "Изолировано 24 несущие стены. Камера установлена на центр здания."


**Сценарий 3: AI анализирует инженерную схему**


Пользователь: "Найди все трубы диаметром больше 100мм"

AI читает VSL JSON:
→ objects с r: "pipe", meta.diameter > 100
→ Находит 8 труб
→ Ответ: "8 труб диаметром >100мм: 4×DN150, 3×DN200, 1×DN250"



### 14.8 Связь с VSL Pipeline

Extended Domains встраиваются в существующий pipeline:


Capture Layer (SVG/PDF/IFC/Three.js)
    ↓
Segmentation Engine (расширенные типы: line, arc, mesh, ...)
    ↓
VSL Builder (расширенные поля: pos3d, rot3d, camera, material)
    ↓
Cache & Diff Engine (без изменений)
    ↓
LLM Adapter (расширенные действия: rotate_camera, isolate_layer, ...)
    ↓
Action Executor (выполнение 3D-действий)


**Важно:** Extended Domains НЕ ломают обратную совместимость. Новые типы и поля — опциональные расширения. Базовый VSL (web/desktop/mobile) работает как прежде.


---


---



## 15. Integration with AI Agents

### 15.1 5-Layer Integration Architecture

VSL provides 5 layers for integration with AI agents, from low-level SDK to high-level MCP protocol.

| Layer | Package | Description | Phase |
|-------|---------|-------------|-------|
| **Layer 1: Core SDK** | `@vsl/sdk` | TypeScript library — ядро системы. Capture Layer, Segmentation, Cache, Diff, Actions | Phase 1 |
| **Layer 2: MCP Server** | `@vsl/mcp-server` | MCP Protocol (JSON-RPC over stdio). Для Claude Desktop, Cline, TaoCoder. **Рекомендуется для MVP** | Phase 1 |
| **Layer 3: REST API** | `@vsl/api-server` | HTTP/WebSocket. Для серверной автоматизации с headless browser | Phase 2+ |
| **Layer 4: CLI** | `@vsl/cli` | Command-line interface. Для scripting и debugging | Phase 2+ |
| **Layer 5: Chrome Extension** | `@vsl/extension` | Content script для DOM access + background script для коммуникации с MCP/API | Phase 1 |

### 15.2 MCP Server (Recommended for MVP)

MCP (Model Context Protocol) — протокол от Anthropic для подключения инструментов к LLM. VSL как MCP-сервер — самый естественный путь интеграции.

#### Архитектура

```
AI Agent (Claude/Cline/TaoCoder)
    │ MCP Protocol (JSON-RPC over stdio)
    ▼
VSL MCP Server (@vsl/mcp-server)
    │
    ├── Tools:
    │   ├── vsl_get_snapshot() → VSL JSON
    │   ├── vsl_get_diff() → только изменения
    │   ├── vsl_execute_action({ action, target_id, value })
    │   ├── vsl_navigate({ url })
    │   ├── vsl_clear_cache()
    │   └── vsl_get_visual({ element_id }) → visual fragment
    │
    └── Resources:
        ├── vsl://current → текущий snapshot
        └── vsl://diff → последний diff
    │
    ▼
Core SDK (@vsl/sdk)
    │
    ▼
Chrome Extension (@vsl/extension)
    │
    ▼
DOM (веб-страница)
```

#### Конфигурация для AI-агентов

```json
{
  "mcpServers": {
    "vsl": {
      "command": "npx",
      "args": ["@vsl/mcp-server"],
      "env": {
        "VSL_PLATFORM": "web",
        "VSL_LLM_PROVIDER": "anthropic"
      }
    }
  }
}
```

#### MCP Tools

| Tool | Описание | Параметры | Возвращает |
|------|----------|-----------|------------|
| `vsl_get_snapshot` | Получить текущий VSL snapshot | `url?` (опционально) | VSL JSON |
| `vsl_get_diff` | Получить только изменения | — | Diff JSON |
| `vsl_execute_action` | Выполнить действие | `action`, `target_id`, `value?` | `{ success: boolean }` |
| `vsl_navigate` | Перейти по URL | `url` | `{ success: boolean }` |
| `vsl_clear_cache` | Сбросить кэш | — | `{ success: boolean }` |
| `vsl_get_visual` | Получить visual fragment | `element_id` | Base64 WebP image |

### 15.3 REST API (Phase 2+)

Для серверной автоматизации с headless browser (Puppeteer/Playwright):

```typescript
// VSL API Server
const app = express();

app.get('/snapshot', async (req, res) => {
  const vsl = await captureLayer.getSnapshot();
  res.json(vsl);
});

app.post('/action', async (req, res) => {
  const { action, target_id, value } = req.body;
  await actionExecutor.execute({ action, target_id, value });
  res.json({ success: true });
});

app.get('/diff', async (req, res) => {
  const diff = await cacheEngine.getDiff();
  res.json(diff);
});
```

### 15.4 Core SDK (Direct Integration)

Для встраивания в код агента:

```typescript
import { VSLClient } from '@vsl/sdk';

const vsl = new VSLClient({
  platform: 'web',
  browserExtension: true
});

const snapshot = await vsl.getSnapshot();
const action = await llm.decide({ vslJson: snapshot, goal: 'Fill the form' });
await vsl.executeAction(action);
const diff = await vsl.getSnapshot({ diff: true });
```

### 15.5 Chrome Extension (DOM Access)

Chrome Extension (Manifest V3) обеспечивает доступ к DOM:

```
┌─────────────────────────────────────────────────┐
│              Chrome Extension                     │
│                                                   │
│  Content Script          Background Script        │
│  (в контексте страницы)  (service worker)         │
│  ├── Извлекает DOM       ├── Вызывает LLM API    │
│  ├── Выполняет действия  ├── Получает action      │
│  └── Отправляет в BG     └── Отправляет обратно   │
│                                                   │
│  Popup UI (управление агентом)                    │
└─────────────────────────────────────────────────┘
```

**Content script** инжектится в каждую страницу через `manifest.json` → `content_scripts`:
- Извлекает DOM: `querySelectorAll('*')`, `getBoundingClientRect()`, ARIA-атрибуты
- Выполняет действия: `element.click()`, `element.value = text`, `element.scrollIntoView()`

**Background script** (service worker):
- Получает данные от content script через `chrome.runtime.sendMessage`
- Формирует VSL JSON → отправляет в LLM API
- Получает action от LLM → отправляет обратно в content script

### 15.6 Data Flow: Agent → Action

Полный цикл взаимодействия агента с VSL:

```
1. Агент вызывает vsl_get_snapshot() через MCP
2. MCP Server → Core SDK → Chrome Extension → DOM
3. DOM → VSL JSON (с кэшированием и диффом)
4. VSL JSON → Агент → LLM (function calling)
5. LLM → { action: "click", target_id: "btn_submit" }
6. Агент вызывает vsl_execute_action() через MCP
7. MCP Server → Core SDK → Chrome Extension → DOM
8. DOM выполняет действие (click)
9. Новый snapshot → diff → агент → LLM → следующее действие
```

### 15.7 Out-of-the-Box Features (MVP)

**Работает из коробки:**
- ✅ Chrome Extension для веб-страниц
- ✅ DOM/A11y extraction
- ✅ VSL JSON generation
- ✅ LLM integration (нужен только API ключ)
- ✅ Caching + Diff (экономия 60-80% токенов)
- ✅ Базовые действия (click, type, scroll, navigate)

**Требует настройки:**
- ⚠️ Visual Fragments Pipeline (CLIP/DINOv2) — интеграция модели
- ⚠️ Humanization Layer — конфигурация per-site

**Не входит в MVP:**
- ❌ Desktop/Mobile (Phase 2-3)
- ❌ Extended Domains CAD/BIM/3D (Phase 4)
- ❌ Ecosystem & Standardization (Phase 6)

---

## Cross-References

- [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md) — продуктовая концепция VSL, value proposition, non-goals
- [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md) — целевая аудитория и сценарии использования
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — принципы проектирования JSON-схемы, API-паттерны, naming conventions
- [ROADMAP.md](./ROADMAP.md) — план реализации по фазам (Web → Desktop → Mobile)
- [DECISIONS.md](./DECISIONS.md) — все принятые архитектурные решения
- [CHECK_ALL.md](./CHECK_ALL.md) — контракт чек-пайплайна: quality gates S0–S7 (python S0–S4 + TypeScript S5–S7: lint/typecheck/build+tests), запуск, интерпретация сбоев, логи
- [README_AI.md](./README_AI.md) — project bible для AI (one-shot ingestion)