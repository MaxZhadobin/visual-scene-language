/**
 * Unit tests for tools/index.ts — MCP-compliant result handling.
 *
 * Test cases:
 *  - MCP-compliant результат (с content array) возвращается напрямую
 *  - Обычный результат оборачивается в JSON.stringify
 *  - Unknown tool возвращает ошибку с isError: true
 *  - Exception handling возвращает ошибку с isError: true
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { registerTools } from './index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { SessionManager } from '../session/sessionManager.js';
import type { McpServerConfig } from '../config/loader.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('tools/index.ts — MCP-compliant result handling', () => {
  let mockServer: jest.Mocked<Server>;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockConfig: McpServerConfig;
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let handlers: Array<{ schema: unknown; handler: unknown }>;

  beforeEach(() => {
    handlers = [];

    // Mock Server — сохраняем все зарегистрированные handlers
    mockServer = {
      setRequestHandler: jest.fn((schema, handler) => {
        handlers.push({ schema, handler });
      }),
    } as unknown as jest.Mocked<Server>;

    // Mock BrowserManager
    mockBrowser = {
      isAvailable: jest.fn().mockResolvedValue(true),
      navigate: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(undefined),
      getContent: jest.fn().mockResolvedValue('<html></html>'),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      getPage: jest.fn().mockResolvedValue({
        click: jest.fn().mockResolvedValue(undefined),
        fill: jest.fn().mockResolvedValue(undefined),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      }),
      launch: jest.fn(),
      close: jest.fn(),
      uploadFile: jest.fn(),
    } as unknown as jest.Mocked<BrowserManager>;

    // Mock ServerSession
    mockSession = {
      hasSnapshot: jest.fn().mockReturnValue(false),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn().mockReturnValue(null),
      getDiff: jest.fn().mockReturnValue(null),
      clear: jest.fn(),
      snapshotFromElements: jest.fn(),
      getIdMap: jest.fn().mockReturnValue(new Map()),
    } as unknown as jest.Mocked<ServerSession>;

    // Mock SessionManager
    mockSessionManager = {
      getDefaultSessionId: jest.fn().mockReturnValue('default'),
      getSession: jest.fn().mockReturnValue({
        sessionId: 'default',
        browser: mockBrowser,
        session: mockSession,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }),
    } as unknown as jest.Mocked<SessionManager>;

    // Mock config
    mockConfig = {
      browser: {
        headless: true,
        timeout: 30000,
      },
      downloadsPath: '',
    } as McpServerConfig;
  });

  /** Получить CallTool handler из зарегистрированных handlers */
  function getCallToolHandler() {
    // CallToolRequestSchema — второй зарегистрированный handler
    // (первый — ListToolsRequestSchema)
    const callHandler = handlers[1];
    return callHandler?.handler as (request: {
      params: { name: string; arguments?: Record<string, unknown>; _meta?: { sessionId?: string } };
    }) => Promise<unknown>;
  }

  describe('registerTools', () => {
    it('регистрирует handlers для ListToolsRequestSchema и CallToolRequestSchema', () => {
      registerTools(mockServer, mockConfig, mockSessionManager);

      // Должны быть зарегистрированы 2 handler'а
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
    });

    it('сохраняет CallToolRequestSchema handler', () => {
      registerTools(mockServer, mockConfig, mockSessionManager);

      // Проверяем что handler сохранён
      const handler = getCallToolHandler();
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });

  describe('CallToolRequestSchema handler', () => {
    beforeEach(() => {
      registerTools(mockServer, mockConfig, mockSessionManager);
    });

    it('возвращает ошибку для unknown tool', async () => {
      const callHandler = getCallToolHandler();
      const result = await callHandler({
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Unknown tool: unknown_tool' }),
          },
        ],
        isError: true,
      });
    });

    it('обрабатывает исключения из handleGetSnapshot и возвращает ошибку с isError: true', async () => {
      // handleGetSnapshot возвращает {status: 'error', error: '...'} когда browser.isAvailable = false
      mockBrowser.isAvailable.mockResolvedValueOnce(false);

      const callHandler = getCallToolHandler();
      const result = (await callHandler({
        params: {
          name: 'vsl_get_snapshot',
          arguments: {},
        },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      // Результат должен быть обёрнут в content array
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');

      // Парсим JSON и проверяем что это ошибка
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('Playwright is not installed');
    });

    it('использует sessionId из _meta если передан', async () => {
      mockBrowser.isAvailable.mockResolvedValueOnce(false);

      const callHandler = getCallToolHandler();
      await callHandler({
        params: {
          name: 'vsl_get_snapshot',
          arguments: {},
          _meta: { sessionId: 'custom-session' },
        },
      });

      expect(mockSessionManager.getSession).toHaveBeenCalledWith('custom-session');
    });

    it('использует default sessionId если _meta не передан', async () => {
      mockBrowser.isAvailable.mockResolvedValueOnce(false);

      const callHandler = getCallToolHandler();
      await callHandler({
        params: {
          name: 'vsl_get_snapshot',
          arguments: {},
        },
      });

      expect(mockSessionManager.getDefaultSessionId).toHaveBeenCalled();
      expect(mockSessionManager.getSession).toHaveBeenCalledWith('default');
    });
  });

  describe('MCP-compliant result handling', () => {
    beforeEach(() => {
      registerTools(mockServer, mockConfig, mockSessionManager);
    });

    it('возвращает MCP-compliant результат напрямую (с content array)', async () => {
      // vsl_get_visual возвращает MCP-compliant результат с content array
      // Мокаем browser для успешного screenshot
      const mockPage = {
        click: jest.fn(),
        fill: jest.fn(),
        waitForTimeout: jest.fn(),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-image-data')),
      };
      mockBrowser.getPage.mockResolvedValue(mockPage as never);

      // Последовательность evaluate вызовов для getVisual:
      // 1. elementExists → true
      // 2. autoScroll check → {needsScroll: false, scrolled: false}
      // 3. getBoundingClientRect → {x: 10, y: 20, width: 100, height: 50}
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)  // elementExists = true
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)  // autoScroll
        .mockResolvedValueOnce({ x: 10, y: 20, width: 100, height: 50 } as never);  // bounding box

      const callHandler = getCallToolHandler();
      const result = (await callHandler({
        params: {
          name: 'vsl_get_visual',
          arguments: { element_id: 'btn_0' },
        },
      })) as { content: Array<{ type: string; data?: string; text?: string; mimeType?: string }>; isError?: boolean };

      // Результат должен быть MCP-compliant (content array с type: 'image')
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      // Проверяем что это изображение, а не текст
      const firstContent = result.content[0];
      expect(firstContent.type).toBe('image');
      expect(firstContent.data).toBeDefined();
      expect(firstContent.mimeType).toBe('image/png');
    });

    it('оборачивает обычный результат в JSON.stringify', async () => {
      // vsl_clear_cache возвращает обычный объект {status: 'success'}
      const callHandler = getCallToolHandler();
      const result = (await callHandler({
        params: {
          name: 'vsl_clear_cache',
          arguments: {},
        },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      // Результат должен быть обёрнут в content array с type: 'text'
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
      expect(result.content[0].type).toBe('text');

      // Текст должен быть JSON
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('success');
    });

    it('не оборачивает MCP-compliant результат дважды', async () => {
      // vsl_get_visual возвращает MCP-compliant результат
      const mockPage = {
        click: jest.fn(),
        fill: jest.fn(),
        waitForTimeout: jest.fn(),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-image-data')),
      };
      mockBrowser.getPage.mockResolvedValue(mockPage as never);

      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)  // elementExists
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)  // autoScroll
        .mockResolvedValueOnce({ x: 10, y: 20, width: 100, height: 50 } as never);  // bounding box

      const callHandler = getCallToolHandler();
      const result = (await callHandler({
        params: {
          name: 'vsl_get_visual',
          arguments: { element_id: 'btn_0' },
        },
      })) as { content: Array<{ type: string; data?: string; text?: string; mimeType?: string }>; isError?: boolean };

      // Проверяем что результат НЕ обёрнут в JSON.stringify
      // Если бы был двойной wrap, то content[0].type был бы 'text', а не 'image'
      expect(result.content[0].type).toBe('image');
      expect(result.content[0].text).toBeUndefined();
      expect(result.content[0].data).toBeDefined();
    });
  });
});