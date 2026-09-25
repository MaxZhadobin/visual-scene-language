# HTTP Extractor Architecture Analysis & Task

**Status:** Analysis & Proposal (no code changes yet)
**Created:** 2026-09-25
**Context:** M1.6 MCP Server, T1.6.6 vsl_read_page

---

## 1. Current State Analysis

### 1.1 Problem Statement

Пользователь запросил рефакторинг `vsl_read_page` для выделения HTTP-first логики в отдельный модуль `httpExtractor.ts`. Текущее состояние:

**readPage.ts (сломан после частичного патча):**
- Импортирует `extractViaHttp` из `httpExtractor.ts` ✅
- В render-режиме (L107-133) использует локальные функции:
  - `detectSpa(html)` — использует `SPA_MARKERS`, который **удалён** из файла ❌
  - `applyReadableFilter(html)` — **удалена** из файла ❌
  - `extractTextContent(html)` — **удалена** из файла ❌
  - `extractTitle(html)` — **удалена** из файла ❌
  - `countWords(text)` — **удалена** из файла ❌
- Файл не компилируется (reference errors)

**httpExtractor.ts (создан, но без полного анализа):**
- Экспортирует `extractViaHttp(url, options)` ✅
- Экспортирует вспомогательные функции: `detectSpa`, `applyReadableFilter`, `extractTextContent`, `extractTitle`, `countWords` ✅
- Содержит константы: `SPA_MARKERS`, `NOISY_SELECTORS` ✅
- **Проблема:** создан без предварительного анализа архитектуры и интеграции

### 1.2 Root Cause

Агент начал реализацию без:
1. Анализа роли HTTP-экстрактора в общей архитектуре
2. Определения границ ответственности между модулями
3. Понимания, как HTTP-экстрактор взаимодействует с BrowserManager, ServerSession, Vision Backend
4. Согласования архитектуры с пользователем

---

## 2. Architecture Analysis


### 1.3 Critical Limitation: HTTP vs Render Capabilities

**HTTP-путь (cheerio):**
- ✅ Структура DOM (элементы, текст, атрибуты)
- ✅ VSL JSON (семантическая разметка)
- ❌ **НЕТ координат (bbox)** — cheerio не рендерит страницу, нет layout engine
- ❌ **НЕТ действий** (click, type, scroll) — нет браузера

**Render-путь (Playwright):**
- ✅ Структура DOM + реальные координаты (getBoundingClientRect)
- ✅ Выполнение действий через BrowserManager
- ✅ Скриншоты, визуальная классификация

**Следствия:**
1. HTTP-путь используется **ТОЛЬКО для чтения** (получение структуры страницы)
2. Для выполнения действий (vsl_execute_action) **ВСЕГДА** используется Render-путь
3. Автоматическая стратегия:
   - `vsl_read_page(url)` → HTTP-first (быстрое чтение структуры)
   - Если агент вызывает `vsl_execute_action` → система использует Render-путь (браузер)
   - Если агент вызывает `vsl_read_page` повторно после действий → Render-путь (нужны координаты для диффов)
4. VSL JSON из HTTP-пути имеет **ограниченные bbox** (приблизительные или null) — агент понимает структуру, но не точное расположение
### 2.1 Role of HTTP Extractor in VSL Architecture

Согласно PRODUCT_CONCEPT.md §5 и ROADMAP.md T1.6.6:

**vsl_read_page** — MCP-tool для чтения веб-страниц с автоматической стратегией извлечения:

**Автоматическая стратегия (из коробки):**
1. **HTTP-first** — статические страницы через HTTP GET → **VSL JSON** (миллисекунды, без браузера)
2. **Auto-switch to Render** — если HTML содержит SPA-маркеры → автоматически переключается на headless-браузер → **VSL JSON** (1-3s, с браузером)

**Ключевой принцип:** Агент НЕ выбирает режим. Система сама определяет стратегию и всегда возвращает **VSL JSON**.

**Поток данных:**
- HTTP-путь: `fetch HTML` → `parse HTML` → `build VSL JSON`
- Render-путь: `browser` → `get DOM` → `extract DOM tree` → `build VSL JSON`

**HTTP Extractor** — это модуль, который реализует **HTTP-first путь**:
- Fetch HTML через нативный fetch (Node.js 18+)
- Детекция SPA-маркеров (если найдены → нужен рендер)
- Readable-фильтрация (удаление шума: nav, footer, cookie banners)
- **Парсинг HTML в DOM-дерево** (через jsdom/cheerio)
- **Построение VSL JSON** из DOM-дерева (аналогично browser-based extraction)

**Ключевой принцип:** HTTP Extractor **не зависит от Playwright** — работает без браузера, но возвращает **VSL JSON**, а не сырой HTML/текст.
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server (index.ts)                    │
│  - JSON-RPC over stdio (MCP 2025-11-25)                     │
│  - Tools registration                                        │
│  - Resources registration                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ├──────────────────────────────────┐
                     │                                  │
              ┌──────▼──────┐                    ┌──────▼──────┐
              │ readPage.ts │                    │  Other Tools │
              │ (T1.6.6)    │                    │  (getSnapshot│
              └──────┬──────┘                    │   etc.)      │
                     │                           └─────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ httpExtractor│ │ Browser  │ │   Server     │
│   .ts        │ │ Manager  │ │   Session    │
│              │ │          │ │              │
│ - fetch HTML │ │ - Playwright│ │ - VSL snapshot│
│ - SPA detect │ │ - navigate │ │ - diff computation│
│ - readable   │ │ - evaluate │ │ - change notifications│
│ - text extract│ │ - screenshot│ │              │
**Integration Flow:**

1. **readPage.ts** получает запрос от MCP-клиента (LLM agent): `vsl_read_page(url)`
2. Вызывает `extractViaHttp(url, options)` из `httpExtractor.ts`
3. Если `result.isSpa === true` → автоматически переключается на render-режим (BrowserManager)
4. Если `result.isSpa === false` → возвращает HTTP-результат с VSL JSON
5. Сохраняет VSL в `ServerSession` для диффов (для обоих путей)
6. Возвращает результат с метаданными (hasDiff, metadata) — агент всегда получает VSL JSON

### 2.3 Responsibility Boundaries
#### httpExtractor.ts (HTTP-first путь)

**Отвечает за:**
- ✅ HTTP-запрос через fetch (с таймаутом, User-Agent)
- ✅ Детекция SPA-маркеров (по HTML-строке)
- ✅ Readable-фильтрация (удаление шумных элементов)
- ✅ **Парсинг HTML в DOM-дерево** (через cheerio)
- ✅ **Построение VSL JSON** из DOM-дерева (аналогично browser-based extraction)
- ✅ Извлечение метаданных (title, wordCount)

**НЕ отвечает за:**
- ❌ Рендер страницы (это BrowserManager)
- ❌ Хранение snapshot/диффов (это ServerSession)
- ❌ Vision-классификация (это LlmVisionClassifier)

#### readPage.ts (оркестрация)

**Отвечает за:**
- ✅ Вызов `extractViaHttp` → получает VSL JSON + флаг `isSpa`
- ✅ Если `isSpa === true` → автоматическое переключение на BrowserManager
- ✅ Вызов `BrowserManager` для render-пути → получает VSL JSON
- ✅ Сохранение VSL в `ServerSession` (для обоих путей)
- ✅ Формирование итогового результата (всегда VSL JSON)

**Ключевой момент:** Агент вызывает `vsl_read_page(url)` без параметров режима. Система сама определяет стратегию и всегда возвращает VSL JSON.

#### BrowserManager (рендер)

**Отвечает за:**
- ✅ Запуск headless-браузера (Playwright)
- ✅ Навигация по URL
- ✅ Получение HTML после рендера (`getContent()`)
- ✅ Выполнение JavaScript (`evaluate()`)
- ✅ Скриншоты (`screenshot()`)

**НЕ отвечает за:**
- ❌ HTTP-запросы (это httpExtractor)
- ❌ Парсинг HTML (это httpExtractor или readPage)
- ❌ SPA-детекция (это httpExtractor)

#### ServerSession (состояние)

**Отвечает за:**
- ✅ Хранение текущего VSL-документа
- ✅ Вычисление диффов между snapshot'ами
- ✅ Уведомление об изменениях (resource subscription)

**НЕ отвечает за:**
- ❌ Извлечение контента (это readPage/httpExtractor)
- ❌ Рендер страниц (это BrowserManager)
### 3.2 Data Flow


Агент вызывает vsl_read_page(url)
  ↓
readPage.ts: Автоматическая стратегия
  ↓
Попытка HTTP-first:
  httpExtractor.extractViaHttp(url)
    ↓
  fetch HTML → cheerio parse → buildVslFromDom
    ↓
  Возвращает: { vslDocument, isSpa, readableApplied }
    ↓
  Проверка: isSpa === true?
    ├─ НЕТ → HTTP-путь успешен
    │   └─ Сохранить VSL в ServerSession (для диффов)
    │   └─ Вернуть VSL JSON агенту (без точных bbox)
    │
    └─ ДА → Переключиться на Render-путь
        └─ BrowserManager.navigate(url)
        └─ extractDomTree (с реальными bbox)
        └─ buildVslDocument → VSL JSON
        └─ Сохранить VSL в ServerSession
        └─ Вернуть VSL JSON агенту (с точными bbox)


**Важно:** HTTP-путь возвращает VSL JSON **без точных координат** (bbox может быть null или приблизительным). Для выполнения действий (vsl_execute_action) и точных диффов используется Render-путь.

**Производительность:**
- Статические страницы: HTTP-путь (миллисекунды, без браузера)
- SPA/интерактивные: HTTP → детекция → Render (1-3s, с браузером)
- Readable-фильтрация: работает в обоих путях (удаление nav, footer, cookie banners)

### 3. Design Decisions

### 3.1 Why Separate httpExtractor?

**Причины:**
1. **Разделение ответственности:** HTTP-экстрактор не знает о браузере, BrowserManager не знает о HTTP
2. **Тестируемость:** HTTP-логика тестируется без моков Playwright
3. **Производительность:** HTTP-путь работает без браузера (миллисекунды vs 1-3s)
4. **Единый формат:** Всегда возвращаем VSL JSON — агент получает консистентный результат

### 3.2 Why Not Merge into readPage.ts?

**Проблемы merge:**
- readPage.ts станет слишком большим (300+ lines)
- Сложнее тестировать HTTP-логику изолированно
- Нарушение Single Responsibility Principle

### 3.3 Why HTTP Extractor Returns VSL JSON (Not Raw Text)?

**Решение пользователя (25.09.2026):** HTTP-экстрактор должен преобразовывать HTML в VSL JSON, а не отдавать сырой текст/HTML.

**Причины:**
1. **Консистентность:** Агент всегда получает VSL JSON независимо от пути извлечения
2. **Семантика:** VSL JSON содержит структуру (id, type, bbox, children), а не плоский текст
3. **Диффы:** Работают для обоих путей (Snapshot Session)
4. **Архитектура:** HTTP-экстрактор — это быстрый способ получить данные, затем они идут через ту же VSL-схему

**Механика:**
- HTTP-путь: `fetch HTML` → `parse HTML` → `build VSL JSON`
- Render-путь: `browser` → `get DOM` → `extract DOM tree` → `build VSL JSON`

### 3.4 Why cheerio for HTML Parsing?

**Причины:**
- Нужен DOM-парсер для построения VSL JSON из статического HTML
- cheerio: легковесный jQuery-like API (быстрее, чем jsdom)
- **Решение:** Использовать cheerio для производительности (HTTP-путь должен быть быстрым)

### 3.5 Why SPA_MARKERS Are String Literals?

**Причины:**
- Простота: `html.includes('#root')` быстрее, чем парсинг DOM
- Достаточно для детекции SPA (маркеры уникальны)
- Не требует DOM-окружения (работает в Node.js)

**Ограничения:**
- Ложные срабатывания: `<style>#root { ... }</style>` — но это редкость
- Не детектирует SPA без маркеров (например, динамическая загрузка) — но это edge case

## 4. Implementation Plan

### 4.1 Rework httpExtractor.ts

**Проблема:** Текущая реализация возвращает сырой текст/HTML, а не VSL JSON.

**Решение:**
1. Добавить зависимость: `cheerio` для парсинга HTML в DOM
2. Реализовать `parseHtml(html)` → DOM tree
3. Реализовать `buildVslFromDom(dom)` → VSL JSON (аналогично `extractDomTree` из `src/capture/domExtractor.ts`, но для статического HTML)
4. Обновить `extractViaHttp` чтобы возвращать `vslDocument` вместо `textContent`
5. Удалить функции `extractTextContent`, `extractTitle`, `countWords` — они больше не нужны (VSL JSON содержит всю структуру)

**Новая сигнатура:**

interface HttpExtractResult {
  url: string;
  vslDocument: VslDocument;  // ← VSL JSON вместо textContent
  title?: string;
  wordCount?: number;
  isSpa: boolean;
  readableApplied: boolean;
}

### 4.2 Update readPage.ts

**Изменения:**
1. Использовать `vslDocument` из `httpResult` вместо `textContent`
2. Сохранять VSL в `ServerSession` для обоих путей (HTTP и render)
3. Автоматическое переключение на BrowserManager если `isSpa === true`
4. Удалить вспомогательные функции (`detectSpa`, `applyReadableFilter`, etc.) из readPage — они теперь в httpExtractor
5. Убрать параметр `mode` из API — агент вызывает `vsl_read_page(url)` без выбора режима

### 4.3 Update Tests

**readPage.test.ts:**
- Обновить моки для `extractViaHttp` (возвращает `vslDocument` вместо `textContent`)
- Проверить, что HTTP-путь сохраняет VSL в session
- Проверить автоматическое переключение на render при `isSpa === true`

**httpExtractor.test.ts:**
- Проверить парсинг HTML в DOM
- Проверить построение VSL JSON из DOM
- Проверить edge cases: timeout, network error, invalid HTML

### 4.4 Documentation

**README.md (packages/mcp-server/):**
- Обновить описание vsl_read_page: всегда возвращает VSL JSON
- Объяснить автоматическую стратегию: HTTP-first → auto-switch to Render для SPA
- Убрать упоминания параметра `mode` из примеров

### 4.5 Update Architectural Documents

**PRODUCT_CONCEPT.md (§5 — vsl_read_page):**
- Обновить описание: `vsl_read_page(url)` без параметра `mode` — автоматическая стратегия из коробки
- Убрать упоминания режимов (http/render/auto) — система сама определяет стратегию
- Подчеркнуть: HTTP-first → auto-switch to Render для SPA, всегда возвращает VSL JSON

**ARCHITECTURE.md (§15.2 — MCP Server Tools):**
- Обновить описание vsl_read_page: автоматическая стратегия, без параметра `mode`
- Обновить границы ответственности: httpExtractor возвращает VSL JSON (не сырой текст/HTML)
- Добавить: cheerio для парсинга HTML, parseHtml → buildVslFromDom

**DECISIONS.md:**
- Добавить решение: vsl_read_page НЕ имеет параметра `mode` — автоматическая стратегия из коробки
- Добавить решение: HTTP Extractor возвращает VSL JSON (не сырой текст/HTML) — консистентность, семантика, диффы
- Добавить решение: cheerio для парсинга HTML (быстрее, чем jsdom)

## 5. Acceptance Criteria

### 5.1 Functional

- [ ] readPage.ts компилируется без ошибок (нет reference errors)
- [ ] Автоматическая стратегия работает: `vsl_read_page(url)` возвращает **VSL JSON** (не сырой текст)
- [ ] HTTP-путь работает: статические страницы извлекаются через HTTP GET (без браузера, миллисекунды)
- [ ] Render-путь работает: SPA/интерактивные страницы рендерятся через BrowserManager (1-3s)
- [ ] Автоматическое переключение работает: если HTML содержит SPA-маркеры → система сама переключается на render
- [ ] Readable-фильтрация работает: `vsl_read_page(url, { readable: true })` фильтрует шум (в обоих путях)
- [ ] SPA-детекция работает: автоматическое переключение на render для SPA (без участия агента)
- [ ] Диффы работают: повторный вызов `vsl_read_page` возвращает diff (**для обоих путей**, не только render)
- [ ] Snapshot Session: HTTP-путь сохраняет VSL в `ServerSession` (аналогично render-пути)
- [ ] Агент НЕ выбирает режим: `vsl_read_page(url)` без параметра `mode` — система сама определяет стратегию
- [ ] **Ограничения HTTP-пути явно задокументированы:** VSL JSON из HTTP-пути имеет ограниченные bbox (null или приблизительные), агент НЕ может выполнять действия (vsl_execute_action) через HTTP-путь — для действий ВСЕГДА используется Render-путь

### 5.2 Non-Functional

- [ ] HTTP-путь работает без Playwright (нет зависимости от браузера для статических страниц)
- [ ] Все тесты проходят (unit tests для readPage и httpExtractor)
- [ ] Покрытие кода ≥80% (DEC-021)
- [ ] TypeScript strict mode (нет ошибок компиляции)
- [ ] ESLint passes (нет warnings)

### 5.3 Integration

- [ ] MCP Server запускается: `npx @vsl/mcp-server` работает
- [ ] check_all.sh passes (все проверки зелёные)
- [ ] Документация обновлена (README, JSDoc, PRODUCT_CONCEPT.md, ARCHITECTURE.md, DECISIONS.md)
## 6. Open Questions

### 6.1 Architecture

**Q3:** Где должна жить SPA-детекция — в httpExtractor или readPage?
- **Pro httpExtractor:** Переиспользование, тестируемость
- **Pro readPage:** Ближе к оркестрации
- **Decision:** В httpExtractor — переиспользуется в автоматической стратегии

### 6.2 Implementation

**Q4:** Нужно ли обновлять тесты после рефакторинга?
- **Answer:** Да — проверить, что тесты проходят с новой сигнатурой (VSL JSON вместо textContent)

**Q5:** Нужно ли добавлять новые тесты для httpExtractor?
- **Answer:** Да — добавить unit tests для parseHtml, buildVslFromDom, edge cases

**Q6:** Нужно ли обновлять документацию?
- **Answer:** Да — обновить README и JSDoc, объяснить что система всегда возвращает VSL JSON (автоматическая стратегия)

---

## 8. User Approval Required

**Перед реализацией необходимо согласие пользователя на:**

1. **Архитектуру:** HTTP Extractor возвращает **VSL JSON** (не сырой текст/HTML)
2. **Парсер:** Использовать `cheerio` для парсинга HTML в DOM (быстрее, чем jsdom)
3. **Границы ответственности:** httpExtractor отвечает за HTTP-first + VSL JSON, readPage оркестрирует
4. **Snapshot Session:** Оба пути (HTTP и render) сохраняют VSL в ServerSession для диффов
5. **Автоматическая стратегия:** Агент вызывает `vsl_read_page(url)` БЕЗ параметра `mode` — система сама определяет стратегию (HTTP-first → auto-switch to Render для SPA)
6. **Обновление архитектурных документов:** PRODUCT_CONCEPT.md, ARCHITECTURE.md, DECISIONS.md — убрать упоминания режимов, описать автоматическую стратегию
7. **Критические ограничения HTTP-пути:** HTTP-путь возвращает VSL JSON **без точных координат** (bbox может быть null или приблизительным). Для выполнения действий (vsl_execute_action) и точных диффов **ВСЕГДА** используется Render-путь (браузер). Агент понимает структуру страницы через HTTP, но для взаимодействия с элементами нужен Render-путь.
8. **План реализации:** Rework httpExtractor → Update readPage → Update tests → Update docs → Update architectural docs

**Пожалуйста, подтвердите или предложите изменения.**