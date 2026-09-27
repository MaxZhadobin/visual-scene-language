/**
 * Tests for vsl_get_visual tool (T1.6.3).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleGetVisual } from './getVisual.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_get_visual', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockPage: {
    screenshot: jest.Mock;
  };

  beforeEach(() => {
    mockPage = {
      screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-png-data')),
    };

    mockBrowser = {
      isAvailable: jest.fn(),
      navigate: jest.fn(),
      evaluate: jest.fn(),
      getContent: jest.fn(),
      screenshot: jest.fn(),
      getPage: jest.fn().mockResolvedValue(mockPage),
      launch: jest.fn(),
      close: jest.fn(),
      uploadFile: jest.fn(),
    } as unknown as jest.Mocked<BrowserManager>;

    mockSession = {
      hasSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      getDiff: jest.fn(),
      clear: jest.fn(),
      snapshotFromElements: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;

    // Defaults
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValue(undefined as never);
  });

  describe('валидация аргументов', () => {
    it('возвращает ошибку если element_id отсутствует', async () => {
      const result = await handleGetVisual(
        { element_id: '' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('element_id is required') }),
        );
      }
    });

    it('возвращает ошибку если element_id не строка', async () => {
      const result = await handleGetVisual(
        { element_id: 123 as unknown as string },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
    });

    it('возвращает ошибку если auto_refresh не boolean', async () => {
      const result = await handleGetVisual(
        { element_id: 'btn_0', auto_refresh: 'yes' as unknown as boolean },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('auto_refresh must be a boolean') }),
        );
      }
    });

    it('возвращает ошибку если auto_scroll не boolean', async () => {
      const result = await handleGetVisual(
        { element_id: 'btn_0', auto_scroll: 42 as unknown as boolean },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('auto_scroll must be a boolean') }),
        );
      }
    });
  });

  describe('проверка browser availability', () => {
    it('возвращает ошибку если Playwright не установлен', async () => {
      mockBrowser.isAvailable.mockResolvedValue(false);

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('Playwright is not installed') }),
        );
      }
    });
  });

  describe('root_0 — full page screenshot', () => {
    it('делает скриншот всей страницы для root_0', async () => {
      const result = await handleGetVisual(
        { element_id: 'root_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBeUndefined();
      expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
      if ('content' in result) {
        const imageContent = result.content.find((c) => c.type === 'image');
        expect(imageContent).toBeDefined();
        if (imageContent && imageContent.type === 'image') {
          expect(imageContent.mimeType).toBe('image/png');
          expect(imageContent.data).toBe(Buffer.from('fake-png-data').toString('base64'));
        }
      }
    });

    it('возвращает MCP-compliant результат с image и text', async () => {
      const result = await handleGetVisual(
        { element_id: 'root_0' },
        mockBrowser,
        mockSession,
      );

      if ('content' in result) {
        expect(result.content).toHaveLength(2);
        expect(result.content[0].type).toBe('image');
        expect(result.content[1].type).toBe('text');
      }
    });

    it('включает metadata с метриками', async () => {
      const result = await handleGetVisual(
        { element_id: 'root_0' },
        mockBrowser,
        mockSession,
      );

      if ('metadata' in result) {
        expect(result.metadata).toBeDefined();
        expect(result.metadata?.json_size_bytes).toBeGreaterThan(0);
        expect(result.metadata?.estimated_tokens).toBeGreaterThan(0);
        expect(result.metadata?.execution_time_ms).toBeGreaterThanOrEqual(0);
        expect(result.metadata?.timestamp).toBeDefined();
      }
    });
  });

  describe('поиск элемента', () => {
    it('возвращает ошибку если элемент не найден', async () => {
      // elementExists → false
      mockBrowser.evaluate.mockResolvedValueOnce(false as never);

      const result = await handleGetVisual(
        { element_id: 'nonexistent_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('Element not found') }),
        );
      }
    });

    it('предлагает auto_refresh когда элемент не найден', async () => {
      mockBrowser.evaluate.mockResolvedValueOnce(false as never);

      const result = await handleGetVisual(
        { element_id: 'missing_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('possible_causes' in result) {
        expect(result.possible_causes).toBeDefined();
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions).toEqual(
          expect.arrayContaining([expect.stringContaining('auto_refresh')]),
        );
      }
    });
  });

  describe('auto-refresh', () => {
    it('вызывает handleGetSnapshot если auto_refresh=true и элемент не найден', async () => {
      // Первый evaluate: elementExists → false
      // После handleGetSnapshot: повторный evaluate → true
      mockBrowser.evaluate
        .mockResolvedValueOnce(false as never)  // elementExists = false
        .mockResolvedValueOnce(true as never);   // elementExists = true after refresh

      // handleGetSnapshot внутри вызывает evaluate для extractDomTreeInBrowser
      // Мокаем возвращаемое значение для extractDomTreeInBrowser
      mockBrowser.getContent.mockResolvedValue('<html></html>' as never);

      const _result = await handleGetVisual(
        { element_id: 'btn_0', auto_refresh: true },
        mockBrowser,
        mockSession,
      );

      // handleGetSnapshot был вызван → evaluate вызван больше 2 раз
      // (2 раза для elementExists check + дополнительные вызовы из handleGetSnapshot)
      expect(mockBrowser.evaluate.mock.calls.length).toBeGreaterThan(2);
    });

    it('не вызывает handleGetSnapshot если auto_refresh=false', async () => {
      mockBrowser.evaluate.mockResolvedValueOnce(false as never);

      await handleGetVisual(
        { element_id: 'btn_0', auto_refresh: false },
        mockBrowser,
        mockSession,
      );

      // Только одна проверка elementExists, без повторной
      expect(mockBrowser.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe('auto-scroll', () => {
    it('проверяет видимость и скроллит если элемент вне viewport', async () => {
      // Последовательность evaluate:
      // 1. elementExists → true
      // 2. scrollResult → {needsScroll: true, scrolled: true}
      // 3. requestAnimationFrame Promise → undefined
      // 4. scrollOffset → {x: 0, y: 500}
      // 5. rect → {x: 100, y: 600, width: 200, height: 100}
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)                          // elementExists
        .mockResolvedValueOnce({ needsScroll: true, scrolled: true } as never) // scrollResult
        .mockResolvedValueOnce(undefined as never)                     // RAF wait
        .mockResolvedValueOnce({ x: 0, y: 500 } as never)             // scrollOffset
        .mockResolvedValueOnce({ x: 100, y: 600, width: 200, height: 100 } as never); // rect

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBeUndefined();
      if ('scroll_info' in result) {
        expect(result.scroll_info).toBeDefined();
        expect(result.scroll_info?.scrolled).toBe(true);
        expect(result.scroll_info?.scroll_offset).toEqual({ x: 0, y: 500 });
      }
    });

    it('не скроллит если элемент виден', async () => {
      // 1. elementExists → true
      // 2. scrollResult → {needsScroll: false, scrolled: false}
      // 3. rect → {x: 100, y: 100, width: 200, height: 50}
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)
        .mockResolvedValueOnce({ x: 100, y: 100, width: 200, height: 50 } as never);

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBeUndefined();
      if ('scroll_info' in result) {
        expect(result.scroll_info).toBeUndefined();
      }
    });

    it('пропускает auto-scroll если auto_scroll=false', async () => {
      // 1. elementExists → true
      // 2. rect → {x: 100, y: 100, width: 200, height: 50}
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce({ x: 100, y: 100, width: 200, height: 50 } as never);

      const result = await handleGetVisual(
        { element_id: 'btn_0', auto_scroll: false },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBeUndefined();
      // Без auto-scroll: только elementExists + rect = 2 evaluate вызова
      expect(mockBrowser.evaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe('скриншот элемента', () => {
    it('использует clip с координатами включая scroll offset', async () => {
      // 1. elementExists → true
      // 2. scrollResult → {needsScroll: false, scrolled: false}
      // 3. rect → {x: 150, y: 350, width: 200, height: 100}
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)
        .mockResolvedValueOnce({ x: 150, y: 350, width: 200, height: 100 } as never);

      await handleGetVisual(
        { element_id: 'img_0' },
        mockBrowser,
        mockSession,
      );

      expect(mockPage.screenshot).toHaveBeenCalledWith({
        type: 'png',
        clip: { x: 150, y: 350, width: 200, height: 100 },
      });
    });

    it('возвращает base64-encoded изображение', async () => {
      const fakeBuffer = Buffer.from('test-image-data');
      mockPage.screenshot.mockResolvedValue(fakeBuffer);

      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)
        .mockResolvedValueOnce({ x: 0, y: 0, width: 100, height: 50 } as never);

      const result = await handleGetVisual(
        { element_id: 'img_0' },
        mockBrowser,
        mockSession,
      );

      if ('content' in result) {
        const imageContent = result.content.find((c) => c.type === 'image');
        expect(imageContent).toBeDefined();
        if (imageContent && imageContent.type === 'image') {
          expect(imageContent.data).toBe(fakeBuffer.toString('base64'));
          expect(imageContent.mimeType).toBe('image/png');
        }
      }
    });

    it('возвращает ошибку если bounding box null', async () => {
      // 1. elementExists → true (querySelector находит элемент)
      // 2. scrollResult → {needsScroll: false, scrolled: false}
      // 3. rect → null (getBoundingClientRect вернул null)
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)
        .mockResolvedValueOnce(null as never);

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('Could not get bounding box') }),
        );
      }
    });
  });

  describe('обработка исключений', () => {
    it('обрабатывает Error исключения', async () => {
      mockBrowser.isAvailable.mockRejectedValue(new Error('Browser crashed'));

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('vsl_get_visual failed') }),
        );
      }
    });

    it('обрабатывает не-Error исключения', async () => {
      mockBrowser.isAvailable.mockRejectedValue('string error');

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('vsl_get_visual failed') }),
        );
      }
    });

    it('обрабатывает ошибку screenshot gracefully', async () => {
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never)
        .mockResolvedValueOnce({ x: 0, y: 0, width: 100, height: 50 } as never);

      mockPage.screenshot.mockRejectedValue(new Error('Clipped area is empty'));

      const result = await handleGetVisual(
        { element_id: 'btn_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.isError).toBe(true);
      if ('content' in result) {
        expect(result.content[0]).toEqual(
          expect.objectContaining({ text: expect.stringContaining('vsl_get_visual failed') }),
        );
      }
    });
  });
});