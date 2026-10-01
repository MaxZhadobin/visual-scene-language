# @thinkingos/vsl-mcp-server

VSL MCP Server — интеграция Visual Scene Language с AI-агентами через [Model Context Protocol](https://modelcontextprotocol.io/) (MCP 2025-11-25).

Позволяет AI-агентам (Claude Desktop, Cline, TaoCoder) взаимодействовать с веб-страницами через семантическую структуру VSL: читать страницы, выполнять действия, получать диффы изменений.

## Быстрая установка (одна команда)


# Через npx — автоматически скачивает пакет и запускает интерактивный setup:
npx -p @thinkingos/vsl-mcp-server mcp-server-setup


Setup скрипт поможет вам:
1. Проверить Node.js >= 18
2. Установить Playwright (опционально, для браузерных инструментов)
3. Сохранить конфигурацию в `~/.vsl/config.json`
4. Получить инструкции для подключения к агенту
## Установка из исходников (для разработчиков)

### Из корня monorepo

# Клонировать репозиторий
git clone <repo-url> visual-scene-language
cd visual-scene-language

# Установить зависимости
npm install

# Собрать пакет
cd packages/mcp-server
npm run build
### Интерактивная настройка (рекомендуется)


# Из корня monorepo:
node packages/mcp-server/bin/setup.js

# Или из директории packages/mcp-server:
npm run setup


Setup скрипт поможет вам:
1. Проверить Node.js >= 18
2. Установить Playwright (опционально, для браузерных инструментов)
3. Сохранить конфигурацию в `~/.vsl/config.json`
4. Получить инструкции для подключения к агенту

## Конфигурация

### API-ключи (env vars)

# Минимум один провайдер для vision-backend (классификация элементов)
export OPENAI_API_KEY="sk-..."           # gpt-6-luna
export ANTHROPIC_API_KEY="sk-ant-..."    # claude-haiku-4-5

# Или кастомный провайдер (любой OpenAI-compatible endpoint):
export VSL_VISION_PROVIDER="custom"
export VSL_VISION_BASE_URL="https://api.together.xyz/v1"
export VSL_VISION_API_KEY="your-key"
export VSL_VISION_MODEL="meta-llama/Llama-Vision"
### Конфигурационный файл (опционально)

`~/.vsl/config.json`:

{
  "openai": { "apiKey": "sk-..." },
  "anthropic": { "apiKey": "sk-ant-..." },
  "vision": {
    "provider": "custom",
    "baseUrl": "https://api.together.xyz/v1",
    "apiKey": "your-key",
    "model": "meta-llama/Llama-Vision"
  }
}
Приоритет: env vars > config file > defaults.

## Инструменты

### vsl_get_snapshot

Получить текущий VSL snapshot страницы. Возвращает VSL JSON с семантической структурой элементов.

**Параметры:**
- `url` (string, optional) — URL страницы. Если не указан, используется текущая страница.
- `detail_level` (string, optional) — уровень детализации: `low` (только интерактивные элементы), `medium` (интерактивные + контейнеры, по умолчанию), `high` (все объекты).
- `ttl` (number, optional) — TTL кэша в мс (по умолчанию 5000 = 5с). `0` — отключить кэширование.
- `full` (boolean, optional) — полный режим: возвращает ВЕСЬ документ без вьюпорт-фильтра и фильтра детализации, минуя дифф-фёрст логику. Используйте, если история агента обрезалась и нужна полная картина страницы (заменяет удалённый тул `vsl_get_full_json`).

**Возвращает:** `VslDocument` — VSL JSON, отфильтрованный по видимому окну и уровню детализации (или полный при `full: true`). Содержит метаданные `scrollable: { top, bottom }` (есть ли контент выше/ниже видимого окна).

**Кэширование:** повторный вызов с тем же URL в пределах TTL возвращает документ из кэша, перефильтрованный по новым параметрам, без обращения к браузеру.

### vsl_execute_action

Выполнить действие над элементом VSL.

**Параметры:**
- `action` (string, required) — имя действия: `click`, `type`, `fill` (алиас `type`), `scroll`, `select`, `hover`, `focus`, `blur`, `check`, `uncheck`, `press`, `upload` (загрузка файла, требует `value` — путь к файлу или список путей через запятую), `download` (скачивание файла: клик по элементу либо прямое скачивание по URL через `value`)
- `target_id` (string, required) — ID элемента в VSL JSON
- `value` (string, optional) — значение для действия (текст для `type`, опция для `select`, путь к файлу для `upload`)
- `timeout` (number, optional) — таймаут ожидания завершения скачивания в мс (только для действия `download`)
- `save_path` (string, optional) — путь для сохранения скачанного файла (только для действия `download`; относительные пути разрешаются в папку загрузок с проверкой выхода за её пределы)
- `return_state` (boolean, optional, по умолчанию `true`) — возвращать ли состояние страницы после действия (дифф + снапшот, отфильтрованные по видимому окну)

**Возвращает:** результат выполнения действия.

**Пример загрузки файла:**


Agent: vsl_execute_action(action="upload", target_id="file_input_0", value="/path/to/document.pdf")
→ { success: true, data: { action: "upload", upload: { selector: "#file_input_0", files: ["/path/to/document.pdf"], success: true } } }


Для загрузки нескольких файлов (если input имеет `multiple` атрибут):


Agent: vsl_execute_action(action="upload", target_id="file_input_1", value="/path/file1.jpg, /path/file2.jpg")
→ { success: true, data: { upload: { files: ["/path/file1.jpg", "/path/file2.jpg"], success: true } } }

**Пример скачивания файла (действие `download`):**


Agent: vsl_execute_action(action="download", target_id="btn_download")
→ { success: true, data: { download: { downloadId: "dl_1", filename: "report.pdf", url: "https://example.com/report.pdf", status: "completed", path: "/downloads/report.pdf" } } }


Прямое скачивание по URL с сохранением в указанный путь и таймаутом:


Agent: vsl_execute_action(action="download", target_id="btn_download", value="https://example.com/file.pdf", save_path="/tmp/file.pdf", timeout=15000)
→ { success: true, data: { download: { downloadId: "dl_1", filename: "file.pdf", status: "completed", path: "/tmp/file.pdf" } } }



**Lazy Navigation (DEC-028):**
Перед выполнением действия система автоматически проверяет, находится ли браузер на URL из текущего snapshot. Если нет — автоматически навигирует на нужный URL. Это позволяет агенту:
1. Прочитать страницу через HTTP-путь (быстро, без браузера)
2. Получить VSL JSON с семантической структурой
3. Вызвать `vsl_execute_action` — система автоматически запустит браузер и перейдёт на URL

Агенту НЕ нужно явно вызывать `vsl_navigate` перед выполнением действий.

### vsl_navigate

Перейти по URL.

**Параметры:**
- `url` (string, required) — URL для навигации

**Возвращает:** успех/неудача навигации.

### vsl_clear_cache

Сбросить кэш VSL snapshot. Следующий вызов `vsl_get_snapshot` создаст новый snapshot с нуля.

**Параметры:** нет.

### vsl_get_visual

Получить visual fragment для элемента (base64 WebP изображение). Автоматически прокручивает страницу к элементу если он вне viewport.

**Параметры:**
- `element_id` (string, required) — ID элемента в VSL JSON
- `auto_scroll` (boolean, optional, default: true) — автоматически прокручивать к элементу если он вне viewport
- `auto_refresh` (boolean, optional, default: false) — автоматически обновлять snapshot перед поиском

**Возвращает:** base64-изображение элемента. Если был выполнен автоскролл, результат содержит `scroll_info: { scrolled: true, scroll_offset: { x, y } }`.

### vsl_read_page

Гибридное чтение веб-страниц с автоматической стратегией. HTTP-first для статических страниц; автоматическое переключение на рендер через браузер для SPA.

**Параметры:**
- `url` (string, required) — URL страницы для чтения
- `readable` (boolean, optional) — фильтрация шума (nav, footer, cookie banners)


**Автоматическая стратегия:**
- Система сама определяет оптимальный путь: HTTP для статических страниц, Render для SPA
- Агент НЕ выбирает режим — нет параметра `mode`
- SPA-маркеры (id="root", id="app", data-reactroot, ng-app) автоматически переключают на Render-путь

**Особенности:**
- Повторные чтения возвращают diff (Snapshot Session)
- Readable-режим фильтрует nav, footer, cookie banners
- HTTP-путь возвращает VSL JSON с семантической структурой без координат (объекты без `p`/`s` прозрачно проходят вьюпорт-фильтр)
- Render-путь возвращает полный VSL JSON с абсолютными пиксельными координатами для выполнения действий

**Возвращает:** VSL JSON структуру страницы (полный документ или diff).

### vsl_get_text_block

Получить полный текст по `txt_ref` из ленивой загрузки текстов. Тексты длиннее ~200 символов в снапшоте автоматически заменяются на `txt_preview` (первые ~50 символов) + `txt_ref` (ссылка вида `tb_001`).

**Параметры:**
- `block_id` (string, required) — ID текстового блока из поля `txt_ref` объекта снапшота (формат `tb_xxx`)

**Возвращает:** `{ block_id, text }` — полное содержимое текстового блока.

## Единый пайплайн отдачи: полный кэш + фильтрация на отдаче

Все пути отдачи (`vsl_get_snapshot`, `vsl_navigate`, `vsl_execute_action` с `return_state`, браузерный путь `vsl_read_page`) используют единый пайплайн:

1. **Полное извлечение** — из браузера извлекается ПОЛНОЕ DOM-дерево, включая элементы вне видимой области (никакого усечения на этапе извлечения).
2. **Полный кэш** — сессия хранит полный `VslDocument`; диффы считаются на полных документах.
3. **Абсолютные координаты** — поле `p` объекта: абсолютные страница-релятивные пиксели `[x, y]` (с учётом скролла страницы); `s` — размер `[ширина, высота]`. Координаты инвариантны к ресайзу окна.
4. **Фильтрация на отдаче** — видимое окно = `[скролл, скролл + вьюпорт]`; сначала вьюпорт-фильтр (контейнер жив, пока есть видимые потомки), затем фильтр детализации `detail_level`.
5. **Метаданные скролла** — результат содержит `scrollable: { top, bottom }`: есть ли контент выше/ниже видимого окна (ориентир для действий `scroll`).

**Различия режимов:**

| | ХТТП-режим (`vsl_read_page`) | Браузерный режим |
|---|---|---|
| Когда | статические страницы | SPA и интерактивные страницы |
| Координаты | отсутствуют (`p`/`s` = null) | абсолютные пиксели |
| Вьюпорт-фильтр | прозрачен (все объекты проходят) | отсекает невидимые элементы |
| Действия | недоступны напрямую — `vsl_execute_action` сам запустит браузер (ленивая навигация) | полный набор действий |

**Повторные запросы без браузера:** смена `detail_level` или `full` в пределах кэша перефильтровывает документ из кэша — без повторного извлечения.

## Ресурсы (MCP Resources)

### vsl://current

Текущий VSL snapshot страницы. Содержит полную семантическую структуру элементов.

### vsl://diff

Последний VSL diff с момента предыдущего snapshot. Содержит только изменения (added/modified/removed).

## Интеграция с AI-агентами

### Claude Desktop

Добавьте в `~/Library/Application Support/Claude/claude_desktop_config.json`:

{
  "mcpServers": {
    "vsl": {
      "command": "node",
      "args": ["/absolute/path/to/visual-scene-language/packages/mcp-server/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
### Cline

Добавьте в настройки Cline (VS Code → Settings → Cline → MCP Servers → Add Server → Local (stdio)):

- **Server Name:** `vsl`
- **Command:** `node`
- **Arguments:** `/absolute/path/to/visual-scene-language/packages/mcp-server/dist/index.js`
- **Environment variables:**
    OPENAI_API_KEY=sk-...
  Или JSON-формат:

{
  "vsl": {
    "command": "node",
    "args": ["/absolute/path/to/visual-scene-language/packages/mcp-server/dist/index.js"],
    "env": {
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
### TaoCoder

Добавьте в `.taocoder/mcp.json`:

{
  "servers": {
    "vsl": {
      "command": "node",
      "args": ["/absolute/path/to/visual-scene-language/packages/mcp-server/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
### Cursor

Добавьте в `.cursor/mcp.json`:

{
  "mcpServers": {
    "vsl": {
      "command": "node",
      "args": ["/absolute/path/to/visual-scene-language/packages/mcp-server/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
> **💡 Подсказка:** Замените `/absolute/path/to/visual-scene-language` на реальный путь к вашему репозиторию. Если вы настроили vision через `~/.vsl/config.json`, env vars можно не указывать.

## Примеры использования

### Чтение статической страницы

Agent: vsl_read_page(url="https://example.com/article")
→ { status: "success", data: { mode: "http", content: "...", vslDocument: {...}, metadata: { title: "Example Article", wordCount: 1500 } } }
### Чтение SPA (автоматическое переключение на Render)

# Система автоматически детектирует SPA-маркеры и переключается на Render-путь
Agent: vsl_read_page(url="https://spa-app.com/dashboard")
→ { status: "success", data: { mode: "render", vslDocument: {...}, hasDiff: false } }

Agent: vsl_execute_action(action="click", target_id="btn_refresh")
→ { success: true }

Agent: vsl_read_page(url="https://spa-app.com/dashboard")
→ { status: "success", data: { mode: "render", diff: { added: [...], modified: [...] }, hasDiff: true } }
### Получение полного снапшота при потере контекста

# История агента обрезалась — запрашиваем полный документ без фильтров
Agent: vsl_get_snapshot(full=true)
→ { vsl_version: "1.0.0", canvas: {...}, objects: [ ...все элементы, включая невидимые... ] }
## Архитектура

┌─────────────────────────────────────────────┐
│  AI Agent (Claude Desktop / Cline / etc.)   │
└──────────────────┬──────────────────────────┘
                   │ MCP (JSON-RPC over stdio)
                   ▼
┌─────────────────────────────────────────────┐
│  @thinkingos/vsl-mcp-server                    │
│  ├── Tools (7): snapshot, action, navigate, │
│  │            cache, visual, read_page,     │
│  │            text_block                    │
│  ├── Resources (2): vsl://current,          │
│  │                  vsl://diff              │
│  ├── BrowserManager (Playwright, optional)  │
│  ├── ServerSession (snapshot state + diff)  │
│  └── Config (env + config file)             │
└──────────────────┬──────────────────────────┘
                   │ @thinkingos/vsl-sdk
                   ▼
┌─────────────────────────────────────────────┐
│  VSL Core SDK                               │
│  ├── DOM extraction → Segmentation          │
│  ├── VSL Builder → VslDocument              │
│  ├── Diff Engine → VslDiff                  │
│  └── Vision Classifier (LLM flash models)   │
└─────────────────────────────────────────────┘
## Исправления (Bug Fixes)

> **ID Stability после fill action** — элементы сохраняют свои короткие ID после изменений DOM.

> **Iframe ID Resolution** — исправлен резолв ID для элементов внутри iframe (используется полный `target_id` с префиксом `iframe_N:`).

> **Lazy Text Loading** — тексты длиннее ~200 символов автоматически заменяются на `txt_preview` + `txt_ref` для экономии токенов.

> **Lazy Navigation** — автоматическая навигация на URL перед выполнением действий, если браузер не на нужной странице.

## Требования

- Node.js ≥ 18
- Playwright (опционально, для SPA-рендеринга): `npx playwright install chromium`
- API-ключ хотя бы одного провайдера (OpenAI / Anthropic / Custom) для vision-backend

## Vision-backend

Для классификации элементов без A11y-семантики используются дешёвые flash-модели:

| Провайдер | Модель | Env var |
|-----------|--------|---------|
| OpenAI | gpt-6-luna | `OPENAI_API_KEY` |
| Anthropic | claude-haiku-4-5 | `ANTHROPIC_API_KEY` |
| Custom | любая OpenAI-compatible | `VSL_VISION_BASE_URL` + `VSL_VISION_API_KEY` + `VSL_VISION_MODEL` |

Модель конфигурируется через `vision.provider` и `vision.model` в config file.

### Кастомные провайдеры

Поддерживаются любые OpenAI-compatible API (Together AI, Groq, OpenRouter, локальные модели через Ollama/vLLM и т.д.). Укажите `provider: "custom"`, `baseUrl`, `apiKey` и `model` в конфиге или через env vars.

**Пример для Together AI:**

{
  "vision": {
    "provider": "custom",
    "baseUrl": "https://api.together.xyz/v1",
    "apiKey": "your-together-key",
    "model": "meta-llama/Llama-Vision"
  }
}
**Пример для Groq:**

{
  "vision": {
    "provider": "custom",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "your-groq-key",
    "model": "llama-3.2-90b-vision-preview"
  }
}
## Лицензия

SEE LICENSE IN LICENSE.txt