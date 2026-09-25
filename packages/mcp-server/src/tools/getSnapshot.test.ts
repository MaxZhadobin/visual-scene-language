/**
 * Unit tests for vsl_get_snapshot tool (T1.6.3).
 *
 * Test cases:
 *  - Успешный snapshot без URL (использует текущую страницу)
 *  - Успешный snapshot с URL (навигация + snapshot)
 *  - Ошибка: Playwright не установлен
 *  - Обработка исключений из browser.evaluate()
 *  - Обработка не-Error исключений
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleGetSnapshot } from './getSnapshot.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';

describe('vsl_get_snapshot', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockConfig: McpServerConfig;

  beforeEach(() => {
    mockBrowser = {
      isAvailable: jest.fn(),
      navigate: jest.fn(),
      evaluate: jest.fn(),
      getContent: jest.fn(),
      screenshot: jest.fn(),
      getPage: jest.fn(),
      launch: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<BrowserManager>;

    mockSession = {
      clear: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      hasSnapshot: jest.fn(),
      getDiff: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;

    mockConfig = {
      browser: { headless: true, navigationTimeout: 30000 },
      vision: { provider: 'openai', model: 'gpt-4o-mini' },
    } as McpServerConfig;
  });

  it('успешно делает snapshot без URL (использует текущую страницу)', async () => {
    const mockDomTree = {
      tag: 'html',
      rect: { x: 0, y: 0, width: 1280, height: 800 },
      children: [],
    };

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValue(mockDomTree as never);

    const result = await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();
    expect((result.data as Record<string, unknown>).vsl_version).toBe('1.0.0');
    expect(mockBrowser.navigate).not.toHaveBeenCalled();
    expect(mockSession.setSnapshot).toHaveBeenCalledTimes(1);
  });

  it('успешно делает snapshot с URL (навигация + snapshot)', async () => {
    const mockDomTree = {
      tag: 'html',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      children: [],
    };

    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValue(mockDomTree as never);

    const result = await handleGetSnapshot(
      { url: 'https://example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();
    expect(mockBrowser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(mockSession.setSnapshot).toHaveBeenCalledTimes(1);
  });

  it('возвращает ошибку, если Playwright не установлен', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
    expect(result.error).toContain('vsl_read_page');
  });

  it('обрабатывает исключения из browser.evaluate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue(new Error('Page context destroyed'));

    const result = await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Page context destroyed');
    expect(result.error).toContain('vsl_get_snapshot failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue('string error');

    const result = await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });
});