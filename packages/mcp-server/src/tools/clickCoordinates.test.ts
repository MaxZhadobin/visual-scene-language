/**
 * Tests for vsl_click_coordinates tool.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleClickCoordinates } from './clickCoordinates.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_click_coordinates', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockPage: {
    evaluate: jest.Mock;
    waitForTimeout: jest.Mock;
    screenshot: jest.Mock;
  };

  beforeEach(() => {
    mockPage = {
      evaluate: jest.fn().mockResolvedValue(true), // elementFromPoint returns true
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-png-data')),
      mouse: { click: jest.fn().mockResolvedValue(undefined) },
    } as unknown as {
      evaluate: jest.Mock;
      waitForTimeout: jest.Mock;
      screenshot: jest.Mock;
      mouse: { click: jest.Mock };
    };

    mockBrowser = {
      isAvailable: jest.fn(),
      navigate: jest.fn(),
      evaluate: jest.fn(),
      getContent: jest.fn(),
      screenshot: jest.fn(),
      getPage: jest.fn().mockResolvedValue(mockPage),
      getFrames: jest.fn().mockResolvedValue([]),
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
      getIdMap: jest.fn().mockReturnValue(new Map([['iframe_2', 'iframe_2']])),
    } as unknown as jest.Mocked<ServerSession>;

    // Defaults
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getSnapshot.mockReturnValue({
      objects: [
        {
          id: 'iframe_2',
          p: [250, 400], // центр элемента (x + width/2, y + height/2)
          s: [300, 400], // размер (width, height)
        },
      ],
    } as never);
  });

  describe('валидация аргументов', () => {
    it('возвращает ошибку если target_id отсутствует', async () => {
      const result = await handleClickCoordinates(
        { target_id: '', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('target_id is required');
    });

    it('возвращает ошибку если target_id не строка', async () => {
      const result = await handleClickCoordinates(
        { target_id: 123 as unknown as string, clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('target_id is required');
    });

    it('возвращает ошибку если clicks отсутствует', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: undefined as unknown as [] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('clicks array is required');
    });

    it('возвращает ошибку если clicks пустой массив', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('clicks array is required');
    });

    it('возвращает ошибку если x не число', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: '50' as unknown as number, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('clicks[0]: x and y must be numbers');
    });

    it('возвращает ошибку если y не число', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: '50' as unknown as number }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('clicks[0]: x and y must be numbers');
    });

    it('возвращает ошибку если delay_after_ms не число', async () => {
      const result = await handleClickCoordinates(
        {
          target_id: 'iframe_2',
          clicks: [{ x: 50, y: 50, delay_after_ms: '500' as unknown as number }],
        },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('clicks[0]: delay_after_ms must be a number');
    });

    it('возвращает ошибку если return_state не boolean', async () => {
      const result = await handleClickCoordinates(
        {
          target_id: 'iframe_2',
          clicks: [{ x: 50, y: 50 }],
          return_state: 'yes' as unknown as boolean,
        },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('return_state must be a boolean');
    });
  });

  describe('проверка snapshot и browser availability', () => {
    it('возвращает ошибку если snapshot отсутствует', async () => {
      mockSession.hasSnapshot.mockReturnValue(false);

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('No snapshot available');
    });

    it('возвращает ошибку если Playwright не установлен', async () => {
      mockBrowser.isAvailable.mockResolvedValue(false);

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Playwright is not installed');
    });
  });

  describe('поиск элемента в snapshot', () => {
    it('возвращает ошибку если элемент не найден в snapshot', async () => {
      mockSession.getSnapshot.mockReturnValue({
        objects: [{ id: 'other_element', rect: { x: 0, y: 0, width: 100, height: 100 } }],
      } as never);

      const result = await handleClickCoordinates(
        { target_id: 'nonexistent', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.error).toContain('not found in idMap');
    });

    it('возвращает ошибку если элемент найден но без rect', async () => {
      mockSession.getSnapshot.mockReturnValue({
        objects: [{ id: 'iframe_2' }],
      } as never);

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.error).toContain('not found in snapshot or has no position/size');
    });
  });

  describe('выполнение кликов', () => {
    it('выполняет одиночный клик по абсолютным координатам', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 100 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.actions_completed).toBe(1);
      // Element rect: x=100, y=200. Click at (50, 100) relative → absolute (150, 300)
      expect(mockPage.mouse.click).toHaveBeenCalledWith(150, 300);
    });

    it('выполняет множественные клики последовательно', async () => {
      const result = await handleClickCoordinates(
        {
          target_id: 'iframe_2',
          clicks: [
            { x: 50, y: 50 },
            { x: 150, y: 50 },
            { x: 250, y: 150 },
          ],
        },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockPage.mouse.click).toHaveBeenCalledTimes(3);
      // Element rect: x=100, y=200
      expect(mockPage.mouse.click).toHaveBeenNthCalledWith(1, 150, 250);
      expect(mockPage.mouse.click).toHaveBeenNthCalledWith(2, 250, 250);
      expect(mockPage.mouse.click).toHaveBeenNthCalledWith(3, 350, 350);
    });

    it('вызывает waitForTimeout после клика с delay_after_ms', async () => {
      const result = await handleClickCoordinates(
        {
          target_id: 'iframe_2',
          clicks: [{ x: 50, y: 50, delay_after_ms: 500 }],
        },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(500);
    });

    it('не вызывает waitForTimeout если delay_after_ms не указан', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      // waitForTimeout вызывается только для стабилизации DOM (100ms)
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(100);
    });

    it('не вызывает waitForTimeout если delay_after_ms = 0', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50, delay_after_ms: 0 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      // Только стабилизация DOM
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(100);
    });
  });

  describe('возврат состояния (return_state)', () => {
    it('возвращает diff + snapshot + screenshot по умолчанию (return_state=true)', async () => {
      mockBrowser.evaluate.mockResolvedValue('http://example.com' as never);

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.screenshot).toBeDefined();
      expect(result.data?.screenshot?.type).toBe('image');
      expect(result.data?.screenshot?.mimeType).toBe('image/png');
      expect(result.data?.screenshot?.data).toBe(Buffer.from('fake-png-data').toString('base64'));
    });

    it('не возвращает состояние если return_state=false', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }], return_state: false },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.screenshot).toBeUndefined();
      expect(result.data?.diff).toBeUndefined();
      expect(result.data?.snapshot).toBeUndefined();
    });
  });

  describe('метаданные', () => {
    it('включает metadata с метриками', async () => {
      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.json_size_bytes).toBeGreaterThan(0);
      expect(result.metadata?.estimated_tokens).toBeGreaterThan(0);
      expect(result.metadata?.execution_time_ms).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.timestamp).toBeDefined();
    });
  });

  describe('обработка исключений', () => {
    it('обрабатывает Error исключения', async () => {
      mockBrowser.isAvailable.mockRejectedValue(new Error('Browser crashed'));

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_click_coordinates failed');
      expect(result.error).toContain('Browser crashed');
    });

    it('обрабатывает не-Error исключения', async () => {
      mockBrowser.isAvailable.mockRejectedValue('string error');

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_click_coordinates failed');
    });

    it('обрабатывает ошибку screenshot gracefully', async () => {
      mockBrowser.evaluate.mockResolvedValue('http://example.com' as never);
      mockPage.screenshot.mockRejectedValue(new Error('Screenshot failed'));

      const result = await handleClickCoordinates(
        { target_id: 'iframe_2', clicks: [{ x: 50, y: 50 }] },
        mockBrowser,
        mockSession,
      );

      // Результат всё равно success, просто без screenshot
      expect(result.status).toBe('success');
      expect(result.data?.screenshot).toBeUndefined();
    });
  });
});