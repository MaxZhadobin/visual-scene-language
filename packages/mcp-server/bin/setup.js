#!/usr/bin/env node

/**
 * VSL MCP Server — интерактивный setup скрипт (v2).
 *
 * Бесшовная установка:
 *  1. Проверка Node.js >= 18
 *  2. Проверка/установка Playwright (chromium)
 *  3. Настройка API ключей для vision-backend (OpenAI / Anthropic / Custom)
 *  4. Валидация API ключа (тестовый запрос)
 *  5. Сохранение конфигурации в ~/.vsl/config.json
 *  6. Вывод инструкций для подключения к агенту
 *
 * Usage:
 *  # Из корня monorepo:
 *  node packages/mcp-server/bin/setup.js
 *  # Из директории packages/mcp-server:
 *  npm run setup
 */

import { createInterface } from 'readline';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(msg = '') { console.log(msg); }
function ok(msg) { log(`${C.green}✅ ${msg}${C.reset}`); }
function warn(msg) { log(`${C.yellow}⚠️  ${msg}${C.reset}`); }
function fail(msg) { log(`${C.red}❌ ${msg}${C.reset}`); }
function info(msg) { log(`${C.blue}ℹ️  ${msg}${C.reset}`); }
function step(n, msg) { log(`\n${C.bold}${C.cyan}Шаг ${n}.${C.reset} ${C.bold}${msg}${C.reset}`); }

// ─── Readline helpers ─────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askYesNo(question, defaultAnswer = 'y') {
  const suffix = defaultAnswer === 'y' ? '(Y/n)' : '(y/N)';
  const answer = await ask(`${question} ${suffix}: `);
  if (answer === '') return defaultAnswer === 'y';
  return answer.toLowerCase().startsWith('y');
}

async function askOptional(question) {
  const answer = await ask(`${question} ${C.dim}(оставьте пустым, чтобы пропустить)${C.reset}: `);
  return answer || null;
}

// ─── Step 1: Node.js version check ───────────────────────────────────────────

function checkNodeVersion() {
  step(1, 'Проверка Node.js');

  const major = parseInt(process.versions.node.split('.')[0], 10);
  const full = process.versions.node;

  if (major >= 18) {
    ok(`Node.js v${full} — подходит (>= 18)`);
    return true;
  } else {
    fail(`Node.js v${full} — требуется >= 18`);
    log(`   Установите Node.js 18+: ${C.dim}https://nodejs.org/${C.reset}`);
    log(`   Или используйте nvm: ${C.dim}nvm install 18 && nvm use 18${C.reset}`);
    return false;
  }
}

// ─── Step 2: Playwright check + install ──────────────────────────────────────

function checkPlaywrightInstalled() {
  try {
    // Проверяем, есть ли playwright в node_modules (локально или глобально)
    execSync('node -e "require(\'playwright\')"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkChromiumInstalled() {
  try {
    // Проверяем, установлен ли chromium браузер
    const result = execSync('npx playwright install --dry-run 2>&1 || true', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    // Если chromium уже установлен, playwright не будет его перечислять как missing
    // Альтернативный способ: пробуем запустить playwright и посмотреть список браузеров
    const browsers = execSync('npx playwright install --list 2>&1 || true', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return browsers.includes('chromium') && !browsers.includes('Missing');
  } catch {
    return false;
  }
}

async function setupPlaywright() {
  step(2, 'Playwright (для браузерных инструментов)');

  // Проверяем, установлен ли playwright как пакет
  const pwPackageInstalled = checkPlaywrightInstalled();

  if (!pwPackageInstalled) {
    info('Playwright не установлен как пакет');
    const installPw = await askYesNo('📦 Установить Playwright?');
    if (!installPw) {
      warn('Пропущено. Статические страницы (HTTP-режим) будут работать без Playwright.');
      info(`Установить позже: ${C.dim}npm install playwright && npx playwright install chromium${C.reset}`);
      return false;
    }

    log(`   ${C.dim}Устанавливаю playwright...${C.reset}`);
    try {
      execSync('npm install playwright', { stdio: 'inherit', timeout: 120000 });
      ok('Playwright пакет установлен');
    } catch (error) {
      fail(`Не удалось установить playwright: ${error.message}`);
      return false;
    }
  } else {
    ok('Playwright пакет уже установлен');
  }

  // Проверяем, установлен ли chromium браузер
  info('Проверяю браузер chromium...');
  try {
    // Просто пробуем установить — если уже установлен, playwright скажет "already installed"
    log(`   ${C.dim}npx playwright install chromium...${C.reset}`);
    execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 180000 });
    ok('Chromium готов');
  } catch (error) {
    warn(`Не удалось установить chromium: ${error.message}`);
    info(`Попробуйте вручную: ${C.dim}npx playwright install chromium${C.reset}`);
    return false;
  }

  return true;
}

// ─── Step 3: API config ──────────────────────────────────────────────────────

async function setupApiConfig() {
  step(3, 'Настройка vision-backend (API ключи)');

  log('   Vision-backend использует мультимодальные модели для классификации элементов.');
  log('   Поддерживаются: OpenAI, Anthropic, или любой OpenAI-compatible провайдер.\n');

  log('  1. OpenAI (gpt-6-luna)');
  log('  2. Anthropic (claude-haiku-4-5)');
  log('  3. Custom (любой OpenAI-compatible endpoint)');
  const choice = await ask('\nВаш выбор (1-3): ');

  let provider, apiKey, model, baseUrl;

  if (choice === '1') {
    provider = 'openai';
    model = 'gpt-6-luna';
    apiKey = await askOptional('🔑 OpenAI API Key (sk-...)');
    if (!apiKey) {
      // Проверяем env
      if (process.env.OPENAI_API_KEY) {
        apiKey = process.env.OPENAI_API_KEY;
        ok('Использую OPENAI_API_KEY из окружения');
      } else {
        warn('API ключ не указан. Vision-backend не будет работать.');
        return null;
      }
    }
  } else if (choice === '2') {
    provider = 'anthropic';
    model = 'claude-haiku-4-5';
    apiKey = await askOptional('🔑 Anthropic API Key (sk-ant-...)');
    if (!apiKey) {
      if (process.env.ANTHROPIC_API_KEY) {
        apiKey = process.env.ANTHROPIC_API_KEY;
        ok('Использую ANTHROPIC_API_KEY из окружения');
      } else {
        warn('API ключ не указан. Vision-backend не будет работать.');
        return null;
      }
    }
  } else if (choice === '3') {
    provider = 'custom';
    baseUrl = await ask('🌐 Base URL (например, https://api.together.xyz/v1): ');
    if (!baseUrl) {
      fail('Base URL обязателен для custom провайдера');
      return null;
    }
    apiKey = await ask('🔑 API Key: ');
    if (!apiKey) {
      fail('API Key обязателен для custom провайдера');
      return null;
    }
    model = await ask('🤖 Model name (например, qwen-vl-plus): ');
    if (!model) {
      fail('Model name обязателен для custom провайдера');
      return null;
    }
  } else {
    fail('Неверный выбор');
    return null;
  }

  return { provider, apiKey, model, baseUrl };
}

// ─── Step 4: API validation ──────────────────────────────────────────────────

async function validateApiKey(config) {
  step(4, 'Валидация API ключа');

  if (!config || !config.apiKey) {
    warn('Пропускаю валидацию — нет API ключа');
    return true;
  }

  info('Отправляю тестовый запрос...');

  try {
    let url, headers, body;

    if (config.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } else {
      // OpenAI или custom (OpenAI-compatible)
      url = config.provider === 'custom'
        ? `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
        : 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      };
      body = JSON.stringify({
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      ok('API ключ валиден, модель доступна');
      return true;
    } else if (response.status === 401 || response.status === 403) {
      fail(`Невалидный API ключ (HTTP ${response.status})`);
      const proceed = await askYesNo('Продолжить несмотря на ошибку?', 'n');
      return proceed;
    } else if (response.status === 404) {
      warn(`Модель "${config.model}" не найдена (HTTP 404). Проверьте название модели.`);
      const proceed = await askYesNo('Продолжить несмотря на ошибку?', 'n');
      return proceed;
    } else if (response.status === 429) {
      warn('Rate limit (HTTP 429) — ключ валиден, но превышен лимит запросов');
      ok('API ключ валиден');
      return true;
    } else {
      const text = await response.text().catch(() => '');
      warn(`Неожиданный ответ (HTTP ${response.status}): ${text.slice(0, 200)}`);
      const proceed = await askYesNo('Продолжить несмотря на ошибку?', 'n');
      return proceed;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      warn('Таймаут запроса (15с) — сеть недоступна или API не отвечает');
      const proceed = await askYesNo('Продолжить без валидации?', 'y');
      return proceed;
    }
    warn(`Ошибка валидации: ${error.message}`);
    const proceed = await askYesNo('Продолжить без валидации?', 'y');
    return proceed;
  }
}

// ─── Step 5: Save config ─────────────────────────────────────────────────────

function ensureConfigDir() {
  const configDir = join(homedir(), '.vsl');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

function loadOrCreateConfig(configPath) {
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      warn('Не удалось прочитать существующий config.json, создаю новый');
    }
  }
  return {};
}

function saveConfig(configPath, config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ─── Step 6: Output agent instructions ───────────────────────────────────────

function printAgentInstructions(visionConfig) {
  step(6, 'Подключение к агенту');

  const mcpServerPath = join(process.cwd(), 'dist', 'index.js');
  const hasLocalDist = existsSync(mcpServerPath);

  // Определяем env vars для конфига
  const envLines = [];
  if (visionConfig.provider === 'openai') {
    envLines.push(`OPENAI_API_KEY=${visionConfig.apiKey}`);
  } else if (visionConfig.provider === 'anthropic') {
    envLines.push(`ANTHROPIC_API_KEY=${visionConfig.apiKey}`);
  } else if (visionConfig.provider === 'custom') {
    envLines.push(`VSL_VISION_PROVIDER=custom`);
    envLines.push(`VSL_VISION_BASE_URL=${visionConfig.baseUrl}`);
    envLines.push(`VSL_VISION_API_KEY=${visionConfig.apiKey}`);
    envLines.push(`VSL_VISION_MODEL=${visionConfig.model}`);
  }

  const envJson = {};
  if (visionConfig.provider === 'openai') {
    envJson.OPENAI_API_KEY = visionConfig.apiKey;
  } else if (visionConfig.provider === 'anthropic') {
    envJson.ANTHROPIC_API_KEY = visionConfig.apiKey;
  } else if (visionConfig.provider === 'custom') {
    envJson.VSL_VISION_PROVIDER = 'custom';
    envJson.VSL_VISION_BASE_URL = visionConfig.baseUrl;
    envJson.VSL_VISION_API_KEY = visionConfig.apiKey;
    envJson.VSL_VISION_MODEL = visionConfig.model;
  }

  log('');
  log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  log(`${C.bold}  Настройка MCP-сервера в вашем агенте${C.reset}`);
  log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  log('');
  log(`${C.bold}Local (stdio) конфигурация:${C.reset}`);
  log('');
  log(`  ${C.bold}Server Name:${C.reset}  vsl`);

  if (hasLocalDist) {
    log(`  ${C.bold}Command:${C.reset}       node`);
    log(`  ${C.bold}Arguments:${C.reset}     ${mcpServerPath}`);
  } else {
    log(`  ${C.bold}Command:${C.reset}       npx`);
    log(`  ${C.bold}Arguments:${C.reset}     @vsl/mcp-server`);
  }

  if (envLines.length > 0) {
    log('');
    log(`  ${C.bold}Environment variables:${C.reset}`);
    for (const line of envLines) {
      log(`    ${line}`);
    }
  }

  log('');
  log(`${C.dim}── Или JSON-конфиг ──${C.reset}`);
  log('');

  const jsonConfig = {
    mcpServers: {
      vsl: {
        ...(hasLocalDist
          ? { command: 'node', args: [mcpServerPath] }
          : { command: 'npx', args: ['@vsl/mcp-server'] }),
        ...(Object.keys(envJson).length > 0 ? { env: envJson } : {}),
      },
    },
  };

  log(`  ${C.dim}${JSON.stringify(jsonConfig, null, 2).split('\n').join('\n  ')}${C.reset}`);

  log('');
  log(`${C.dim}── Куда вставить ──${C.reset}`);
  log('');
  log(`  ${C.bold}Cline:${C.reset}        VS Code → Settings → Cline → MCP Servers → Add Server`);
  log(`  ${C.bold}Claude Desktop:${C.reset} ~/Library/Application Support/Claude/claude_desktop_config.json`);
  log(`  ${C.bold}TaoCoder:${C.reset}     .taocoder/mcp.json`);
  log(`  ${C.bold}Cursor:${C.reset}       .cursor/mcp.json`);
  log('');
  log(`${C.dim}💡 Если вы настроили vision через ~/.vsl/config.json, env vars можно не указывать.${C.reset}`);
  log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('');
  log(`${C.bold}🚀 VSL MCP Server — установка${C.reset}`);
  log('');
  log('Этот скрипт поможет вам:');
  log('  1. Проверить Node.js');
  log('  2. Установить Playwright (для браузерных инструментов)');
  log('  3. Настроить API ключи для vision-backend');
  log('  4. Проверить работоспособность API');
  log('  5. Сохранить конфигурацию');
  log('  6. Получить инструкции для подключения к агенту');
  log('');

  // Шаг 1: Node.js
  if (!checkNodeVersion()) {
    process.exit(1);
  }

  // Шаг 2: Playwright
  await setupPlaywright();

  // Шаг 3: API config
  const visionConfig = await setupApiConfig();

  // Шаг 4: Валидация
  if (visionConfig) {
    await validateApiKey(visionConfig);
  }

  // Шаг 5: Сохранение конфига
  step(5, 'Сохранение конфигурации');

  const configPath = join(ensureConfigDir(), 'config.json');
  const config = loadOrCreateConfig(configPath);

  if (visionConfig) {
    config.vision = {
      provider: visionConfig.provider,
      model: visionConfig.model,
      apiKey: visionConfig.apiKey,
      ...(visionConfig.baseUrl ? { baseUrl: visionConfig.baseUrl } : {}),
    };
    saveConfig(configPath, config);
    ok(`Конфигурация сохранена: ${configPath}`);
  } else {
    warn('Vision-backend не настроен. Вы можете настроить его позже.');
    info(`Через config file: ${C.dim}~/.vsl/config.json${C.reset}`);
    info(`Через env vars: ${C.dim}VSL_VISION_PROVIDER, VSL_VISION_BASE_URL, VSL_VISION_API_KEY, VSL_VISION_MODEL${C.reset}`);
  }

  // Шаг 6: Инструкции
  if (visionConfig) {
    printAgentInstructions(visionConfig);
  }

  // Финал
  log(`${C.bold}✨ Готово!${C.reset}`);
  log('');
  log('Далее:');
  log(`  1. Добавьте MCP-сервер в ваш агент (инструкции выше)`);
  log(`  2. Перезапустите агент`);
  log(`  3. Используйте инструменты: vsl_read_page, vsl_get_snapshot, vsl_execute_action, ...`);
  log('');

  rl.close();
}

// Запуск
main().catch((error) => {
  fail(`Ошибка: ${error.message}`);
  rl.close();
  process.exit(1);
});