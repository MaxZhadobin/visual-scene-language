# E2E Tests (T1.5.6)

Playwright e2e-тесты Chrome Extension с реальным Chromium.

## Структура

e2e/
├── fixtures/
│   ├── server.mjs          — HTTP-сервер fixture-страниц (порт 3456)
│   ├── registration.html   — форма регистрации
│   ├── ecommerce.html      — каталог товаров + корзина
│   └── settings.html       — страница настроек (language, theme)
├── extension.spec.ts       — e2e-тесты extension (Test A + 3 gated сценария)
├── playwright.config.ts    — конфигурация Playwright (webServer, extension)
└── README.md               — этот файл
## Запуск

### Test A (без API-ключей)

Проверяет, что extension загружается, content script инжектится, service worker жив.

npx playwright test e2e/extension.spec.ts -g "snapshot round-trip"
### 3 demo-сценария (gated API-ключом)

Требует `OPENAI_API_KEY` или `ANTHROPIC_API_KEY` в окружении.

# OpenAI
OPENAI_API_KEY=sk-... npx playwright test e2e/extension.spec.ts -g "demo scenarios"

# Anthropic
ANTHROPIC_API_KEY=sk-ant-... npx playwright test e2e/extension.spec.ts -g "demo scenarios"
Сценарии:
1. **Registration** — заполнить форму (имя, email, пароль) и отправить
2. **E-commerce** — добавить товар (Mechanical Keyboard) в корзину
3. **Settings** — сменить язык на Russian и сохранить

### Все e2e-тесты

npx playwright test
## Ручная инструкция

### Предварительные требования

1. Собрать extension:
      npm run build:extension
   2. Установить Playwright Chromium:
      npx playwright install chromium
   ### Ручной запуск 3 сценариев

1. Запустить fixture-сервер:
      node e2e/fixtures/server.mjs
   2. Открыть Chrome с загруженным extension:
      chrome --load-extension=extension/dist
      (или через `chrome://extensions` → Developer mode → Load unpacked → выбрать `extension/dist`)

3. Открыть fixture-страницу: `http://localhost:3456/registration.html`

4. Кликнуть на иконку extension → popup:
   - Goal: `Fill the registration form with name "John Doe", email "john@example.com", password "secret123" and submit`
   - Provider: `openai` (или `anthropic`)
   - API Key: ваш ключ
   - Click **Start**

5. Наблюдать за выполнением: агент заполнит форму и нажмёт Submit.

6. Повторить для `ecommerce.html` (goal: `Add the Mechanical Keyboard to the cart`) и `settings.html` (goal: `Change the language to Russian and save settings`).

## Ограничения

- **Headed mode**: extensions требуют headed Chromium (не headless).
- **Extension ID**: определяется автоматически из service worker URL.
- **file:// не используется**: content scripts `<all_urls>` не инжектятся на `file://` без 'Allow access to file URLs' (MV3).
- **Gated тесты**: auto-skip без API-ключей (OPENAI_API_KEY или ANTHROPIC_API_KEY).