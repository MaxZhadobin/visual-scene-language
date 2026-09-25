# README_AI.md — Visual Scene Language (VSL)

> **Defensive Publication** | Author: Maxim Zhadobin | Date: 28.05.2025 | Version: v0.2
> License: CC BY 4.0
>
> **Этот документ — мастер-документ проекта VSL.**
> Он предназначен для AI-агентов (one-shot ingestion) и содержит полную картину проекта
> без необходимости чтения истории чата. Все архитектурные решения, концепции и ссылки
> собраны здесь.

---

## 1. Overview

**Visual Scene Language (VSL)** — это JSON-формат и SDK для AI-агентов, работающих с экраном.
VSL **не является** UI-приложением — это инфраструктурный слой (middleware/SDK), который
представляет визуальные сцены в виде структурированного JSON, понятного языковым моделям.

**Ключевая идея:** вместо отправки полных скриншотов (1–2 MB) в LLM, VSL извлекает
семантическую структуру экрана через DOM/accessibility API и передаёт компактный JSON
(10–100 KB) с визуальными фрагментами только для элементов, недоступных через A11y.

**Что делает VSL:**
- Извлекает структуру экрана (DOM + accessibility API + визуальные фрагменты)
- Строит компактный JSON с семантическими объектами
- Кэширует статические элементы и генерирует диффы (экономия 60–80% токенов)
- Предоставляет SDK для интеграции с любым LLM (OpenAI, Anthropic, Google, open-source)
- Выполняет действия на экране (click, type, scroll, navigate, ...)

**Что НЕ делает VSL:**
- Не является UI-приложением для визуализации
- Не требует fine-tuning LLM (работает через промпт-инжиниринг)
- Не привязан к конкретному LLM-провайдеру (model-agnostic)

**Основной use case:** computer use agents — автоматизация навигации по сайтам и приложениям.
Цикл: DOM/A11y snapshot → VSL JSON → LLM принимает решение → действие → новый snapshot.

---

## 2. Quick Start

### Для AI-агента (как начать работу с VSL):

// 1. Импортировать SDK
import { VSLClient } from '@vsl/sdk';

// 2. Инициализировать клиент
const vsl = new VSLClient({
  platform: 'web',           // 'web' | 'desktop' | 'mobile'
  llmProvider: 'openai',     // 'openai' | 'anthropic' | 'google' | 'custom'
  apiKey: 'sk-...',
  model: 'gpt-4'
});

// 3. Получить первый snapshot (полный VSL JSON)
const snapshot = await vsl.getSnapshot();
// → { vsl_version: "1.0.0", canvas: {...}, objects: [...], visual_fragments: {...} }

// 4. Отправить в LLM для принятия решения
const action = await vsl.decide({
  vslJson: snapshot,
  goal: 'Fill the form and submit'
});
// → { action: "click", target_id: "btn_submit" }

// 5. Выполнить действие
await vsl.executeAction(action);

// 6. Получить следующий snapshot (только дифф!)
const diff = await vsl.getSnapshot({ diff: true });
// → { diff_version: 2, base_version: 1, changes: { added: [...], modified: [...], removed: [...], unchanged_refs: [...] } }
### Для разработчика SDK:

// Подписка на изменения экрана
const unsubscribe = vsl.onScreenChange((diff) => {
  console.log('Screen changed:', diff);
});

// Управление кэшем
vsl.cache.clear();                    // полный сброс
vsl.cache.invalidate('btn_submit');   // invalidation конкретного элемента

// Ручная invalidation
await vsl.refresh();  // принудительное обновление snapshot
---

## 3. Document Index

| Документ | Описание | Статус |
|----------|----------|--------|
| [PRODUCT_CONCEPT.md](./PRODUCT_CONCEPT.md) | Концепция продукта: что такое VSL, ключевая идея, use cases, non-goals | ✅ Готов |
| [TARGET_AUDIENCE.md](./TARGET_AUDIENCE.md) | Целевая аудитория: AI-агенты (primary), разработчики SDK (secondary), QA/test automation (tertiary) | ✅ Готов |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | JSON schema design principles: минимализм, семантика, extensibility, naming conventions, data model | ✅ Готов |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Высокоуровневая архитектура: pipeline, компоненты, data flow, caching, diff, action model | ✅ Готов |
| [DECISIONS.md](./DECISIONS.md) | Все принятые архитектурные решения (DEC-001 — DEC-023) с контекстом и обоснованием | ✅ Готов |
| [ROADMAP.md](./ROADMAP.md) | План реализации: 6 фаз (Web → Desktop → Mobile → Extended Domains → Humanization → Ecosystem), ~36-52 недели | ✅ Готов |
| [CHECK_ALL.md](./CHECK_ALL.md) | Контракт чек-пайплайна: quality gates S0–S7 (python S0–S4 + TypeScript S5–S7: lint/typecheck/build+tests), запуск, интерпретация сбоев, логи | ✅ Готов |

---

## 4. Core Concepts

### 4.1 Hybrid Data Collection

VSL использует **гибридный подход** к сбору данных:

| Источник | Что извлекает | Когда используется |
|----------|---------------|-------------------|
| **DOM** | Структура, тексты, атрибуты, состояния | Основной источник для веб |
| **Accessibility API** | Роли, labels, состояния, иерархия | Когда DOM недоступен или недостаточен |
| **Visual Fragments** | Скриншоты отдельных элементов | Для элементов без A11y (images, canvas, custom widgets) |

**Принцип:** DOM/A11y — основной источник структурных данных. Скриншоты используются
**только** для визуальных фрагментов элементов, которые невозможно описать через
структурные данные.

→ Подробнее: [ARCHITECTURE.md §2.1–2.2](./ARCHITECTURE.md)

### 4.2 VSL JSON Format

VSL JSON оптимизирован для LLM-контекста:

- **Короткие ключи**: `t` (type), `r` (role), `p` (position), `s` (size), `st` (state), `txt` (text), `act` (actions), `vf` (visual fragment)
- **Относительные координаты**: `[0.0–1.0, 0.0–1.0]` — процент от viewport
- **Умные дефолты**: не пишем то, что можно вывести
- **Нет избыточности**: не дублируем информацию
- **Lazy Text Loading (M1.7, DEC-026)**: длинные тексты (> 200 символов) заменяются на `txt_preview` + `txt_ref`, полные тексты кэшируются в `text_blocks`

{
  "vsl_version": "1.0.0",
  "canvas": {
    "viewport": { "width": 1920, "height": 1080, "unit": "px" },
    "background": "#ffffff",
    "timestamp": "2025-05-28T12:00:00Z"
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
    },
    {
      "id": "article_001",
      "t": "container",
      "p": [0.1, 0.2],
      "s": [800, 600],
      "txt_preview": "Это длинная статья о программировании, которая содержит мн…",
      "txt_ref": "tb_000"
    }
  ],
  "visual_fragments": {
    "emb_abc123": {
      "type": "image",
      "format": "webp",
      "size": [120, 40],
      "data": "base64..."
    }
  },
  "text_blocks": {
    "tb_000": "Это длинная статья о программировании, которая содержит много полезной информации..."
  }
}
→ Подробнее: [DESIGN_SYSTEM.md §2–4](./DESIGN_SYSTEM.md)

### 4.3 Cache & Diff Mechanism

VSL кэширует статические элементы и передаёт только дифф изменений:

| Вызов | Без кэша | С кэшем | Экономия |
|-------|----------|---------|----------|
| 1-й | 100 KB (полный JSON) | 100 KB | 0% |
| 2-й | 100 KB | 15 KB (дифф) | 85% |
| 3-й | 100 KB | 10 KB (дифф) | 90% |

**Средняя экономия:** 60–80% после первого вызова.

**Реализация (M1.2, `@vsl/sdk`):**

- **Cache Store** (`createCacheStore()`): in-memory Map id → {object, contentHash, coordHash}; sha256 по детерминированной сериализации (contentHash: t/r/st/txt/act; coordHash: p/s).
- **Invalidation-триггеры** (VslSnapshotSession): URL change → полный сброс кэша; viewport resize → сброс только координат (`invalidateCoordinates()`); DOM-мутации → `attachMutationObserver(root, store)` точечно инвалидирует изменённые элементы.
- **Session-состояние:** {lastUrl, lastViewport, lastDocument, version}; версии снапшотов живут в заголовке диффа (diff_version/base_version), канон VslDocument (§4) не расширяется.

Замер на фикстурах M1.2 (`npm run demo:cache-diff`): [full] 1.50 KB → идентичный повтор 0.32 KB (−78.9%) → точечная мутация txt 0.36 KB (−76.1%).

→ Подробнее: [ARCHITECTURE.md §5–6](./ARCHITECTURE.md)

### 4.4 Action Model

VSL поддерживает полный набор действий:

**Базовые:** click, type, clear, scroll, hover, focus, blur, select, check, uncheck
**Расширенные:** drag, drop, submit, reset, open, close, expand, collapse, wait, download
**Навигационные:** navigate, go_back, go_forward, refresh

**Реализация (M1.3, `@vsl/sdk`):** `VALID_ACTIONS` (24 действия) и `TARGET_ACTIONS` в `src/llm/actions.ts` — единый источник правды для enum в tool-схеме и system prompt; `validateAction` валидирует ответ модели (whitelist действия + существование target_id в VSL JSON).

→ Подробнее: [ARCHITECTURE.md §7](./ARCHITECTURE.md), [DESIGN_SYSTEM.md §3.4](./DESIGN_SYSTEM.md)

### 4.5 Platform Strategy

| Фаза | Платформа | Источники данных |
|------|-----------|------------------|
| **Phase 1 (MVP)** | Web (browser extension / desktop app with webview) | DOM, Accessibility API, Visual Fragments |
| **Phase 2** | Desktop (macOS/Windows/Linux) | AX API, UI Automation, AT-SPI |
| **Phase 3** | Mobile (iOS/Android) | UIAccessibility, AccessibilityService |

→ Подробнее: [ARCHITECTURE.md §8](./ARCHITECTURE.md)

---

## 5. Architecture Overview

Система VSL состоит из 6 основных компонентов, образующих pipeline:

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
**Компоненты:**

1. **Capture Layer** — извлечение данных из DOM/A11y + визуальные фрагменты
2. **Segmentation Engine** — разбиение на семантические объекты (DOM-based + vision model fallback)
3. **VSL Builder** — построение JSON-дерева в формате VSL
4. **Cache & Diff Engine** — кэширование статических элементов, генерация диффов
5. **LLM Integration Layer** — адаптеры для OpenAI, Anthropic, Google, custom LLM
6. **Action Executor** — выполнение действий на экране

→ Полная архитектура: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 6. Data Model Example

Полный пример VSL JSON для веб-страницы с формой:

{
  "vsl_version": "1.0.0",
  "snapshot_version": 1,
  "canvas": {
    "viewport": { "width": 1920, "height": 1080, "unit": "px" },
    "background": "#ffffff",
    "scale": 1.0,
    "orientation": "landscape",
    "timestamp": "2025-05-28T12:00:00Z",
    "url": "https://example.com/login",
    "title": "Login Page"
  },
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
          "vf": "emb_logo_001"
        },
        {
          "id": "nav_001",
          "t": "nav",
          "r": "main_navigation",
          "p": [0.3, 0.02],
          "s": [600, 40],
          "ch": [
            { "id": "nav_home", "t": "link", "txt": "Home", "p": [0.0, 0.0], "s": [80, 40], "act": ["click"] },
            { "id": "nav_about", "t": "link", "txt": "About", "p": [0.1, 0.0], "s": [80, 40], "act": ["click"] }
          ]
        }
      ]
    },
    {
      "id": "form_001",
      "t": "container",
      "r": "login_form",
      "p": [0.35, 0.3],
      "s": [400, 300],
      "ch": [
        { "id": "input_email", "t": "input", "r": "email", "p": [0.1, 0.2], "s": [280, 40], "st": "enabled,focused", "txt": "", "act": ["type", "focus", "blur"] },
        { "id": "input_password", "t": "input", "r": "password", "p": [0.1, 0.4], "s": [280, 40], "st": "enabled", "txt": "", "act": ["type", "focus", "blur"] },
        { "id": "checkbox_remember", "t": "checkbox", "r": "remember_me", "p": [0.1, 0.6], "s": [20, 20], "st": "unchecked", "txt": "Remember me", "act": ["check", "uncheck"] },
        { "id": "btn_submit", "t": "button", "r": "submit", "p": [0.1, 0.8], "s": [280, 40], "st": "enabled", "txt": "Log In", "act": ["click", "submit"] }
      ]
    }
  ],
  "visual_fragments": {
    "emb_logo_001": {
      "type": "image",
      "format": "webp",
      "size": [120, 40],
      "data": "UklGRiQAAABXQVZFZm10IBAA..."
    }
  }
}
**Пример диффа (после ввода email):**

{
  "diff_version": 2,
  "base_version": 1,
  "timestamp": "2025-05-28T12:01:00Z",
  "changes": {
    "added": [],
    "modified": [
      { "id": "input_email", "txt": "user@example.com", "st": "enabled" },
      { "id": "btn_submit", "st": "enabled" }
    ],
    "removed": [],
    "unchanged_refs": ["header_001", "logo_001", "nav_001", "form_001", "input_password", "checkbox_remember"]
  }
}
→ Полная спецификация: [DESIGN_SYSTEM.md §4](./DESIGN_SYSTEM.md)

---

## 7. Integration Guide

### 7.1 Snapshot Generation

// Полный snapshot
const snapshot = await vsl.getSnapshot();

// Snapshot с диффом (только изменения)
const diff = await vsl.getSnapshot({ diff: true });

// Snapshot с visual fragments
const snapshotWithVisuals = await vsl.getSnapshot({ includeVisualFragments: true });

**Реализация M1.2 — VslSnapshotSession** (первый вызов → VslDocument, далее → VslDiff):

// (M1.2, @vsl/sdk)
const session = new VslSnapshotSession(createCacheStore());

const first = session.snapshot(document.body, { url: location.href, viewport: { width: 1280, height: 800 } });
// → VslDocument (полный), кэш заполнен

const next = session.snapshot(document.body, { url: location.href, viewport: { width: 1280, height: 800 } });
// → VslDiff (§6.2): added/modified/removed/unchanged_refs

const afterNavigation = session.snapshot(document.body, { url: '/other', viewport: { width: 1280, height: 800 } });
// → VslDocument (URL change → полный снапшот, кэш пересобран)

isVslDiff(result) различает VslDocument и VslDiff.
### 7.2 Cache Management

// Проверить размер кэша
const cacheSize = vsl.cache.size();

// Очистить кэш
vsl.cache.clear();

// Invalidation конкретного элемента
vsl.cache.invalidate('btn_submit');

// Invalidation по MVP-семантике (M1.2): '*' — полный сброс; точный id;
// 'tag' — все id с префиксом 'tag_' (например, 'button' → все button_*)
vsl.cache.invalidateBySelector('button');

// Сброс координат при viewport resize (содержимое сохраняется)
vsl.cache.invalidateCoordinates();

> Примечание: CSS-селекторы (например, '.modal-dialog') к кэшированным VslObject
> неприменимы — id имеют форму tag_indexPath; семантика селектора выше — MVP
> (расширение на CSS-селекторы — вне M1.2).
### 7.3 Diff Subscription

> **Статус (M1.2):** live-подписка на изменения экрана (onScreenChange) вне scope
> M1.2; основа готова — diffVslDocuments / VslSnapshotSession (§7.1). Планируется
> в последующих вехах (snapshot pipeline + мутации DOM).

// Подписаться на изменения экрана
const unsubscribe = vsl.onScreenChange((diff) => {
  console.log('Added:', diff.changes.added);
  console.log('Modified:', diff.changes.modified);
  console.log('Removed:', diff.changes.removed);
});

// Отписаться
unsubscribe();
### 7.4 LLM Provider Adapters

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

// Alibaba Qwen (через OpenAI-совместимый API)
const qwenAdapter = new OpenAIAdapter({
  apiKey: 'sk-...',
  baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.7-plus',
});
const action = await qwenAdapter.decide({
  vslJson: snapshot,
  goal: 'Fill the form and submit'
});

// Custom LLM
const customAdapter = new CustomLLMAdapter({
  endpoint: 'https://my-llm.example.com/api',
  promptTemplate: '...'
});

**Реализация M1.3 — OpenAIAdapter / AnthropicAdapter (@vsl/sdk):**

// (M1.3, @vsl/sdk) — оба адаптера реализуют LlmAdapter: sendPrompt(vslJson, task) + decide({vslJson, goal})
import { OpenAIAdapter, AnthropicAdapter } from '@vsl/sdk';

const openai = new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY }); // model по умолчанию gpt-4o
const action = await openai.decide({ vslJson: snapshot, goal: 'Fill the form and submit' });
// → LlmAction { action, target_id?, value?, reasoning? }; target_id валидирован по VSL JSON (§7.4)

const anthropic = new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }); // claude-sonnet-4-20250514

// sendPrompt принимает VslDocument И VslDiff (diff-first, §11.2); visualFragments — опциональный
// side-channel-стор vf-ref → { mediaType, data: base64 } (§4.4): с данными — image-блоки, без — текстовые ссылки
const response = await openai.sendPrompt(diff, 'Fill the form and submit', {
  visualFragments: new Map([['emb_abc123', { mediaType: 'image/webp', data: 'UklGR...' }]])
});
// → LlmResponse { action, usage: { inputTokens, outputTokens }, raw }

// Транспорт — нативный fetch (node>=18), retry до 3 попыток с паузами 1s/2s (§10.3),
// только сеть/429/5xx; transport и sleep инъекцируются через конфиг — тесты без сети (DEC-023).
// CustomLLMAdapter и Google-адаптер — вне M1.3.
// Alibaba Qwen (DEC-025): OpenAIAdapter с кастомным baseUrl поддерживает DashScope API
// без изменений кода — API совместим с OpenAI format (image_url base64 inline).
// Vision-бэкенд = только LLM vision API (OpenAI/Anthropic/Alibaba Qwen), CLIP/DINOv2 — порт.

### 7.5 Action Execution

// Клик
await vsl.executeAction({ action: 'click', target_id: 'btn_submit' });

// Ввод текста
await vsl.executeAction({ action: 'type', target_id: 'input_email', value: 'user@example.com' });

// Навигация
await vsl.executeAction({ action: 'navigate', url: 'https://example.com' });

// Скролл
await vsl.executeAction({ action: 'scroll', direction: 'down', amount: 300 });
→ Полное API: [ARCHITECTURE.md §9](./ARCHITECTURE.md)

### 7.6 MCP Server (Recommended for MVP)

MCP (Model Context Protocol) Server — рекомендуемый способ интеграции VSL с AI-агентами для MVP.
Обёртка вокруг Core SDK, использующая MCP Protocol (JSON-RPC over stdio).

**Поддерживаемые агенты:** Claude Desktop, Cline, TaoCoder, и любые MCP-совместимые агенты.

**Конфигурация (Claude Desktop / Cline):**

```json
{
  "mcpServers": {
    "vsl": {
      "command": "npx",
      "args": ["@vsl/mcp-server"],
      "env": {
        "VSL_PLATFORM": "web",
        "VSL_LLM_PROVIDER": "anthropic",
        "VSL_LLM_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

**MCP Tools (12 инструментов):**

| Tool | Описание |
|------|----------|
| `vsl_get_snapshot` | Получить полный VSL snapshot текущего экрана |
| `vsl_get_diff` | Получить только изменения с последнего snapshot |
| `vsl_execute_action` | Выполнить действие (click, type, scroll, navigate). Lazy Navigation (DEC-028): автоматически навигирует браузер на URL из snapshot, если текущий URL отличается |
| `vsl_find_element` | Найти элемент по тексту, роли или CSS-селектору |
| `vsl_cache_clear` | Очистить кэш snapshots |
| `vsl_cache_invalidate` | Invalidating конкретного элемента или селектора |
| `vsl_navigate` | Navigate to URL |
| `vsl_wait_for` | Ожидание появления элемента (selector, timeout) |
| `vsl_get_visual_fragment` | Получить визуальный фрагмент (Base64 WebP) по ID |
| `vsl_get_text_block` | Получить полный текст по txt_ref (lazy text loading, M1.7) |
| `vsl_read_page` | Прочитать веб-страницу с автоматической стратегией: HTTP-first для статики, автопереключение на Render для SPA (M1.6, DEC-024) |
| `vsl_download` | Управление загрузкой файлов: клик по элементу или прямое скачивание по URL, ожидание завершения, сохранение в save_path (M1.5) |
| `vsl_decide` | Отправить VSL JSON в LLM и получить рекомендуемое действие |
**Поток взаимодействия:**

```
AI Agent (Claude/Cline/TaoCoder)
    ↓ MCP Protocol (JSON-RPC over stdio)
VSL MCP Server (@vsl/mcp-server)
    ↓ Internal API
Core SDK (@vsl/sdk)
    ↓ Chrome Extension Messaging
Chrome Extension (@vsl/extension)
    ↓ DOM API
Web Page
```

→ Полная архитектура интеграции: [ARCHITECTURE.md §15](./ARCHITECTURE.md)
→ Решение: [DECISIONS.md DEC-019](./DECISIONS.md)

---

## 8. Performance

### 8.1 Latency Budget

| Компонент | Целевая latency | Обоснование |
|-----------|-----------------|-------------|
| Capture (DOM/A11y) | 50–200 ms | Зависит от размера DOM |
| Segmentation | 100–500 ms | Обход дерева + vision model (если нужен) |
| VSL Builder | 10–50 ms | Построение JSON |
| Cache/Diff | 10–50 ms | Сравнение хэшей |
| LLM API call | 500–2000 ms | Зависит от провайдера и размера контекста |
| Action execution | 50–200 ms | Зависит от действия |
| **Итого** | **~1–3 секунды** | Приемлемо для computer use agents |

### 8.2 Token Optimization

| Подход | Размер | Токены |
|--------|--------|--------|
| Полный скриншот (JPEG) | 1–2 MB | ~1000 токенов (vision) |
| Полный VSL JSON | 50–100 KB | ~500–1000 токенов |
| VSL дифф | 5–15 KB | ~50–150 токенов |

**Стратегии экономии:**
- Короткие ключи — экономия ~30% токенов
- Диффы вместо полных снэпшотов — экономия 60–80%
- Visual fragments по запросу (lazy loading)
- Умные дефолты

### 8.3 Throughput

- 1 цикл (snapshot → LLM → action) в 1–3 секунды
- 20–60 циклов в минуту
- Достаточно для большинства computer use задач

→ Подробнее: [ARCHITECTURE.md §11](./ARCHITECTURE.md)

---

## 9. Security & Privacy

### 9.1 Data Handling

- VSL JSON содержит только **структурные данные** экрана (не секреты)
- Visual fragments кодируются в base64 и могут быть отключены
- Кэш хранится локально (in-memory или SQLite)

### 9.2 PII Filtering

- SDK может фильтровать PII (personal identifiable information) перед отправкой в LLM
- Поля `txt` для input типа password автоматически маскируются
- Email, phone numbers могут быть отфильтрованы по конфигурации

### 9.3 Sandboxing

- Web: работает в контексте browser extension (sandboxed)
- Desktop: работает в sandboxed процессе
- Mobile: работает в рамках app permissions

### 9.4 Audit Logging

- Все действия логируются (action, target, timestamp)
- Логи хранятся локально
- Могут быть экспортированы для debugging

→ Подробнее: [ARCHITECTURE.md §12](./ARCHITECTURE.md)

---

## 10. Cross-References

Полная таблица ссылок на все архитектурные документы с номерами секций:

### PRODUCT_CONCEPT.md
- §1 Overview → [PRODUCT_CONCEPT.md §1](./PRODUCT_CONCEPT.md)
- §2 Key Idea → [PRODUCT_CONCEPT.md §2](./PRODUCT_CONCEPT.md)
- §3 Use Cases → [PRODUCT_CONCEPT.md §3](./PRODUCT_CONCEPT.md)
- §4 Non-Goals → [PRODUCT_CONCEPT.md §4](./PRODUCT_CONCEPT.md)
- §2.5 Why VSL? — Зачем нужна эта прокладка? → [PRODUCT_CONCEPT.md §2.5](./PRODUCT_CONCEPT.md)
- §5 Architecture Diagram → [PRODUCT_CONCEPT.md §5](./PRODUCT_CONCEPT.md)

### TARGET_AUDIENCE.md
- §1 Primary Audience (AI Agents) → [TARGET_AUDIENCE.md §1](./TARGET_AUDIENCE.md)
- §2 Secondary Audience (SDK Developers) → [TARGET_AUDIENCE.md §2](./TARGET_AUDIENCE.md)
- §3 Tertiary Audience (QA/Test Automation) → [TARGET_AUDIENCE.md §3](./TARGET_AUDIENCE.md)
- §4 Use Case Scenarios → [TARGET_AUDIENCE.md §4](./TARGET_AUDIENCE.md)

### DESIGN_SYSTEM.md
- §2 JSON Schema Design Principles → [DESIGN_SYSTEM.md §2](./DESIGN_SYSTEM.md)
- §3 Element Naming Conventions → [DESIGN_SYSTEM.md §3](./DESIGN_SYSTEM.md)
- §4 Data Model Structure → [DESIGN_SYSTEM.md §4](./DESIGN_SYSTEM.md)
- §5 API Patterns → [DESIGN_SYSTEM.md §5](./DESIGN_SYSTEM.md)
- §6 Versioning Strategy → [DESIGN_SYSTEM.md §6](./DESIGN_SYSTEM.md)
- §7 Error Handling → [DESIGN_SYSTEM.md §7](./DESIGN_SYSTEM.md)

### ARCHITECTURE.md
- §1 Overview → [ARCHITECTURE.md §1](./ARCHITECTURE.md)
- §2 System Architecture (6 компонентов) → [ARCHITECTURE.md §2](./ARCHITECTURE.md)
- §3 Data Flow → [ARCHITECTURE.md §3](./ARCHITECTURE.md)
- §4 Hybrid Data Collection → [ARCHITECTURE.md §4](./ARCHITECTURE.md)
- §5 Caching Strategy → [ARCHITECTURE.md §5](./ARCHITECTURE.md)
- §6 Diff Mechanism → [ARCHITECTURE.md §6](./ARCHITECTURE.md)
- §7 Action Model → [ARCHITECTURE.md §7](./ARCHITECTURE.md)
- §8 Platform Adapters → [ARCHITECTURE.md §8](./ARCHITECTURE.md)
- §9 Integration API → [ARCHITECTURE.md §9](./ARCHITECTURE.md)
- §10 Error Handling & Resilience → [ARCHITECTURE.md §10](./ARCHITECTURE.md)
- §11 Performance Considerations → [ARCHITECTURE.md §11](./ARCHITECTURE.md)
- §12 Security & Privacy → [ARCHITECTURE.md §12](./ARCHITECTURE.md)
- §13 Humanization Layer → [ARCHITECTURE.md §13](./ARCHITECTURE.md)
- §14 Extended Domains (2D чертежи + 3D графика) → [ARCHITECTURE.md §14](./ARCHITECTURE.md)
- §15 Integration with AI Agents (MCP Server, REST API, Core SDK, Chrome Extension) → [ARCHITECTURE.md §15](./ARCHITECTURE.md)

### DECISIONS.md
- DEC-001: VSL — JSON-формат и SDK, не UI-приложение → [DECISIONS.md §3 DEC-001](./DECISIONS.md)
- DEC-002: Model-agnostic дизайн (без fine-tuning) → [DECISIONS.md §3 DEC-002](./DECISIONS.md)
- DEC-003: Целевая аудитория — все AI-агенты → [DECISIONS.md §3 DEC-003](./DECISIONS.md)
- DEC-004: Гибридный подход (DOM/A11y + visual fragments) → [DECISIONS.md §3 DEC-004](./DECISIONS.md)
- DEC-005: Контекстные эмбеддинги вместо полных скриншотов → [DECISIONS.md §3 DEC-005](./DECISIONS.md)
- DEC-006: Diff-механизм для экономии токенов → [DECISIONS.md §3 DEC-006](./DECISIONS.md)
- DEC-007: Максимальная детализация — все видимые элементы → [DECISIONS.md §3 DEC-007](./DECISIONS.md)
- DEC-008: Полный набор действий → [DECISIONS.md §3 DEC-008](./DECISIONS.md)
- DEC-009: Все платформы, начать с Web MVP → [DECISIONS.md §3 DEC-009](./DECISIONS.md)
- DEC-010 — DEC-013 → [DECISIONS.md §3](./DECISIONS.md)
- DEC-014: Multi-Level Segmentation Algorithm (5 уровней) → [DECISIONS.md §3 DEC-014](./DECISIONS.md)
- DEC-015: Visual Fragments Pipeline (CLIP/DINOv2 + WebP + hybrid) → [DECISIONS.md §3 DEC-015](./DECISIONS.md)
- DEC-016: Humanization Layer для обхода anti-bot detection → [DECISIONS.md §3 DEC-016](./DECISIONS.md)
- DEC-017: Extended Domains — VSL для CAD/BIM/3D → [DECISIONS.md §3 DEC-017](./DECISIONS.md)
- DEC-018: "Why VSL?" — обоснование ценности в PRODUCT_CONCEPT.md → [DECISIONS.md §3 DEC-018](./DECISIONS.md)
- DEC-019: 5-Layer Integration Architecture (от Core SDK до MCP Server и Chrome Extension) → [DECISIONS.md §3 DEC-019](./DECISIONS.md)
- DEC-020: CHECK_ALL.md — контракт чек-пайплайна (quality gates S0–S4) → [DECISIONS.md §3 DEC-020](./DECISIONS.md)
- DEC-021: Порог покрытия тестами 80% (S7, jest coverageThreshold) → [DECISIONS.md §3 DEC-021](./DECISIONS.md)
- DEC-022: Формат диффа — авторитетен ARCHITECTURE §6.2; DESIGN_SYSTEM §5.3 синхронизирован → [DECISIONS.md §3 DEC-022](./DECISIONS.md)
- DEC-023: LLM-транспорт — нативный fetch, ноль runtime-зависимостей → [DECISIONS.md §3 DEC-023](./DECISIONS.md)
- DEC-024: vsl_read_page — автоматическая стратегия HTTP-first (M1.6) → [DECISIONS.md §3 DEC-024](./DECISIONS.md)
- DEC-025: Vision-backend — только LLM vision API (OpenAI/Anthropic/Alibaba Qwen) → [DECISIONS.md §3 DEC-025](./DECISIONS.md)

### ROADMAP.md
- Phase 1: Web MVP → [ROADMAP.md §2](./ROADMAP.md)
- Phase 2: Desktop → [ROADMAP.md §3](./ROADMAP.md)
- Phase 3: Mobile → [ROADMAP.md §4](./ROADMAP.md)
- Phase 4: Extended Domains (2D чертежи + 3D/BIM/CAD) → [ROADMAP.md §5](./ROADMAP.md)
- Phase 5: Humanization Layer → [ROADMAP.md §6](./ROADMAP.md)
- Phase 6: Ecosystem & Standardization → [ROADMAP.md §7](./ROADMAP.md)

### CHECK_ALL.md
- §3 Как запускать (bash check_all.sh из корня проекта) → [CHECK_ALL.md §3](./CHECK_ALL.md)
- §4 Шаги проверки — quality gates S0–S7 → [CHECK_ALL.md §4](./CHECK_ALL.md)
- §6 Интерпретация сбоев → [CHECK_ALL.md §6](./CHECK_ALL.md)
- §8 Расширение пайплайна (S5–S7 активированы в Phase 1) → [CHECK_ALL.md §8](./CHECK_ALL.md)

---

## Appendix A: Glossary

| Термин | Определение |
|--------|-------------|
| **VSL** | Visual Scene Language — JSON-формат и SDK для представления визуальных сцен |
| **Canvas** | Корневой объект VSL JSON, описывающий viewport и глобальные параметры |
| **Object** | Семантический элемент на экране (кнопка, поле ввода, текст, изображение) |
| **Visual Fragment** | Ссылка на эмбеддинг визуального элемента (для элементов без A11y) |
| **Diff** | Разница между двумя VSL-снэпшотами (added/modified/removed/unchanged) |
| **Capture Layer** | Компонент VSL, извлекающий данные из DOM/A11y/Visual |
| **Segmentation Engine** | Компонент VSL, разбивающий данные на семантические объекты |
| **VSL Builder** | Компонент VSL, строящий JSON-дерево |
| **Cache & Diff Engine** | Компонент VSL, кэширующий статические элементы и генерирующий диффы |
| **LLM Integration Layer** | Компонент VSL, адаптирующий JSON для различных LLM-провайдеров |
| **Action Executor** | Компонент VSL, выполняющий действия на экране |
| **Computer Use Agent** | AI-агент, управляющий экраном (клик, ввод, навигация) |
| **MCP Server** | Обёртка вокруг Core SDK, использующая MCP Protocol (JSON-RPC over stdio) — рекомендуемый способ интеграции VSL с AI-агентами (§7.6, DEC-019) |

---

## Appendix B: Comparison with Alternatives

| Подход | Описание | Преимущества VSL |
|--------|----------|------------------|
| **Скриншоты (Anthropic Computer Use)** | Полный скриншот → vision LLM → действие | VSL: 60–80% экономия токенов, семантическая точность |
| **DOM-only (Selenium, Playwright)** | Только DOM-селекторы | VSL: работает с элементами без A11y, визуальный контекст |
| **Accessibility Tree only** | Только accessibility tree | VSL: дополняет визуальными фрагментами, кэширование |
| **Scene Graph (Unity, Unreal)** | Граф сцены для рендеринга | VSL: оптимизирован для LLM, компактный JSON |

---

*End of README_AI.md — Visual Scene Language (VSL) project bible.*