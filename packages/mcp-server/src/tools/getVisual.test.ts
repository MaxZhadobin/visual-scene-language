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

  it('успешно получает visual fragment', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce(true as never) // elementExists
      .mockResolvedValueOnce({ x: 10, y: 20, width: 100, height: 50 } as never); // rect

    const fakeBuffer = Buffer.from('fake-image-data');
    mockPage.screenshot.mockResolvedValue(fakeBuffer);

    const result = await handleGetVisual({ element_id: 'btn_submit' }, mockBrowser);

    expect(result.status).toBe('success');
    expect(result.data?.element_id).toBe('btn_submit');
    expect(result.data?.image).toBe(fakeBuffer.toString('base64'));
    expect(result.data?.mediaType).toBe('image/png');
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 10, y: 20, width: 100, height: 50 },
    });
  });

  it('возвращает ошибку, если element_id не указан', async () => {
    const result = await handleGetVisual({ element_id: '' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('element_id is required');
  });

  it('возвращает ошибку, если Playwright не установлен', async () => {
    mockBrowser.isAvailable.mockResolvedValue(false);

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Playwright is not installed');
  });

  it('возвращает ошибку, если элемент не найден', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValueOnce(false as never); // elementExists = false

    const result = await handleGetVisual({ element_id: 'nonexistent' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Element not found');
    expect(result.error).toContain('nonexistent');
  });

  it('возвращает ошибку, если не удалось получить bounding box', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate
      .mockResolvedValueOnce(true as never) // elementExists
      .mockResolvedValueOnce(null as never); // rect = null

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Could not get bounding box');
  });

  it('обрабатывает исключения из browser.evaluate()', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue(new Error('Page context destroyed'));

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Page context destroyed');
    expect(result.error).toContain('vsl_get_visual failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockRejectedValue('string error');

    const result = await handleGetVisual({ element_id: 'btn' }, mockBrowser);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });
});