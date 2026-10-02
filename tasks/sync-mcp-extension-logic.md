# Синхронизация логики между MCP Tools и Extension SDK

## Проблема

Логика разработки разъехалась между MCP-тулами (packages/mcp-server) и Extension SDK (src/). Новые фичи добавляются только в MCP, Extension отстаёт. Это создаёт несогласованность в возможностях и поведении системы.

## Контекст

Система имеет два режима работы:
- **MCP Server** (packages/mcp-server) — standalone сервер с Playwright, управляющий браузером извне (headless/headed). Предназначен для AI-агентов (Claude, GPT).
- **Extension SDK** (src/) — библиотека для content script, работающая внутри браузерного контекста. Предназначена для in-page automation в Chrome Extension.

Оба режима должны предоставлять согласованный набор возможностей, но текущая реализация имеет значительные расхождения.

## Выявленные расхождения

### 1. Расхождения в действиях (Actions)

**MCP execute_action** (packages/mcp-server/src/tools/executeAction.ts) поддерживает 13 действий:
- click, type, fill, scroll, select, hover, focus, blur, check, uncheck, press, download, upload

**Extension executor** (src/executor/actionExecutor.ts) поддерживает 24 действия:
- click, type, clear, scroll, hover, focus, blur, select, check, uncheck, drag, drop, submit, reset, open, close, expand, collapse, wait, navigate, go_back, go_forward, refresh, download

**Действия, которые есть в Extension, но отсутствуют в MCP (12 штук):**
1. `clear` — очистка текстового поля
2. `drag` — drag-and-drop (target_id=source, value=destination)
3. `drop` — drop на целевой элемент
4. `submit` — отправка формы
5. `reset` — сброс формы
6. `open` — открытие dialog/details
7. `close` — закрытие dialog/details
8. `expand` — раскрытие элемента с aria-expanded
9. `collapse` — сворачивание элемента с aria-expanded
10. `wait` — ожидание условия (selector или "idle")
11. `go_back` — навигация назад в истории
12. `go_forward` — навигация вперёд в истории
13. `refresh` — обновление страницы

**Действия, которые есть в MCP, но отсутствуют в Extension (3 штуки):**
1. `fill` — алиас для `type` (удобство для LLM)
2. `press` — нажатие клавиши на клавиатуре (Enter, Tab, Escape и т.д.)
3. `upload` — загрузка файла в input[type="file"]

### 2. Расхождения в возможностях (Capabilities)

**MCP имеет, Extension не имеет:**

#### 2.1. Iframe Support
- **MCP**: `iframeFrameRegistry`, `extractDomTreeFromFrame`, frame routing в executeAction
- **Extension**: отсутствует
- **Файлы MCP**: packages/mcp-server/src/tools/getSnapshot.ts (L47, L388-402, L572-616)
- **Файлы Extension**: src/capture/domExtractor.ts — нет iframe логики

#### 2.2. Viewport Filtering Pipeline
- **MCP**: единый пайплайн (viewport filter → detail_level filter → scrollable metadata)
- **Extension**: отсутствует
- **Файлы MCP**: packages/mcp-server/src/utils/viewportFilter.ts, detailLevelFilter.ts
- **Файлы Extension**: нет аналогов

#### 2.3. ID Mapping (короткие ID)
- **MCP**: `idMapper.ts`, `reverseIdMap` — замена длинных ID на короткие для LLM
- **Extension**: отсутствует
- **Файлы MCP**: packages/mcp-server/src/utils/idMapper.ts
- **Файлы Extension**: нет аналога

#### 2.4. Lazy Text Loading
- **MCP**: `text_blocks` map, `vsl_get_text_block` tool для получения полных текстов > 200 символов
- **Extension**: отсутствует
- **Файлы MCP**: packages/mcp-server/src/tools/getTextBlock.ts
- **Файлы Extension**: нет аналога

#### 2.5. Click Coordinates
- **MCP**: `vsl_click_coordinates` tool для кликов по координатам (reCAPTCHA support)
- **Extension**: отсутствует
- **Файлы MCP**: packages/mcp-server/src/tools/clickCoordinates.ts
- **Файлы Extension**: нет аналога

#### 2.6. Snapshot Caching
- **MCP**: TTL-based cache с fullDocument, повторные вызовы перефильтровываются из кэша
- **Extension**: отсутствует
- **Файлы MCP**: packages/mcp-server/src/tools/getSnapshot.ts (L29-39, L478-516, L720-728)
- **Файлы Extension**: нет аналога

### 3. Расхождения в навигации

**MCP vsl_navigate** (packages/mcp-server/src/tools/navigate.ts):
- Использует Playwright `browser.navigate()`
- Может управлять браузером извне
- Поддерживает lazy navigation в executeAction (автоматический переход на URL из snapshot)

**Extension executor** (src/executor/actionExecutor.ts):
- Использует `window.location.assign()`, `history.back()`, `history.forward()`, `location.reload()`
- Работает только внутри браузерного контекста (content script)
- Не может управлять навигацией извне

### 4. Архитектурные различия

**MCP Server:**
- Standalone процесс с Playwright
- Управляет браузером через CDP (Chrome DevTools Protocol)
- Может работать с headless/headed браузерами
- Предназначен для AI-агентов (Claude, GPT)
- Имеет полный контроль над браузером

**Extension SDK:**
- Библиотека для content script
- Работает внутри браузерного контекста
- Ограничена permissions extension
- Предназначена для in-page automation
- Не может управлять браузером извне

## Требования

### Критические (Must Have)

1. **Синхронизировать действия**:
   - Добавить в MCP недостающие 12 действий из Extension (clear, drag, drop, submit, reset, open, close, expand, collapse, wait, go_back, go_forward, refresh)
   - Добавить в Extension недостающие 3 действия из MCP (fill, press, upload)
   - Унифицировать сигнатуры и поведение

2. **Портировать capabilities из MCP в Extension**:
   - Iframe support (extractDomTree для iframe, frame routing)
   - Viewport filtering pipeline
   - ID mapping (короткие ID)
   - Lazy text loading (text_blocks)
   - Snapshot caching

3. **Сохранить обратную совместимость**:
   - Не ломать существующий API MCP tools
   - Не ломать существующий API Extension SDK
   - Добавить новые возможности как расширения

### Важные (Should Have)

4. **Документация**:
   - Обновить ARCHITECTURE.md с описанием обоих режимов
   - Добавить матрицу соответствия действий между MCP и Extension
   - Описать ограничения каждого режима

5. **Тестирование**:
   - Добавить интеграционные тесты для синхронизированных действий
   - Проверить parity между MCP и Extension

### Опциональные (Nice to Have)

6. **Абстракция общего кода**:
   - Вынести общую логику (viewport filter, ID mapping, etc.) в shared utilities
   - Использовать как в MCP, так и в Extension

## Критерии приёмки

1. ✅ Все 24 действия из Extension доступны в MCP execute_action
2. ✅ Все 13 действий из MCP доступны в Extension executor
3. ✅ Extension поддерживает iframe extraction и frame routing
4. ✅ Extension имеет viewport filtering pipeline
5. ✅ Extension имеет ID mapping (короткие ID)
6. ✅ Extension имеет lazy text loading
7. ✅ Extension имеет snapshot caching
8. ✅ Обратная совместимость сохранена (существующие тесты проходят)
9. ✅ Документация обновлена
10. ✅ Интеграционные тесты добавлены и проходят

## Ограничения

1. **Не менять архитектуру**:
   - MCP остаётся standalone сервером с Playwright
   - Extension остаётся библиотекой для content script
   - Не пытаться унифицировать через общую кодовую базу (слишком разные среды выполнения)

2. **Сохранить производительность**:
   - Новые возможности не должны замедлять существующие операции
   - Snapshot caching должен иметь настраиваемый TTL
   - Viewport filtering должен быть эффективным (не re-extract на каждый вызов)

3. **Не нарушать безопасность**:
   - Extension не должен иметь доступ к cross-origin iframe без явного разрешения
   - Snapshot caching не должен хранить чувствительные данные (passwords, tokens)
   - ID mapping не должен раскрывать внутреннюю структуру DOM

## План реализации

### Фаза 1: Синхронизация действий (Priority: High)

1. **Добавить в MCP недостающие действия из Extension**:
   - clear, drag, drop, submit, reset, open, close, expand, collapse, wait, go_back, go_forward, refresh
   - Файл: packages/mcp-server/src/tools/executeAction.ts
   - Тесты: packages/mcp-server/src/tools/executeAction.test.ts

2. **Добавить в Extension недостающие действия из MCP**:
   - fill (алиас type), press (keyboard), upload (file)
   - Файл: src/executor/actionExecutor.ts
   - Тесты: src/executor/actionExecutor.test.ts

### Фаза 2: Портирование capabilities (Priority: High)

3. **Iframe support в Extension**:
   - Добавить extractDomTreeForIframe в src/capture/domExtractor.ts
   - Добавить frame routing в executor
   - Тесты: src/capture/domExtractor.iframe.test.ts

4. **Viewport filtering pipeline в Extension**:
   - Скопировать utils/viewportFilter.ts и utils/detailLevelFilter.ts из MCP
   - Интегрировать в snapshot generation
   - Тесты: src/utils/viewportFilter.test.ts

5. **ID mapping в Extension**:
   - Скопировать utils/idMapper.ts из MCP
   - Интегрировать в snapshot generation
   - Тесты: src/utils/idMapper.test.ts

6. **Lazy text loading в Extension**:
   - Добавить text_blocks в VslDocument
   - Добавить getTextBlock API
   - Тесты: src/session/textBlocks.test.ts

7. **Snapshot caching в Extension**:
   - Добавить cache store с TTL
   - Интегрировать в snapshot generation
   - Тесты: src/cache/snapshotCache.test.ts

### Фаза 3: Документация и тестирование (Priority: Medium)

8. **Обновить документацию**:
   - ARCHITECTURE.md — описание обоих режимов
   - Добавить матрицу соответствия действий
   - Описать ограничения каждого режима

9. **Интеграционные тесты**:
   - Проверить parity между MCP и Extension
   - Тесты: tests/integration/mcp-extension-parity.test.ts

### Фаза 4: Оптимизация (Priority: Low)

10. **Вынести общий код в shared utilities**:
    - viewportFilter, detailLevelFilter, idMapper → packages/shared/
    - Использовать как в MCP, так и в Extension

## Оценка времени

- Фаза 1: 2-3 дня
- Фаза 2: 4-5 дней
- Фаза 3: 1-2 дня
- Фаза 4: 2-3 дня
- **Итого: 9-13 дней**

## Риски

1. **Breaking changes**:
   - Риск: изменения могут сломать существующий код
   - Митигация: семантическое версионирование, миграционные гайды

2. **Производительность**:
   - Риск: новые возможности могут замедлить систему
   - Митигация: бенчмарки до/после, оптимизация критических путей

3. **Сложность тестирования**:
   - Риск: трудно проверить parity между MCP и Extension
   - Митигация: интеграционные тесты, manual testing checklist

## Связанные файлы

### MCP Server
- packages/mcp-server/src/tools/executeAction.ts
- packages/mcp-server/src/tools/getSnapshot.ts
- packages/mcp-server/src/tools/navigate.ts
- packages/mcp-server/src/tools/getVisual.ts
- packages/mcp-server/src/tools/readPage.ts
- packages/mcp-server/src/tools/getTextBlock.ts
- packages/mcp-server/src/tools/clickCoordinates.ts
- packages/mcp-server/src/utils/viewportFilter.ts
- packages/mcp-server/src/utils/detailLevelFilter.ts
- packages/mcp-server/src/utils/idMapper.ts

### Extension SDK
- src/executor/actionExecutor.ts
- src/executor/types.ts
- src/capture/domExtractor.ts
- src/session/snapshotSession.ts
- src/cache/cacheStore.ts
- src/index.ts

### Документация
- ARCHITECTURE.md
- ROADMAP.md
- README.md

## Следующие шаги

1. ✅ Проанализировать расхождения (выполнено)
2. ⏳ Получить одобрение на спецификацию
3. ⏳ Начать реализацию Фазы 1 (синхронизация действий)
4. ⏳ Продолжить Фазу 2 (портирование capabilities)
5. ⏳ Завершить Фазы 3-4 (документация, тестирование, оптимизация)

---

**Создано**: 2026-10-01
**Автор**: TaoCoder
**Статус**: На рассмотрении