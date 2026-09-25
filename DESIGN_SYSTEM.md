# DESIGN_SYSTEM.md — Visual Scene Language (VSL)

> Defensive Publication | Author: Maxim Zhadobin | Date: 28.05.2025 | Version: v0.1
> License: CC BY 4.0
>
> **Важно:** VSL — это JSON-формат и SDK для AI-агентов, а не UI-приложение.
> Данный документ описывает принципы проектирования JSON-схемы, API-паттерны
> и соглашения по именованию элементов VSL.

---

## 1. Overview

DESIGN_SYSTEM.md определяет принципы проектирования VSL как JSON-формата и SDK.
VSL не является UI-проектом — это инфраструктурный слой для AI-агентов, работающих
с экраном. Документ описывает:

- Принципы проектирования JSON-схемы (минимализм, семантика, extensibility)
- Соглашения по именованию элементов (типы, свойства, состояния, действия)
- Структуру модели данных (canvas, objects tree, visual fragments)
- API-паттерны SDK (snapshot generation, caching, diff, integration)
- Стратегию версионирования и миграции
- Паттерны обработки ошибок

**Cross-references:**
- Концепция продукта → [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md)
- Целевая аудитория → [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md)
- Архитектура → [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 2. JSON Schema Design Principles

### 2.1 Минимализм и эффективность токенов

VSL оптимизирован для LLM-контекста. Каждый байт JSON стоит токенов.

**Принципы:**
- **Краткие ключи**: используем короткие, но читаемые имена (`t` вместо `type`, `p` вместо `position`, `s` вместо `size`). Но не в ущерб читаемости — баланс.
- **Нет избыточности**: не дублируем информацию. Если элемент имеет `role: "button"`, не добавляем `is_button: true`.
- **Умные дефолты**: если свойство не указано, используется дефолт. Не пишем `opacity: 1.0` явно.
- **Компактные координаты**: используем относительные координаты и якоря вместо абсолютных пикселей где возможно.

**Пример:**
{
  "t": "button",
  "r": "submit",
  "p": [0.5, 0.9],
  "s": [120, 40],
  "st": "enabled",
  "txt": "Отправить"
}
Вместо:
{
  "type": "button",
  "role": "submit_form_button",
  "position": {"x": 0.5, "y": 0.9, "unit": "relative"},
  "size": {"width": 120, "height": 40, "unit": "pixels"},
  "state": "enabled",
  "text": "Отправить",
  "is_interactive": true,
  "is_visible": true
}
### 2.2 Семантическая ясность

Каждый элемент VSL должен нести чёткую семантику для LLM.

**Принципы:**
- **Element types** отражают реальную семантику: `button`, `input`, `text`, `image`, `link`, `checkbox`, `select`, `container`.
- **Roles** уточняют назначение: `submit`, `cancel`, `search`, `navigation`, `login`.
- **States** описывают текущее состояние: `enabled`, `disabled`, `focused`, `hovered`, `selected`, `checked`, `expanded`, `collapsed`.
- **Нет абстракций без семантики**: не используем `generic_element` — всегда конкретный тип.

**Таблица element types:**

| Type | Описание | Примеры |
|------|----------|---------|
| `button` | Интерактивный элемент действия | Submit, Cancel, OK |
| `input` | Поле ввода текста | Email, password, search |
| `text` | Текстовый контент (не интерактивный) | Заголовки, параграфы |
| `image` | Визуальный контент | Логотипы, иконки, фото |
| `link` | Кликабельная ссылка | Navigation, external links |
| `checkbox` | Чекбокс (toggle) | Remember me, terms |
| `select` | Выпадающий список | Country, language |
| `container` | Группировка элементов | Card, modal, sidebar |
| `canvas` | Canvas/WebGL элемент | Charts, games, custom widgets |
| `video` | Видео-элемент | Player, preview |

### 2.3 Extensibility

VSL должен позволять добавлять новые типы элементов без breaking changes.

**Принципы:**
- **Open-closed**: схема открыта для расширения, закрыта для модификации. Новые типы добавляются, старые не меняются.
- **Custom properties**: любой элемент может содержать `custom: {}` для domain-specific данных.
- **Versioned schema**: версия схемы в корне JSON (`"vsl_version": "1.0.0"`).
- **Graceful degradation**: LLM должен мочь игнорировать неизвестные поля.

**Пример расширения:**
{
  "t": "custom_widget",
  "r": "calendar_picker",
  "p": [0.3, 0.5],
  "s": [300, 250],
  "custom": {
    "widget_type": "date_range",
    "min_date": "2025-01-01",
    "max_date": "2025-12-31",
    "selected_range": ["2025-06-01", "2025-06-15"]
  }
}
### 2.4 Backward Compatibility

Версионирование схемы гарантирует стабильность.

**Принципы:**
- **Semantic versioning**: `major.minor.patch`.
  - `major`: breaking changes (удаление полей, изменение семантики)
  - `minor`: additive changes (новые типы, новые опциональные поля)
  - `patch`: bug fixes, clarifications (без изменений схемы)
- **Deprecation cycle**: устаревшие поля помечаются `"deprecated": true` и удаляются через 2 major-версии.
- **Migration guides**: для каждого major-release — документ миграции.

---

## 3. Element Naming Conventions

### 3.1 Element Types

Используются **lowercase snake_case** для типов элементов:
- ✅ `button`, `input_field`, `text_block`, `image_element`
- ❌ `Button`, `INPUT`, `textField`, `image-element`

**Стандартные типы:**
- `button` — кнопка действия
- `input` — поле ввода (текст, число, пароль)
- `textarea` — многострочное поле ввода
- `text` — текстовый контент
- `heading` — заголовок (h1-h6)
- `image` — изображение
- `icon` — иконка (SVG, font icon)
- `link` — гиперссылка
- `checkbox` — чекбокс
- `radio` — радио-кнопка
- `select` — выпадающий список
- `dropdown` — раскрывающееся меню
- `container` — контейнер (div, section)
- `modal` — модальное окно
- `sidebar` — боковая панель
- `nav` — навигация
- `footer` — подвал
- `header` — шапка
- `card` — карточка
- `list` — список
- `table` — таблица
- `canvas` — canvas/WebGL
- `video` — видео
- `audio` — аудио

### 3.2 Property Names

Используются **короткие lowercase ключи** для экономии токенов:

| Полное имя | Короткий ключ | Тип | Описание |
|------------|---------------|-----|----------|
| `type` | `t` | string | Тип элемента |
| `role` | `r` | string | Семантическая роль |
| `position` | `p` | [x, y] | Позиция (relative 0.0-1.0) |
| `size` | `s` | [w, h] | Размер (pixels или relative) |
| `state` | `st` | string | Состояние элемента |
| `text` | `txt` | string | Текстовое содержимое |
| `style` | `sty` | object | Визуальные стили |
| `children` | `ch` | array | Дочерние элементы |
| `visual_fragment` | `vf` | string | Ссылка на эмбеддинг |
| `anchor` | `a` | string | Точка привязки |
| `custom` | `c` | object | Кастомные свойства |
| `actions` | `act` | array | Доступные действия |
| `metadata` | `meta` | object | Мета-данные |

### 3.3 State Descriptors

Состояния описываются **lowercase строками**:

**Базовые состояния:**
- `enabled` — элемент активен и кликабелен
- `disabled` — элемент неактивен (серый, не кликабелен)
- `focused` — элемент в фокусе (клавиатурная навигация)
- `hovered` — курсор над элементом
- `selected` — элемент выбран (в списке, таблице)
- `checked` — чекбокс/радио отмечен
- `unchecked` — чекбокс/радио не отмечен
- `expanded` — элемент развёрнут (dropdown, accordion)
- `collapsed` — элемент свёрнут
- `visible` — элемент видим
- `hidden` — элемент скрыт
- `loading` — элемент загружается (spinner, skeleton)
- `error` — элемент в состоянии ошибки
- `success` — элемент в состоянии успеха
- `warning` — элемент в состоянии предупреждения

**Комбинации состояний:**
{
  "st": "enabled,focused"
}
### 3.4 Action Names

Действия описываются **lowercase verb_noun**:

**Базовые действия:**
- `click` — клик по элементу
- `type` — ввод текста
- `clear` — очистка поля
- `scroll` — скролл (вверх/вниз/влево/вправо)
- `hover` — наведение курсора
- `focus` — установка фокуса
- `blur` — снятие фокуса
- `select` — выбор элемента (в списке)
- `check` — отметить чекбокс
- `uncheck` — снять чекбокс
- `drag` — перетаскивание
- `drop` — отпускание
- `submit` — отправка формы
- `reset` — сброс формы
- `open` — открытие (modal, dropdown)
- `close` — закрытие (modal, dropdown)
- `expand` — развёртывание
- `collapse` — свёртывание
- `navigate` — навигация (по ссылке)
- `go_back` — назад (browser history)
- `go_forward` — вперёд (browser history)
- `refresh` — обновление страницы
- `wait` — ожидание (element appears, page loads)

**Пример:**
{
  "act": ["click", "type", "focus", "hover"]
}
---

## 4. Data Model Structure

### 4.1 Canvas (Viewport)

Корневой объект описывает viewport и глобальные параметры:

{
  "vsl_version": "1.0.0",
  "canvas": {
    "viewport": {
      "width": 1920,
      "height": 1080,
      "unit": "px"
    },
    "background": "#ffffff",
    "scale": 1.0,
    "orientation": "landscape"
  },
  "objects": [...]
}
**Параметры canvas:**
- `viewport` — размеры viewport (width, height, unit)
- `background` — цвет фона (hex, rgb, transparent)
- `scale` — масштаб (для retina/HiDPI)
- `orientation` — ориентация (landscape, portrait)
- `timestamp` — timestamp snapshot (ISO 8601)
- `url` — URL страницы (для веб)
- `title` — заголовок страницы

### 4.2 Objects Tree

Дерево объектов представляет иерархию элементов на экране:

{
  "objects": [
    {
      "id": "header_001",
      "t": "header",
      "r": "main_header",
      "p": [0.0, 0.0],
      "s": [1920, 80],
      "ch": [
        {
          "id": "logo_001",
          "t": "image",
          "r": "company_logo",
          "p": [0.02, 0.02],
          "s": [120, 40],
          "vf": "emb_abc123"
        },
        {
          "id": "nav_001",
          "t": "nav",
          "r": "main_navigation",
          "p": [0.3, 0.02],
          "s": [600, 40],
          "ch": [...]
        }
      ]
    }
  ]
}
**Структура объекта:**
- `id` — уникальный идентификатор (опционально, генерируется SDK)
- `t` — тип элемента (обязательно)
- `r` — роль (опционально, уточняет семантику)
- `p` — позиция [x, y] (обязательно, relative 0.0-1.0 или absolute pixels)
- `s` — размер [width, height] (обязательно)
- `st` — состояние (опционально)
- `txt` — текст (опционально)
- `sty` — стили (опционально)
- `ch` — дочерние элементы (опционально)
- `vf` — visual fragment reference (опционально, ссылка на эмбеддинг)
- `a` — anchor point (опционально)
- `c` — custom properties (опционально)
- `act` — доступные действия (опционально)
- `meta` — мета-данные (опционально)

### 4.3 Properties

**Position (`p`):**
- Относительные координаты: `[0.0-1.0, 0.0-1.0]` — процент от viewport
- Абсолютные координаты: `[x, y]` в пикселях (если `unit: "px"` в canvas)

**Size (`s`):**
- `[width, height]` в пикселях или relative units
- Авто-размер: `"auto"` для width или height

**Anchor (`a`):**
- Точка привязки для позиционирования: `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`

**Style (`sty`):**
{
  "sty": {
    "bg": "#f0f0f0",
    "fg": "#333333",
    "border": "1px solid #ccc",
    "radius": 4,
    "shadow": "0 2px 4px rgba(0,0,0,0.1)",
    "opacity": 1.0,
    "font": {
      "family": "Arial",
      "size": 14,
      "weight": "normal",
      "style": "normal"
    }
  }
}
### 4.4 Visual Fragments

Visual fragments — ссылки на эмбеддинги визуальных элементов:

{
  "vf": "emb_abc123",
  "vf_meta": {
    "type": "image",
    "format": "png",
    "size": [120, 40],
    "hash": "sha256:def456",
    "cached_at": "2025-06-01T12:00:00Z"
  }
}
**Принципы visual fragments:**
- **Контекстные эмбеддинги**: каждый элемент имеет ссылку на свой визуальный фрагмент, а не на полный скриншот.
- **Кэширование**: статические элементы (логотипы, иконки) кэшируются и не пересоздаются.
- **Lazy loading**: LLM может работать только со структурой, подгружая визуал по необходимости.
- **Hash-based deduplication**: одинаковые визуальные фрагменты кэшируются один раз.

---

## 5. API Patterns

### 5.1 Snapshot Generation

Основной поток SDK: capture → segment → build → cache → diff.

┌──────────────────┐   ┌──────────────────────────────────────┐   ┌─────┐
│ DOM/Accessibility│──▶│  VSL SDK                             │──▶│ LLM │
│ API + Visual     │   │                                      │   │     │
│ Fragments        │   │  1. Извлечение структуры из DOM/A11y │   │     │
│                  │   │  2. Визуальные фрагменты для не-A11y │   │     │
│ (гибридный       │   │  3. Кэширование статических элементов│   │     │
│  источник)       │   │  4. Генерация диффа изменений        │   │     │
└──────────────────┘   └──────────────────────────────────────┘   └─────┘
**Паттерны:**
- **Full snapshot**: первый вызов — полный snapshot всех элементов.
- **Diff snapshot**: последующие вызовы — только изменения (diff).
- **Selective snapshot**: snapshot только определённой области (viewport, container).

### 5.2 Cache Management

**Статические vs динамические элементы:**
- **Статические**: логотипы, иконки, фоны — кэшируются по hash.
- **Динамические**: текст, кнопки, поля ввода — обновляются при каждом snapshot.

**Стратегии кэширования:**
- **LRU (Least Recently Used)**: удаляем старые эмбеддинги.
- **TTL (Time To Live)**: кэш живёт N секунд/минут.
- **Hash-based**: одинаковые визуальные фрагменты кэшируются один раз.

### 5.3 Diff Generation

> **Синхронизировано с ARCHITECTURE.md §6.2** (DEC-022): формат §6.2 — авторитетный,
> этот раздел приведён к нему в M1.2 и реализован в Diff Engine @vsl/sdk.

Дифф описывает изменения между snapshots; сравнение — по плоскому индексу id
(id = tag_indexPath, детерминированы в M1.1) + пара хэшей записи кэша
(contentHash {t,r,st,txt,act} + coordHash {p,s}, sha256). Поле ch в сравнении
не участвует — дети отслеживаются собственными id. Canvas не диффуется.

{
  "diff_version": 2,
  "base_version": 1,
  "timestamp": "2025-06-01T12:01:00Z",
  "changes": {
    "added": [
      { "id": "modal_001", "t": "modal", "r": "confirmation_dialog", "p": [0.3, 0.4], "s": [400, 300], "ch": [...] }
    ],
    "modified": [
      { "id": "button_001", "st": "disabled" }
    ],
    "removed": [
      { "id": "spinner_001" }
    ],
    "unchanged_refs": ["header_001", "nav_001", "logo_001"]
  }
}

**Блоки changes:**
- `added` — новые объекты полными поддеревьями (потомки внутри `ch`, отдельными
  записями не дублируются); tree order next
- `modified` — `id` + только изменившиеся поля в порядке канона §4 (t→r→p→s→st→txt→act);
  удалённое опциональное поле передаётся явным `null` (r/st/txt/act; t/p/s/id — никогда)
- `removed` — только `{id}`; tree order prev
- `unchanged_refs` — id неизменённых объектов; tree order next

### 5.4 Integration Points

**LLM Provider Adapters:**
VSL model-agnostic — работает с любым LLM через промпт-инжиниринг.

**Адаптеры:**
- **OpenAI adapter**: форматирование для GPT-4 vision
- **Anthropic adapter**: форматирование для Claude
- **Google adapter**: форматирование для Gemini
- **Open-source adapter**: форматирование для Llama, Mistral, etc.

**Паттерн интеграции:**
# Pseudocode
vsl_snapshot = vsl_sdk.capture(url)
vsl_json = vsl_snapshot.to_json()
llm_prompt

### 5.5 Lazy Navigation (DEC-028)

При вызове `vsl_execute_action` система автоматически проверяет, находится ли браузер на URL из текущего snapshot. Если нет — автоматически навигирует на нужный URL. Это позволяет агенту:

1. Прочитать страницу через HTTP-путь (быстро, без браузера)
2. Получить VSL JSON с семантической структурой
3. Вызвать `vsl_execute_action` — система автоматически запустит браузер и перейдёт на URL


// Псевдокод lazy navigation
const snapshot = session.getSnapshot();
const snapshotUrl = snapshot.canvas.url;

if (snapshotUrl) {
  const currentUrl = await browser.evaluate(() => window.location.href);
  if (currentUrl !== snapshotUrl) {
    await browser.navigate(snapshotUrl);
  }
}


**Принципы:**
- **Прозрачность**: агент НЕ вызывает `vsl_navigate` явно — система делает это автоматически.
- **Эффективность**: навигация происходит только если URL не совпадает (проверка через `window.location.href`).
- **Мост между путями**: HTTP-путь (read-only) → Render-путь (actions) работает бесшовно.