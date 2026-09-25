/**
 * Playwright configuration for e2e tests (T1.5.6, dev_11).
 *
 * WebServer: локальный HTTP-сервер на node:http (e2e/fixtures/server.ts),
 * раздающий 3 fixture-страницы (registration, e-commerce, settings).
 * file:// НЕ используется: content scripts <all_urls> не инжектятся на file://
 * без 'Allow access to file URLs' (MV3).
 *
 * Extension: launchPersistentContext с --load-extension=extension/dist,
 * channel 'chromium' (требование MV3 service worker).
 *
 * Gated-тесты: OPENAI_API_KEY/ANTHROPIC_API_KEY — test.skip без ключей.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // extension tests share browser profile
  reporter: [['list']],
  use: {
    headless: false, // extensions require headed mode
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'node e2e/fixtures/server.mjs',
    port: 3456,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});