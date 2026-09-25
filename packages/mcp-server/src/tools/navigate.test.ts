/**
 * Unit tests for vsl_navigate tool (T1.6.3).
 *
 * Test cases:
 *  - Успешная навигация
 *  - Ошибка: URL не указан
 *  - Ошибка: невалидный URL
 *  - Ошибка: браузер недоступен (Playwright не установлен)
 *  - Обработка исключений из BrowserManager
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleNavigate } from './navigate.js';
import type { BrowserManager } from '../browser/manager.js';

describe('vsl_navigate', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;

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
  });

  it('успешно навигирует и возвращает URL + title', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.evaluate.mockResolvedValue('Test Page Title' as never);

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser);

    expect(result.status).toBe('success');
    expect(result.data?.url).toBe('https://example.com');
    expect(result.data?.title).toBe('Test Page Title');
    expect(mockBrowser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(mockBrowser.evaluate).toHaveBeenCalledTimes(1);
  });

  it('возвращает ошибку, если URL не указан', async () => {
    const result = await handleNavigate({ url: '' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('URL is required');
  });

  it('возвращает ошибку, если URL невалидный', async () => {
    const result = await handleNavigate({ url: 'not-a-url' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid URL');
    expect(result.error).toContain('not-a-url');
  });

  it('возвращает ошибку, если Playwright не установлен', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
  });

  it('обрабатывает исключения из browser.navigate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockRejectedValue(new Error('Navigation timeout'));

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Navigation timeout');
    expect(result.error).toContain('vsl_navigate failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockRejectedValue('string error');

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });
});