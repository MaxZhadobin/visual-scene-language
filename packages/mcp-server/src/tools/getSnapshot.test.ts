/**
 * Unit tests for vsl_get_snapshot tool (T1.6.3, updated for SDK pipeline).
 *
 * Test cases:
 *  - Успешный snapshot без URL (использует текущую страницу)
 *  - Успешный snapshot с URL (навигация + snapshot)
 *  - Ошибка: Playwright не установлен
 *  - Обработка исключений из browser.evaluate()
 *  - Обработка не-Error исключений
 *  - Проверка что используется SDK пайплайн (segmentTree → buildVslDocument)
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { handleGetSnapshot } from './getSnapshot.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';

/**
 * Setup global DOM mocks for SDK's buildVslDocument/buildCanvas.
 * The SDK uses window.location.href, document.title, window.innerWidth/Height.
 * jest.mock does NOT work in ESM mode (--experimental-vm-modules),
 * so we set globalThis.window/document directly.
 */
function setupGlobalDomMocks() {
  const mockWindow = {
    location: { href: 'https://test.com' },
    innerWidth: 1280,
    innerHeight: 800,
  };
  const mockDocument = {
    title: 'Test Page',
  };
  (globalThis as Record<string, unknown>).window = mockWindow;
  (globalThis as Record<string, unknown>).document = mockDocument;
  return { mockWindow, mockDocument };
}

function cleanupGlobalDomMocks() {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
}

describe('vsl_get_snapshot', () => {

  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockConfig: McpServerConfig;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let domMocks: ReturnType<typeof setupGlobalDomMocks>;

  beforeEach(() => {
    domMocks = setupGlobalDomMocks();

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

  afterEach(() => {
    cleanupGlobalDomMocks();
  });

  /**
   * Создаёт минимальное валидное ExtractedElement[] для тестов.
   * Формат совместим с SDK segmentTree/buildVslDocument.
   */
  function createMockExtractedElements() {
    return [
      {
        tag: 'div',
        indexPath: [0],
        rect: { x: 0, y: 0, width: 1280, height: 800 },
        text: null,
        attributes: { class: 'container' },
        css: { display: 'block' },
        children: [
          {
            tag: 'button',
            indexPath: [0, 0],
            rect: { x: 100, y: 100, width: 120, height: 40 },
            text: 'Click me',
            attributes: { type: 'button' },
            css: { cursor: 'pointer', display: 'inline-block' },
            children: [],
          },
          {
            tag: 'a',
            indexPath: [0, 1],
            rect: { x: 100, y: 150, width: 100, height: 30 },
            text: 'Link text',
            attributes: { href: 'https://example.com' },
            css: { display: 'inline' },
            children: [],
          },
        ],
      },
    ];
  }

  it('успешно делает snapshot без URL (использует текущую страницу)', async () => {
    const mockElements = createMockExtractedElements();

    mockBrowser.isAvailable.mockResolvedValue(true);
    
    // browser.evaluate вызывается 4 раза:
    // 1. extractDomTreeInBrowser() → ExtractedElement[]
    // 2. viewport → { width, height }
    // 3. window.location.href → string
    // 4. writeVslIdsToDom() → undefined
    mockBrowser.evaluate
      .mockResolvedValueOnce(mockElements as never)
      .mockResolvedValueOnce({ width: 1280, height: 800 } as never)
      .mockResolvedValueOnce('https://current-page.com' as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();
    
    // Проверяем что результат — семантический VSL (не сырой DOM)
    const vslDoc = result.data as Record<string, unknown>;
    expect(vslDoc.vsl_version).toBeDefined();
    expect(vslDoc.objects).toBeDefined();
    expect(Array.isArray(vslDoc.objects)).toBe(true);
    
    // Проверяем что НЕТ root_0 (старая логика)
    const objects = vslDoc.objects as Array<Record<string, unknown>>;
    const hasRoot0 = objects.some(obj => obj.id === 'root_0');
    expect(hasRoot0).toBe(false);
    
    // Проверяем что есть семантические объекты (button, link)
    const objectTypes = objects.map(obj => obj.t).filter(Boolean);
    expect(objectTypes.length).toBeGreaterThan(0);
    
    expect(mockBrowser.navigate).not.toHaveBeenCalled();
    expect(mockSession.setSnapshot).toHaveBeenCalledTimes(1);
  });

  it('успешно делает snapshot с URL (навигация + snapshot)', async () => {
    const mockElements = createMockExtractedElements();

    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.isAvailable.mockResolvedValue(true);
    
    mockBrowser.evaluate
      .mockResolvedValueOnce(mockElements as never)
      .mockResolvedValueOnce({ width: 1920, height: 1080 } as never)
      .mockResolvedValueOnce('https://example.com' as never)
      .mockResolvedValueOnce(undefined as never);

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
    
    // Проверяем что viewport корректный
    const vslDoc = result.data as Record<string, unknown>;
    expect(vslDoc.canvas).toBeDefined();
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

  it('использует SDK пайплайн: extractDomTree → segmentTree → buildVslDocument', async () => {
    const mockElements = createMockExtractedElements();

    mockBrowser.isAvailable.mockResolvedValue(true);
    
    mockBrowser.evaluate
      .mockResolvedValueOnce(mockElements as never)
      .mockResolvedValueOnce({ width: 1280, height: 800 } as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');
    
    // Проверяем что browser.evaluate вызывался 4 раза
    expect(mockBrowser.evaluate).toHaveBeenCalledTimes(4);
    
    // Проверяем что результат содержит семантические типы (из SDK segmentTree)
    const vslDoc = result.data as Record<string, unknown>;
    const objects = vslDoc.objects as Array<Record<string, unknown>>;
    
    // SDK должен определить семантические типы (button, link, container)
    const types = objects.map(obj => obj.t).filter(Boolean);
    expect(types.length).toBeGreaterThan(0);
    
    // Проверяем что есть хотя бы один объект с act (actions) — ищем рекурсивно в ch (children)
    const hasActionsRecursive = (objs: Array<Record<string, unknown>>): boolean => {
      return objs.some(obj => {
        if (Array.isArray(obj.act) && (obj.act as string[]).length > 0) return true;
        if (Array.isArray(obj.ch)) return hasActionsRecursive(obj.ch as Array<Record<string, unknown>>);
        return false;
      });
    };
    expect(hasActionsRecursive(objects)).toBe(true);
  });

  it('записывает data-vsl-id атрибуты в DOM после сборки VSL', async () => {
    const mockElements = createMockExtractedElements();

    mockBrowser.isAvailable.mockResolvedValue(true);
    
    mockBrowser.evaluate
      .mockResolvedValueOnce(mockElements as never)
      .mockResolvedValueOnce({ width: 1280, height: 800 } as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce(undefined as never);

    await handleGetSnapshot({}, mockBrowser, mockSession, mockConfig);

    // 4-й вызов browser.evaluate — запись ID в DOM
    const fourthCall = mockBrowser.evaluate.mock.calls[3];
    expect(fourthCall).toBeDefined();
    
    // Первый аргумент — функция записи
    expect(typeof fourthCall[0]).toBe('function');
    
    // Второй аргумент — массив VSL объектов
    const vslObjects = fourthCall[1] as Array<Record<string, unknown>>;
    expect(Array.isArray(vslObjects)).toBe(true);
    expect(vslObjects.length).toBeGreaterThan(0);
  });
});