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
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_navigate', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;

  beforeEach(() => {
    // Мок страницы с waitForTimeout — нужен injectVslIdsIntoDom, чтобы
    // успешная ветка единого пайплайна отдачи реально исполнялась в тестах
    const mockPage = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    mockBrowser = {
      isAvailable: jest.fn(),
      navigate: jest.fn(),
      evaluate: jest.fn(),
      getContent: jest.fn(),
      screenshot: jest.fn(),
      getPage: jest.fn().mockReturnValue(mockPage),
      launch: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<BrowserManager>;

    mockSession = {
      hasSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      getDiff: jest.fn(),
      clear: jest.fn(),
      snapshotFromElements: jest.fn(),
      // Единый пайплайн отдачи (АС[3]): скролл-контекст последнего снапшота
      getScrollContext: jest.fn().mockReturnValue(null),
    } as unknown as jest.Mocked<ServerSession>;
  });

  it('успешно навигирует и возвращает URL + title', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.evaluate
      .mockResolvedValueOnce('Test Page Title' as never)  // title
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: [], viewport: { width: 1024, height: 768 }, scroll: { x: 0, y: 0, width: 1024, height: 768 } }] as never)  // extractDomTree (обёртка)
      .mockResolvedValueOnce(undefined as never);  // injectVslIdsIntoDom
    // Документ с canvas — единый пайплайн отдачи берёт вьюпорт из документа
    mockSession.getSnapshot.mockReturnValue({
      objects: [],
      canvas: { viewport: { width: 1024, height: 768 }, url: 'https://example.com' },
    } as never);

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser, mockSession);

    expect(result.status).toBe('success');
    expect(result.data?.url).toBe('https://example.com');
    expect(result.data?.title).toBe('Test Page Title');
    expect(mockBrowser.navigate).toHaveBeenCalledWith('https://example.com');
  });

  it('возвращает ошибку, если URL не указан', async () => {
    const result = await handleNavigate({ url: '' }, mockBrowser, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('URL is required');
  });

  it('возвращает ошибку, если URL невалидный', async () => {
    const result = await handleNavigate({ url: 'not-a-url' }, mockBrowser, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid URL');
    expect(result.error).toContain('not-a-url');
  });

  it('возвращает ошибку, если Playwright не установлен', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
  });

  it('обрабатывает исключения из browser.navigate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockRejectedValue(new Error('Navigation timeout'));

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Navigation timeout');
    expect(result.error).toContain('vsl_navigate failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockRejectedValue('string error');

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });

  it('возвращает warning если snapshot extraction failed', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.evaluate
      .mockResolvedValueOnce('Test Page Title' as never)  // title
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: [], viewport: { width: 1024, height: 768 }, scroll: { x: 0, y: 0, width: 1024, height: 768 } }] as never);  // extractDomTree (обёртка)
    mockSession.snapshotFromElements.mockImplementation(() => {
      throw new Error('snapshotFromElements failed');
    });

    const result = await handleNavigate({ url: 'https://example.com' }, mockBrowser, mockSession);

    expect(result.status).toBe('success');
    expect(result.data?.url).toBe('https://example.com');
    expect(result.warning).toContain('Failed to extract snapshot');
    expect(result.warning).toContain('snapshotFromElements failed');
  });
});