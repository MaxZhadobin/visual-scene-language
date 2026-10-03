#!/usr/bin/env node

/**
 * VSL MCP Server — интерактивный setup скрипт (v2).
 *
 * Бесшовная установка:
 *  1. Проверка Node.js >= 18
 *  2. Проверка/установка Playwright (chromium)
 *  3. Сохранение конфигурации в ~/.vsl/config.json
 *  4. Вывод инструкций для подключения к агенту
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
function step(n, msg) { log(`\n${C.bold}${C.cyan}Step ${n}.${C.reset} ${C.bold}${msg}${C.reset}`); }

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


// ─── Step 1: Node.js version check ───────────────────────────────────────────

function checkNodeVersion() {
  step(1, 'Checking Node.js');

  const major = parseInt(process.versions.node.split('.')[0], 10);
  const full = process.versions.node;

  if (major >= 18) {
    ok(`Node.js v${full} — OK (>= 18)`);
    return true;
  } else {
    fail(`Node.js v${full} — requires >= 18`);
    log(`   Install Node.js 18+: ${C.dim}https://nodejs.org/${C.reset}`);
    log(`   Or use nvm: ${C.dim}nvm install 18 && nvm use 18${C.reset}`);
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function checkChromiumInstalled() {
  try {
    // Проверяем, установлен ли chromium браузер
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  step(2, 'Playwright (for browser tools)');

  // Проверяем, установлен ли playwright как пакет
  const pwPackageInstalled = checkPlaywrightInstalled();

  if (!pwPackageInstalled) {
    info('Playwright is not installed as a package');
    const installPw = await askYesNo('📦 Install Playwright?');
    if (!installPw) {
      warn('Skipped. Static pages (HTTP mode) will work without Playwright.');
      info(`Install later: ${C.dim}npm install playwright && npx playwright install chromium${C.reset}`);
      return false;
    }

    log(`   ${C.dim}Installing playwright...${C.reset}`);
    try {
      execSync('npm install playwright', { stdio: 'inherit', timeout: 120000 });
      ok('Playwright package installed');
    } catch (error) {
      fail(`Failed to install playwright: ${error.message}`);
      return false;
    }
  } else {
    ok('Playwright package is already installed');
  }

  // Проверяем, установлен ли chromium браузер
  info('Checking chromium browser...');
  try {
    // Просто пробуем установить — если уже установлен, playwright скажет "already installed"
    log(`   ${C.dim}npx playwright install chromium...${C.reset}`);
    execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 180000 });
    ok('Chromium is ready');
  } catch (error) {
    warn(`Failed to install chromium: ${error.message}`);
    info(`Try manually: ${C.dim}npx playwright install chromium${C.reset}`);
    return false;
  }

  return true;
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
      warn('Failed to read existing config.json, creating a new one');
    }
  }
  return {};
}

function saveConfig(configPath, config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ─── Step 6: Output agent instructions ───────────────────────────────────────

function printAgentInstructions(visionConfig) {
  step(6, 'Connecting to your agent');

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
  log(`${C.bold}  Configure MCP server in your agent${C.reset}`);
  log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  log('');
  log(`${C.bold}Local (stdio) configuration:${C.reset}`);
  log('');
  log(`  ${C.bold}Server Name:${C.reset}  vsl`);

  if (hasLocalDist) {
    log(`  ${C.bold}Command:${C.reset}       node`);
    log(`  ${C.bold}Arguments:${C.reset}     ${mcpServerPath}`);
  } else {
    log(`  ${C.bold}Command:${C.reset}       npx`);
    log(`  ${C.bold}Arguments:${C.reset}     @thinkingos/vsl-mcp-server`);
  }

  if (envLines.length > 0) {
    log('');
    log(`  ${C.bold}Environment variables:${C.reset}`);
    for (const line of envLines) {
      log(`    ${line}`);
    }
  }

  log('');
  log(`${C.dim}── Or JSON config ──${C.reset}`);
  log('');

  const jsonConfig = {
    mcpServers: {
      vsl: {
        ...(hasLocalDist
          ? { command: 'node', args: [mcpServerPath] }
          : { command: 'npx', args: ['@thinkingos/vsl-mcp-server'] }),
        ...(Object.keys(envJson).length > 0 ? { env: envJson } : {}),
      },
    },
  };

  log(`  ${C.dim}${JSON.stringify(jsonConfig, null, 2).split('\n').join('\n  ')}${C.reset}`);

  log('');
  log(`${C.dim}── Where to paste ──${C.reset}`);
  log('');
  log(`  ${C.bold}Cline:${C.reset}        VS Code → Settings → Cline → MCP Servers → Add Server`);
  log(`  ${C.bold}Claude Desktop:${C.reset} ~/Library/Application Support/Claude/claude_desktop_config.json`);
  log(`  ${C.bold}TaoCoder:${C.reset}     .taocoder/mcp.json`);
  log(`  ${C.bold}Cursor:${C.reset}       .cursor/mcp.json`);
  log('');
  log(`${C.dim}💡 If you configured vision via ~/.vsl/config.json, you don\'t need to specify env vars.${C.reset}`);
  log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('');
  log(`${C.bold}🚀 VSL MCP Server — Setup${C.reset}`);
  log('');
  log('This script will help you:');
  log('  1. Check Node.js');
  log('  2. Install Playwright (for browser tools)');
  log('  3. Save configuration');
  log('  4. Get instructions for connecting to your agent');
  log('');

  // Шаг 1: Node.js
  if (!checkNodeVersion()) {
    process.exit(1);
  }

  // Шаг 2: Playwright
  await setupPlaywright();

  // Шаг 3: Сохранение конфига
  step(3, 'Saving configuration');

  const configPath = join(ensureConfigDir(), 'config.json');
  const config = loadOrCreateConfig(configPath);
  saveConfig(configPath, config);
  ok(`Configuration saved: ${configPath}`);

  // Шаг 4: Инструкции
  printAgentInstructions(null);

  // Финал
  log(`${C.bold}✨ Done!${C.reset}`);
  log('');
  log('Next steps:');
  log(`  1. Add the MCP server to your agent (instructions above)`);
  log(`  2. Restart your agent`);
  log(`  3. Use tools: vsl_read_page, vsl_get_snapshot, vsl_execute_action, ...`);
  log('');

  rl.close();
}

// Запуск
main().catch((error) => {
  fail(`Error: ${error.message}`);
  rl.close();
  process.exit(1);
});