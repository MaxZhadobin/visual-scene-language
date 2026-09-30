# Анализ Chrome Extension «VSL Agent»

> Дата: 29.09.2026 | Статус: анализ завершён

---

## 1. Что это за расширение

**VSL Agent** — это Chrome-расширение (Manifest V3, версия 0.1.0), реализующее **standalone агентный цикл** поверх VSL SDK. Это демонстрационный/рабочий прототип, показывающий, как VSL SDK используется для автоматизации веб-страниц через LLM.

**Расположение:** `extension/` (отдельный пакет `vsl-extension` в монорепо VSL SDK)

**Назначение:** пользователь открывает popup, вводит цель на естественном языке (например, «Заполни форму и нажми Submit»), выбирает LLM-провайдера и API-ключ → расширение автоматически выполняет цикл «снапшот → решение LLM → действие на DOM» до N шагов.

---

## 2. Архитектура и как работает

### 2.1. Три компонента (MV3)

| Компонент | Файл | Роль |
|-----------|------|------|
| **Popup** | `popup.ts` + `popup.html` | UI: ввод цели, выбор провайдера/модели/API-ключа, кнопки Start/Stop, журнал шагов |
| **Background (Service Worker)** | `background.ts` | Оркестратор агентного цикла: snapshot → decide → execute |
| **Content Script** | `content.ts` | Инжектится во все фреймы (`all_frames: true`); держит `VslSnapshotSession` (кэш/дифф), исполняет действия на DOM |

### 2.2. Протокол сообщений

| Сообщение | Направление | Назначение |
|-----------|-------------|------------|
| `vsl/start` | popup → background | Запуск агентного цикла (goal, provider, apiKey, model, maxSteps) |
| `vsl/stop` | popup → background | Запрос остановки (проверяется между шагами) |
| `vsl/snapshot` | background → content | Построить VSL-снапшот (полный документ или дифф) |
| `vsl/execute` | background → content | Исполнить действие LLM на DOM |
| `vsl/capture` | content → background | Скриншот viewport (`captureVisibleTab` — только в SW) |
| `vsl/classify` | content → background | Классификация визуального фрагмента через LLM vision API |
| `vsl/frameSnapshot` | iframe content → background | Snapshot из iframe (M2.1) |
| `vsl/iframeRects` | top-frame content → background | Координаты iframe-элементов (M2.1) |
| `vsl/iframeFrameIds` | top-frame content → background | Запрос frameId по URL (M2.1 rework) |

### 2.3. Агентный цикл (background.ts: `runAgentLoop`)

for step = 1..maxSteps:
  1. chrome.tabs.sendMessage(tabId, "vsl/snapshot", {vision: true})
     → content строит VSL JSON (с кэшем/диффом) + vision-фрагменты
     → background агрегирует iframe snapshots (200ms wait — hack)
  
  2. adapter.decide({vslJson, goal, visualFragments})
     → LLM возвращает LlmAction {action, target_id, reasoning}
  
  3. chrome.tabs.sendMessage(tabId, "vsl/execute", {action}, {frameId})
     → content исполняет действие на живом DOM (soft-fail)
  
  → записывает шаг в chrome.storage.local → popup читает и рендерит
### 2.4. Поддерживаемые LLM-провайдеры

| Провайдер | Адаптер | Дефолтная модель |
|-----------|---------|-----------------|
| OpenAI | `OpenAIAdapter` | gpt-4o |
| Anthropic | `AnthropicAdapter` | claude-sonnet-4-20250514 |
| Alibaba Qwen | `OpenAIAdapter` (OpenAI-compatible) | qwen3.8-max |

Пользователь может указать кастомный `baseUrl` и `model` через popup.

### 2.5. Iframe support (M2.1)

- Content script инжектится во все фреймы (`all_frames: true`)
- Каждый iframe отправляет свой snapshot в background через `MSG_FRAME_SNAPSHOT`
- Background агрегирует все snapshots в единый VslDocument с iframe-объектами
- Target_id для элементов iframe: `frame_{frameId}:{localId}`
- Execute маршрутизируется по frameId через `chrome.tabs.sendMessage` options

---

## 3. Взаимосвязь с SDK

### 3.1. Что extension берёт из SDK

Extension **напрямую импортирует** модули SDK через relative paths (`../../src/...`), НЕ через npm-пакет:

| Модуль SDK | Использование в extension |
|------------|--------------------------|
| `src/executor/actionExecutor` → `executeAction()` | Content script: исполнение действий на DOM |
| `src/executor/types` → `ActionResult` | Тип результата исполнения |
| `src/session/snapshotSession` → `VslSnapshotSession` | Content script: кэш снапшотов, диффы |
| `src/vision/fragmentExtractor` → `FragmentExtractor` | Content script: извлечение визуальных фрагментов |
| `src/vision/types` → `ViewportCapture`, `VisionClassifier` | Типы для vision-портов |
| `src/vision/llmVisionClassifier` → `LlmVisionClassifier` | Background: классификация через LLM vision API |
| `src/llm/anthropic` → `AnthropicAdapter` | Background: адаптер Anthropic |
| `src/llm/openai` → `OpenAIAdapter` | Background: адаптер OpenAI (+ Qwen) |
| `src/llm/types` → `LlmAction`, `LlmAdapter`, `RawLlmCaller` | Типы для LLM-интеграции |
| `src/types/vsl` → `VslObject` | Типы VSL-объектов |

### 3.2. Что extension добавляет сверх SDK

Extension — это **оркестрационный слой**, которого нет в SDK:

| Компонент extension | Зачем нужен |
|---------------------|-------------|
| **Popup UI** (`popup.ts` + `popup.html`) | Ввод цели, выбор провайдера, журнал шагов — SDK не имеет UI |
| **Service Worker agent loop** (`background.ts`) | Цикл snapshot→decide→execute — SDK предоставляет primitives, но не loop |
| **Chrome messaging protocol** (`protocol.ts`) | MV3-специфичный протокол сообщений — SDK platform-agnostic |
| **Chrome API wrappers** | `chrome.tabs.captureVisibleTab`, `chrome.storage.local`, `chrome.tabs.sendMessage` — SDK не знает про Chrome |
| **Iframe aggregation** (`aggregateSnapshotsWithFrames`) | Специфика Chrome multi-frame — SDK работает с одним DOM-корнем |
| **Vision proxy** (capture/classify ports) | Content script не имеет доступа к `captureVisibleTab` и LLM API (CORS) — нужен proxy через background |

---

## 4. Полноценность работы через SDK

### 4.1. ✅ Что работает полноценно через SDK

1. **Снапшоты DOM → VSL JSON** — `VslSnapshotSession` из SDK, кэш и диффы работают полностью
2. **Исполнение действий** — `executeAction()` из SDK, soft-fail контракт
3. **LLM-адаптеры** — `AnthropicAdapter`, `OpenAIAdapter` из SDK, включая валидацию действий
4. **Vision-классификация** — `LlmVisionClassifier` + `FragmentExtractor` из SDK
5. **Кэширование и диффы** — session-level кэш, mutation observer, coordinate invalidation

### 4.2. ⚠️ Что работает, но с оговорками

1. **Iframe aggregation (M2.1)** — работает, но синхронизация iframe snapshots через `setTimeout(200ms)` — это **хак** (TODO в коде: «заменить на явный механизм синхронизации»)
2. **Vision-ветка** — content script проксирует capture/classify через background; `FragmentExtractor` кэширует по hash, но каждый шаг цикла — это LLM API call для каждого нового фрагмента (затратно)
3. **Сборка** — `tsup --config extension/tsup.config.ts` бандлит extension + SDK в `dist/*.global.js`; relative imports `../../src/...` работают, но это хрупкая связь (не через npm package)

### 4.3. ❌ Чего нет / ограничения

| Ограничение | Детали |
|-------------|--------|
| **Нет MCP-сервера в extension** | MCP-сервер (`packages/mcp-server`) — отдельный компонент, работает через Node.js, не через extension. Extension и MCP — два независимых интерфейса к SDK |
| **Нет поддержки desktop/mobile** | Extension работает только с веб-страницами в Chrome. SDK поддерживает `platform: 'web' \| 'desktop' \| 'mobile'`, но extension использует только web |
| **Нет persistence между сессиями** | `frameRegistry` и `iframeRectsMap` очищаются после каждого цикла; нет истории целей/действий |
| **Нет retry/error recovery** | Если LLM вернул невалидное действие — цикл падает с `status: 'error'`; нет retry-логики |
| **Нет human-in-the-loop** | Пользователь может только Start/Stop; нет подтверждения действий, нет pause/resume |
| **maxSteps лимит** | Дефолт 10 шагов; нет адаптивного завершения (по достижении цели) |
| **API key в chrome.storage.local** | Не зашифрован; хранится в plaintext |
| **Нет экспорта/импорта конфигураций** | Настройки (provider, apiKey, model) — только в chrome.storage |

---

## 5. Extension vs MCP-сервер: два интерфейса к SDK

| | Chrome Extension | MCP-сервер (`packages/mcp-server`) |
|---|---|---|
| **Среда** | Chrome MV3 | Node.js (CLI/IDE) |
| **Доступ к DOM** | Content script (isolated world) | Puppeteer browser |
| **LLM** | Встроенный агентный цикл (popup → background) | Внешний (IDE-агент вызывает MCP tools) |
| **Vision** | `captureVisibleTab` + LLM vision API | `vsl_get_visual` (base64 WebP по элементу) |
| **Iframe** | Native Chrome multi-frame | Puppeteer frames |
| **Use case** | Standalone автоматизация в браузере | Интеграция с AI-агентами в IDE (TaoCoder, Cline) |

Оба используют один и тот же SDK (`src/`), но оркестрируют его по-разному.

---

## 6. Выводы

1. **Extension полноценно использует SDK** — все ключевые модули (snapshot, execute, LLM adapters, vision) импортируются и работают. Extension — это тонкий оркестрационный слой поверх SDK.

2. **Extension НЕ дублирует функциональность SDK** — он добавляет только то, чего SDK не может предоставить: Chrome-specific API (tabs, storage, messaging), UI (popup), и агентный цикл (loop).

3. **Связь хрупкая** — relative imports `../../src/...` вместо npm-зависимости. Это работает для монорепо, но усложняет переиспользование.

4. **Есть известные проблемы:**
   - Iframe sync hack (setTimeout 200ms)
   - Нет retry/error recovery
   - Нет адаптивного завершения цикла
   - API key в plaintext

5. **Extension и MCP — комплементарны**, не конкуренты. Extension для standalone browser automation, MCP для IDE-агентов.