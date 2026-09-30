/**
 * Unit tests for iframe support (M2.1) in vsl_get_snapshot tool.
 *
 * Test cases:
 *  - Извлекает iframe элементы и создаёт sub-VslDocuments
 *  - Пропускает iframe если Playwright frame не найден
 *  - Обрабатывает ошибки iframe extraction как best-effort
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { handleGetSnapshot } from './getSnapshot.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';

/**
 * Setup global DOM mocks for SDK's buildVslDocument/buildCanvas.
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

describe('vsl_get_snapshot — iframe support (M2.1)', () => {

  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockConfig: McpServerConfig;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let domMocks: ReturnType<typeof setupGlobalDomMocks>;

  beforeEach(() => {
    domMocks = setupGlobalDomMocks();

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
      getFrame: jest.fn(),
      getFrames: jest.fn().mockReturnValue([]),
      evaluateInFrame: jest.fn(),
      launch: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<BrowserManager>;

    mockSession = {
      clear: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      hasSnapshot: jest.fn(),
      getDiff: jest.fn(),
      snapshotFromElements: jest.fn(),
      getScrollContext: jest.fn().mockReturnValue(null),
      getPreviousSnapshot: jest.fn().mockReturnValue(null),
      getReverseIdMap: jest.fn().mockReturnValue(new Map()),
      rebuildIdMaps: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;

    mockConfig = {
      browser: { headless: true, navigationTimeout: 30000 },
      vision: { provider: 'openai', model: 'gpt-4o-mini' },
    } as McpServerConfig;
  });

  afterEach(() => {
    cleanupGlobalDomMocks();
  });

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
        ],
      },
    ];
  }

  function createMockVslDocument(options?: { url?: string }): Record<string, unknown> {
    const url = options?.url || 'https://test.com';
    return {
      vsl_version: '1.0',
      url: url,
      title: 'Test Page',
      canvas: {
        viewport: { width: 1280, height: 800 },
        url: url,
      },
      objects: [
        {
          id: 'div_0',
          t: 'div',
          bbox: [0, 0, 1280, 800],
          ch: [
            {
              id: 'button_0_0',
              t: 'button',
              txt: 'Click me',
              bbox: [100, 100, 120, 40],
              act: ['click'],
            },
          ],
        },
      ],
    };
  }

  it('извлекает iframe элементы и создаёт sub-VslDocuments', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);

    // Mock iframe elements found by extractIframesInBrowser
    const mockIframeElements = [
      {
        url: 'https://example.com/iframe1',
        rect: { x: 100, y: 200, width: 300, height: 400 },
        name: 'test-iframe',
        id: 'iframe-1',
      },
    ];

    // Mock iframe DOM extraction result
    const mockIframeExtraction = [
      {
        __type: 'extraction_result',
        elements: [
          {
            tag: 'button',
            indexPath: [0],
            rect: { x: 50, y: 50, width: 100, height: 40 },
            text: 'Iframe Button',
            attributes: {},
            css: {},
            children: [],
          },
        ],
        viewport: { width: 300, height: 400 },
        scroll: { x: 0, y: 0, width: 300, height: 400 },
      },
    ];

    // Mock Playwright frames (partial URL match)
    const mockFrame = {
      url: () => 'https://example.com/iframe1',
    };
    mockBrowser.getFrames = jest.fn().mockResolvedValue([mockFrame]);
    mockBrowser.evaluateInFrame = jest.fn().mockResolvedValue(mockIframeExtraction);

    // Setup evaluate mocks for main page
    mockBrowser.evaluate
      .mockResolvedValueOnce([
        {
          __type: 'extraction_result',
          elements: mockElements,
          viewport: { width: 1280, height: 800 },
          scroll: { x: 0, y: 0, width: 1280, height: 800 },
        },
      ] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce(mockIframeElements as never) // extractIframesInBrowser
      .mockResolvedValueOnce(undefined as never); // injectVslIdsIntoDom

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');
    expect(mockBrowser.getFrames).toHaveBeenCalled();

    // Verify iframe object was added to snapshot
    const vslDoc = result.data as Record<string, unknown>;
    const objects = vslDoc.objects as Array<Record<string, unknown>>;
    const iframeObject = objects.find((obj) => obj.t === 'iframe');
    expect(iframeObject).toBeDefined();
    expect(iframeObject?.id).toBe('iframe_0');
    expect(iframeObject?.iframe).toBeDefined();
    const iframeData = iframeObject?.iframe as Record<string, unknown>;
    expect(iframeData.url).toBe('https://example.com/iframe1');
  });

  it('пропускает iframe если Playwright frame не найден', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);
    mockBrowser.isAvailable.mockResolvedValue(true);

    const mockIframeElements = [
      {
        url: 'https://missing.com/iframe',
        rect: { x: 0, y: 0, width: 100, height: 100 },
        name: 'missing',
        id: 'missing-iframe',
      },
    ];

    // Frame not found
    mockBrowser.getFrame = jest.fn().mockReturnValue(null);

    mockBrowser.evaluate
      .mockResolvedValueOnce([
        {
          __type: 'extraction_result',
          elements: mockElements,
          viewport: { width: 1280, height: 800 },
          scroll: { x: 0, y: 0, width: 1280, height: 800 },
        },
      ] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce(mockIframeElements as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');

    // Verify no iframe object was added
    const vslDoc = result.data as Record<string, unknown>;
    const objects = vslDoc.objects as Array<Record<string, unknown>>;
    const iframeObject = objects.find((obj) => obj.t === 'iframe');
    expect(iframeObject).toBeUndefined();
  });

  it('обрабатывает ошибки iframe extraction как best-effort', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);
    mockBrowser.isAvailable.mockResolvedValue(true);

    const mockIframeElements = [
      {
        url: 'https://error.com/iframe',
        rect: { x: 0, y: 0, width: 100, height: 100 },
        name: 'error',
        id: 'error-iframe',
      },
    ];

    const mockFrame = { url: () => 'https://error.com/iframe' };
    mockBrowser.getFrame = jest.fn().mockReturnValue(mockFrame);
    mockBrowser.evaluateInFrame = jest
      .fn()
      .mockRejectedValue(new Error('Frame context destroyed'));

    mockBrowser.evaluate
      .mockResolvedValueOnce([
        {
          __type: 'extraction_result',
          elements: mockElements,
          viewport: { width: 1280, height: 800 },
          scroll: { x: 0, y: 0, width: 1280, height: 800 },
        },
      ] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce(mockIframeElements as never)
      .mockResolvedValueOnce(undefined as never);

    // Should not throw — best-effort
    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');

    // Main snapshot should still be returned
    const vslDoc = result.data as Record<string, unknown>;
    expect(vslDoc.objects).toBeDefined();
  });
});