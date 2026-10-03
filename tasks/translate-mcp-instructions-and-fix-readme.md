# Перевод MCP tool/resource descriptions на английский + README installation section + setup.js

## Проблема

1. **README.md** — секция `## Installation` содержит только `npm install @thinkingos/vsl-sdk`. Отсутствует блок с инструкциями по установке MCP-сервера (npm install + setup + подключение к агенту).

2. **MCP tool descriptions** — все 8 инструментов в `packages/mcp-server/src/tools/index.ts` (L34-195) имеют описания и parameter descriptions на **русском языке**. Это то, что видит AI-агент при подключении к MCP-серверу. Англоязычные агенты не смогут понять инструкции.

3. **MCP resource descriptions** — 2 ресурса в `packages/mcp-server/src/resources/index.ts` (L23-36) тоже на русском.

4. **npm setup script** — `packages/mcp-server/bin/setup.js` (322 строки) выводит все сообщения на русском (шаги, вопросы, инструкции). **Решено: перевести на английский.**

## Контекст

- MCP-сервер — это публичный пакет `@thinkingos/vsl-mcp-server`, который подключают AI-агенты (Claude Desktop, Cline, TaoCoder, Cursor)
- Tool descriptions — это интерфейс между сервером и LLM-агентом. Агент видит их при `tools/list` и использует для принятия решений
- README.md — основная документация проекта на GitHub
- setup.js — интерактивный CLI-скрипт, который видит пользователь при установке через npm

## Требования

### 1. README.md — добавить секцию установки MCP

Добавить после текущей `## Installation` (или расширить её) блок с:
- Установкой MCP-сервера: `npm install @thinkingos/vsl-mcp-server`
- Запуском setup: `npx @thinkingos/vsl-mcp-server setup` или `node packages/mcp-server/bin/setup.js`
- JSON-конфигом для подключения к агенту (Cline, Claude Desktop, TaoCoder, Cursor)
- Упоминанием env vars для vision API

### 2. Перевод MCP tool descriptions на английский

**Файл:** `packages/mcp-server/src/tools/index.ts` (L34-195)

Перевести на английский:
- `description` всех 8 инструментов (vsl_get_snapshot, vsl_execute_action, vsl_navigate, vsl_clear_cache, vsl_get_visual, vsl_read_page, vsl_get_text_block, vsl_click_coordinates)
- `description` всех параметров в `inputSchema.properties` для каждого инструмента

**НЕ переводить:**
- Комментарии в коде (они для разработчиков)
- README.md, ARCHITECTURE.md и другие доки
- README_AI.md

### 3. Перевод MCP resource descriptions на английский

**Файл:** `packages/mcp-server/src/resources/index.ts` (L23-36)

Перевести `description` для:
- `vsl://current` — "Текущий VSL snapshot страницы..."
- `vsl://diff` — "Последний VSL diff..."

### 4. npm setup script — перевести на английский

**Файл:** `packages/mcp-server/bin/setup.js` (322 строки)

Перевести все пользовательские сообщения на английский:
- `step()` вызовы: "Проверка Node.js" → "Checking Node.js"
- `ok()`, `warn()`, `fail()`, `info()` вызовы
- Вопросы в `ask()` и `askYesNo()`
- Инструкции по подключению к агенту (JSON-конфиги)
- Финальные сообщения

**НЕ переводить:**
- Комментарии в коде (JSDoc, inline comments)
- Названия переменных, функции, структуру кода

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `README.md` | Добавить секцию MCP installation |
| `packages/mcp-server/src/tools/index.ts` | Перевести tool descriptions + parameter descriptions → EN |
| `packages/mcp-server/src/resources/index.ts` | Перевести resource descriptions → EN |
| `packages/mcp-server/bin/setup.js` | Перевести все пользовательские сообщения → EN |

## Acceptance Criteria

- [ ] README.md содержит секцию с инструкциями по установке MCP-сервера через npm (install + setup + agent config)
- [ ] Все 8 MCP tool descriptions переведены на английский
- [ ] Все parameter descriptions в inputSchema переведены на английский
- [ ] Оба MCP resource description переведены на английский
- [ ] npm setup script: все пользовательские сообщения переведены на английский

## Constraints

- НЕ переводить весь проект, все доки, README_AI.md
- Переводить ТОЛЬКО: MCP tool/resource descriptions (то, что видит агент) + setup.js сообщения (то, что видит пользователь при установке)
- Сохранять техническую точность: ID, параметры, примеры кода не менять
- README.md уже на английском — новая секция тоже на английском
- Комментарии в коде НЕ переводить (они для разработчиков)