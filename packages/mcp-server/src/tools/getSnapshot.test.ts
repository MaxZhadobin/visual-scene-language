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

    // Mock page object with waitForTimeout for DOM stabilization (Fix 3)
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
      clear: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      hasSnapshot: jest.fn(),
      getDiff: jest.fn(),
      snapshotFromElements: jest.fn(),
      // Единый пайплайн отдачи (АС[3]): скролл-контекст и предыдущий документ
      getScrollContext: jest.fn().mockReturnValue(null),
      getPreviousSnapshot: jest.fn().mockReturnValue(null),
      getReverseIdMap: jest.fn().mockReturnValue(new Map()),
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

  /**
   * Создаёт минимальный валидный VslDocument для тестов.
   * Совместим с SDK pipeline: vsl_version, objects, canvas.
   */
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
            {
              id: 'link_0_1',
              t: 'link',
              txt: 'Link text',
              bbox: [100, 150, 100, 30],
              act: ['click'],
            },
          ],
        },
      ],
    };
  }

  it('успешно делает snapshot без URL (использует текущую страницу)', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);
    // browser.evaluate вызывается 4 раза:
    // 1. extractDomTree() -> обёртка [{__type, elements, viewport, scroll}]
    // 2. window.location.href -> string
    // 3. document.title -> string
    // 4. extractIframesInBrowser() -> []
    // 5. injectVslIdsIntoDom() -> undefined
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('https://current-page.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

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
    expect(mockSession.snapshotFromElements).toHaveBeenCalledTimes(1);
  });

  it('успешно делает snapshot с URL (навигация + snapshot)', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument({ url: 'https://example.com' });
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.isAvailable.mockResolvedValue(true);
    // URL задан явно → evaluate для window.location.href пропускается.
    // 4 вызова: 1. extractDomTree (обёртка), 2. document.title, 3. extractIframesInBrowser, 4. injectVslIdsIntoDom
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1920, height: 1080 }, scroll: { x: 0, y: 0, width: 1920, height: 1080 } }] as never)
      .mockResolvedValueOnce('Example Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await handleGetSnapshot(
      { url: 'https://example.com', ttl: 0 },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();
    expect(mockBrowser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(mockSession.snapshotFromElements).toHaveBeenCalledTimes(1);

    // Проверяем что viewport корректный
    const vslDoc = result.data as Record<string, unknown>;
    expect(vslDoc.canvas).toBeDefined();
  });

  it('возвращает ошибку, если Playwright не установлен', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
  });

  it('обрабатывает исключения из browser.evaluate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue(new Error('Page context destroyed'));

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Page context destroyed');
    expect(result.error).toContain('vsl_get_snapshot failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue('string error');

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });

  it('использует SDK пайплайн: extractDomTree -> segmentTree -> buildVslDocument', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');

    // Проверяем что browser.evaluate вызывался 5 раз
    // (extractDomTree, url, title, extractIframesInBrowser, injectVslIdsIntoDom)
    expect(mockBrowser.evaluate).toHaveBeenCalledTimes(5);

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
    const mockDoc = createMockVslDocument();
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    // 5-й вызов browser.evaluate — запись ID в DOM (injectVslIdsIntoDom)
    const injectCall = mockBrowser.evaluate.mock.calls[4];
    expect(injectCall).toBeDefined();

    // Первый аргумент — функция записи
    expect(typeof injectCall[0]).toBe('function');

    // Второй аргумент — массив VSL объектов
    const vslObjects = injectCall[1] as Array<Record<string, unknown>>;
    expect(Array.isArray(vslObjects)).toBe(true);
    expect(vslObjects.length).toBeGreaterThan(0);
  });

  it('по умолчанию использует detail_level = medium (фильтрует не-interactive и не-container элементы)', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    // Добавляем span — не входит ни в INTERACTIVE_TYPES, ни в CONTAINER_TYPES
    (mockDoc.objects as Array<Record<string, unknown>>).push({
      id: 'span_1',
      t: 'span',
      txt: 'Some text',
      bbox: [200, 200, 50, 20],
    });
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    // Вызываем БЕЗ detail_level — должен использоваться default 'medium'
    const result = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);

    expect(result.status).toBe('success');
    const vslDoc = result.data as Record<string, unknown>;
    const objects = vslDoc.objects as Array<Record<string, unknown>>;

    // span_1 должен быть отфильтрован при 'medium' (не interactive и не container)
    const hasSpan = objects.some(obj => obj.id === 'span_1');
    expect(hasSpan).toBe(false);

    // div_0 должен остаться (container type)
    const hasDiv = objects.some(obj => obj.id === 'div_0');
    expect(hasDiv).toBe(true);
  });

  it('явное указание detail_level: high возвращает все объекты без фильтрации', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    // Добавляем span — не входит ни в INTERACTIVE_TYPES, ни в CONTAINER_TYPES
    (mockDoc.objects as Array<Record<string, unknown>>).push({
      id: 'span_1',
      t: 'span',
      txt: 'Some text',
      bbox: [200, 200, 50, 20],
    });
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    // Вызываем С detail_level: 'high' — фильтрация отключена
    const result = await handleGetSnapshot(
      { ttl: 0, detail_level: 'high' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    const vslDoc = result.data as Record<string, unknown>;
    const objects = vslDoc.objects as Array<Record<string, unknown>>;

    // span_1 должен остаться (high = без фильтрации)
    const hasSpan = objects.some(obj => obj.id === 'span_1');
    expect(hasSpan).toBe(true);

    // Оба объекта верхнего уровня на месте (div_0 + span_1)
    expect(objects.length).toBe(2);
  });

  it('повторный вызов с другим detail_level берёт снапшот из кэша без обращения к браузеру (АС[5])', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument({ url: 'https://cache-test.com' });
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.isAvailable.mockResolvedValue(true);
    // URL задан явно → 4 вызова: экстракт-обёртка, title, extractIframesInBrowser, inject
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('Cache Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    // Первый вызов: заполняет кэш ПОЛНЫМ документом (дефолтный TTL 5s)
    const first = await handleGetSnapshot(
      { url: 'https://cache-test.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );
    expect(first.status).toBe('success');
    const evaluateCallsAfterFirst = mockBrowser.evaluate.mock.calls.length;

    // Второй вызов: другой detail_level, тот же URL → из кэша без браузера
    const second = await handleGetSnapshot(
      { url: 'https://cache-test.com', detail_level: 'low' },
      mockBrowser,
      mockSession,
      mockConfig,
    );
    expect(second.status).toBe('success');

    // Браузер и навигация повторно НЕ вызывались — ответ полностью из кэша
    expect(mockBrowser.evaluate.mock.calls.length).toBe(evaluateCallsAfterFirst);
    expect(mockBrowser.navigate).toHaveBeenCalledTimes(1);
    expect(mockSession.snapshotFromElements).toHaveBeenCalledTimes(1);

    // Метаданные пересчитаны для кэш-хита
    expect(second.metadata).toBeDefined();
    expect(typeof second.metadata?.object_count).toBe('number');
  });

  it('кэш отдаёт документ, отфильтрованный по запрошенной детализации (АС[5])', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument({ url: 'https://cache-detail.com' });
    // span — не interactive и не container: исчезает при 'low'
    (mockDoc.objects as Array<Record<string, unknown>>).push({
      id: 'span_1',
      t: 'span',
      txt: 'Some text',
      bbox: [200, 200, 50, 20],
    });
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('Detail Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    // Первый вызов: 'high' — кэш сохраняет полный документ
    const first = await handleGetSnapshot(
      { url: 'https://cache-detail.com', detail_level: 'high' },
      mockBrowser,
      mockSession,
      mockConfig,
    );
    expect(first.status).toBe('success');

    // Второй вызов из кэша: 'low' — span должен исчезнуть
    const second = await handleGetSnapshot(
      { url: 'https://cache-detail.com', detail_level: 'low' },
      mockBrowser,
      mockSession,
      mockConfig,
    );
    expect(second.status).toBe('success');

    const vslDoc = second.data as Record<string, unknown>;
    const objects = vslDoc.objects as Array<Record<string, unknown>>;

    // span_1 отфильтрован из кэша при 'low'
    const hasSpan = objects.some(obj => obj.id === 'span_1');
    expect(hasSpan).toBe(false);

    // Контейнер с интерактивными потомками остаётся
    const hasDiv = objects.some(obj => obj.id === 'div_0');
    expect(hasDiv).toBe(true);
  });

  it('full=true возвращает полный документ с оффскрин-элементами, минуя вьюпорт-фильтр и фильтр детализации', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument();
    // Оффскрин-элементы в абсолютных координатах (п/с): ниже видимого окна (0,0,1280,800)
    (mockDoc.objects as Array<Record<string, unknown>>).push(
      { id: 'btn_off', t: 'button', txt: 'Offscreen button', p: [0, 900], s: [120, 40] },
      { id: 'span_off', t: 'span', txt: 'Offscreen text', p: [0, 950], s: [50, 20] },
    );
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.isAvailable.mockResolvedValue(true);
    // Два свежих вызова (ttl: 0 → без кэша), каждый 5 evaluate: обёртка, url, title, extractIframesInBrowser, inject
    const extractionResult = [{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never;
    mockBrowser.evaluate
      .mockResolvedValueOnce(extractionResult)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(extractionResult)
      .mockResolvedValueOnce('https://test.com' as never)
      .mockResolvedValueOnce('Test Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    // Обычный вызов (медиум + вьюпорт): оффскрин-элементы отфильтрованы
    const normal = await handleGetSnapshot({ ttl: 0 }, mockBrowser, mockSession, mockConfig);
    expect(normal.status).toBe('success');
    const normalObjects = (normal.data as Record<string, unknown>).objects as Array<Record<string, unknown>>;
    expect(normalObjects.some(o => o.id === 'btn_off')).toBe(false);
    expect(normalObjects.some(o => o.id === 'span_off')).toBe(false);
    expect(normalObjects.some(o => o.id === 'div_0')).toBe(true);

    // фулл=тру: полный документ без фильтров — оффскрин-элементы на месте
    const full = await handleGetSnapshot({ ttl: 0, full: true }, mockBrowser, mockSession, mockConfig);
    expect(full.status).toBe('success');
    const fullObjects = (full.data as Record<string, unknown>).objects as Array<Record<string, unknown>>;
    expect(fullObjects.some(o => o.id === 'btn_off')).toBe(true);
    expect(fullObjects.some(o => o.id === 'span_off')).toBe(true);
    expect(fullObjects.some(o => o.id === 'div_0')).toBe(true);
  });

  it('full=true из кэша отдаёт полный документ без обращения к браузеру', async () => {
    const mockElements = createMockExtractedElements();
    const mockDoc = createMockVslDocument({ url: 'https://full-cache.test.com' });
    (mockDoc.objects as Array<Record<string, unknown>>).push(
      { id: 'btn_off', t: 'button', txt: 'Offscreen button', p: [0, 900], s: [120, 40] },
    );
    mockSession.snapshotFromElements.mockReturnValue(mockDoc as never);

    mockBrowser.navigate.mockResolvedValue(undefined);
    mockBrowser.isAvailable.mockResolvedValue(true);
    // УРЛ задан явно → 4 вызова: обёртка, title, extractIframesInBrowser, inject
    mockBrowser.evaluate
      .mockResolvedValueOnce([{ __type: 'extraction_result', elements: mockElements, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, width: 1280, height: 800 } }] as never)
      .mockResolvedValueOnce('Full Cache Page' as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(undefined as never);

    // Первый вызов заполняет кэш (дефолтный TTL 5 секунд)
    const first = await handleGetSnapshot(
      { url: 'https://full-cache.test.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );
    expect(first.status).toBe('success');
    const callsAfterFirst = mockBrowser.evaluate.mock.calls.length;

    // фулл=тру из кэша: полный документ без вьюпорт-фильтра, браузер не трогается
    const second = await handleGetSnapshot(
      { url: 'https://full-cache.test.com', full: true },
      mockBrowser,
      mockSession,
      mockConfig,
    );
    expect(second.status).toBe('success');
    expect(mockBrowser.evaluate.mock.calls.length).toBe(callsAfterFirst);

    const objects = (second.data as Record<string, unknown>).objects as Array<Record<string, unknown>>;
    expect(objects.some(o => o.id === 'btn_off')).toBe(true);
    expect(objects.some(o => o.id === 'div_0')).toBe(true);
  });

});