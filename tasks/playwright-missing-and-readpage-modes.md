# Playwright Missing in MCP Server Environment & vsl_read_page Modes

## Problem Statement

Пользователь столкнулся с двумя проблемами:

1. **Playwright не установлен в окружении MCP server** — хотя при установке пакета он должен был установиться
2. **Неясность с режимами vsl_read_page** — в описании инструмента упоминаются `mode=auto/http/render`, но пользователь подозревает, что режимов больше нет

## Root Cause Analysis

### Проблема 1: Playwright отсутствует

**Корневая причина:** Playwright НЕ входит в зависимости пакета `@thinkingos/vsl-mcp-server`.

**Доказательства:**

1. **package.json** (`packages/mcp-server/package.json:32-44`):
   - `dependencies`: только `@modelcontextprotocol/sdk`, `@thinkingos/vsl-sdk`, `cheerio`
   - `devDependencies`: только инструменты разработки (jest, tsup, typescript)
   - **Отсутствует:** `playwright` в `dependencies`, `peerDependencies`, `optionalDependencies`

2. **tsup.config.ts** (`packages/mcp-server/tsup.config.ts:11`):
      external: ['playwright', 'playwright-core', 'chromium-bidi']
      Playwright помечен как external — не бандлится в dist.

3. **Механизм подключения Playwright** (`packages/mcp-server/src/browser/manager.ts:84-104`):
      private async loadPlaywright(): Promise<PlaywrightModule | null> {
     if (this.playwright) return this.playwright;
     // Динамический импорт — Playwright optional peer dependency
     const pw = await import('playwright');
     this.playwright = pw as unknown as PlaywrightModule;
     return this.playwright;
   } catch {
     throw new Error(
       'Playwright is not installed. Install it with: npm install playwright\n' +
       'Or use vsl_read_page with mode="http" for static pages (no browser required).'
     );
   }
      Playwright загружается динамически через `import('playwright')`. Если его нет — выбрасывается ошибка.

4. **Setup скрипт** (`packages/mcp-server/bin/setup.js:122-163`):
   - Устанавливает Playwright через интерактивный процесс: `npm install playwright && npx playwright install chromium`
   - Но setup запускается ТОЛЬКО вручную, не при `npm install -g`

**Почему Playwright "пропадает":**

MCP server подключён через глобальную npm установку:
node /opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server/dist/index.js
При `npm install -g @thinkingos/vsl-mcp-server`:
- Устанавливаются только зависимости из `package.json`
- Playwright НЕ устанавливается, т.к. его нет в зависимостях
- Setup скрипт не запускается автоматически

**Результат:** Playwright физически отсутствует в `/opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server/node_modules/`.

Проверка подтвердила:
$ cd packages/mcp-server && npm ls playwright
@thinkingos/vsl-mcp-server@0.2.0
└── (empty)
playwright NOT in npm tree
### Проблема 2: Устаревшее описание vsl_read_page

**Корневая причина:** Описание инструмента в `tools/index.ts` не соответствует реальному интерфейсу.

**Доказательства:**

1. **Реальный интерфейс** (`packages/mcp-server/src/tools/readPage.ts:22-26`):
      export interface ReadPageArgs {
     url: string;
     readable?: boolean;
   }
      **Параметра `mode` НЕТ.** Только `url` и `readable`.

2. **Устаревшее описание** (`packages/mcp-server/src/tools/index.ts:119-121`):
      name: 'vsl_read_page',
   description: 'Гибридное чтение веб-страниц. mode=auto (по умолчанию): статические страницы читаются через HTTP (быстро), SPA рендерятся через браузер. mode=http: только HTTP (без браузера). mode=render: всегда рендерить через браузер. readable=true: фильтрует шум (навигация, футеры, cookie-баннеры) для чистого контента. При повторных вызовах возвращает diff (изменения), а не полный контент. Пример: {url:https://example.com, mode:auto, readable:true}.',
      Описание упоминает `mode=auto/http/render`, но этого параметра больше нет.

3. **История изменений:** Параметр `mode` был удалён по решению DEC-024 (автоматическое определение режима без участия агента).

**Реальное поведение vsl_read_page:**

Согласно `readPage.ts:55-163`:
- Агент НЕ выбирает режим — система определяет его автоматически
- **HTTP-first:** сначала пытается получить контент через HTTP (`extractViaHttp`)
- **Автоматическое переключение:** если обнаружена SPA или HTTP не сработал — переключается на render через браузер
- **Readable filter:** опциональная фильтрация шума (навигация, футеры, cookie-баннеры)

**Вывод:** Режимов нет — есть автоматическое определение стратегии. Агент должен вызывать инструмент только с `url` и опционально `readable`.

## Impact

### Проблема 1: Playwright отсутствует

**Критичность:** HIGH

**Последствия:**
- Все браузерные инструменты не работают:
  - `vsl_get_snapshot` — требует браузер
  - `vsl_execute_action` — требует браузер
  - `vsl_navigate` — требует браузер
  - `vsl_get_visual` — требует браузер
  - `vsl_read_page` — частично работает (только HTTP-путь для статических страниц)

**Workaround:**
- Статические страницы можно читать через HTTP-путь `vsl_read_page` (без браузера)
- Для браузерных инструментов нужно вручную установить Playwright:
    cd /opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server
  npm install playwright
  npx playwright install chromium
  ### Проблема 2: Устаревшее описание

**Критичность:** MEDIUM

**Последствия:**
- Агент получает неверную информацию о параметрах инструмента
- Может пытаться передать параметр `mode`, который игнорируется
- Путаница у пользователей и разработчиков

## Proposed Fixes

### Fix 1: Добавить Playwright в зависимости

**Вариант A: Optional Dependencies (рекомендуется)**

Добавить в `packages/mcp-server/package.json`:
{
  "optionalDependencies": {
    "playwright": "^1.40.0"
  }
}
**Плюсы:**
- Playwright устанавливается автоматически при `npm install -g`
- Не блокирует установку, если Playwright не может быть установлен (например, в CI)
- Соответствует архитектуре "Playwright is optional"

**Минусы:**
- Увеличивает размер пакета (~200MB с браузерами)

**Вариант B: Peer Dependencies + Setup Script**

Добавить в `packages/mcp-server/package.json`:
{
  "peerDependencies": {
    "playwright": "^1.40.0"
  },
  "peerDependenciesMeta": {
    "playwright": {
      "optional": true
    }
  }
}
Обновить `bin/setup.js` для автоматического запуска при первой попытке использовать браузерные инструменты.

**Плюсы:**
- Не увеличивает размер пакета
- Пользователь явно устанавливает Playwright

**Минусы:**
- Требует дополнительных действий от пользователя
- Может быть неочевидно, почему браузерные инструменты не работают

**Рекомендация:** Вариант A (optionalDependencies) — обеспечивает best UX, Playwright устанавливается автоматически.

### Fix 2: Обновить описание vsl_read_page

Обновить `packages/mcp-server/src/tools/index.ts:119-121`:

{
  name: 'vsl_read_page',
  description: 'Гибридное чтение веб-страниц с автоматическим определением стратегии. Статические страницы читаются через HTTP (быстро), SPA автоматически рендерятся через браузер. readable=true: фильтрует шум (навигация, футеры, cookie-баннеры) для чистого контента. При повторных вызовах возвращает diff (изменения), а не полный контент. Пример: {url: "https://example.com", readable: true}.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL страницы для чтения'
      },
      readable: {
        type: 'boolean',
        description: 'Readable-режим: фильтрация шума (nav, footer, cookie banners) для чистого контента'
      }
    },
    required: ['url']
  }
}
**Изменения:**
- Удалены упоминания `mode=auto/http/render`
- Добавлено пояснение "автоматическое определение стратегии"
- Обновлён пример (убран `mode`)

## Implementation Plan

### Phase 1: Fix Playwright Dependencies

1. **Обновить `packages/mcp-server/package.json`:**
   - Добавить `optionalDependencies` с `playwright: "^1.40.0"`

2. **Обновить `packages/mcp-server/README.md`:**
   - Добавить секцию "Browser Tools Setup"
   - Объяснить, что Playwright устанавливается автоматически
   - Указать manual installation команды для troubleshooting

3. **Протестировать установку:**
      cd packages/mcp-server
   npm install
   npm ls playwright
   # Ожидается: playwright установлен
   4. **Пересобрать и опубликовать:**
      npm run build
   npm publish
   5. **Обновить глобальную установку:**
      npm install -g @thinkingos/vsl-mcp-server@latest
   ### Phase 2: Fix vsl_read_page Description

1. **Обновить `packages/mcp-server/src/tools/index.ts`:**
   - Заменить описание `vsl_read_page` (строки 119-121)
   - Убрать упоминания `mode`
   - Обновить пример

2. **Обновить тесты (если есть):**
   - Проверить `packages/mcp-server/src/tools/readPage.test.ts`
   - Убедиться, что тесты не используют параметр `mode`

3. **Пересобрать и опубликовать:**
      npm run build
   npm publish
   ### Phase 3: Verification

1. **Проверить установку Playwright:**
      cd /opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server
   npm ls playwright
   # Ожидается: playwright@1.40.0+
   2. **Протестировать браузерные инструменты:**
   - `vsl_get_snapshot` — должен работать
   - `vsl_navigate` — должен работать
   - `vsl_execute_action` — должен работать

3. **Протестировать vsl_read_page:**
   - Вызвать без `mode`: `{url: "https://example.com"}`
   - Убедиться, что работает HTTP-путь для статических страниц
   - Убедиться, что работает render-путь для SPA

4. **Проверить описание инструмента:**
   - Запустить MCP server
   - Проверить список инструментов — описание `vsl_read_page` должно быть обновлено

## Acceptance Criteria

- [ ] Playwright установлен в `optionalDependencies` пакета `@thinkingos/vsl-mcp-server`
- [ ] При `npm install -g @thinkingos/vsl-mcp-server` Playwright устанавливается автоматически
- [ ] Браузерные инструменты (`vsl_get_snapshot`, `vsl_navigate`, `vsl_execute_action`, `vsl_get_visual`) работают после установки
- [ ] Описание `vsl_read_page` обновлено — убраны упоминания `mode=auto/http/render`
- [ ] Пример вызова `vsl_read_page` обновлён — только `url` и `readable`
- [ ] Все существующие тесты проходят
- [ ] Обратная совместимость сохранена — старый код с параметром `mode` не ломается (параметр игнорируется)

## Constraints

- Не ломать существующую функциональность MCP server
- Обеспечить обратную совместимость — если кто-то передаёт параметр `mode`, он должен игнорироваться без ошибки
- Не увеличивать время запуска MCP server
- Playwright должен оставаться optional — если он не может быть установлен, HTTP-путь должен работать

## References

- `packages/mcp-server/package.json:32-44` — зависимости пакета
- `packages/mcp-server/src/tools/readPage.ts:22-26` — реальный интерфейс ReadPageArgs
- `packages/mcp-server/src/tools/index.ts:119-121` — устаревшее описание инструмента
- `packages/mcp-server/src/browser/manager.ts:84-104` — механизм загрузки Playwright
- `packages/mcp-server/tsup.config.ts:11` — Playwright помечен как external
- `packages/mcp-server/bin/setup.js:122-163` — setup скрипт для ручной установки

## Notes

- Параметр `mode` был удалён по решению DEC-024 (автоматическое определение режима)
- Playwright помечен как `external` в tsup.config.ts — не бандлится в dist
- MCP server подключён через глобальную npm установку: `/opt/homebrew/lib/node_modules/@thinkingos/vsl-mcp-server/`
- Setup скрипт (`bin/setup.js`) не запускается автоматически при `npm install -g`