# @thinkingos/vsl-mcp-server

VSL MCP Server — интеграция Visual Scene Language с AI-агентами через [Model Context Protocol](https://modelcontextprotocol.io/) (MCP 2025-11-25).

Позволяет AI-агентам (Claude Desktop, Cline, TaoCoder) взаимодействовать с веб-страницами через семантическую структуру VSL: читать страницы, выполнять действия, получать диффы изменений.

## Быстрая установка (одна команда)

# Через npx — автоматически скачивает пакет и запускает интерактивный setup:


npx -p @thinkingos/vsl-mcp-server mcp-server-setup


Setup скрипт поможет вам:
1. Проверить Node.js >= 18
2. Установить Playwright (опционально, для браузерных инструментов)
3. Настроить API ключи для vision-backend (OpenAI / Anthropic / Custom)
4. Проверить работоспособность API (тестовый запрос)
5. Сохранить конфигурацию в `~/.vsl/config.json`
6. Получить инструкции для подключения к агенту

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
3. Настроить API ключи для vision-backend (OpenAI, Anthropic, или любой OpenAI-compatible провайдер)
4. Проверить работоспособность API (тестовый запрос)
5. Сохранить конфигурацию в `~/.vsl/config.json`
6. Получить инструкции для подключения к агенту

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

**Возвращает:** `VslDocument` — полный VSL JSON.

### vsl_get_diff

Получить изменения с момента последнего snapshot. Возвращает только diff (added/modified/removed).

**Параметры:** нет.

**Возвращает:** `VslDiff` — дифф с момента последнего `vsl_get_snapshot`.

### vsl_execute_action

Выполнить действие над элементом VSL.

**Параметры:**
- `action` (string, required) — имя действия: `click`, `type`, `fill` (алиас `type`), `scroll`, `select`, `hover`, `focus`, `blur`, `check`, `uncheck`, `press`
- `target_id` (string, required) — ID элемента в VSL JSON
- `value` (string, optional) — значение для действия (текст для `type`, опция для `select`)

**Возвращает:** результат выполнения действия.

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

Получить visual fragment для элемента (base64 WebP изображение).

**Параметры:**
- `element_id` (string, required) — ID элемента в VSL JSON

**Возвращает:** base64-изображение элемента.

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
- HTTP-путь возвращает VSL JSON с семантической структурой (без точных координат bbox)
- Render-путь возвращает полный VSL JSON с координатами для выполнения действий

**Возвращает:** VSL JSON структуру страницы (полный документ или diff).

### vsl_get_full_json

Получить полный VSL JSON, минуя diff-first логику Snapshot Session.

**Параметры:** нет.

**Используйте**, если история агента обрезалась и он не видит полную картину из инкрементальных диффов.

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
### Получение полного VSL JSON

Agent: vsl_get_full_json()
→ { vsl_version: "1.0.0", canvas: {...}, objects: [...] }
## Архитектура

┌─────────────────────────────────────────────┐
│  AI Agent (Claude Desktop / Cline / etc.)   │
└──────────────────┬──────────────────────────┘
                   │ MCP (JSON-RPC over stdio)
                   ▼
┌─────────────────────────────────────────────┐
│  @thinkingos/vsl-mcp-server                    │
│  ├── Tools (8): snapshot, diff, action,     │
│  │            navigate, cache, visual,      │
│  │            read_page, full_json          │
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