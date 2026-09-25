/**
 * Unit tests for vsl_execute_action tool (T1.6.3).
 *
 * Test cases:
 *  - Валидация аргументов (action, target_id)
 *  - Проверка snapshot availability
 *  - Проверка browser availability
 *  - Ленивая навигация: автоматический переход на URL из snapshot
 *  - Ленивая навигация: пропуск навигации если URL совпадает
 *  - Ленивая навигация: пропуск если snapshotUrl отсутствует
 *  - Выполнение действия click
 *  - Выполнение действия type (с value)
 *  - Выполнение действия type (без value → ошибка)
 *  - Выполнение действия scroll
 *  - Выполнение действия select (с value)
 *  - Выполнение действия hover
 *  - Выполнение действия focus
 *  - Выполнение действия blur
 *  - Обработка неизвестного действия
 *  - Обработка исключений
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleExecuteAction } from './executeAction.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_execute_action', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;

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

    mockSession = {
      hasSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      getDiff: jest.fn(),
      clear: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;

    // Дефолтные моки
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValue(undefined);
    mockBrowser.navigate.mockResolvedValue(undefined);
  });

  describe('валидация аргументов', () => {
    it('возвращает ошибку если action отсутствует', async () => {
      const result = await handleExecuteAction(
        { action: '', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('action is required');
    });

    it('возвращает ошибку если target_id отсутствует', async () => {
      const result = await handleExecuteAction(
        { action: 'click', target_id: '' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('target_id is required');
    });

    it('возвращает ошибку для неизвестного действия', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
      } as never);
      mockBrowser.evaluate.mockResolvedValue('https://example.com' as never);

      const result = await handleExecuteAction(
        { action: 'unknown_action', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Unknown action: unknown_action');
    });
  });

  describe('проверка snapshot и browser', () => {
    it('возвращает ошибку если snapshot отсутствует', async () => {
      mockSession.hasSnapshot.mockReturnValue(false);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('No snapshot available');
    });

    it('возвращает ошибку если Playwright не установлен', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockBrowser.isAvailable.mockResolvedValue(false);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Playwright is not installed');
    });
  });

  describe('ленивая навигация', () => {
    beforeEach(() => {
      mockSession.hasSnapshot.mockReturnValue(true);
    });

    it('автоматически навигирует если текущий URL не совпадает с snapshot', async () => {
      const snapshotUrl = 'https://example.com/page1';
      const currentUrl = 'https://example.com/page2';

      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: snapshotUrl },
      } as never);

      // browser.evaluate возвращает текущий URL страницы
      mockBrowser.evaluate.mockResolvedValueOnce(currentUrl as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.navigate).toHaveBeenCalledWith(snapshotUrl);
    });

    it('пропускает навигацию если URL совпадает с snapshot', async () => {
      const snapshotUrl = 'https://example.com/page1';

      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: snapshotUrl },
      } as never);

      // browser.evaluate возвращает тот же URL
      mockBrowser.evaluate.mockResolvedValueOnce(snapshotUrl as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.navigate).not.toHaveBeenCalled();
    });

    it('пропускает навигацию если snapshotUrl отсутствует', async () => {
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: undefined },
      } as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.navigate).not.toHaveBeenCalled();
    });

    it('пропускает навигацию если snapshot.canvas.url пустая строка', async () => {
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: '' },
      } as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.navigate).not.toHaveBeenCalled();
    });
  });

  describe('выполнение действий', () => {
    beforeEach(() => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
      } as never);
      mockBrowser.evaluate.mockResolvedValue('https://example.com' as never);
    });

    it('выполняет действие click', async () => {
      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('click');
      expect(result.data?.target_id).toBe('button_0');
      expect(result.data?.success).toBe(true);
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие type с value', async () => {
      const result = await handleExecuteAction(
        { action: 'type', target_id: 'input_0', value: 'test text' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('type');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('возвращает ошибку для type без value', async () => {
      const result = await handleExecuteAction(
        { action: 'type', target_id: 'input_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('value is required for type action');
    });

    it('выполняет действие scroll', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'down' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('scroll');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие scroll с дефолтным значением (down)', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие select с value', async () => {
      const result = await handleExecuteAction(
        { action: 'select', target_id: 'select_0', value: 'option1' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('select');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('возвращает ошибку для select без value', async () => {
      const result = await handleExecuteAction(
        { action: 'select', target_id: 'select_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('value is required for select action');
    });

    it('выполняет действие hover', async () => {
      const result = await handleExecuteAction(
        { action: 'hover', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('hover');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие focus', async () => {
      const result = await handleExecuteAction(
        { action: 'focus', target_id: 'input_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('focus');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие blur', async () => {
      const result = await handleExecuteAction(
        { action: 'blur', target_id: 'input_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('blur');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('возвращает ошибку для не реализованного действия (check, uncheck, press)', async () => {
      const result = await handleExecuteAction(
        { action: 'check', target_id: 'checkbox_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Action check is not yet implemented');
    });
  });

  describe('обработка исключений', () => {
    beforeEach(() => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
      } as never);
      mockBrowser.evaluate.mockResolvedValue('https://example.com' as never);
    });

    it('обрабатывает Error исключения', async () => {
      mockBrowser.evaluate.mockRejectedValueOnce(new Error('Browser crashed'));

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_execute_action failed');
      expect(result.error).toContain('Browser crashed');
    });

    it('обрабатывает не-Error исключения', async () => {
      mockBrowser.evaluate.mockRejectedValueOnce('string error');

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_execute_action failed');
      expect(result.error).toContain('string error');
    });
  });
});