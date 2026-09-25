# ROADMAP.md — Visual Scene Language (VSL)

> Defensive Publication | Author: Maxim Zhadobin | Date: 28.05.2025 | Version: v0.2
> License: CC BY 4.0
>
> **Этот документ** описывает детальный план реализации VSL по фазам: от Web MVP до открытого стандарта.
> Каждая фаза содержит конкретные задачи с acceptance criteria, зависимостями и оценками времени.
> Разработчик может взять любую задачу и начать её выполнять.

---

## 1. Overview

### Что такое VSL

VSL (Visual Scene Language) — JSON-формат и SDK для AI-агентов, работающих с экраном.
Представляет визуальные сцены в виде структурированного JSON, понятного языковым моделям.

### Принципы реализации

- **Итеративная разработка**: каждая фаза — работающий продукт
- **MVP-first**: начинаем с Web, расширяем на Desktop/Mobile/Extended
- **Platform-agnostic**: единый JSON-формат для всех платформ
- **Model-agnostic**: работает с любым LLM через промпт-инжиниринг
- **Open standard**: цель — сделать VSL открытым стандартом для computer use agents

### Общая длительность

~36–52 недели (9–13 месяцев) до открытого стандарта с экосистемой.

### Зависимости между фазами

Phase 1 (Web MVP) ──→ Phase 2 (Desktop)
                  ├──→ Phase 3 (Mobile)
                  ├──→ Phase 4 (Extended Domains)
                  ├──→ Phase 5 (Humanization Layer)
                  └──→ Phase 6 (Ecosystem & Standardization)
Phase 1 — фундамент. Все остальные фазы зависят от него.
Phase 2–5 могут выполняться параллельно после завершения Phase 1.

### Как читать этот документ

Каждая фаза содержит:
- **Milestones** — группы задач с общей целью
- **Задачи** — конкретные шаги с acceptance criteria, зависимостями, оценкой времени
- **Формат задачи**: `T<phase>.<milestone>.<number>` (например, T1.1.1)

---

## 2. Phase 1: Web MVP (🟢 4–6 недель)

**Цель:** доказать концепцию на веб-платформе. Первый работающий computer use agent на VSL.

### Компоненты

| Компонент | Описание | Сложность |
|-----------|----------|-----------|
| **Capture Layer** | DOM + Accessibility API + Visual Fragments | 🟡 Средняя |
| **Segmentation Engine** | 5-level algorithm (семантические теги → ARIA → CSS → структура → vision) | 🔴 Высокая |
| **VSL Builder** | Генерация VSL JSON из семантических объектов | 🟢 Низкая |
| **Cache & Diff Engine** | Кэширование статических элементов, diff-механизм (экономия 60–80%) | 🟡 Средняя |
| **LLM Adapter** | Адаптеры для OpenAI/Anthropic/Google (function calling) | 🟡 Средняя |
| **Action Executor** | Выполнение действий: click, type, scroll, navigate | 🟢 Низкая |
| **Browser Extension** | Chrome/Firefox extension для работы с веб-страницами | 🟡 Средняя |

---

### M1.1: Snapshot generation (1 неделя)

**Цель:** DOM → VSL JSON. Базовый Capture Layer + Segmentation Engine (уровни 1–3) + VSL Builder.

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.1.1 | Настроить проект (TypeScript, ESLint, Jest, tsup) | `npm run build` работает, `npm test` проходит, CI pipeline настроен | — | 🟢 | 0.5 дня |
| T1.1.2 | Реализовать DOM extraction | `querySelectorAll('*')` + `getBoundingClientRect()` извлекает все видимые элементы с координатами, текстами, атрибутами | T1.1.1 | 🟡 | 1 день |
| T1.1.3 | Реализовать Segmentation Level 1 (семантические теги) | `<button>` → `t: button`, `<input>` → `t: input`, `<a>` → `t: link`, `<nav>` → `t: nav`. Покрытие ~40% элементов | T1.1.2 | 🟡 | 1 день |
| T1.1.4 | Реализовать Segmentation Level 2 (ARIA-атрибуты) | `role="button"` → `t: button`, `aria-label` → `txt`, `aria-pressed` → `st`. Покрытие ~60% | T1.1.3 | 🟡 | 1 день |
| T1.1.5 | Реализовать VSL Builder (генерация JSON) | DOM → VSL JSON с `canvas`, `objects` tree, `id`, `t`, `r`, `p`, `s`, `txt`, `st` полями. Валидный JSON по DESIGN_SYSTEM.md | T1.1.4 | 🟡 | 1 день |
| T1.1.6 | Написать тесты snapshot generation | Покрытие >80%. Тесты на 3 типах страниц: лендинг, форма, дашборд. Snapshot валиден по JSON schema | T1.1.5 | 🟢 | 0.5 дня |

**Результат M1.1:** рабочий snapshot для простых страниц (лендинги, формы).

---

### M1.2: Caching + Diff (1 неделя)

**Цель:** кэширование статических элементов, генерация диффов. Экономия 60–80% токенов.

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.2.1 | Реализовать Cache Store (in-memory Map) | `cache.set(id, element)`, `cache.get(id)`, `cache.clear()`. Hash по содержимому элемента | T1.1.5 | 🟡 | 0.5 дня |
| T1.2.2 | Реализовать cache invalidation | URL change → полный сброс. DOM mutation observer → invalidation изменённых элементов. Viewport resize → сброс координат | T1.2.1 | 🟡 | 1 день |
| T1.2.3 | Реализовать Diff Engine | Сравнение двух snapshots: `added`, `modified`, `removed`, `unchanged_refs`. Формат по ARCHITECTURE.md §6 | T1.2.1 | 🟡 | 1 день |
| T1.2.4 | Интегрировать diff в snapshot pipeline | Первый вызов → полный JSON. Последующие → diff + `unchanged_refs`. Проверить экономию токенов на 5 страницах | T1.2.2, T1.2.3 | 🟡 | 1 день |
| T1.2.5 | Написать тесты caching + diff | Тесты: первый вызов (full), второй вызов (diff), invalidation по URL, экономия >60% | T1.2.4 | 🟢 | 1 день |

**Результат M1.2:** экономия 60–80% токенов после первого вызова.

---

### M1.3: LLM Integration (1 неделя)

**Цель:** LLM Adapter для OpenAI и Anthropic. Function calling для генерации действий.

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.3.1 | Реализовать LLM Adapter interface | Абстрактный интерфейс: `sendPrompt(vslJson, task) → LLMResponse`. Провайдеры: OpenAI, Anthropic | T1.1.5 | 🟡 | 0.5 дня |
| T1.3.2 | Реализовать OpenAI adapter | `gpt-4o` / `gpt-4o-mini` через function calling. System prompt + VSL JSON → actions JSON | T1.3.1 | 🟡 | 1 день |
| T1.3.3 | Реализовать Anthropic adapter | `claude-sonnet-4-20250514` через tool use. System prompt + VSL JSON → actions JSON | T1.3.1 | 🟡 | 1 день |
| T1.3.4 | Написать system prompt + few-shot examples | System prompt описывает VSL формат. 3 few-shot примера: клик по кнопке, заполнение формы, навигация. Function calling schema | T1.3.2, T1.3.3 | 🟡 | 1 день |
| T1.3.5 | Написать тесты LLM integration | Mock LLM responses. Тесты: генерация `click`, `type`, `scroll` действий. Валидация `target_id` | T1.3.4 | 🟢 | 0.5 дня |

**Результат M1.3:** LLM принимает решения на основе VSL JSON и генерирует действия.

---

### M1.4: Action Execution (1 неделя)

**Цель:** Action Executor для выполнения действий на веб-страницах. Browser Extension.

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.4.1 | Реализовать Action Executor (базовые действия) | `click(target_id)`, `type(target_id, value)`, `scroll(direction, amount)`. Поиск элемента по `id` в DOM | T1.1.5 | 🟡 | 1 день |
| T1.4.2 | Реализовать расширенные действия | `hover`, `select`, `check`, `uncheck`, `drag`, `focus`, `blur`, `clear` | T1.4.1 | 🟡 | 1 день |
| T1.4.3 | Реализовать навигационные действия | `navigate(url)`, `go_back()`, `go_forward()`, `refresh()`, `wait(selector, timeout)` | T1.4.1 | 🟡 | 0.5 дня |
| T1.4.4 | Создать Chrome Extension (Manifest V3) | Content script для DOM access. Background script для LLM calls. Popup UI для управления агентом | T1.4.1 | 🟡 | 1 день |
| T1.4.5 | Написать тесты action execution | Тесты: click по кнопке, type в input, scroll страницы. Интеграция с Chrome Extension | T1.4.2, T1.4.3, T1.4.4 | 🟢 | 0.5 дня |

**Результат M1.4:** агент может взаимодействовать с веб-страницами через Chrome Extension.

---

### M1.5: End-to-end Demo (1–2 недели)

**Цель:** полная интеграция. Работающий computer use agent на веб.

**Статус:** ✅ Завершено (24.09.2026). Все задачи T1.5.1–T1.5.6 реализованы и верифицированы. Vision-бэкенд: OpenAI gpt-4o, Anthropic claude-sonnet, Alibaba Qwen qwen3.7-plus (через OpenAIAdapter+baseUrl, DEC-025).

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.5.1 | Реализовать Segmentation Level 3 (CSS-анализ) | `cursor: pointer` + `onclick` → `button`. `position: fixed` + `top: 0` → `header`. Покрытие ~85% | T1.1.3 | 🟡 | 1 день |
| T1.5.2 | Реализовать Segmentation Level 4 (структурный анализ) | Паттерны: toolbar (≥3 кнопки в ряд), list (≥3 элемента), grid, form_field (label + input). Latency <100ms | T1.5.1 | 🔴 | 2 дня |
| T1.5.3 | Реализовать Visual Fragments Pipeline | Bounding box extraction → CLIP/DINOv2 классификация → WebP эмбеддинг. Hybrid approach (embedding + lazy image) | T1.5.1 | 🔴 | 2 дня |
| T1.5.4 | Реализовать Segmentation Level 5 (vision fallback) | Элементы без A11y → vision model classification. CLIP embedding + confidence score. Покрытие ~100% | T1.5.3 | 🔴 | 1 день |
| T1.5.5 | Интегрировать все компоненты в end-to-end pipeline | Snapshot → LLM → Action → новый Snapshot. Полный цикл за 1–3 секунды. Chrome Extension → LLM → Action Executor | T1.4.4, T1.5.2, T1.5.4 | 🟡 | 2 дня |
| T1.5.6 | Demo: 3 сценария | (1) Заполнить форму регистрации. (2) Найти товар на e-commerce, добавить в корзину. (3) Navigate to settings, change language | T1.5.5 | 🟡 | 1 день |

**Результат M1.5:** работающий computer use agent на веб-страницах.

---

### M1.6: MCP Server (1 неделя)

**Цель:** MCP-сервер для интеграции VSL с AI-агентами (Claude Desktop, Cline, TaoCoder). Рекомендуемый путь интеграции для MVP ([ARCHITECTURE.md §15.2](./ARCHITECTURE.md)).

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.6.1 | Исследовать MCP Protocol | Документация MCP (Model Context Protocol). Определить tools, resources, prompts для VSL | — | 🟡 | 1 день |
| T1.6.2 | Реализовать MCP Server skeleton | JSON-RPC over stdio. Базовая структура: tools, resources, error handling. TypeScript + @modelcontextprotocol/sdk | T1.6.1 | 🟡 | 1 день |
| T1.6.3 | Реализовать MCP Tools | `vsl_get_snapshot()`, `vsl_get_diff()`, `vsl_execute_action()`, `vsl_navigate()`, `vsl_clear_cache()`, `vsl_get_visual()`, `vsl_read_page()`. Интеграция с Core SDK | T1.6.2 | 🔴 | 2 дня |
| T1.6.4 | Реализовать MCP Resources | `vsl://current` (текущий snapshot), `vsl://diff` (последний diff). Подписка на изменения | T1.6.2 | 🟡 | 1 день |
| T1.6.5 | Написать интеграционные тесты | Тесты: MCP Server ↔ AI Agent (mock). Валидация tools, resources, error handling. Тест конфигурации mcpServers | T1.6.3, T1.6.4 | 🟢 | 1 день |
| T1.6.6 | Реализовать vsl_read_page — автоматическая стратегия HTTP-first (M1.6, DEC-024) | Автоматическая стратегия: HTTP-first для статики, автопереключение на Render для SPA (без параметра mode). HTTP-путь: cheerio → VSL JSON (без bbox, без действий). Render-путь: Playwright → VSL JSON + действия. Оба пути сохраняют в ServerSession для диффов. Ограничения HTTP: нет координат, нет действий — для vsl_execute_action ВСЕГДА Render-путь. Тесты: HTTP/Render, SPA-детект, readable, диффы. ([PRODUCT_CONCEPT.md §5](./PRODUCT_CONCEPT.md), [ARCHITECTURE.md §2.7](./ARCHITECTURE.md)) | T1.6.3 | 🔴 | 2 дня |

**Lazy Navigation (DEC-028, M1.6):** При вызове `vsl_execute_action` система автоматически проверяет, находится ли браузер на URL из текущего snapshot. Если нет — автоматически навигирует на нужный URL. Это позволяет агенту сначала прочитать страницу через быстрый HTTP-путь (`vsl_read_page`), получить VSL JSON, а затем выполнять действия — система сама запустит браузер и перейдёт на URL. Агенту НЕ нужно явно вызывать `vsl_navigate` перед выполнением действий.

**Результат M1.6:** MCP-сервер готов к интеграции с AI-агентами, включая автоматическое чтение страниц (`vsl_read_page` с HTTP-first стратегией, DEC-024).

---

### M1.7: Lazy Text Loading (0.5 недели)

**Цель:** оптимизация токенов для контентных страниц. Длинные тексты (статьи, параграфы) не включаются в основной VSL JSON — вместо этого кэшируются и отдаются по запросу через MCP tool. Экономия 80–90% токенов для контентных страниц.

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.7.1 | Определить порог длины текста для lazy loading | Порог: если txt.length > N символов (например 200) — заменяем на txt_preview (первые ~50 символов) + txt_ref: tb_xxx. Короткие тексты (кнопки, ссылки, labels) остаются в txt. Классификация: h1-h6 — всегда заголовки; p, blockquote, li — кандидаты на lazy; button, a, label — всегда короткие | T1.1.5 | 🟡 | 0.5 дня |
| T1.7.2 | Реализовать text block cache | Кэш text_blocks: { tb_xxx: полный текст } в том же VSL JSON (для batch-доступа). Интеграция с segmenter.ts (L63: txt: el.text — условная логика) | T1.7.1 | 🟡 | 1 день |
| T1.7.3 | Реализовать MCP tool vsl_get_text_block(block_id) | Tool возвращает полный текст по block_id. Интеграция с MCP Server (M1.6). Тесты: получение полного текста, обработка несуществующих ID | T1.6.2, T1.7.2 | 🟡 | 1 день |
| T1.7.4 | Обновить LLM system prompt | Инструкция для LLM: если нужен полный текст блока, вызови vsl_get_text_block(block_id). Тесты: LLM корректно использует lazy text (95%+ accuracy на контентных страницах) | T1.7.3 | 🟢 | 0.5 дня |

**Результат M1.7:** Lazy Text Loading работает — длинные тексты не в JSON, кэшируются и отдаются по запросу. Экономия 80–90% токенов для контентных страниц.

### M1.8: Prompt Injection Filter (0.5 недели)

**Цель:** защита от prompt injection через веб-контент. Фильтр работает **на входе Capture Layer** — сразу после извлечения текста из любого источника (DOM, raw HTML), **до** сегментации и упаковки в VSL JSON. Единая точка фильтрации для всех источников текста.

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T1.8.1 | Реализовать Prompt Injection Filter (Scanner + Logger + Stripper) | Фильтр применяется ко всем источникам текста: DOM-extracted (реализовано), raw HTML (HTTP-first, DEC-024, M1.6). Фильтр работает **до** сегментации и Lazy Text Loading (M1.7). Тесты: фильтр корректно вырезает инъекции из DOM и raw HTML | T1.1.5, DEC-024 | 🟡 | 1 день |
| T1.8.2 | Создать bundled patterns.json (базовые regex-паттерны) | JSON файл `patterns.json` внутри SDK с базовыми паттернами: "ignore previous instructions", "you are now", "system:", и т.д. Формат: {id, pattern, type: regex\|ml, severity, action: strip\|log\|block, description}. Версионирование: patterns_v1.json, patterns_v2.json | T1.8.1 | 🟢 | 0.5 дня |
| T1.8.3 | Реализовать remote patterns loader (CDN/GitHub, кэширование) | Автозагрузка `https://vsl.dev/patterns/latest.json` при запуске VSL. Локальное кэширование (fallback если нет интернета). Опционально (можно отключить через конфиг). Тесты: загрузка remote patterns, fallback на bundled при отсутствии интернета | T1.8.2 | 🟡 | 1 день |
| T1.8.4 | Реализовать custom patterns (vsl.config.json) | Пользователь может добавить свои паттерны через `vsl.config.json`: `{ "customPatterns": ["my-specific-attack-pattern"] }`. Тесты: custom patterns корректно применяются | T1.8.3 | 🟢 | 0.5 дня |
| T1.8.5 | Интеграция с Capture Layer (фильтр на входе, до сегментации) | Фильтр вызывается сразу после извлечения текста из любого источника, **до** segmenter.ts. Полный текст фильтруется целиком (preview не фильтруется — слишком короткий). Тесты: интеграция с domExtractor (сейчас) и httpExtractor (M1.6) | T1.8.1, T1.7.2 | 🟡 | 1 день |
| T1.8.6 | Тесты false positive strategy (confidence threshold, domain whitelist) | Confidence threshold — паттерн срабатывает только если confidence > порога. Domain whitelist — доверенные домены (github.com, docs.google.com) пропускаются. User override — пользователь может отключить фильтр для конкретных доменов. Тесты: false positive rate < 1% на легитимном контенте | T1.8.5 | 🟡 | 1 день |

**Результат M1.8:** Prompt Injection Filter работает — фильтрует текст из всех источников (DOM, raw HTML) на входе Capture Layer, до сегментации. 3 уровня паттернов: bundled (в SDK), remote (CDN/GitHub), custom (vsl.config.json). False positive strategy: confidence threshold + domain whitelist + user override. Overhead: ~5–20ms на сканирование страницы.


### Deliverables Phase 1

- **Browser Extension** (Chrome/Firefox) — для работы с веб-страницами
- **VSL SDK** (TypeScript, NPM package) — для интеграции в другие продукты
- **MCP Server** (@vsl/mcp-server) — MCP Protocol для интеграции с AI-агентами (Claude Desktop, Cline, TaoCoder)
- **Demo** — end-to-end computer use agent на веб-страницах

### Критерии успеха Phase 1

- ✅ Snapshot generation работает для типичных веб-страниц (лендинги, формы, дашборды)
- ✅ Кэширование экономит 60–80% токенов
- ✅ Lazy Text Loading экономит 80–90% токенов на контентных страницах (статьи, блоги, документация)
- ✅ LLM корректно интерпретирует VSL JSON и генерирует действия (95%+ accuracy)
- ✅ Агент может заполнить форму, нажать кнопку, прокрутить страницу, перейти по ссылке
- ✅ End-to-end цикл: 1–3 секунды на итерацию
- ✅ MCP Server работает с AI-агентами (Claude Desktop, Cline, TaoCoder)

### Связи с документами

- Архитектура: [ARCHITECTURE.md §2–7, §15](./ARCHITECTURE.md)
- Дизайн-система: [DESIGN_SYSTEM.md §2–4](./DESIGN_SYSTEM.md)
- Концепция: [PRODUCT_CONCEPT.md §3, §5](./PRODUCT_CONCEPT.md)
- Решения: [DECISIONS.md §3 DEC-004–DEC-008, DEC-014, DEC-015, DEC-019, DEC-020](./DECISIONS.md)

---

## 3. Phase 2: Desktop (🟡 6–8 недель)

**Цель:** кросс-платформенная автоматизация нативных приложений (macOS, Windows, Linux).

### Компоненты

| Компонент | Описание | Сложность |
|-----------|----------|-----------|
| **macOS Adapter** | AX API (AXUIElement) — извлечение accessibility tree | 🔴 Высокая |
| **Windows Adapter** | UI Automation (IUIAutomation) — извлечение UI elements | 🔴 Высокая |
| **Linux Adapter** | AT-SPI (Assistive Technology Service Provider Interface) | 🔴 Высокая |
| **Native App** | Electron/Tauri — десктопное приложение для управления агентом | 🟡 Средняя |
| **Cross-app Navigation** | Переключение между приложениями (Cmd+Tab, Alt+Tab) | 🟡 Средняя |

---

### M2.1: macOS Accessibility API (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T2.1.1 | Исследовать macOS AX API | Документация AXUIElement, AXValue. Определить маппинг AX roles → VSL types | — | 🟡 | 1 день |
| T2.1.2 | Реализовать AX tree extraction | `AXUIElementCreateApplication()` → обход дерева → извлечение roles, labels, values, positions | T2.1.1 | 🔴 | 3 дня |
| T2.1.3 | Реализовать маппинг AX roles → VSL types | `AXButton` → `button`, `AXTextField` → `input`, `AXStaticText` → `text`, `AXWindow` → `container` | T2.1.2 | 🟡 | 2 дня |
| T2.1.4 | Реализовать координаты и размеры | `AXPosition` + `AXSize` → `p`, `s` в VSL JSON. Нормализация координат | T2.1.2 | 🟡 | 1 день |
| T2.1.5 | Интегрировать в VSL SDK | `macOSAdapter.getScreenshot()` → VSL JSON. Тесты на Finder, Safari, Mail | T2.1.3, T2.1.4 | 🟡 | 2 дня |
| T2.1.6 | Написать тесты macOS adapter | Snapshot для 5 нативных macOS приложений. Валидация VSL JSON | T2.1.5 | 🟢 | 1 день |

**Результат M2.1:** VSL snapshot для macOS apps (Finder, Safari, Mail).

---

### M2.2: Windows UI Automation (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T2.2.1 | Исследовать Windows UI Automation | Документация IUIAutomation, ControlType. Определить маппинг UIA types → VSL types | — | 🟡 | 1 день |
| T2.2.2 | Реализовать UIA tree extraction | `IUIAutomation::ElementFromHandle()` → обход дерева → извлечение ControlType, Name, Value | T2.2.1 | 🔴 | 3 дня |
| T2.2.3 | Реализовать маппинг UIA types → VSL types | `UIA_ButtonControlType` → `button`, `UIA_EditControlType` → `input`, `UIA_TextControlType` → `text` | T2.2.2 | 🟡 | 2 дня |
| T2.2.4 | Реализовать координаты и размеры | `BoundingRectangle` → `p`, `s` в VSL JSON. Нормализация координат | T2.2.2 | 🟡 | 1 день |
| T2.2.5 | Интегрировать в VSL SDK | `windowsAdapter.getScreenshot()` → VSL JSON. Тесты на Notepad, Explorer, Edge | T2.2.3, T2.2.4 | 🟡 | 2 дня |
| T2.2.6 | Написать тесты Windows adapter | Snapshot для 5 нативных Windows приложений. Валидация VSL JSON | T2.2.5 | 🟢 | 1 день |

**Результат M2.2:** VSL snapshot для Windows apps (Notepad, Explorer, Edge).

---

### M2.3: Linux AT-SPI (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T2.3.1 | Исследовать AT-SPI | Документация AT-SPI2, D-Bus interface. Определить маппинг AT-SPI roles → VSL types | — | 🟡 | 1 день |
| T2.3.2 | Реализовать AT-SPI tree extraction | D-Bus calls → обход accessibility tree → извлечение roles, names, values | T2.3.1 | 🔴 | 3 дня |
| T2.3.3 | Реализовать маппинг AT-SPI roles → VSL types | `ROLE_PUSH_BUTTON` → `button`, `ROLE_ENTRY` → `input`, `ROLE_LABEL` → `text` | T2.3.2 | 🟡 | 2 дня |
| T2.3.4 | Реализовать координаты и размеры | `getExtents()` → `p`, `s` в VSL JSON | T2.3.2 | 🟡 | 1 день |
| T2.3.5 | Интегрировать в VSL SDK | `linuxAdapter.getScreenshot()` → VSL JSON. Тесты на GNOME Terminal, Firefox, LibreOffice | T2.3.3, T2.3.4 | 🟡 | 2 дня |
| T2.3.6 | Написать тесты Linux adapter | Snapshot для 5 нативных Linux приложений. Валидация VSL JSON | T2.3.5 | 🟢 | 1 день |

**Результат M2.3:** VSL snapshot для Linux apps (GNOME Terminal, Firefox, LibreOffice).

---

### M2.4: Cross-app Navigation (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T2.4.1 | Реализовать window activation | `activateWindow(appName)` — фокус на конкретное приложение по имени | T2.1.5, T2.2.5, T2.3.5 | 🟡 | 1 день |
| T2.4.2 | Реализовать hotkey simulation | Cmd+Tab (macOS), Alt+Tab (Windows), Super (Linux) — переключение между приложениями | T2.4.1 | 🟡 | 1 день |
| T2.4.3 | Реализовать app listing | `getRunningApps()` → список активных приложений с names, PIDs | T2.4.1 | 🟡 | 1 день |
| T2.4.4 | Написать тесты cross-app navigation | Тесты: переключение между 3 приложениями, активация по имени | T2.4.2, T2.4.3 | 🟢 | 1 день |

**Результат M2.4:** агент может работать с несколькими приложениями.

---

### M2.5: Desktop Demo (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T2.5.1 | Создать Desktop App (Electron/Tauri) | Native app с UI для управления агентом. Интеграция с VSL SDK | T2.4.1 | 🟡 | 2 дня |
| T2.5.2 | Demo: macOS workflow | Открыть Finder → найти файл → отправить по email через Mail | T2.5.1 | 🟡 | 1 день |
| T2.5.3 | Demo: Windows workflow | Открыть Notepad → написать текст → сохранить файл | T2.5.1 | 🟡 | 1 день |
| T2.5.4 | Demo: cross-app workflow | Переключение между 3 приложениями, выполнение задач в каждом | T2.5.1, T2.4.4 | 🟡 | 1 день |

**Результат M2.5:** работающий desktop computer use agent.

---

### Deliverables Phase 2

- **Desktop App** (Electron/Tauri) — для macOS/Windows/Linux
- **Platform Adapters** — macOS (AX API), Windows (UI Automation), Linux (AT-SPI)
- **VSL SDK** (расширение) — поддержка desktop платформ

### Критерии успеха Phase 2

- ✅ VSL snapshot работает для нативных приложений на macOS, Windows, Linux
- ✅ Агент может автоматизировать типовые задачи (открыть файл, заполнить форму, отправить email)
- ✅ Cross-app navigation работает (переключение между приложениями)
- ✅ Latency: 1–3 секунды на итерацию (включая accessibility tree extraction)

### Связи с документами

- Архитектура: [ARCHITECTURE.md §8](./ARCHITECTURE.md)
- Решения: [DECISIONS.md §3 DEC-009](./DECISIONS.md)

---

## 4. Phase 3: Mobile (🟡 6–8 недель)

**Цель:** мобильная автоматизация нативных приложений (iOS, Android).

### Компоненты

| Компонент | Описание | Сложность |
|-----------|----------|-----------|
| **iOS Adapter** | UIAccessibility API (VoiceOver data) — извлечение accessibility tree | 🔴 Высокая |
| **Android Adapter** | AccessibilityService (TalkBack data) — извлечение accessibility tree | 🔴 Высокая |
| **Mobile SDK** | Swift (iOS) + Kotlin (Android) — нативные SDK | 🟡 Средняя |
| **Mobile App** | React Native/Flutter — приложение для управления агентом | 🟡 Средняя |
| **Mobile Actions** | Tap, swipe, type, long press, pinch zoom | 🟡 Средняя |

---

### M3.1: iOS VoiceOver Data (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T3.1.1 | Исследовать iOS UIAccessibility API | Документация UIAccessibilityTraits, accessibilityLabel, accessibilityValue | — | 🟡 | 1 день |
| T3.1.2 | Реализовать iOS accessibility tree extraction | Обход UIView hierarchy → извлечение traits, labels, values, frames | T3.1.1 | 🔴 | 3 дня |
| T3.1.3 | Реализовать маппинг UIAccessibility traits → VSL types | `.button` → `button`, `.searchField` → `input`, `.staticText` → `text` | T3.1.2 | 🟡 | 2 дня |
| T3.1.4 | Реализовать координаты и размеры | `accessibilityFrame` → `p`, `s` в VSL JSON | T3.1.2 | 🟡 | 1 день |
| T3.1.5 | Интегрировать в VSL SDK (Swift) | `iOSAdapter.getSnapshot()` → VSL JSON. Тесты на Settings, Safari, Messages | T3.1.3, T3.1.4 | 🟡 | 2 дня |
| T3.1.6 | Написать тесты iOS adapter | Snapshot для 5 iOS приложений. Валидация VSL JSON | T3.1.5 | 🟢 | 1 день |

**Результат M3.1:** VSL snapshot для iOS apps.

---

### M3.2: Android TalkBack Data (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T3.2.1 | Исследовать Android AccessibilityService | Документация AccessibilityNodeInfo, className, contentDescription | — | 🟡 | 1 день |
| T3.2.2 | Реализовать Android accessibility tree extraction | `AccessibilityService` → обход node tree → извлечение className, text, bounds | T3.2.1 | 🔴 | 3 дня |
| T3.2.3 | Реализовать маппинг AccessibilityNodeInfo → VSL types | `className: Button` → `button`, `className: EditText` → `input`, `className: TextView` → `text` | T3.2.2 | 🟡 | 2 дня |
| T3.2.4 | Реализовать координаты и размеры | `getBoundsInScreen()` → `p`, `s` в VSL JSON | T3.2.2 | 🟡 | 1 день |
| T3.2.5 | Интегрировать в VSL SDK (Kotlin) | `androidAdapter.getSnapshot()` → VSL JSON. Тесты на Settings, Chrome, Gmail | T3.2.3, T3.2.4 | 🟡 | 2 дня |
| T3.2.6 | Написать тесты Android adapter | Snapshot для 5 Android приложений. Валидация VSL JSON | T3.2.5 | 🟢 | 1 день |

**Результат M3.2:** VSL snapshot для Android apps.

---

### M3.3: Mobile Action Execution (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T3.3.1 | Реализовать iOS actions (XCUITest) | `tap(id)`, `type(id, text)`, `swipe(direction)`, `longPress(id)`, `pinchZoom(factor)` | T3.1.5 | 🟡 | 2 дня |
| T3.3.2 | Реализовать Android actions (UIAutomator) | `tap(id)`, `type(id, text)`, `swipe(direction)`, `longPress(id)`, `pinchZoom(factor)` | T3.2.5 | 🟡 | 2 дня |
| T3.3.3 | Реализовать mobile-specific actions | `pullToRefresh()`, `openNotification()`, `switchApp(packageName)`, `goHome()` | T3.3.1, T3.3.2 | 🟡 | 1 день |
| T3.3.4 | Интегрировать actions в VSL SDK | `executeAction(action, targetId)` → выполнение на устройстве | T3.3.3 | 🟡 | 1 день |
| T3.3.5 | Создать Mobile App (React Native/Flutter) | UI для управления агентом. Подключение к iOS/Android device | T3.3.4 | 🟡 | 2 дня |
| T3.3.6 | Написать тесты mobile actions | Тесты: tap, type, swipe на 3 приложениях. Интеграция с Mobile App | T3.3.4, T3.3.5 | 🟢 | 1 день |

**Результат M3.3:** агент может взаимодействовать с мобильными приложениями.

---

### M3.4: Mobile Demo (1–2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T3.4.1 | Demo: iOS workflow | Открыть Settings → изменить Wi-Fi → вернуться на home screen | T3.3.5 | 🟡 | 1 день |
| T3.4.2 | Demo: Android workflow | Открыть Gmail → написать email → отправить | T3.3.5 | 🟡 | 1 день |
| T3.4.3 | Demo: cross-app workflow | Переключение между 3 мобильными приложениями | T3.3.5 | 🟡 | 1 день |
| T3.4.4 | Написать документацию mobile SDK | API docs, примеры интеграции, setup guides для iOS/Android | T3.4.1, T3.4.2 | 🟢 | 1 день |

**Результат M3.4:** работающий mobile computer use agent.

---

### Deliverables Phase 3

- **Mobile SDK** — Swift (iOS) + Kotlin (Android)
- **Mobile App** (React Native/Flutter) — для управления агентом
- **Demo** — mobile computer use agent

### Критерии успеха Phase 3

- ✅ VSL snapshot работает для нативных мобильных приложений на iOS и Android
- ✅ Агент может автоматизировать типовые мобильные задачи
- ✅ Mobile actions работают (tap, swipe, type, long press)
- ✅ Latency: 1–3 секунды на итерацию

### Связи с документами

- Архитектура: [ARCHITECTURE.md §8](./ARCHITECTURE.md)
- Решения: [DECISIONS.md §3 DEC-009](./DECISIONS.md)

---

## 5. Phase 4: Extended Domains (🟡 8–12 недель)

**Цель:** расширение VSL за пределы стандартных UI для работы с архитектурными чертежами, инженерными схемами и 3D-сценами.

### Ключевая идея

CAD/BIM/3D форматы **УЖЕ содержат богатую семантику** (типы элементов, слои, размеры, материалы, связи). VSL только извлекает и унифицирует её.

---

### Phase 4.1: 2D Чертежи (SVG/PDF) — 🟢 2–4 недели

#### M4.1.1: SVG parser + базовые типы (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.1.1.1 | Реализовать SVG DOM parser | `querySelectorAll('line, rect, circle, path, text, polyline')` → извлечение примитивов с атрибутами | — | 🟡 | 1 день |
| T4.1.1.2 | Реализовать маппинг SVG → VSL types | `<line>` → `line`, `<rect>` → `rect`, `<circle>` → `circle`, `<text>` → `text`, `<path>` → `path` | T4.1.1.1 | 🟡 | 1 день |
| T4.1.1.3 | Добавить новые VSL types для 2D | `line`, `arc`, `circle`, `polyline`, `dimension`, `annotation`, `callout`, `layer`, `block`, `hatch` | T4.1.1.2 | 🟡 | 1 день |
| T4.1.1.4 | Расширить canvas для 2D | `coordinate_system`, `scale`, `unit` (mm, cm, m, inch, ft) в canvas | T4.1.1.3 | 🟢 | 0.5 дня |
| T4.1.1.5 | Написать тесты SVG parser | Парсинг 3 SVG чертежей → VSL JSON. Валидация типов и координат | T4.1.1.4 | 🟢 | 0.5 дня |

**Результат M4.1.1:** SVG → VSL JSON для базовых 2D примитивов.

#### M4.1.2: PDF parser + сложные типы (1–2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.1.2.1 | Интегрировать PDF.js | Загрузка PDF → извлечение векторных объектов, слоёв, аннотаций | — | 🟡 | 1 день |
| T4.1.2.2 | Реализовать PDF → VSL маппинг | PDF paths → `line`/`polyline`, PDF text → `text`, PDF annotations → `annotation` | T4.1.2.1 | 🟡 | 2 дня |
| T4.1.2.3 | Реализовать dimension extraction | Размерные линии → `dimension` type с `measured_value`, `unit` | T4.1.2.2 | 🟡 | 1 день |
| T4.1.2.4 | Реализовать layer extraction | PDF layers (OCG) → `layer` type с `name`, `visible` | T4.1.2.2 | 🟡 | 1 день |
| T4.1.2.5 | Написать тесты PDF parser | Парсинг 3 PDF чертежей → VSL JSON. Валидация dimension, annotation, layer | T4.1.2.4 | 🟢 | 1 день |

**Результат M4.1.2:** PDF → VSL JSON для архитектурных чертежей.

#### M4.1.3: 2D Demo (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.1.3.1 | Demo: AI читает архитектурный чертёж | "Найди все окна на северном фасаде" → AI находит объекты с `r: "window"` → ответ с количеством | T4.1.2.5 | 🟡 | 1 день |
| T4.1.3.2 | Demo: AI рассчитывает площади | "Рассчитай площадь остекления" → AI суммирует `meta.area` окон → ответ в м² | T4.1.3.1 | 🟡 | 1 день |
| T4.1.3.3 | Demo: AI анализирует инженерную схему | "Найди все трубы диаметром >100мм" → AI фильтрует по `meta.diameter` → ответ | T4.1.3.1 | 🟡 | 1 день |
| T4.1.3.4 | Написать документацию 2D extended domains | API docs, примеры JSON, setup guide | T4.1.3.3 | 🟢 | 1 день |

**Результат M4.1.3:** AI анализ 2D чертежей через VSL.

---

### Phase 4.2: 3D Веб-сцены (Three.js/Babylon.js) — 🟡 4–8 недель

#### M4.2.1: Three.js scene graph extraction (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.2.1.1 | Исследовать Three.js scene graph | `scene.traverse()` → извлечение meshes, lights, cameras, materials | — | 🟡 | 1 день |
| T4.2.1.2 | Реализовать Three.js → VSL маппинг | `Mesh` → `mesh` type, `position` → `pos3d`, `rotation` → `rot3d`, `scale` → `scale3d` | T4.2.1.1 | 🟡 | 2 дня |
| T4.2.1.3 | Добавить 3D поля в VSL | `pos3d`, `rot3d`, `scale3d`, `camera`, `material`, `light` | T4.2.1.2 | 🟡 | 1 день |
| T4.2.1.4 | Расширить canvas для 3D | `camera` (type, position, target, fov, near, far), `coordinate_system` | T4.2.1.3 | 🟡 | 1 день |
| T4.2.1.5 | Реализовать material extraction | `MeshStandardMaterial` → `sty.material`, `sty.color`, `sty.opacity` | T4.2.1.2 | 🟡 | 1 день |
| T4.2.1.6 | Написать тесты Three.js extraction | Парсинг 3 Three.js сцен → VSL JSON. Валидация pos3d, material, camera | T4.2.1.5 | 🟢 | 1 день |

**Результат M4.2.1:** Three.js scene → VSL JSON с 3D полями.

#### M4.2.2: Babylon.js support + 3D-действия (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.2.2.1 | Исследовать Babylon.js scene graph | `scene.meshes`, `scene.lights`, `scene.cameras` → извлечение объектов | — | 🟡 | 1 день |
| T4.2.2.2 | Реализовать Babylon.js → VSL маппинг | Аналогично Three.js, но через Babylon.js API | T4.2.2.1 | 🟡 | 2 дня |
| T4.2.2.3 | Реализовать 3D-действия | `rotate_camera`, `zoom`, `pan`, `isolate_layer`, `hide_layer`, `show_layer`, `measure_distance`, `set_camera`, `explode_view` | T4.2.1.3 | 🟡 | 2 дня |
| T4.2.2.4 | Реализовать action executor для 3D | Выполнение 3D-действий через Three.js/Babylon.js API | T4.2.2.3 | 🟡 | 1 день |
| T4.2.2.5 | Написать тесты 3D actions | Тесты: rotate_camera, isolate_layer, measure_distance на 3 сценах | T4.2.2.4 | 🟢 | 1 день |

**Результат M4.2.2:** поддержка Babylon.js + 3D-действия.

#### M4.2.3: 3D Demo (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.2.3.1 | Demo: AI управляет BIM-моделью | "Покажи все несущие стены" → `isolate_layer("A-WALL")` → камера на центр здания | T4.2.2.5 | 🟡 | 2 дня |
| T4.2.3.2 | Demo: AI анализирует инженерную схему | "Найди все трубы диаметром >100mm" -> AI фильтрует по meta.diameter -> ответ | T4.2.2.5 | 🟡 | 2 дня |
| T4.2.3.3 | Написать документацию 3D extended domains | API docs, примеры JSON, setup guide для Three.js/Babylon.js | T4.2.3.1, T4.2.3.2 | 🟢 | 1 день |

**Результат M4.2.3:** AI управление BIM-моделями через VSL.


---

### Phase 4.3: BIM/CAD (IFC, DWG) — 🔴 4-6 недель

#### M4.3.1: IFC parser + маппинг BIM элементов (2-3 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.3.1.1 | Исследовать IFC формат | Документация IFC schema (IfcWall, IfcWindow, IfcDoor). Определить маппинг IFC types -> VSL types | — | 🟡 | 2 дня |
| T4.3.1.2 | Интегрировать IFC.js / IfcOpenShell | Загрузка IFC файла -> извлечение элементов с геометрией и метаданными | T4.3.1.1 | 🔴 | 3 дня |
| T4.3.1.3 | Реализовать IFC -> VSL маппинг | IfcWall -> mesh + r: wall, IfcWindow -> mesh + r: window. Сохранение meta.layer, meta.volume, meta.area | T4.3.1.2 | 🔴 | 3 дня |
| T4.3.1.4 | Реализовать LOD (Level of Detail) | Frustum culling + lazy loading для больших моделей (100K+ объектов) | T4.3.1.3 | 🔴 | 2 дня |
| T4.3.1.5 | Написать тесты IFC parser | Парсинг 3 IFC моделей -> VSL JSON. Валидация типов, метаданных | T4.3.1.4 | 🟢 | 1 день |

**Результат M4.3.1:** IFC -> VSL JSON для BIM-моделей.

---

#### M4.3.2: DWG/DXF parser + маппинг CAD элементов (2-3 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.3.2.1 | Исследовать DWG/DXF форматы | Документация AutoCAD DXF (LINE, ARC, CIRCLE, DIMENSION, BLOCK, LAYER). Определить маппинг DXF entities -> VSL types | — | 🟡 | 2 дня |
| T4.3.2.2 | Интегрировать libdxfrw / ODA | Загрузка DWG/DXF файла -> извлечение entities, layers, blocks | T4.3.2.1 | 🔴 | 3 дня |
| T4.3.2.3 | Реализовать DXF -> VSL маппинг | LINE -> line, ARC -> arc, CIRCLE -> circle, DIMENSION -> dimension, TEXT -> text, INSERT (block) -> block | T4.3.2.2 | 🔴 | 3 дня |
| T4.3.2.4 | Реализовать layer/block extraction | DXF layers -> layer type, DXF blocks -> block type с повторением | T4.3.2.3 | 🟡 | 2 дня |
| T4.3.2.5 | Написать тесты DWG/DXF parser | Парсинг 3 DWG/DXF файлов -> VSL JSON. Валидация типов, слоёв, блоков | T4.3.2.4 | 🟢 | 1 день |

**Результат M4.3.2:** DWG/DXF -> VSL JSON для CAD-чертежей.

---

#### M4.3.3: Extended domains demo (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T4.3.3.1 | Demo: IFC модель -> AI анализ | Загрузить IFC -> VSL JSON -> AI находит все окна, рассчитывает площади, анализирует слои | T4.3.1.5 | 🟡 | 2 дня |
| T4.3.3.2 | Demo: DWG чертёж -> AI анализ | Загрузить DWG -> VSL JSON -> AI находит все размеры, аннотации, блоки | T4.3.2.5 | 🟡 | 2 дня |
| T4.3.3.3 | Написать документацию extended domains | API docs, примеры JSON для всех форматов (SVG, PDF, Three.js, IFC, DWG), setup guides | T4.3.3.1, T4.3.3.2 | 🟢 | 1 день |

**Результат M4.3.3:** AI анализ архитектурных чертежей и BIM-моделей через VSL.

---

### Deliverables Phase 4

- **Расширенный SDK** — поддержка 2D чертежей (SVG/PDF) и 3D сцен (Three.js/BIM/CAD)
- **Парсеры** — SVG, PDF, IFC, DWG/DXF
- **Примеры** — AI анализ архитектурных чертежей, управление BIM-моделями

### Критерии успеха Phase 4

- ✅ VSL snapshot работает для 2D чертежей (SVG, PDF)
- ✅ VSL snapshot работает для 3D сцен (Three.js, IFC)
- ✅ AI может анализировать чертежи (находить окна, рассчитывать площади)
- ✅ AI может управлять 3D-сценами (поворот камеры, изоляция слоёв)

### Связи с документами

- Архитектура: [ARCHITECTURE.md §14](./ARCHITECTURE.md)
- Расширения: [extended_format_specs.md](./extended_format_specs.md)
- Решения: [DECISIONS.md §3 DEC-017](./DECISIONS.md)

---

## 6. Phase 5: Humanization Layer (🟡 2–3 недели)

**Цель:** имитация человеческого поведения для обхода anti-bot detection при работе с внешними приложениями (LinkedIn, банки, госуслуги).

### Проблема

VSL имитирует **действия** человека (click, type, scroll), но не имитирует **поведение** человека. Внешние приложения проверяют паттерны поведения — timing, mouse movement, scroll patterns — и блокируют автоматизацию.

### Компоненты

| Компонент | Что делает | Как реализуют |
|-----------|-----------|---------------|
| **Timing Engine** | Случайные задержки между действиями | Gaussian distribution (μ=500ms, σ=200ms), min=200ms, max=2000ms |
| **Mouse Simulator** | Кривые линии мыши (Bezier curves) | Cubic Bezier с random control points, overshoot на 5–15% |
| **Scroll Randomizer** | Случайные паттерны скролла | Random step size (50–300px), random pauses, occasional scroll-back |
| **Rate Limiter** | Ограничение действий в час | Configurable: N actions/hour, N profiles/day |
| **Session Manager** | Управление сессиями | Random session duration (5–30 min), random breaks |
| **Fingerprint Rotator** | Ротация browser fingerprint | userAgent, WebGL, canvas hash, timezone |
| **Typing Simulator** | Человечный ввод текста | Random delay между keystrokes (50–200ms), occasional typos + backspace |

---

### M5.1: Timing Engine + Mouse Simulator (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T5.1.1 | Реализовать Timing Engine | Gaussian distribution (μ=500ms, σ=200ms), min=200ms, max=2000ms. Конфигурируемые параметры per-site | — | 🟡 | 1 день |
| T5.1.2 | Реализовать Mouse Simulator | Cubic Bezier curves с random control points. Overshoot на 5–15%. Natural mouse movement | T5.1.1 | 🟡 | 2 дня |
| T5.1.3 | Интегрировать в Action Executor | Action Executor → Timing Engine → Mouse Simulator → Browser/OS. Overhead: +200–2000ms per action | T5.1.2 | 🟡 | 1 день |
| T5.1.4 | Написать тесты timing + mouse | Тесты: distribution correctness, Bezier curve generation, overhead measurement | T5.1.3 | 🟢 | 1 день |

**Результат M5.1:** действия выглядят как человеческие (timing, mouse movement).

---

### M5.2: Scroll Randomizer + Rate Limiter (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T5.2.1 | Реализовать Scroll Randomizer | Random step size (50–300px), random pauses, occasional scroll-back. Natural scroll patterns | — | 🟡 | 1 день |
| T5.2.2 | Реализовать Rate Limiter | Configurable: N actions/hour, N profiles/day. Throttling при превышении лимитов | T5.2.1 | 🟡 | 1 день |
| T5.2.3 | Интегрировать в Action Executor | Action Executor → Scroll Randomizer → Rate Limiter → Browser/OS | T5.2.2 | 🟡 | 1 день |
| T5.2.4 | Написать тесты scroll + rate | Тесты: scroll pattern randomness, rate limiting, throttling | T5.2.3 | 🟢 | 1 день |

**Результат M5.2:** агент не превышает лимиты, скролл выглядит естественно.

---

### M5.3: Session Manager + Fingerprint Rotator + Typing Simulator (1 неделя)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T5.3.1 | Реализовать Session Manager | Random session duration (5–30 min), random breaks. Session state management | — | 🟡 | 1 день |
| T5.3.2 | Реализовать Fingerprint Rotator | userAgent, WebGL, canvas hash, timezone rotation. Different fingerprints per session | T5.3.1 | 🟡 | 1 день |
| T5.3.3 | Реализовать Typing Simulator | Random delay между keystrokes (50–200ms), occasional typos + backspace. Human-like typing | T5.3.2 | 🟡 | 1 день |
| T5.3.4 | Интегрировать все компоненты | Action Executor → Humanization Layer (все 7 компонентов) → Browser/OS | T5.3.3 | 🟡 | 1 день |
| T5.3.5 | Написать тесты humanization | Тесты: session management, fingerprint rotation, typing simulation. Overhead: +300–3000ms per action | T5.3.4 | 🟢 | 1 день |

**Результат M5.3:** полная имитация человеческого поведения.

---

### Deliverables Phase 5

- **Humanization Module** — модуль для имитации человеческого поведения
- **Конфигурация per-site** — настройки для разных сайтов (LinkedIn, банки, госуслуги)

### Критерии успеха Phase 5

- ✅ Действия агента неотличимы от действий человека (timing, mouse movement, scroll)
- ✅ Rate limiting работает (не превышаем лимиты)
- ✅ Session management работает (random duration, random breaks)
- ✅ Fingerprint rotation работает (разные userAgent, WebGL, canvas hash)
- ✅ Overhead: +300–3000ms per action (intentional)

### Когда НЕ нужен

- Внутренние приложения (корпоративные тулы)
- Тестовые среды
- Сайты без anti-bot detection
- Когда агент работает от имени пользователя (user-present mode)

### Связи с документами

- Архитектура: [ARCHITECTURE.md §13](./ARCHITECTURE.md)
- Решения: [DECISIONS.md §3 DEC-016](./DECISIONS.md)

---

## 7. Phase 6: Ecosystem & Standardization (🔴 12+ недель)

**Цель:** сделать VSL открытым стандартом для computer use agents. Экосистемный эффект: если VSL станет стандартом, все AI-агенты смогут работать с любым экраном.

### Компоненты

| Компонент | Описание | Сложность |
|-----------|----------|-----------|
| **Public Specification** | JSON schema specification (RFC-style) | 🟡 Средняя |
| **Reference Implementation** | Open-source SDK (TypeScript) | 🟡 Средняя |
| **Documentation** | API docs, tutorials, examples, migration guides | 🟢 Низкая |
| **Community** | GitHub, Discord, examples, integrations | 🔴 Высокая |
| **Integration Partners** | Anthropic, OpenAI, Google, open-source agents | 🔴 Высокая |

---

### M6.1: Public Spec v1.0 (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T6.1.1 | Написать JSON schema specification | Формальное описание VSL JSON формата. Все поля, типы, ограничения. RFC-style документ | — | 🟡 | 3 дня |
| T6.1.2 | Определить версионирование | Semantic versioning (major.minor.patch). Backward compatibility policy. Deprecation cycle | T6.1.1 | 🟡 | 1 день |
| T6.1.3 | Написать migration guides | Миграция между версиями. Breaking changes policy | T6.1.2 | 🟢 | 1 день |
| T6.1.4 | Опубликовать spec v1.0 | Spec опубликована на GitHub, доступна для публичного ревью | T6.1.3 | 🟢 | 1 день |

**Результат M6.1:** спецификация готова к публикации.

---

### M6.2: Open-source SDK Release (4 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T6.2.1 | Подготовить reference implementation (TypeScript) | Полный SDK: snapshot generation, caching, diff, LLM adapters, action execution. NPM package | — | 🟡 | 5 дней |
| T6.2.2 | Написать unit tests | Покрытие >80%. Тесты на всех компонентах | T6.2.1 | 🟡 | 3 дня |
| T6.2.3 | Написать integration tests | End-to-end тесты: snapshot -> LLM -> action -> новый snapshot | T6.2.2 | 🟡 | 2 дня |
| T6.2.4 | Опубликовать NPM package | npm publish @vsl/sdk. Package доступен для установки | T6.2.3 | 🟢 | 1 день |
| T6.2.5 | Написать README для SDK | Quick start, API docs, examples, installation guide | T6.2.4 | 🟢 | 2 дня |
| T6.2.6 | Создать GitHub repository | Public repo. LICENSE (CC BY 4.0). CONTRIBUTING.md. CODE_OF_CONDUCT.md | T6.2.5 | 🟢 | 1 день |

**Результат M6.2:** SDK доступен для интеграции.

---

### M6.3: Documentation + Tutorials (3 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T6.3.1 | Написать API documentation | TypeDoc/JSDoc для всех публичных API. 100% coverage | T6.2.5 | 🟡 | 3 дня |
| T6.3.2 | Написать getting started tutorial | Пошаговое руководство: установка, первый snapshot, первое действие | T6.3.1 | 🟢 | 2 дня |
| T6.3.3 | Написать integration guides | Интеграция с OpenAI, Anthropic, Google. Примеры кода | T6.3.2 | 🟡 | 3 дня |
| T6.3.4 | Написать examples | 10+ примеров: web, desktop, mobile, extended domains. Каждый пример — рабочий код | T6.3.3 | 🟡 | 3 дня |
| T6.3.5 | Написать migration guides | Миграция с других подходов (Anthropic Computer Use, OpenAI Operator) на VSL | T6.3.4 | 🟢 | 2 дня |
| T6.3.6 | Опубликовать документацию | Documentation site (GitHub Pages / Vercel). Поиск, навигация | T6.3.5 | 🟢 | 2 дня |

**Результат M6.3:** документация полная и доступна.

---

### M6.4: Community Launch (2 недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T6.4.1 | Создать Discord server | Публичный сервер. Каналы: #general, #help, #examples, #integrations | — | 🟢 | 0.5 дня |
| T6.4.2 | Написать contribution guidelines | CONTRIBUTING.md: как внести вклад, code style, PR process, code review | T6.4.1 | 🟢 | 1 день |
| T6.4.3 | Создать examples repository | Отдельный репозиторий с примерами интеграции. 10+ примеров | T6.4.2 | 🟡 | 2 дня |
| T6.4.4 | Запустить community | Анонс на Hacker News, Reddit, Twitter. Первые 100 members | T6.4.3 | 🟡 | 2 дня |
| T6.4.5 | Провести Q&A session | Live session для первых пользователей. Ответы на вопросы | T6.4.4 | 🟢 | 1 день |

**Результат M6.4:** сообщество запущено.

---

### M6.5: First Integrations (2+ недели)

| ID | Задача | Acceptance Criteria | Зависимости | Сложность | Время |
|----|--------|---------------------|-------------|-----------|-------|
| T6.5.1 | Интеграция с 3rd party agent #1 | Партнёрство с open-source AI агентом. Интеграция VSL SDK | T6.4.4 | 🔴 | 3 дня |
| T6.5.2 | Интеграция с 3rd party agent #2 | Партнёрство с другим AI агентом | T6.5.1 | 🔴 | 3 дня |
| T6.5.3 | Интеграция с 3rd party agent #3 | Третья интеграция | T6.5.2 | 🔴 | 3 дня |
| T6.5.4 | Написать case studies | 3 case studies: как интеграция улучшила агент | T6.5.3 | 🟡 | 2 дня |
| T6.5.5 | Партнёрства с Anthropic/OpenAI/Google | Обсуждение интеграции VSL в их продукты | T6.5.4 | 🔴 | 5 дней |

**Результат M6.5:** первые внешние интеграции.

---

### Deliverables Phase 6

- **Public Specification** v1.0 — JSON schema specification
- **Open-source SDK** — reference implementation (TypeScript)
- **Documentation** — API docs, tutorials, examples
- **Community** — GitHub, Discord, examples repository

### Критерии успеха Phase 6

- ✅ Public spec v1.0 опубликована
- ✅ Open-source SDK доступен на NPM
- ✅ Документация полная (API docs, tutorials, examples)
- ✅ Сообщество активно (GitHub stars, Discord members, contributions)
- ✅ Первые 3rd party интеграции (минимум 3)

### Связи с документами

- Архитектура: [ARCHITECTURE.md §1-14](./ARCHITECTURE.md)
- Дизайн-система: [DESIGN_SYSTEM.md §1-4](./DESIGN_SYSTEM.md)
- Концепция: [PRODUCT_CONCEPT.md §1-3](./PRODUCT_CONCEPT.md)
- Решения: [DECISIONS.md §3 DEC-001 — DEC-020](./DECISIONS.md)

---

## 8. Dependencies & Risks

### Зависимости между фазами

| Фаза | Зависит от | Блокирует |
|------|-----------|-----------|
| Phase 1 (Web MVP) | — | Phase 2, 3, 4, 5, 6 |
| Phase 2 (Desktop) | Phase 1 | — |
| Phase 3 (Mobile) | Phase 1 | — |
| Phase 4 (Extended) | Phase 1 | — |
| Phase 5 (Humanization) | Phase 1 | — |
| Phase 6 (Ecosystem) | Phase 1, 2, 3, 4, 5 | — |

Phase 2-5 могут выполняться параллельно после завершения Phase 1.

### Ключевые риски

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|-----------|
| **Segmentation Engine accuracy** | 🟡 Средняя | 🔴 Высокое | 5-level algorithm с vision model fallback. Тестирование на реальных страницах. |
| **LLM hallucinations** | 🟡 Средняя | 🔴 Высокое | Function calling (structured output). Few-shot examples. Валидация target_id. |
| **Anti-bot detection** | 🟡 Средняя | 🟡 Среднее | Humanization Layer (Phase 5). Timing, mouse movement, scroll randomization. |
| **Токенизация больших JSON** | 🟢 Низкая | 🟡 Среднее | Diff-механизм (экономия 60-80%). Кэширование статических элементов. |
| **Accessibility API limitations** | 🟡 Средняя | 🟡 Среднее | Hybrid approach (DOM + A11y + Visual). Fallback на visual fragments. |
| **Cross-platform consistency** | 🟡 Средняя | 🟡 Среднее | Единый VSL JSON формат. Platform adapters абстрагируют различия. |

---

## 9. Success Metrics

### Технические метрики

| Метрика | Цель | Как измерять |
|---------|------|-------------|
| **Token savings** | 60-80% после кэширования | Сравнение: полный JSON vs diff JSON |
| **Latency** | 1-3 секунды на итерацию | Snapshot + LLM inference + action execution |
| **Accuracy** | 95%+ action success rate | % корректно выполненных действий (target_id match) |
| **Coverage** | 85%+ элементов без vision model | % элементов классифицированных уровнями 1-4 |

### Продуктовые метрики

| Метрика | Цель | Как измерять |
|---------|------|-------------|
| **Adoption** | 1000+ GitHub stars | GitHub repository statistics |
| **Integrations** | 10+ 3rd party agents | Партнёрства, case studies |
| **Community** | 500+ Discord members | Discord server statistics |
| **Documentation** | 100% API coverage | TypeDoc/JSDoc coverage report |

---

## 10. Cross-References

### Связи с другими документами

| Документ | Описание | Связанные секции |
|----------|----------|-----------------|
| [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md) | Концепция продукта, value proposition, use cases | §2.5 (Why VSL?), §3 (Solution), §5 (Use Cases) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Высокоуровневая архитектура, pipeline, компоненты | §2-14 (все секции) |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | JSON schema design principles, API patterns | §2 (Design Principles), §3 (Naming), §4 (Data Model) |
| [DECISIONS.md](./DECISIONS.md) | Архитектурные решения (DEC-001 — DEC-021) | §3 (All decisions) |
| [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md) | Целевая аудитория, сценарии использования | §2 (Primary/Secondary/Tertiary) |
| [README_AI.md](./README_AI.md) | Мастер-документ для AI-агентов | §3 (Document Index), §10 (Cross-References) |
| [CHECK_ALL.md](./CHECK_ALL.md) | Контракт чек-пайплайна: quality gates S0–S7, запуск, интерпретация сбоев, логи | §4 (Шаги проверки), §8 (S5–S7 активированы в Phase 1) |

### Связи решений с фазами

| Решение | Фаза | Описание |
|---------|------|----------|
| DEC-001 | Все | VSL — JSON-формат и SDK, не UI-приложение |
| DEC-002 | Все | Model-agnostic дизайн (работает с любым LLM) |
| DEC-004 | Phase 1 | Гибридный подход (DOM/A11y + visual fragments) |
| DEC-005 | Phase 1 | Контекстные эмбеддинги вместо полных скриншотов |
| DEC-006 | Phase 1 | Diff-механизм для экономии токенов |
| DEC-007 | Phase 1 | Максимальная детализация — все видимые элементы |
| DEC-008 | Phase 1 | Полный набор действий (базовые, расширенные, навигационные) |
| DEC-009 | Phase 2, 3 | Все платформы сразу, но начать с Web MVP |
| DEC-014 | Phase 1 | Multi-Level Segmentation Algorithm (5 уровней) |
| DEC-015 | Phase 1 | Visual Fragments Pipeline (CLIP/DINOv2 + WebP + hybrid) |
| DEC-016 | Phase 5 | Humanization Layer для обхода anti-bot detection |
| DEC-017 | Phase 4 | Extended Domains — VSL для CAD/BIM/3D |
| DEC-018 | Все | Why VSL — обоснование ценности |
| DEC-019 | Phase 1 | 5-Layer Integration Architecture |
| DEC-020 | Phase 1 | CHECK_ALL.md — контракт чек-пайплайна (quality gates S0–S4), активация шагов S5+ |
| DEC-021 | Phase 1 | Порог покрытия тестами 80% (S7, jest coverageThreshold) |

---

## Appendix A: Timeline Summary

Week 1-6:   Phase 1 — Web MVP (🟢 4-6 недель)
Week 7-14:  Phase 2 — Desktop (🟡 6-8 недель)  [параллельно с Phase 3-5]
Week 7-14:  Phase 3 — Mobile (🟡 6-8 недель)   [параллельно с Phase 2, 4-5]
Week 7-19:  Phase 4 — Extended Domains (🟡 8-12 недель) [параллельно с Phase 2-3, 5]
Week 7-9:   Phase 5 — Humanization Layer (🟡 2-3 недели) [параллельно с Phase 2-4]
Week 15-36: Phase 6 — Ecosystem & Standardization (🔴 12+ недель) [после Phase 1-5]
**Общая длительность:** ~36-52 недели (9-13 месяцев)

---

## Appendix B: Task Count Summary

| Фаза | Milestones | Задач | Сложность |
|------|-----------|-------|-----------|
| Phase 1 (Web MVP) | 6 | 32 | 🟢🟡🔴 |
| Phase 2 (Desktop) | 5 | 26 | 🟡🔴 |
| Phase 3 (Mobile) | 4 | 22 | 🟡🔴 |
| Phase 4 (Extended) | 9 | 33 | 🟡🔴 |
| Phase 5 (Humanization) | 3 | 13 | 🟡 |
| Phase 6 (Ecosystem) | 5 | 25 | 🟡🔴 |
| **Итого** | **32** | **~151** | — |

---

## Appendix C: Priority Matrix

| Фаза | Приоритет | Зависимости | Ценность | Риск |
|------|-----------|------------|----------|------|
| Phase 1 (Web MVP) | 🔴 Critical | — | 🔴 Высокая | 🟡 Средний |
| Phase 2 (Desktop) | 🟡 High | Phase 1 | 🟡 Средняя | 🔴 Высокий |
| Phase 3 (Mobile) | 🟡 High | Phase 1 | 🟡 Средняя | 🔴 Высокий |
| Phase 4 (Extended) | 🟢 Medium | Phase 1 | 🟢 Средняя | 🟡 Средний |
| Phase 5 (Humanization) | 🟢 Medium | Phase 1 | 🟡 Средняя | 🟢 Низкий |
| Phase 6 (Ecosystem) | 🔴 Critical | Phase 1-5 | 🔴 Высокая | 🔴 Высокий |

---

*Документ создан: 2025-05-28 | Автор: Maxim Zhadobin | Версия: v0.2 | Лицензия: CC BY 4.0*