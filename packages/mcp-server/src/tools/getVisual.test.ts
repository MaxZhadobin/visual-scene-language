/**
 * Unit tests for vsl_get_visual tool (T1.6.3).
 *
 * Test cases:
 *  - Успешное получение visual fragment
 *  - Ошибка: element_id не указан
 *  - Ошибка: Playwright не установлен
 *  - Ошибка: элемент не найден
 *  - Ошибка: не удалось получить bounding box
 *  - Обработка исключений из browser.evaluate()
 *  - Обработка не-Error исключений
 *  - Автоскролл: элемент в viewport — скролл не выполняется
 *  - Автоскролл: элемент вне viewport — скролл выполняется
 *  - Автоскролл: auto_scroll=false — скролл отключён
 *  - Автоскролл: scroll_info возвращается в результате
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleGetVisual } from './getVisual.js';
import type { BrowserManager } from '../browser/manager.js';

describe('vsl_get_visual', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockPage: { screenshot: jest.Mock };

  beforeEach(() => {
    mockPage = {
      screenshot: jest.fn(),
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

    mockBrowser.getPage.mockResolvedValue(mockPage as never);
  });

  it('успешно получает visual fragment (элемент в viewport, скролл не нужен)', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce(true as never) // elementExists
      .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never) // scrollResult: элемент виден
      .mockResolvedValueOnce({ x: 10, y: 20, width: 100, height: 50 } as never); // rect

    const fakeBuffer = Buffer.from('fake-image-data');
    mockPage.screenshot.mockResolvedValue(fakeBuffer);

    const result = await handleGetVisual({ element_id: 'btn_submit' }, mockBrowser);

    expect('isError' in result).toBe(false);
    expect(result.content.length).toBe(2);
    expect(result.content[0]).toEqual({
      type: 'image',
      data: fakeBuffer.toString('base64'),
      mimeType: 'image/png',
    });
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 10, y: 20, width: 100, height: 50 },
    });
    // scroll_info не должен присутствовать если скролл не выполнялся
    expect(result.scroll_info).toBeUndefined();
  });

  it('возвращает ошибку, если element_id не указан', async () => {
    const result = await handleGetVisual({ element_id: '' }, mockBrowser);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('element_id is required');
  });

  it('возвращает ошибку, если Playwright не установлен', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Playwright is not installed');
  });

  it('возвращает ошибку, если элемент не найден', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValueOnce(false as never); // elementExists = false

    const result = await handleGetVisual({ element_id: 'nonexistent' }, mockBrowser);

    expect(result.isError).toBe(true);
    const errorText = (result.content[0] as { text: string }).text;
    expect(errorText).toContain('Element not found');
    expect(errorText).toContain('nonexistent');
  });

  it('возвращает ошибку, если не удалось получить bounding box', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce(true as never) // elementExists
      .mockResolvedValueOnce({ needsScroll: false, scrolled: false } as never) // scrollResult
      .mockResolvedValueOnce(null as never); // rect = null

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Could not get bounding box');
  });

  it('обрабатывает исключения из browser.evaluate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue(new Error('Page context destroyed'));

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.isError).toBe(true);
    const errorText = (result.content[0] as { text: string }).text;
    expect(errorText).toContain('Page context destroyed');
    expect(errorText).toContain('vsl_get_visual failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue('string error');

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('string error');
  });

  describe('auto-scroll', () => {
    it('выполняет автоскролл когда элемент вне viewport и возвращает scroll_info', async () => {
      mockBrowser.isAvailable.mockResolvedValue(true);
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never) // elementExists
        .mockResolvedValueOnce({ needsScroll: true, scrolled: true } as never) // scrollResult: элемент вне viewport
        .mockResolvedValueOnce(undefined as never) // waitForScroll (requestAnimationFrame)
        .mockResolvedValueOnce({ x: 0, y: 500 } as never) // scrollOffset после скролла
        .mockResolvedValueOnce({ x: 10, y: 520, width: 100, height: 50 } as never); // rect после скролла

      const fakeBuffer = Buffer.from('fake-image-data');
      mockPage.screenshot.mockResolvedValue(fakeBuffer);

      const result = await handleGetVisual({ element_id: 'btn_bottom' }, mockBrowser);

      expect('isError' in result).toBe(false);
      expect(result.scroll_info).toEqual({
        scrolled: true,
        scroll_offset: { x: 0, y: 500 },
      });
      // Скриншот должен быть сделан с новыми координатами (после скролла)
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        type: 'png',
        clip: { x: 10, y: 520, width: 100, height: 50 },
      });
    });

    it('не выполняет автоскролл когда auto_scroll=false', async () => {
      mockBrowser.isAvailable.mockResolvedValue(true);
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never) // elementExists
        // Нет вызова scrollResult — auto_scroll=false пропускает проверку видимости
        .mockResolvedValueOnce({ x: 10, y: 20, width: 100, height: 50 } as never); // rect

      const fakeBuffer = Buffer.from('fake-image-data');
      mockPage.screenshot.mockResolvedValue(fakeBuffer);

      const result = await handleGetVisual({ element_id: 'btn', auto_scroll: false }, mockBrowser);

      expect('isError' in result).toBe(false);
      expect(result.scroll_info).toBeUndefined();
      // evaluate вызван только 2 раза: elementExists + rect (без scroll checks)
      expect(mockBrowser.evaluate).toHaveBeenCalledTimes(2);
    });

    it('возвращает ошибку если auto_scroll не boolean', async () => {
      const result = await handleGetVisual({ element_id: 'btn', auto_scroll: 'yes' as unknown as boolean }, mockBrowser);

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('auto_scroll must be a boolean');
    });
  });
});