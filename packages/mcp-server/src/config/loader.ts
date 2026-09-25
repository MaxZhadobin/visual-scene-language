/**
 * Загрузчик конфигурации MCP Server (T1.6.2).
 *
 * Источники конфигурации (приоритет от высокого к низкому):
 *  1. Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY)
 *  2. Config file (~/.vsl/config.json) — опционально
 *  3. Defaults — значения по умолчанию
 *
 * Конфигурация включает:
 *  - Vision provider (openai/anthropic/custom)
 *  - Vision model (gpt-6-luna, claude-haiku-4-5, или кастомная)
 *  - API keys для каждого провайдера
 *  - Browser settings для vsl_read_page (headless, timeout)
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Поддерживаемые vision-провайдеры. 'custom' — любой OpenAI-compatible endpoint (Qwen, Together AI, Groq, OpenRouter, Ollama и т.д.). */
export type VisionProvider = 'openai' | 'anthropic' | 'custom';

/** Конфигурация vision-провайдера. */
export interface VisionConfig {
  /** Провайдер vision API. */
  provider: VisionProvider;
  /** Модель vision API. */
  model: string;
  /** API-ключ провайдера. */
  apiKey: string;
  /** Base URL API (опционально, для кастомных endpoints). */
  baseUrl?: string;
}

/** Конфигурация браузера для vsl_read_page. */
export interface BrowserConfig {
  /** Headless mode (по умолчанию true). */
  headless: boolean;
  /** Timeout для навигации (мс, по умолчанию 30000). */
  navigationTimeout: number;
  /** Timeout для рендеринга (мс, по умолчанию 10000). */
  renderTimeout: number;
  /** Путь для сохранения загруженных файлов (по умолчанию ~/.vsl/downloads). */
  downloadsPath?: string;
  /** Timeout для ожидания завершения загрузки (мс, по умолчанию 60000). */
  downloadTimeout?: number;
  /** Разрешить скачивание файлов (по умолчанию true). */
  acceptDownloads?: boolean;
}

/** Полная конфигурация MCP Server. */
export interface McpServerConfig {
  /** Vision provider configuration. */
  vision: VisionConfig;
  /** Browser configuration for vsl_read_page. */
  browser: BrowserConfig;
  /** API keys для всех провайдеров (из env vars). */
  apiKeys: {
    openai?: string;
    anthropic?: string;
  };
}

/** Путь к config file по умолчанию. */
const DEFAULT_CONFIG_PATH = join(homedir(), '.vsl', 'config.json');

/** Значения по умолчанию для vision models. */
const DEFAULT_VISION_MODELS: Record<VisionProvider, string> = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-4-5',
  custom: '', // Пользователь должен указать модель для custom провайдера
};

/** Значения по умолчанию для browser. */
const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  navigationTimeout: 30000,
  renderTimeout: 10000,
  downloadsPath: join(homedir(), '.vsl', 'downloads'),
  downloadTimeout: 60000,
  acceptDownloads: true,
};

/**
 * Загружает конфигурацию из env vars и config file.
 *
 * Приоритет:
 *  1. Env vars (VSL_VISION_PROVIDER, VSL_VISION_MODEL, etc.)
 *  2. Config file (~/.vsl/config.json)
 *  3. Defaults
 */
export function loadConfig(): McpServerConfig {
  // 1. Загружаем config file (если существует)
  const fileConfig = loadConfigFile();

  // 2. API keys из env vars
  const apiKeys = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };

  // 3. Vision provider: env > config file > default
  const provider = (
    process.env.VSL_VISION_PROVIDER ||
    fileConfig.vision?.provider ||
    'openai'
  ) as VisionProvider;

  // 4. Vision model: env > config file > default для провайдера
  const model =
    process.env.VSL_VISION_MODEL ||
    fileConfig.vision?.model ||
    DEFAULT_VISION_MODELS[provider];

  // 5. API key для выбранного провайдера (для custom — из config file)
  const apiKey = provider === 'custom' ? (fileConfig.vision?.apiKey || '') : (apiKeys[provider] || '');

  // 6. Base URL (опционально)
  const baseUrl = process.env.VSL_VISION_BASE_URL || fileConfig.vision?.baseUrl;

  // 7. Browser config: env > config file > defaults
  const browser: BrowserConfig = {
    headless: process.env.VSL_BROWSER_HEADLESS
      ? process.env.VSL_BROWSER_HEADLESS === 'true'
      : (fileConfig.browser?.headless ?? DEFAULT_BROWSER_CONFIG.headless),
    navigationTimeout:
      process.env.VSL_NAVIGATION_TIMEOUT
        ? parseInt(process.env.VSL_NAVIGATION_TIMEOUT, 10)
        : (fileConfig.browser?.navigationTimeout ?? DEFAULT_BROWSER_CONFIG.navigationTimeout),
    renderTimeout:
      process.env.VSL_RENDER_TIMEOUT
        ? parseInt(process.env.VSL_RENDER_TIMEOUT, 10)
        : (fileConfig.browser?.renderTimeout ?? DEFAULT_BROWSER_CONFIG.renderTimeout),
    downloadsPath:
      process.env.VSL_DOWNLOADS_PATH ||
      fileConfig.browser?.downloadsPath ||
      DEFAULT_BROWSER_CONFIG.downloadsPath,
    downloadTimeout:
      process.env.VSL_DOWNLOAD_TIMEOUT
        ? parseInt(process.env.VSL_DOWNLOAD_TIMEOUT, 10)
        : (fileConfig.browser?.downloadTimeout ?? DEFAULT_BROWSER_CONFIG.downloadTimeout),
    acceptDownloads:
      process.env.VSL_ACCEPT_DOWNLOADS
        ? process.env.VSL_ACCEPT_DOWNLOADS === 'true'
        : (fileConfig.browser?.acceptDownloads ?? DEFAULT_BROWSER_CONFIG.acceptDownloads),
  };

  return {
    vision: {
      provider,
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    },
    browser,
    apiKeys,
  };
}

/**
 * Загружает config file из ~/.vsl/config.json.
 * Возвращает пустой объект, если файл не существует.
 */
function loadConfigFile(): Partial<McpServerConfig> {
  if (!existsSync(DEFAULT_CONFIG_PATH)) {
    return {};
  }

  try {
    const content = readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
    return JSON.parse(content) as Partial<McpServerConfig>;
  } catch (error) {
    console.error(`[VSL MCP Server] Failed to load config file: ${error}`);
    return {};
  }
}