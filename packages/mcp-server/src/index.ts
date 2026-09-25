#!/usr/bin/env node

/**
 * VSL MCP Server — точка входа (T1.6.2).
 *
 * MCP Protocol (JSON-RPC over stdio) для интеграции VSL с AI-агентами
 * (Claude Desktop, Cline, TaoCoder). Стандарт: MCP 2025-11-25.
 *
 * Архитектура:
 *  - StdioServerTransport — транспорт JSON-RPC over stdio
 *  - Server — ядро MCP SDK, обработка handshake и запросов
 *  - Tools — 7 инструментов (vsl_get_snapshot, vsl_get_diff, vsl_execute_action,
 *    vsl_navigate, vsl_clear_cache, vsl_get_visual, vsl_read_page)
 *  - Resources — vsl://current, vsl://diff с подпиской на изменения
 *  - Config — env vars + optional ~/.vsl/config.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config/loader.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { BrowserManager } from './browser/manager.js';
import { ServerSession } from './session/serverSession.js';
import { VSL_MCP_SERVER_VERSION } from './version.js';

/**
 * Создаёт и запускает MCP Server.
 *
 * Lifecycle:
 *  1. Загрузка конфигурации (env + config file)
 *  2. Создание Server с metadata (name, version, capabilities)
 *  3. Регистрация handlers: tools, resources
 *  4. Подключение транспорта (stdio)
 *  5. Ожидание запросов от клиента
 */
async function main(): Promise<void> {
  // 1. Загрузка конфигурации
  const config = loadConfig();

  // 2. Создание shared singleton'ов
  const browser = new BrowserManager(config.browser);
  const session = new ServerSession();

  // 3. Создание MCP Server
  const server = new Server(
    {
      name: 'vsl-mcp-server',
      version: VSL_MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: true },
      },
    },
  );

  // 4. Регистрация handlers (передаём shared browser и session)
  registerTools(server, config, browser, session);
  registerResources(server, config, session);

  // 5. Подключение транспорта
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 6. Логирование запуска (в stderr, чтобы не мешать JSON-RPC в stdout)
  console.error(`[VSL MCP Server] v${VSL_MCP_SERVER_VERSION} started (stdio transport)`);
  console.error(`[VSL MCP Server] Config: vision=${config.vision.provider}, model=${config.vision.model}`);
}

// Запуск сервера
main().catch((error) => {
  console.error('[VSL MCP Server] Fatal error:', error);
  process.exit(1);
});