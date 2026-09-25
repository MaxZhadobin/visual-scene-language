# DECISIONS.md — Visual Scene Language (VSL)

> Defensive Publication | Author: Maxim Zhadobin | Date: 28.05.2025 | Version: v0.2
> License: CC BY 4.0
>
> **Важно:** Этот документ содержит все подтверждённые человеком архитектурные решения
> по проекту VSL. Каждое решение имеет контекст, обоснование и ссылки на связанные документы.

---

## 1. Overview

DECISIONS.md — это журнал всех архитектурных решений, принятых в ходе проектирования VSL.
Каждое решение записано в формате: **контекст → решение → обоснование → последствия**.

Документ предназначен для:
- Быстрого понимания, почему архитектура именно такая
- Предотвращения повторного обсуждения уже принятых решений
- Onboarding новых участников проекта
- AI-агентов, которые работают с проектом (one-shot ingestion)

**Cross-references:**
- Концепция продукта → [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md)
- Целевая аудитория → [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md)
- Дизайн-система → [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)
- Архитектура → [ARCHITECTURE.md](./ARCHITECTURE.md)
- Roadmap → [ROADMAP.md](./ROADMAP.md)
- Чек-пайплайн (quality gates) → [CHECK_ALL.md](./CHECK_ALL.md)

---

## 2. Format

Каждое решение записывается в формате:

### DEC-XXX: Краткое название

**Дата:** YYYY-MM-DD
**Статус:** proposed | accepted | deprecated | superseded by DEC-YYY
**Контекст:** Что произошло? Какая проблема возникла?
**Решение:** Что решили?
**Обоснование:** Почему именно так? Какие альтернативы рассматривали?
**Последствия:** Что это значит для архитектуры? Какие документы затронуты?
**Связи:** DEC-XXX, DEC-YYY
---

## 3. Decisions

### DEC-001: VSL — это JSON-формат и SDK, а не UI-приложение

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** При обсуждении проекта возник вопрос: что именно мы строим? UI-приложение для визуализации сцен? Или что-то другое?
**Решение:** VSL — это инфраструктурный слой (middleware/SDK) для AI-агентов. JSON-формат для представления визуальных сцен + SDK для извлечения, кэширования и диффа. Не UI-проект.
**Обоснование:** VSL решает проблему computer use agents — им нужно семантическое представление экрана, а не визуализация. JSON — нативный формат для LLM. SDK позволяет встраивать VSL в чужие продукты.
**Последствия:** Все документы (PRODUCT_CONCEPT.md, TARGET_AUDIENCE.md, DESIGN_SYSTEM.md, ARCHITECTURE.md) описывают VSL как формат/SDK, а не как UI.
**Связи:** DEC-002, DEC-003

---

### DEC-002: VSL работает как сторонний модуль без обучения LLM

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Вопрос: нужно ли fine-tuning LLM для работы с VSL?
**Решение:** VSL работает model-agnostic через промпт-инжиниринг, без fine-tuning. Работает с любым LLM (GPT-4, Claude, Gemini, open-source).
**Обоснование:** Fine-tuning требует доступа к модели и больших данных. Промпт-инжиниринг позволяет работать с любым LLM сразу. JSON — достаточно структурированный формат, чтобы LLM понимала его без обучения.
**Последствия:** ARCHITECTURE.md описывает LLM Integration Layer с адаптерами для разных провайдеров. DESIGN_SYSTEM.md описывает JSON schema, оптимизированную для LLM-контекста.
**Связи:** DEC-001, DEC-005

---

### DEC-003: Целевая аудитория — все AI-агенты, работающие с экраном

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Вопрос: для кого VSL? Только для разработчиков AI-агентов? Или для самих агентов?
**Решение:** VSL — инфраструктурный слой для ВСЕХ AI-агентов, работающих с экраном. Не узкопрофильная тула для разработчиков, а открытый стандарт. Первичная аудитория — сами AI-агенты (или их операторы). Вторичная — разработчики SDK. Третичная — QA/test automation.
**Обоснование:** Если VSL — это стандарт, то он должен быть универсальным. Ограничение только разработчиками сужает экосистему. AI-агенты — конечные потребители VSL, они используют его как "зрение".
**Последствия:** TARGET_AUDIENCE.md описывает три уровня аудитории. PRODUCT_CONCEPT.md подчёркивает универсальность.
**Связи:** DEC-001, DEC-002

---

### DEC-004: Гибридный подход к сбору данных (DOM/A11y + visual fragments)

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Изначально предполагалось, что VSL работает только со скриншотами. Но это дорого и медленно.
**Решение:** VSL использует гибридный подход. Основной источник: DOM + accessibility API (структурные данные). Скриншоты используются ТОЛЬКО для визуальных элементов, которые не парсятся через DOM (изображения, canvas, сложные кастомные виджеты).
**Обоснование:** DOM/A11y даёт точную семантическую информацию (роли, состояния, тексты) бесплатно. Скриншоты нужны только для элементов без A11y. Это снижает стоимость (10–100 KB JSON вместо 1–2 MB скриншот) и повышает точность.
**Последствия:** ARCHITECTURE.md описывает Capture Layer с тремя источниками (DOM, A11y, Visual). PRODUCT_CONCEPT.md обновлён с учётом гибридного подхода. Все архитектурные диаграммы отражают гибрид.
**Связи:** DEC-005, DEC-006

---

### DEC-005: Контекстные эмбеддинги вместо полных скриншотов

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Как передавать визуальную информацию LLM? Полный скриншот? Или что-то другое?
**Решение:** Каждый элемент VSL содержит ссылку на эмбеддинг своего визуального фрагмента (не всего экрана). LLM получает семантическую структуру + визуальные фрагменты по ссылке.
**Обоснование:** Полный скриншот = 1–2 MB = ~1000 токенов. Контекстные эмбеддинги = только нужные элементы = экономия токенов. LLM может игнорировать визуал и работать только со структурой (быстро, дёшево) или подгружать фрагменты по необходимости.
**Последствия:** DESIGN_SYSTEM.md описывает visual fragments в data model. ARCHITECTURE.md описывает Segmentation Engine и VSL Builder.
**Связи:** DEC-004, DEC-007

---

### DEC-006: Diff-механизм для экономии токенов

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Каждый цикл computer use agent делает новый снэпшот экрана. Как не передавать одни и те же данные повторно?
**Решение:** VSL кэширует статические элементы и передаёт только дифф изменений. Первый вызов: полный JSON. Последующие: только added/modified/removed элементы + ссылки на кэшированные.
**Обоснование:** Статические элементы (header, footer, логотипы, иконки) редко меняются. Передача полного JSON каждый раз = трата токенов. Дифф = 60–80% экономия после первого вызова.
**Последствия:** ARCHITECTURE.md описывает Cache & Diff Engine (секции 5-6). DESIGN_SYSTEM.md описывает формат диффа.
**Связи:** DEC-004, DEC-005

---

### DEC-007: Максимальная детализация — все видимые элементы

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Какую granularity использовать? Только интерактивные элементы? Или все видимые?
**Решение:** Максимально детально. Все видимые элементы, не только интерактивные. Цель — дать LLM полноценное "зрение" экрана.
**Обоснование:** LLM нужно понимать контекст: где находится элемент, что вокруг, какая структура. Только интерактивные элементы = потеря контекста. Все элементы = полная картина.
**Последствия:** DESIGN_SYSTEM.md описывает полную иерархию объектов (objects tree). ARCHITECTURE.md описывает Segmentation Engine.
**Связи:** DEC-005, DEC-008

---

### DEC-008: Полный набор действий — базовые, расширенные, навигационные

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Какие действия должен поддерживать VSL? Только click/type/scroll? Или больше?
**Решение:** Все действия: базовые (click, type, scroll, hover, focus, blur, select, check, uncheck), расширенные (drag, drop, submit, reset, open, close, expand, collapse, wait), навигационные (navigate, go_back, go_forward, refresh).
**Обоснование:** Computer use agents должны мочь выполнять любые действия. Ограничение набора действий = ограничение возможностей агента.
**Последствия:** ARCHITECTURE.md описывает Action Model (секция 7). DESIGN_SYSTEM.md описывает action names (секция 3.4).
**Связи:** DEC-007, DEC-002

---

### DEC-009: Все платформы сразу, но начать с Web MVP

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** На каких платформах работать? Web? Desktop? Mobile?
**Решение:** Все платформы (web, desktop, mobile), но начать с Web MVP. Phase 1: Web (browser extension / desktop app with webview). Phase 2: Desktop (macOS/Windows/Linux). Phase 3: Mobile (iOS/Android).
**Обоснование:** VSL — универсальный стандарт, должен работать везде. Но MVP нужен быстро. Web — самая доступная платформа (DOM, A11y API). Desktop и Mobile добавляются позже.
**Последствия:** ARCHITECTURE.md описывает Platform Adapters (секция 8). ROADMAP.md описывает фазы.
**Связи:** DEC-004, DEC-010

---

### DEC-010: Use case — computer use agent с VSL как промежуточным представлением

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Какой ключевой use case VSL?
**Решение:** Управление экраном — автоматизация навигации по сайтам и приложениям. Цикл: DOM/A11y → VSL-представление → LLM принимает решение → действие (клик, ввод, скролл) → новый DOM/A11y snapshot → дифф.
**Обоснование:** Это попадает в тренд computer use agents (Anthropic Computer Use, OpenAI Operator, Google Mariner). VSL даёт структурированное представление, которое легче для LLM, чем пиксели.
**Последствия:** PRODUCT_CONCEPT.md описывает use case. ARCHITECTURE.md описывает data flow (секция 3).
**Связи:** DEC-001, DEC-002, DEC-004

---

### DEC-011: Список документов для проекта VSL

**Дата:** 2025-05-28
**Статус:** accepted (частично superseded by DEC-020)
**Контекст:** Какие документы нужны для проекта?
**Решение:** 6 документов: PRODUCT_CONCEPT.md (концепция), TARGET_AUDIENCE.md (аудитория), DESIGN_SYSTEM.md (JSON schema design principles), ARCHITECTURE.md (архитектура), ROADMAP.md (план), DECISIONS.md (решения), README_AI.md (project bible для AI). DESIGN_SYSTEM.md и CHECK_ALL.md не нужны — это не UI проект и нет кода для проверки.
**Обоснование:** Документы покрывают все аспекты: от концепции до реализации. Каждый документ имеет чёткую цель. Не нужны документы, которые не применимы (UI design system, code quality checks).
**Последствия:** Все документы созданы и связаны cross-references.
**Связи:** DEC-001, DEC-003

---

### DEC-012: Структура ARCHITECTURE.md — 12 секций

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Какая структура ARCHITECTURE.md?
**Решение:** 12 секций: 1) Overview, 2) System Architecture (6 компонентов pipeline), 3) Data Flow, 4) Hybrid Data Collection, 5) Caching Strategy, 6) Diff Mechanism, 7) Action Model, 8) Platform Adapters, 9) Integration API, 10) Error Handling & Resilience, 11) Performance Considerations, 12) Security & Privacy.
**Обоснование:** Структура покрывает все аспекты архитектуры: от высокоуровневой схемы до деталей реализации. Каждая секция имеет чёткую цель.
**Последствия:** ARCHITECTURE.md создан (932 строки). Все секции заполнены.
**Связи:** DEC-001, DEC-004, DEC-006, DEC-008, DEC-009

---

### DEC-013: Структура DESIGN_SYSTEM.md — JSON schema design principles

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Какой фокус DESIGN_SYSTEM.md? Это не UI design system.
**Решение:** DESIGN_SYSTEM.md фокусируется на JSON schema design principles, API patterns, naming conventions для VSL elements. 4 секции: 1) Overview, 2) JSON Schema Design Principles (минимализм, семантика, extensibility, backward compatibility), 3) Element Naming Conventions (типы, свойства, состояния, действия), 4) Data Model Structure (canvas, objects tree, properties, visual fragments).
**Обоснование:** VSL — это JSON-формат, не UI. DESIGN_SYSTEM.md должен описывать принципы проектирования JSON-схемы, а не UI-компоненты.
**Последствия:** DESIGN_SYSTEM.md создан (450 строк). Все секции заполнены.
**Связи:** DEC-001, DEC-005, DEC-007

---
### DEC-014: Multi-Level Segmentation Algorithm (5 уровней)

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** DOM-дерево ≠ семантическое дерево. Один `<div>` может содержать 10 логических элементов. Как извлечь семантику из DOM без потери информации?
**Решение:** 5-уровневый алгоритм сегментации с нарастающей сложностью: (1) семантические теги (~40% элементов, бесплатно), (2) ARIA-атрибуты (~20%, бесплатно), (3) CSS-анализ (~25%, 10–50ms), (4) структурный анализ паттернов (50–100ms), (5) vision model fallback (~15%, 100–500ms). Результат: ~85% элементов классифицируются без vision model.
**Обоснование:** Каждый уровень добавляет покрытие ценой latency. Уровни 1–4 бесплатны или быстрые и покрывают 85% элементов. Vision model — дорогой fallback только для элементов без A11y. Ключевая эвристика: "Semantic Density" score (≥3 → включаем, ==0 без детей → пропускаем).
**Последствия:** ARCHITECTURE.md §2.2.1 описывает алгоритм детально. Segmentation Engine — ключевой R&D-риск, но митигирован многоуровневым подходом.
**Связи:** DEC-004, DEC-005, DEC-007

---

### DEC-015: Visual Fragments Pipeline (CLIP/DINOv2 + WebP + hybrid approach)

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Элементы без A11y (images, canvas, custom widgets) нужно описать визуально. Как генерировать эмбеддинги эффективно, не перегружая LLM?
**Решение:** Pipeline: (1) bounding box extraction (10–50ms), (2) CLIP/DINOv2 классификация (100–300ms batch), (3) hybrid approach — CLIP embedding всегда (~2 KB) + Base64 WebP image по запросу LLM (lazy loading). Формат: WebP (компактнее JPEG на 25–30%). Кэширование по hash(bounding_box + pixel_content). Экономия ~80% токенов.
**Обоснование:** Полный скриншот = 1–2 MB = ~1000 токенов каждый раз. Контекстные эмбеддинги = только нужные элементы. Hybrid approach: embedding для кэширования/сравнения (всегда), image только по запросу LLM. Если LLM не запрашивает визуал → экономия 80% токенов.
**Последствия:** ARCHITECTURE.md §2.2.2 описывает pipeline детально. DESIGN_SYSTEM.md описывает visual fragments в data model (поле `vf`).
**Связи:** DEC-004, DEC-005, DEC-006, DEC-014

---

### DEC-016: Humanization Layer для обхода anti-bot detection

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** VSL имитирует ДЕЙСТВИЯ человека (click, type, scroll), но не ПОВЕДЕНИЕ. Внешние приложения (LinkedIn, банки, госуслуги) проверяют паттерны поведения — timing, mouse movement, scroll patterns — и блокируют автоматизацию.
**Решение:** Добавить Humanization Layer (§13 ARCHITECTURE.md) с 7 компонентами: Timing Engine (Gaussian delays μ=500ms σ=200ms), Mouse Simulator (Bezier curves с overshoot 5–15%), Scroll Randomizer (random step 50–300px), Rate Limiter (N actions/hour), Session Manager (random duration 5–30 min), Fingerprint Rotator (userAgent, WebGL, canvas hash), Typing Simulator (random delay 50–200ms + occasional typos). Overhead: +300–3000ms per action (intentional). Конфигурация per-site.
**Обоснование:** Без humanization agent блокируется на сайтах с anti-bot detection (LinkedIn, банки). Humanization делает действия неотличимыми от человеческих. Overhead — это фича, не баг: имитирует человеческую скорость.
**Последствия:** ARCHITECTURE.md §13 описывает Humanization Layer детально. ROADMAP.md Phase 5 (2–3 недели). Humanization Layer НЕ влияет на VSL JSON — только на action execution.
**Связи:** DEC-008, DEC-009

---

### DEC-017: Extended Domains — VSL для CAD/BIM/3D

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** VSL работает с UI (web/desktop/mobile). Но CAD/BIM/3D форматы УЖЕ содержат богатую семантику (типы элементов, слои, размеры, материалы, связи). В отличие от веб (где нужно ИНФЕРИТЬ семантику из DOM), здесь семантика уже заложена в формате. Можно расширить VSL для архитектурных чертежей и 3D-сцен.
**Решение:** Расширить VSL (§14 ARCHITECTURE.md): (1) 2D чертежи (SVG/PDF/DWG/DXF) — новые типы: line, arc, circle, polyline, dimension, annotation, callout, layer, block, hatch. (2) 3D сцены (Three.js/Babylon.js/BIM/CAD) — новые поля: pos3d, rot3d, scale3d, camera, material, light. (3) 3D-действия: rotate_camera, zoom, pan, isolate_layer, hide_layer, measure_distance. Обратная совместимость сохранена — новые типы/поля опциональны.
**Обоснование:** CAD/BIM форматы (IFC, DWG) уже содержат семантику — VSL только извлекает и унифицирует. Это расширяет область применения VSL за пределы UI. AI может анализировать чертежи (находить окна, рассчитывать площади) и управлять BIM-моделями. Фазы реализации: Phase 4.1 (2D, 2–4 недели), Phase 4.2 (3D веб, 4–8 недель), Phase 4.3 (BIM/CAD, 4–6 недель).
**Последствия:** ARCHITECTURE.md §14 описывает Extended Domains детально. ROADMAP.md Phase 4 (8–12 недель). extended_format_specs.md описывает расширения стилей/материалов/анимации.
**Связи:** DEC-001, DEC-002, DEC-009

---

### DEC-018: "Why VSL?" — обоснование ценности в PRODUCT_CONCEPT.md

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Нужно чётко объяснить, зачем нужна VSL как "прокладка" между экраном и LLM. Без обоснования непонятна ценность middleware.
**Решение:** Добавить §2.5 в PRODUCT_CONCEPT.md: VSL = семантический транслятор. 3 проблемы, которые решает VSL: (1) LLM "слепой" без vision (скриншот = 1000+ токенов, медленно, неточно), (2) DOM/A11y ≠ семантика (тысячи `<div>` без смысла), (3) нет стандарта для computer use agents (Anthropic = скриншоты, OpenAI = проприетарный, Google = закрытый). Честные нюансы: VSL не заменяет vision полностью (гибрид), middleware не продукт (ценность в экосистеме), решает "последнюю милю" (мост между LLM и экраном).
**Обоснование:** Без чёткого обоснования ценности VSL выглядит как лишняя абстракция. §2.5 объясняет: экономия токенов (10–100 KB vs 1–2 MB), повышение точности (семантика vs пиксели), ускорение (diff vs полный скриншот), универсальность (model-agnostic), стандарт (экосистемный эффект). Честные ограничения: Segmentation Engine — сложная R&D задача, визуальные фрагменты всё равно нужны, ценность зависит от экосистемы.
**Последствия:** PRODUCT_CONCEPT.md §2.5 описывает ценность VSL с аналогиями (скриншот vs JSON), 3 проблемами и решениями, честными нюансами.
**Связи:** DEC-001, DEC-002, DEC-004, DEC-010

---



### DEC-019: 5-Layer Integration Architecture (Core SDK, MCP Server, REST API, CLI, Chrome Extension)

**Дата:** 2025-05-28
**Статус:** accepted
**Контекст:** Как AI-агенты будут взаимодействовать с VSL? Нужна чёткая архитектура интеграции, определяющая слои абстракции от низкоуровневого SDK до высокоуровневого протокола.
**Решение:** 5-слойная архитектура интеграции: (1) **Core SDK** (`@vsl/sdk`) — TypeScript library, ядро системы (Capture Layer, Segmentation, Cache, Diff, Actions), (2) **MCP Server** (`@vsl/mcp-server`) — MCP Protocol (JSON-RPC over stdio), для Claude Desktop, Cline, TaoCoder. **Рекомендуется для MVP**, (3) **REST API** (`@vsl/api-server`) — HTTP/WebSocket, для серверной автоматизации с headless browser (Phase 2+), (4) **CLI** (`@vsl/cli`) — command-line interface, для scripting и debugging (Phase 2+), (5) **Chrome Extension** (`@vsl/extension`) — content script для DOM access + background script для коммуникации с MCP/API. Data flow: AI Agent → MCP Protocol → VSL MCP Server → Core SDK → Chrome Extension → DOM.
**Обоснование:** MCP Server — самый естественный путь интеграции для MVP, т.к. Claude Desktop, Cline, TaoCoder уже поддерживают MCP Protocol. Core SDK — для встраивания в код агента. REST API — для серверной автоматизации (Phase 2+). Chrome Extension — для DOM access в веб-страницах. 5-слойная архитектура обеспечивает гибкость: каждый слой может использоваться независимо.
**Последствия:** ARCHITECTURE.md §15 описывает 5-слойную архитектуру детально. ROADMAP.md Phase 1 включает M1.6 (MCP Server, 1 неделя, 5 задач T1.6.1-T1.6.5). Для MVP: Core SDK + MCP Server + Chrome Extension.
**Связи:** DEC-001, DEC-002, DEC-009, DEC-010

---

### DEC-020: CHECK_ALL.md — контракт чек-пайплайна (quality gates S0–S4)

**Дата:** 2026-09-19
**Статус:** accepted
**Контекст:** DEC-011 (2025-05-28) зафиксировал «CHECK_ALL.md не нужен — нет кода для проверки». С тех пор проект получил исполняемый артефакт (`vsl_to_image.py` + `vsl_scene_example.json`) и 8 документов, требующих проверки целостности. Нужен единый контракт проверки качества проекта (запрос пользователя: «чек-алл под наш проект»).
**Решение:** Создать CHECK_ALL.md как 8-й архитектурный документ — контракт/ТЗ для будущего `check_all.sh`. Quality gates S0–S4: S0 prerequisites (python3 ≥ 3.8, matplotlib), S1 синтаксис (`py_compile vsl_to_image.py`), S2 валидация mockup JSON-сцены, S3 headless smoke-тест рендера (`MPLBACKEND=Agg`), S4 целостность 8 документов. Часть DEC-011 («CHECK_ALL.md не нужен») superseded. `check_all.sh` вне скоупа до Phase 1: до реализации шаги §4 CHECK_ALL.md выполняются вручную, эквивалентны контракту скрипта 1:1; логи прогонов — `.taocoder/check_runs/`.
**Обоснование:** «Нет кода для проверки» больше не верно: есть код и разросшаяся документация. Минимум S0–S4 соответствует documentation-only стадии; расширение (lint, typecheck, тесты, CI) зафиксировано как S5+ в §8 CHECK_ALL.md и активируется в Phase 1 по [ROADMAP.md](./ROADMAP.md).
**Последствия:** CHECK_ALL.md создан в корне; кросс-линки добавлены в ARCHITECTURE.md, README_AI.md и этот документ; Document Index README_AI.md — 8/8. При реализации `check_all.sh` скрипт обязан соответствовать контракту CHECK_ALL.md — расхождение = провал соответствующего S-шага.
**Связи:** DEC-011, DEC-001, DEC-012

### DEC-021: Порог покрытия тестами 80% (S7, jest coverageThreshold)

**Дата:** 2026-09-20
**Статус:** accepted
**Контекст:** CHECK_ALL.md §8 в ревизии Phase 1 активирует шаг S7 (сборка + unit-тесты) и требует зафиксировать порог покрытия отдельным решением. Фактическое покрытие M1.1: 97.9% statements / 91.02% branches / 97.43% functions / 99.12% lines — порог нужен как автоматический барьер от деградации, а не как целевое значение.
**Решение:** Глобальный порог покрытия 80% по всем четырём метрикам (statements, branches, functions, lines) — `coverageThreshold.global` в `jest.config.js` для TS-кода SDK (src/**, тесты исключены). Нарушение порога → ненулевой exit code jest → провал шага S7 чек-пайплайна.
**Обоснование:** 80% — общепринятый баланс цена/польза; фактические 91–99% в M1.1 показывают, что порог не мешает разработке, но защищает от тихой деградации покрытия. Фиксация в конфиге делает контроль автоматическим внутри check_all.sh (S7), без ручных проверок.
**Последствия:** снижение любой метрики ниже 80% блокирует ALL GREEN; пересмотр порога — отдельным решением (только вверх по факту стабильности); CHECK_ALL.md §4 S7 и §8 ссылаются на это решение.
**Связи:** DEC-020, DEC-001

### DEC-022: Формат диффа — авторитетен ARCHITECTURE §6.2; DESIGN_SYSTEM §5.3 синхронизирован

**Дата:** 2026-09-22
**Статус:** accepted
**Контекст:** ROADMAP T1.2.3 требует формат диффа по ARCHITECTURE.md §6, но DESIGN_SYSTEM.md §5.3 описывал конфликтующий формат (op/path/before/after + операции move/reorder). Кроме того, §6.2 не специфицировал поведение при удалении опционального поля в modified и семантику invalidateBySelector, необходимую для MVP-кэша M1.2.
**Решение:** Авторитетный формат диффа — ARCHITECTURE.md §6.2: {diff_version, base_version, timestamp, changes:{added — полные поддеревья, modified — id + только изменившиеся поля, removed — {id}, unchanged_refs}}. Уточнения, зафиксированные реализацией M1.2: (1) modified передаёт удалённое опциональное поле явным null (r/st/txt/act; t/p/s/id — никогда не null); (2) сравнение — по плоскому индексу id + паре хэшей (contentHash {t,r,st,txt,act} + coordHash {p,s}, sha256), поле ch в сравнении не участвует; (3) invalidateBySelector — MVP-семантика: '*' → полный сброс, точный id, 'tag' → все id с префиксом 'tag_' (CSS-селекторы к кэшированным VslObject неприменимы — id = tag_indexPath); (4) DESIGN_SYSTEM.md §5.3 синхронизирован под §6.2 (не наоборот).
**Обоснование:** Единый формат в двух документах исключает расхождение доков и кода; явный null устраняет амбивалентность Partial («не изменилось» vs «удалено»); MVP-семантика селектора соответствует детерминированным id из M1.1.
**Последствия:** diffVslDocuments/VslDiff (src/diff/diffEngine.ts) — эталонная реализация; README_AI §4.3/§7 описывают M1.2 API; при эволюции формата правки начинаются с ARCHITECTURE §6.
**Связи:** DEC-006, DEC-021, DEC-001

### DEC-023: LLM-транспорт — нативный fetch, ноль runtime-зависимостей

**Дата:** 2026-09-22
**Статус:** accepted
**Контекст:** M1.3 (ROADMAP T1.3.1–T1.3.3) требует HTTP-транспорт для LLM-адаптеров (OpenAI chat/completions, Anthropic /v1/messages). Варианты: официальные SDK (openai, @anthropic-ai/sdk) против нативного fetch; проект с M1.1 держит ноль runtime-зависимостей в package.json и требует engines node>=18.
**Решение:** Транспорт — нативный fetch за инъецируемым интерфейсом LlmTransport (defaultTransport = fetch; в тестах — инъекция), без openai/@anthropic-ai/sdk. Retry — собственный retryWithBackoff по §10.3: до 3 попыток, паузы 1s/2s, повтор только сетевых ошибок/429/5xx (прочие 4xx — fast-fail), инъекция sleep для детерминированных тестов. Visual fragments — side-channel: адаптер собирает vf-ссылки из VslDocument|VslDiff, image-блоки только для ссылок с данными из опционального стора (vf-ref → {mediaType, data base64}); без стора — текстовая подача ссылок; генерация фрагментов остаётся в M1.5 (DEC-015).
**Обоснование:** Ноль runtime-зависимостей сохраняет пакет лёгким и изоморфным (node/браузер); HTTP API обоих провайдеров просты и стабильны — SDK добавляют зависимости и дублирующие типы без функциональной выгоды для MVP; инъекция транспорта/sleep даёт детерминированные тесты без сети (T1.3.5) и полное покрытие retry-логики.
**Последствия:** src/llm/transport.ts (defaultTransport/defaultSleep/retryWithBackoff/executeJsonWithRetry) и openai.ts/anthropic.ts — эталонная реализация; LlmAdapterConfig.{transport, sleep, maxRetries} — точки настройки; при потребности в стриминге/батчинге — пересмотр отдельным DEC; ошибка — LlmError (с HTTP-статусом либо без — сетевой сбой).
**Связи:** DEC-002, DEC-021, DEC-015

### DEC-024: vsl_read_page — автоматическая стратегия HTTP-first (M1.6)

**Дата:** 2026-09-23 (обновлено 2026-09-25)
**Статус:** accepted
**Контекст:** Классический web_fetch (HTTP GET → readability → markdown) ненадёжен на современных сайтах: SPA/CSR отдают пустой HTML-shell; шум (меню, футеры, cookie-баннеры) попадает в markdown; нет интерактивности (пагинация, аккордеоны); теряется семантика элементов (button disabled, accordion expanded); каждое чтение — полный контент без кэша и диффов. Идея пользователя: инструмент чтения страниц на базе VSL будет работать надёжнее.

**Решение:** MCP-tool `vsl_read_page(url)` с **автоматической стратегией** HTTP-first:
1. **HTTP-first:** `extractViaHttp(url)` — fetch HTML, cheerio парсинг, `buildVslFromDom()` → VSL JSON
2. **SPA-детекция:** `detectSpa(html)` проверяет маркеры (id="root", data-reactroot, ng-app, etc.)
3. **Автоматическое переключение:** если SPA обнаружена → Render-путь через BrowserManager (Playwright)
4. **Агент НЕ выбирает режим** — нет параметра `mode`, система сама определяет стратегию

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
1. HTTP-путь используется **ТОЛЬКО для чтения** — получение структуры страницы, извлечение текста, навигация по контенту
2. Для выполнения действий (`vsl_execute_action`) **ВСЕГДА** используется Render-путь — агент не может кликать кнопки через HTTP-путь
3. VSL JSON из HTTP-пути имеет ограниченные bbox (все координаты `null`) — агент понимает структуру страницы, но не точное расположение элементов на экране
4. Оба пути (HTTP и Render) сохраняют VSL-снэпшот в `ServerSession` для вычисления диффов на повторных чтениях

**Обоснование:** VSL превосходит markdown там, где тот ломается: семантика объектов ({t: button, st: disabled, act: [click]}); диффы повторных чтений (замер M1.2: −78.9% идентичный повтор, −76.1% мутация) делают цикл «прочитал → подействовал → перечитал» дешёвым; интерактив через Action Model (23 действия); script/style/display:none отсекаются domExtractor'ом. Автоматическая стратегия снимает главный trade-off: латентность HTTP для статики + полнота рендеринга для SPA.

**Последствия:** Сценарий зафиксирован в PRODUCT_CONCEPT.md §5, задача T1.6.6 — в ROADMAP.md M1.6. ARCHITECTURE.md §2.7 описывает HTTP Extractor детально (компоненты, ограничения, SPA-детекция, интеграция с ServerSession). ReadPageArgs содержит только `url` и `readable` (параметр `mode` удалён).
**Связи:** DEC-019, DEC-006, DEC-010, DEC-001

### DEC-025: Vision-backend — только LLM vision API (OpenAI/Anthropic/Alibaba Qwen)

**Дата:** 2026-09-24
**Статус:** accepted
**Контекст:** ARCHITECTURE.md §2.2.2 описывает Visual Fragments Pipeline с CLIP/DINOv2 как классификаторами и эмбеддинг-генераторами. Локальная реализация CLIP/DINOv2 требует нативных зависимостей (onnxruntime, transformers, ~500 MB моделей) — несовместимо с zero-dependency SDK (DEC-023) и браузерным рантаймом extension.
**Решение:** Vision-бэкенд = только LLM vision API через существующие адаптеры (OpenAI gpt-4o, Anthropic claude-sonnet, Alibaba Qwen qwen3.7-plus). OpenAIAdapter с кастомным `baseUrl` поддерживает Alibaba DashScope без изменений кода (API совместим с OpenAI format: `content: [{type: 'text'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,...'}}]`). VisionClassifier — порт для будущих реализаций (CLIP-эмбеддинги позже). Integration-тесты gated env-ключами (OPENAI_API_KEY / ANTHROPIC_API_KEY / QWEN_API_KEY), auto-skip без ключей.
**Обоснование:** (1) LLM vision API уже поддерживается инфраструктурой SDK (sendRaw, retry, image-блоки); (2) нулевые нативные зависимости — SDK остаётся browser-compatible; (3) Alibaba Qwen — альтернативный провайдер с конкурентной ценой и OpenAI-совместимым API; (4) порт VisionClassifier позволяет добавить CLIP/DINOv2 позже без изменения API. Alibaba требует минимум 10x10 px (1x1 возвращает ошибку).
**Последствия:** Integration-тесты покрывают 3 провайдера (OpenAI, Anthropic, Alibaba). PIXEL_PNG обновлён до 20x20 px (Alibaba constraint). CLIP/DINOv2 — будущая работа через порт VisionClassifier. Связано с DEC-002 (model-agnostic), DEC-023 (zero runtime deps), DEC-015 (Visual Fragments Pipeline).
**Связи:** DEC-002, DEC-023, DEC-015

### DEC-026: Lazy Text Loading — оптимизация токенов для контентных страниц (M1.7)

**Дата:** 2026-09-25
**Статус:** accepted
**Контекст:** Текущая архитектура VSL кладёт полный текст каждого элемента в поле txt (segmenter.ts L63). Для контентных страниц (статьи, блоги, документация) это приводит к огромному расходу токенов: 50+ параграфов по 50-200 слов = 4000+ токенов только на тексты. При этом LLM в 95% случаев достаточно заголовков для навигации.
**Решение:** Длинные тексты (> порога ~200 символов) не включаются в основной VSL JSON. Вместо этого: txt_preview (первые ~50 символов) + txt_ref: tb_xxx. Короткие тексты (кнопки, ссылки, labels) остаются в txt как обычно. Полные тексты кэшируются в text_blocks и отдаются по запросу через MCP tool vsl_get_text_block(block_id). Экономия: 80-90% токенов для контентных страниц.
**Обоснование:** (1) Принцип pay only for what you need. (2) Соответствует архитектуре VSL — lazy loading уже есть для visual fragments (vf). (3) MCP tool call — правильный механизм. (4) LLM в 95% случаев достаточно заголовков для навигации. (5) Экономия огромная: 4000+ токенов → 400-800 токенов.
**Последствия:** PRODUCT_CONCEPT.md секция 3 описывает механизм. ROADMAP.md M1.7 (0.5 недели) содержит задачи T1.7.1-T1.7.4. Интеграция с segmenter.ts и MCP Server (M1.6).
**Связи:** DEC-006, DEC-015, DEC-019, DEC-024


### DEC-027: Prompt Injection Filter — защита от инъекций через веб-контент (M1.8)

**Дата:** 2026-09-25
**Статус:** accepted
**Контекст:** VSL как middleware перехватывает весь текст с экранов до отправки в LLM. Prompt injection через веб-контент — реальная угроза: скрытые инструкции в display:none, alt-текстах, meta-тегах, комментариях HTML. Без фильтрации LLM может выполнить вредоносные инструкции, замаскированные под контент страницы.
**Решение:** Добавить Prompt Injection Filter (M1.8): (1) фильтр работает **на входе Capture Layer** — сразу после извлечения текста из любого источника (DOM, raw HTML), **до** сегментации и упаковки в VSL JSON; (2) библиотека паттернов — 3 уровня: bundled (в SDK, versioned JSON), remote (CDN/GitHub, автозагрузка при запуске, кэшируется локально), custom (пользовательские через vsl.config.json); (3) формат паттерна: {id, pattern, type: regex|ml, severity, action: strip|log|block, description}; (4) false positive strategy: confidence threshold + domain whitelist + user override; (5) логирование найденных инъекций (security audit). Defense-in-depth: не заменяет sandboxing, но добавляет критический слой безопасности. Visual Fragments OCR и PDF/SVG/IFC не входят в scope VSL — это задачи других систем.
**Обоснование:** (1) VSL уже middleware — перехватывает весь текст с экранов до LLM. (2) Prompt injection через веб-контент — реальная угроза. (3) Фильтр на входе — единая точка фильтрации для всех источников. (4) 3 уровня паттернов — быстрая реакция на новые атаки без релиза SDK. (5) Логирование — критично для security audit. Риски: false positives, необходимость обновления паттернов, overhead ~5–20ms.
**Последствия:** PRODUCT_CONCEPT.md секция 3 описывает механизм. ARCHITECTURE.md секция 12.5 описывает фильтр (обновлено). ROADMAP.md M1.8 (0.5 недели). Интеграция с Capture Layer — фильтр применяется сразу после извлечения текста из любого источника, до сегментации.
**Связи:** DEC-001, DEC-004, DEC-010, DEC-024, DEC-026

### DEC-028: Lazy Navigation в vsl_execute_action — автоматическая навигация на URL из snapshot

**Дата:** 2026-09-25
**Статус:** accepted
**Контекст:** Гибридная архитектура (DEC-024) позволяет агенту читать страницы через HTTP-путь (быстро, без браузера) и получать VSL JSON с семантической разметкой. Однако для выполнения действий (vsl_execute_action) требуется Render-путь (Playwright). Если агент прочитал страницу через HTTP-путь, а затем вызывает vsl_execute_action, браузер может быть не запущен или находиться на другом URL.
**Решение:** vsl_execute_action реализует "ленивую навигацию" (lazy navigation): перед выполнением действия проверяет текущий URL браузера через `browser.evaluate(() => window.location.href)` и сравнивает с `snapshot.canvas.url`. Если URL не совпадает — автоматически навигирует на URL из snapshot через `browser.navigate()`. Это позволяет агенту: (1) читать страницы через HTTP-путь (быстро), (2) выполнять действия на тех же страницах (автоматический переход в Render-путь).
**Обоснование:** (1) Соответствует принципу "агент не выбирает режим" (DEC-024). (2) Прозрачно для агента — не требует явного вызова vsl_read_page повторно. (3) Минимизирует overhead — навигация только если URL действительно отличается. (4) Сохраняет семантику: HTTP-путь для чтения, Render-путь для действий, но переход автоматический.
**Последствия:** executeAction.ts L98-109 реализует lazy navigation. Тесты покрывают сценарии: URL совпадает (нет навигации), URL отличается (автоматическая навигация), snapshotUrl отсутствует (нет навигации). Документация обновлена: JSDoc executeAction.ts, ARCHITECTURE.md §2.7, README_AI.md, packages/mcp-server/README.md.
**Связи:** DEC-024, DEC-019, DEC-010

---

---
## 4. Decision Index

| ID | Название | Статус | Связи |
|----|----------|--------|-------|
| DEC-001 | VSL — JSON-формат и SDK | accepted | DEC-002, DEC-003 |
| DEC-002 | Model-agnostic, без fine-tuning | accepted | DEC-001, DEC-005 |
| DEC-003 | Целевая аудитория — все AI-агенты | accepted | DEC-001, DEC-002 |
| DEC-004 | Гибридный подход (DOM/A11y + visual) | accepted | DEC-005, DEC-006 |
| DEC-005 | Контекстные эмбеддинги | accepted | DEC-004, DEC-007 |
| DEC-006 | Diff-механизм для экономии токенов | accepted | DEC-004, DEC-005 |
| DEC-007 | Максимальная детализация | accepted | DEC-005, DEC-008 |
| DEC-008 | Полный набор действий | accepted | DEC-007, DEC-002 |
| DEC-009 | Все платформы, начать с Web MVP | accepted | DEC-004, DEC-010 |
| DEC-010 | Use case — computer use agent | accepted | DEC-001, DEC-002, DEC-004 |
| DEC-011 | Список документов | accepted | DEC-001, DEC-003 |
| DEC-012 | Структура ARCHITECTURE.md | accepted | DEC-001, DEC-004, DEC-006, DEC-008, DEC-009 |
| DEC-013 | Структура DESIGN_SYSTEM.md | accepted | DEC-001, DEC-005, DEC-007 |
| DEC-014 | Multi-Level Segmentation Algorithm (5 уровней) | accepted | DEC-004, DEC-005, DEC-007 |
| DEC-015 | Visual Fragments Pipeline (CLIP/DINOv2 + WebP + hybrid) | accepted | DEC-004, DEC-005, DEC-006, DEC-014 |
| DEC-016 | Humanization Layer для обхода anti-bot detection | accepted | DEC-008, DEC-009 |
| DEC-017 | Extended Domains — VSL для CAD/BIM/3D | accepted | DEC-001, DEC-002, DEC-009 |
| DEC-018 | "Why VSL?" — обоснование ценности в PRODUCT_CONCEPT.md | accepted | DEC-001, DEC-002, DEC-004, DEC-010 |
| DEC-019 | 5-Layer Integration Architecture (Core SDK, MCP Server, REST API, CLI, Chrome Extension) | accepted | DEC-001, DEC-002, DEC-009, DEC-010 |
| DEC-020 | CHECK_ALL.md — контракт чек-пайплайна (quality gates S0–S4), supersede части DEC-011 | accepted | DEC-011, DEC-001, DEC-012 |
| DEC-021 | Порог покрытия тестами 80% (S7, jest coverageThreshold) | accepted | DEC-020, DEC-001 |
| DEC-022 | Формат диффа — авторитетен ARCHITECTURE §6.2, DESIGN_SYSTEM §5.3 синхронизирован | accepted | DEC-006, DEC-021, DEC-001 |
| DEC-023 | LLM-транспорт — нативный fetch, ноль runtime-зависимостей | accepted | DEC-002, DEC-021, DEC-015 |
| DEC-024 | vsl_read_page — гибридный MCP-tool чтения веб-страниц (дополнение к web_fetch) | accepted | DEC-019, DEC-006, DEC-010, DEC-001 |
| DEC-025 | Vision-backend — только LLM vision API (OpenAI/Anthropic/Alibaba Qwen) | accepted | DEC-002, DEC-023, DEC-015 |
| DEC-026 | Lazy Text Loading — оптимизация токенов для контентных страниц (M1.7) | accepted | DEC-006, DEC-015, DEC-019, DEC-024 |
| DEC-027 | Prompt Injection Filter — защита от инъекций через веб-контент (Phase 7) | accepted | DEC-001, DEC-004, DEC-010 |

---
| DEC-027 | Prompt Injection Filter — защита от инъекций через веб-контент (M1.8) | accepted | DEC-001, DEC-004, DEC-010, DEC-024, DEC-026 |
| DEC-028 | Lazy Navigation в vsl_execute_action — автоматическая навигация на URL из snapshot | accepted | DEC-024, DEC-019, DEC-010 |
## Cross-References

- [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md) — продуктовая концепция VSL, value proposition, non-goals
- [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md) — целевая аудитория и сценарии использования
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — принципы проектирования JSON-схемы, API-паттерны, naming conventions
- [ARCHITECTURE.md](./ARCHITECTURE.md) — высокоуровневая архитектура системы
- [ROADMAP.md](./ROADMAP.md) — план реализации по фазам (Web → Desktop → Mobile)
- [README_AI.md](./README_AI.md) — project bible для AI (one-shot ingestion)
- [CHECK_ALL.md](./CHECK_ALL.md) — контракт чек-пайплайна: quality gates S0–S7, запуск, интерпретация сбоев, логи
