/**
 * Unit tests for vsl_read_page tool (T1.6.6).
 *
 * Test cases:
 *  - Успешное чтение в HTTP-режиме (статическая страница)
 *  - Успешное чтение в render-режиме (SPA)
 *  - Авто-детект SPA и переключение на render
 *  - Readable-режим с фильтрацией шума
 *  - Ошибка: Playwright не установлен в render-режиме
 *  - Ошибка: fetch failed в http-режиме (критично)
 *  - Ошибка: fetch failed в auto-режиме (fallback на render)
 *  - Обработка исключений из browser.evaluate()
 *  - Обработка не-Error исключений
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleReadPage } from './readPage.js';
import { buildVslFromDom } from './httpExtractor.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';

describe('vsl_read_page', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockConfig: McpServerConfig;
  let mockPage: { screenshot: jest.Mock; waitForTimeout: jest.Mock };

  beforeEach(() => {
    mockPage = {
      screenshot: jest.fn(),
      // Единый пайплайн отдачи: инжект data-vsl-id использует waitForTimeout
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

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
      hasSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn().mockReturnValue({
        canvas: { url: 'https://example.com', viewport: { width: 1024, height: 768 } },
        objects: [],
      }),
      getDiff: jest.fn(),
      clear: jest.fn(),
      // Единый пайплайн отдачи (АС[3]): рендер-путь строит документ через
      // snapshotFromElements, отдача фильтруется по скролл-контексту
      snapshotFromElements: jest.fn().mockReturnValue({
        canvas: { url: 'https://example.com', viewport: { width: 1024, height: 768 } },
        objects: [],
      }),
      getScrollContext: jest.fn().mockReturnValue(null),
      getPreviousSnapshot: jest.fn().mockReturnValue(null),
      getReverseIdMap: jest.fn().mockReturnValue(new Map()),
    } as unknown as jest.Mocked<ServerSession>;

    mockConfig = {
      vision: { provider: 'openai', model: 'gpt-4o-mini-vision' },
      browser: { headless: true, navigationTimeout: 30000 },
    } as unknown as McpServerConfig;

    mockBrowser.getPage.mockResolvedValue(mockPage as never);

    // Mock global fetch
    global.fetch = jest.fn() as never;
  });

  it('успешно читает в HTTP-режиме (статическая страница)', async () => {
    const html = '<html><head><title>Test Page</title></head><body><p>Hello World</p></body></html>';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    mockSession.hasSnapshot.mockReturnValue(false); // Явный мок для hasDiff=false
    const result = await handleReadPage(
      { url: 'https://example.com' }, // mode убран — автоматическая стратегия
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.mode).toBe('http');
    expect(result.data?.url).toBe('https://example.com');
    expect(result.data?.content).toContain('Hello World');
    expect(result.data?.metadata.title).toBe('Test Page');
    expect(result.data?.metadata.isSpa).toBe(false);
    expect(result.data?.hasDiff).toBe(false);
    expect(result.data?.vslDocument).toBeDefined(); // HTTP-путь возвращает VSL JSON
    expect(mockSession.setSnapshot).toHaveBeenCalled(); // HTTP-путь сохраняет в session
    expect(mockBrowser.navigate).not.toHaveBeenCalled();
  });

  it('успешно читает в render-режиме (SPA)', async () => {
    // detectSpa() ищет '#root' буквально в HTML, поэтому добавляем в <style>
    const html = '<html><head><title>SPA Page</title><style>#root { display: block; }</style></head><body><div id="root">App Content</div></body></html>';

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.getContent.mockResolvedValue(html);
    // Единый пайплайн отдачи (АС[3]): рендер-путь извлекает полный документ
    // через extractDomTree (обёртка extraction_result со скроллом)
    mockBrowser.evaluate.mockResolvedValue([{
      __type: 'extraction_result',
      elements: [],
      viewport: { width: 1024, height: 768 },
      scroll: { x: 0, y: 0, width: 1024, height: 768 },
    }] as never);

    const result = await handleReadPage(
      { url: 'https://spa.example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.mode).toBe('render');
    expect(result.data?.content).toContain('App Content');
    expect(result.data?.metadata.isSpa).toBe(true);
    expect(result.data?.vslDocument).toBeDefined();
    expect(mockBrowser.navigate).toHaveBeenCalledWith('https://spa.example.com', undefined);
    // Рендер-путь строит документ через SDK-пайплайн (АС[3])
    expect(mockSession.snapshotFromElements).toHaveBeenCalled();
  });

  it('авто-детект SPA и переключение на render', async () => {
    // detectSpa() ищет '#root' буквально в HTML
    const html = '<html><head><title>SPA</title><style>#root { }</style></head><body><div id="root"></div></body></html>';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.getContent.mockResolvedValue(html);
    // Единый пайплайн отдачи (АС[3]): обёртка extraction_result
    mockBrowser.evaluate.mockResolvedValue([{
      __type: 'extraction_result',
      elements: [],
      viewport: { width: 1024, height: 768 },
      scroll: { x: 0, y: 0, width: 1024, height: 768 },
    }] as never);

    const result = await handleReadPage(
      { url: 'https://spa.example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.mode).toBe('render');
    expect(result.data?.metadata.isSpa).toBe(true);
    expect(mockBrowser.navigate).toHaveBeenCalled();
  });

  it('readable-режим фильтрует шумные элементы (nav, footer)', async () => {
    const html = `
      <html>
        <head><title>Article</title></head>
        <body>
          <nav>Navigation</nav>
          <main><p>Article content here</p></main>
          <footer>Footer content</footer>
        </body>
      </html>
    `;

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await handleReadPage(
      { url: 'https://example.com/article', readable: true }, // mode убран
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.metadata.readableApplied).toBe(true);
    expect(result.data?.content).toContain('Article content here');
    expect(result.data?.content).not.toContain('Navigation');
    expect(result.data?.content).not.toContain('Footer content');
  });

  it('возвращает ошибку, если Playwright не установлен в render-режиме', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleReadPage(
      { url: 'https://spa.example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
    expect(result.error).toContain('npm install playwright');
  });

  it('fallback на render при ошибке fetch (автоматическая стратегия)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    // Render-путь недоступен (Playwright не установлен)
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleReadPage(
      { url: 'https://example.com' }, // mode убран — автоматическая стратегия
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
  });

  it('fallback на render, если fetch failed в auto-режиме', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const html = '<html><body>Rendered content</body></html>';
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.getContent.mockResolvedValue(html);
    // Единый пайплайн отдачи (АС[3]): обёртка extraction_result
    mockBrowser.evaluate.mockResolvedValue([{
      __type: 'extraction_result',
      elements: [],
      viewport: { width: 1024, height: 768 },
      scroll: { x: 0, y: 0, width: 1024, height: 768 },
    }] as never);

    const result = await handleReadPage(
      { url: 'https://example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.mode).toBe('render');
    expect(mockBrowser.navigate).toHaveBeenCalled();
  });

  it('hasDiff=true при повторном чтении (есть предыдущий snapshot)', async () => {
    const html = '<html><body>Content</body></html>';

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.getContent.mockResolvedValue(html);
    // Единый пайплайн отдачи (АС[3]): обёртка extraction_result
    mockBrowser.evaluate.mockResolvedValue([{
      __type: 'extraction_result',
      elements: [],
      viewport: { width: 1024, height: 768 },
      scroll: { x: 0, y: 0, width: 1024, height: 768 },
    }] as never);
    mockSession.hasSnapshot.mockReturnValue(true);

    const result = await handleReadPage(
      { url: 'https://example.com' }, // mode убран
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.hasDiff).toBe(true);
    // Рендер-путь строит документ через SDK-пайплайн (АС[3])
    expect(mockSession.snapshotFromElements).toHaveBeenCalled();
  });

  it('использует fallback DOM при исключении из browser.evaluate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.getContent.mockResolvedValue('<html></html>');
    mockBrowser.evaluate.mockRejectedValue(new Error('Page context destroyed'));

    const result = await handleReadPage(
      { url: 'https://example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    // extractVslFromPage перехватывает ошибку и использует fallback DOM
    expect(result.status).toBe('success');
    expect(result.data?.vslDocument).toBeDefined();
  });

  it('обрабатывает не-Error исключения (fallback на render)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce('string error');

    // Render-путь недоступен (Playwright не установлен)
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleReadPage(
      { url: 'https://example.com' }, // mode убран — автоматическая стратегия
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
  });

  it('извлекает title и подсчитывает слова', async () => {
    const html = '<html><head><title>My Page Title</title></head><body><p>One two three four five</p></body></html>';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await handleReadPage(
      { url: 'https://example.com' }, // mode убран
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.metadata.title).toBe('My Page Title');
    expect(result.data?.metadata.wordCount).toBeGreaterThan(0);
  });

  it('удаляет script и style теги из контента', async () => {
    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <script>alert('evil');</script>
          <style>.hidden { display: none; }</style>
          <p>Visible content</p>
        </body>
      </html>
    `;

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await handleReadPage(
      { url: 'https://example.com' }, // mode убран
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.content).toContain('Visible content');
    expect(result.data?.content).not.toContain('alert');
    expect(result.data?.content).not.toContain('display: none');
  });

  it('HTTP path: vslDocument содержит короткие ID (buildVslFromDom генерирует их напрямую)', async () => {
    // HTML содержит button и input — buildVslFromDom сгенерирует короткие ID через createIdGenerator
    const html = '<html><head><title>Test</title></head><body><button>Click me</button><input type="text" /></body></html>';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    // В HTTP path buildVslFromDom уже генерирует короткие ID (btn_0, inp_0),
    // поэтому reverseIdMap пустой — маппинг не нужен
    mockSession.getReverseIdMap.mockReturnValue(new Map());

    // buildVslFromDom генерирует короткие ID напрямую через createIdGenerator.
    // getSnapshot должен возвращать документ, сгенерированный buildVslFromDom
    // (именно это делает session.setSnapshot в реальном коде)
    const expectedVslDoc = buildVslFromDom(html, { url: 'https://example.com' });
    mockSession.getSnapshot.mockReturnValue(expectedVslDoc as never);

    const result = await handleReadPage(
      { url: 'https://example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.mode).toBe('http');
    expect(result.data?.vslDocument).toBeDefined();

    // buildVslFromDom генерирует короткие ID напрямую через createIdGenerator
    const vslDoc = result.data?.vslDocument as { objects?: Array<{ id: string; t: string }> };
    expect(vslDoc?.objects).toBeDefined();
    expect(vslDoc?.objects!.length).toBeGreaterThanOrEqual(2);
    // Найти button и input среди объектов (порядок зависит от обхода DOM)
    const buttonObj = vslDoc?.objects?.find(o => o.t === 'button');
    const inputObj = vslDoc?.objects?.find(o => o.t === 'input');
    expect(buttonObj).toBeDefined();
    expect(inputObj).toBeDefined();
    expect(buttonObj?.id).toMatch(/^btn_\d+$/);
    expect(inputObj?.id).toMatch(/^inp_\d+$/);
  });

  it('render path: vslDocument содержит короткие ID после маппинга', async () => {
    const html = '<html><head><title>SPA</title><style>#root { display: block; }</style></head><body><div id="root">Content</div></body></html>';

    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.getContent.mockResolvedValue(html);
    mockBrowser.evaluate.mockResolvedValue([{
      __type: 'extraction_result',
      elements: [],
      viewport: { width: 1024, height: 768 },
      scroll: { x: 0, y: 0, width: 1024, height: 768 },
    }] as never);

    // Настроить reverseIdMap: длинные ID → короткие ID
    const reverseIdMap = new Map<string, string>([
      ['div_0_0_0', 'div_0'],
      ['span_1_0_1', 'txt_0'],
    ]);
    mockSession.getReverseIdMap.mockReturnValue(reverseIdMap);

    // Настроить getSnapshot чтобы возвращал документ с длинными ID
    mockSession.getSnapshot.mockReturnValue({
      canvas: { url: 'https://spa.example.com', viewport: { width: 1024, height: 768 } },
      objects: [
        { id: 'div_0_0_0', t: 'container', p: [0, 0], s: [1024, 768] },
        { id: 'span_1_0_1', t: 'text', p: [10, 10], s: [100, 20] },
      ],
    } as never);

    const result = await handleReadPage(
      { url: 'https://spa.example.com' },
      mockBrowser,
      mockSession,
      mockConfig,
    );

    expect(result.status).toBe('success');
    expect(result.data?.mode).toBe('render');
    expect(result.data?.vslDocument).toBeDefined();

    // Проверить что vslDocument содержит короткие ID
    const vslDoc = result.data?.vslDocument as { objects?: Array<{ id: string }> };
    expect(vslDoc?.objects).toBeDefined();
    expect(vslDoc?.objects?.[0]?.id).toBe('div_0');
    expect(vslDoc?.objects?.[1]?.id).toBe('txt_0');
  });
});