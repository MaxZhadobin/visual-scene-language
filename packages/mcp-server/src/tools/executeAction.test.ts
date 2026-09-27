/**
 * Unit tests for vsl_execute_action tool (T1.6.3).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleExecuteAction } from './executeAction.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_execute_action', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockPage: {
    click: jest.Mock;
    fill: jest.Mock;
    waitForTimeout: jest.Mock;
    keyboard: { press: jest.Mock };
  };

  beforeEach(() => {
    mockPage = {
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
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

    it('возвращает ошибку при return_state не boolean', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
      } as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0', return_state: 'true' as unknown as boolean },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('return_state must be a boolean');
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

      // 1. lazy navigation URL check → currentUrl (не совпадает)
      // 2. hasVslIds → true
      // 3. click → page.click (не evaluate)
      // 4. page.waitForTimeout (не evaluate)
      // 5. стабилизация DOM (setTimeout 100ms) → undefined
      // 6. currentUrl → currentUrl
      // 7. extractDomTreeInBrowser → []
      // 8. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce(currentUrl as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(currentUrl as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

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

      // 1. lazy navigation URL check → snapshotUrl (совпадает)
      // 2. hasVslIds → true
      // 3. стабилизация DOM → undefined
      // 4. currentUrl → snapshotUrl
      // 5. extractDomTreeInBrowser → []
      // 6. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce(snapshotUrl as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(snapshotUrl as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

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

      // snapshotUrl отсутствует → if (snapshotUrl) пропускает URL check
      // 1. hasVslIds → true
      // 2. стабилизация DOM → undefined
      // 3. currentUrl → 'https://example.com'
      // 4. extractDomTreeInBrowser → []
      // 5. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

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

      // snapshotUrl = '' → if (snapshotUrl) → false
      // 1. hasVslIds → true
      // 2. стабилизация DOM → undefined
      // 3. currentUrl → 'https://example.com'
      // 4. extractDomTreeInBrowser → []
      // 5. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

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
      // Дефолт: все evaluate возвращают 'https://example.com'
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

    it('выполняет действие fill как алиас для type', async () => {
      const result = await handleExecuteAction(
        { action: 'fill', target_id: 'input_0', value: 'test text' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('fill');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('возвращает ошибку для fill без value', async () => {
      const result = await handleExecuteAction(
        { action: 'fill', target_id: 'input_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('value is required for type action');
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
    it('выполняет действие press с value', async () => {
      const result = await handleExecuteAction(
        { action: 'press', target_id: 'input_0', value: 'Enter' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('press');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter', { delay: 0 });
    });

    it('возвращает ошибку для press без value', async () => {
      const result = await handleExecuteAction(
        { action: 'press', target_id: 'input_0' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('value is required for press action');
    });

    it('выполняет действие press с клавишей Tab', async () => {
      const result = await handleExecuteAction(
        { action: 'press', target_id: 'input_0', value: 'Tab' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('success');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Tab', { delay: 0 });
    });

    it('выполняет действие press с клавишей Escape', async () => {
      const result = await handleExecuteAction(
        { action: 'press', target_id: 'input_0', value: 'Escape' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('success');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape', { delay: 0 });
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

    it('выполняет действие scroll left', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'left' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('success');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие scroll right', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'right' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('success');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('выполняет действие scroll с amount (down:300)', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'down:300' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('success');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });

    it('отклоняет невалидное направление scroll', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'diagonal' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid scroll direction');
    });

    it('отклоняет невалидный amount в scroll', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'down:abc' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid scroll amount');
    });

    it('отклоняет scroll с слишком большим количеством частей', async () => {
      const result = await handleExecuteAction(
        { action: 'scroll', target_id: 'page', value: 'down:300:extra' },
        mockBrowser,
        mockSession,
      );
      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid scroll value format');
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

    it('выполняет действие upload с одним файлом', async () => {
      const result = await handleExecuteAction(
        { action: 'upload', target_id: 'input_0', value: '/tmp/test.txt' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.action).toBe('upload');
      expect(result.data?.target_id).toBe('input_0');
      expect(result.data?.success).toBe(true);
      expect(result.data?.upload).toEqual({
        selector: expect.any(String),
        files: ['/tmp/test.txt'],
        success: true,
      });
      expect(mockBrowser.uploadFile).toHaveBeenCalled();
    });

    it('выполняет действие upload с несколькими файлами', async () => {
      const result = await handleExecuteAction(
        { action: 'upload', target_id: 'input_0', value: '/tmp/a.txt, /tmp/b.txt' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.upload?.files).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
      expect(mockBrowser.uploadFile).toHaveBeenCalled();
    });

    it('возвращает ошибку для upload без value', async () => {
      const result = await handleExecuteAction(
        { action: 'upload', target_id: 'input_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('value is required for upload action');
    });

    it('возвращает ошибку для upload с пустым value', async () => {
      const result = await handleExecuteAction(
        { action: 'upload', target_id: 'input_0', value: '   ' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('value must contain at least one file path');
    });

    it('обрабатывает ошибку uploadFile', async () => {
      mockBrowser.uploadFile.mockRejectedValueOnce(new Error('Path traversal detected'));

      const result = await handleExecuteAction(
        { action: 'upload', target_id: 'input_0', value: '../../../etc/passwd' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_execute_action failed');
      expect(result.error).toContain('Path traversal detected');
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

  describe('return_state параметр', () => {
    beforeEach(() => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
      } as never);
      mockBrowser.evaluate.mockResolvedValue('https://example.com' as never);
    });

    it('не возвращает state при return_state=false', async () => {
      // 1. hasVslIds → true
      // 2. click → page.click (не evaluate)
      // 3. page.waitForTimeout (не evaluate)
      // return_state=false → пропускает getStateAfterAction
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce('https://example.com' as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0', return_state: false },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.state).toBeUndefined();
    });

    it('возвращает diff в state при return_state=true (default)', async () => {
      const mockElements = [{ id: 'test', type: 'button' }];
      // 1. hasVslIds → true
      // 2. click → page.click (не evaluate)
      // 3. page.waitForTimeout (не evaluate)
      // 4. стабилизация DOM (setTimeout 100ms) → undefined
      // 5. currentUrl → 'https://example.com'
      // 6. extractDomTreeInBrowser → mockElements
      // 7. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce(mockElements as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

      mockSession.getDiff.mockReturnValue({
        changes: { added: [], modified: [], removed: [] },
      });
      mockSession.getSnapshot.mockReturnValue({ canvas: { url: 'https://example.com' } } as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.state).toBeDefined();
      expect(result.data?.state?.diff).toBeDefined();
      expect(mockSession.getDiff).toHaveBeenCalled();
    });

    it('обрабатывает ошибку getStateAfterAction gracefully', async () => {
      // Последовательность evaluate вызовов:
      // 1. URL check → 'https://example.com' (совпадает, не навигирует)
      // 2. hasVslIds → true
      // 3. click → page.click (не evaluate)
      // 4. page.waitForTimeout (не evaluate)
      // 5. стабилизация DOM → undefined
      // 6. currentUrl → 'https://example.com'
      // 7. getStateAfterAction: extractDomTreeInBrowser → throws error
      mockBrowser.evaluate
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce('https://example.com' as never)
        .mockRejectedValueOnce(new Error('DOM extraction failed'));

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0', return_state: true },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.state?.error).toBeDefined();
      expect(result.warning).toContain('State extraction failed');
    });
  });

  describe('auto-snapshot логика (проверка data-vsl-id)', () => {
    beforeEach(() => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
      } as never);
      mockBrowser.evaluate.mockResolvedValue('https://example.com' as never);
    });

    it('автоматически создаёт snapshot если data-vsl-id отсутствуют в DOM', async () => {
      const mockElements = [{ id: 'btn_1', type: 'button', text: 'Click me' }];

      // 1. hasVslIds → false (нет data-vsl-id)
      // 2. extractDomTreeInBrowser → mockElements
      // 3. viewport → { width: 1024, height: 768 }
      // 4. click → page.click (не evaluate)
      // 5. page.waitForTimeout (не evaluate)
      // 6. стабилизация DOM → undefined
      // 7. currentUrl → 'https://example.com'
      // 8. getStateAfterAction: extractDomTreeInBrowser → mockElements
      // 9. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce(false as never)
        .mockResolvedValueOnce(mockElements as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce(mockElements as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

      mockSession.getDiff.mockReturnValue({ changes: { added: [], modified: [], removed: [] } });
      mockSession.getSnapshot.mockReturnValue({ canvas: { url: 'https://example.com' } } as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockSession.snapshotFromElements).toHaveBeenCalled();
    });

    it('пропускает создание snapshot если data-vsl-id уже есть в DOM', async () => {
      // 1. URL check → 'https://example.com' (совпадает, не навигирует)
      // 2. hasVslIds → true (data-vsl-id есть)
      // 3. click → page.click (не evaluate)
      // 4. page.waitForTimeout (не evaluate)
      // 5. стабилизация DOM → undefined
      // 6. currentUrl → 'https://example.com'
      // 7. getStateAfterAction: extractDomTreeInBrowser → []
      // 8. viewport → { width: 1024, height: 768 }
      mockBrowser.evaluate
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce('https://example.com' as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce({ width: 1024, height: 768 } as never);

      mockSession.getDiff.mockReturnValue({ changes: { added: [], modified: [], removed: [] } });
      mockSession.getSnapshot.mockReturnValue({ canvas: { url: 'https://example.com' } } as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      // snapshotFromElements вызывается в getStateAfterAction (строка 116) для обновления snapshot
      // Auto-snapshot (строка 238-249) НЕ вызывается, потому что hasVslIds = true
      // Значит, snapshotFromElements должен быть вызван ровно 1 раз
      expect(mockSession.snapshotFromElements).toHaveBeenCalledTimes(1);
    });

    it('обрабатывает ошибку при создании auto-snapshot gracefully', async () => {
      // 1. hasVslIds → false
      // 2. extractDomTreeInBrowser → throws error
      mockBrowser.evaluate
        .mockResolvedValueOnce(false as never)
        .mockRejectedValueOnce(new Error('DOM extraction failed'));

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'button_0' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_execute_action failed');
      expect(result.error).toContain('DOM extraction failed');
    });
  });
});