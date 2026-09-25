/**
 * Unit tests for vsl_download tool (T1.6.3, dev_10).
 *
 * Test cases:
 *  - Валидация аргументов (target_id ИЛИ value)
 *  - Проверка snapshot availability (для target_id)
 *  - Проверка browser availability
 *  - Ленивая навигация: автоматический переход на URL из snapshot
 *  - Ленивая навигация: пропуск навигации если URL совпадает
 *  - Режим value: прямое скачивание по URL
 *  - Режим target_id: клик по элементу
 *  - Нет downloads → ошибка
 *  - Успешная загрузка (completed)
 *  - save_path: сохранение файла
 *  - Обработка исключений
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleDownload } from './download.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_download', () => {
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
      getDownloads: jest.fn(),
      waitForDownload: jest.fn(),
      saveDownload: jest.fn(),
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
    mockBrowser.getDownloads.mockReturnValue([]);
  });

  describe('валидация аргументов', () => {
    it('возвращает ошибку если ни target_id, ни value не указаны', async () => {
      const result = await handleDownload({}, mockBrowser, mockSession);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Either target_id');
    });

    it('возвращает ошибку если target_id и value оба пустые', async () => {
      const result = await handleDownload(
        { target_id: '', value: '' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Either target_id');
    });
  });

  describe('проверка snapshot', () => {
    it('возвращает ошибку если target_id указан но snapshot отсутствует', async () => {
      mockSession.hasSnapshot.mockReturnValue(false);

      const result = await handleDownload(
        { target_id: 'btn_download' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('No snapshot available');
    });
  });

  describe('проверка browser availability', () => {
    it('возвращает ошибку если браузер недоступен', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockBrowser.isAvailable.mockResolvedValue(false);

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Playwright is not installed');
    });
  });

  describe('ленивая навигация', () => {
    it('навигирует если URL браузера не совпадает с snapshot URL', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com/page' },
      } as never);
      mockBrowser.evaluate
        .mockResolvedValueOnce('https://other.com') // currentUrl
        .mockResolvedValueOnce(undefined); // evaluate for download

      await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(mockBrowser.navigate).toHaveBeenCalledWith('https://example.com/page');
    });

    it('пропускает навигацию если URL совпадает', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com/page' },
      } as never);
      mockBrowser.evaluate
        .mockResolvedValueOnce('https://example.com/page') // currentUrl === snapshotUrl
        .mockResolvedValueOnce(undefined); // evaluate for download

      await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(mockBrowser.navigate).not.toHaveBeenCalled();
    });

    it('пропускает навигацию если snapshotUrl отсутствует', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: {},
      } as never);

      await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(mockBrowser.navigate).not.toHaveBeenCalled();
    });
  });

  describe('режим value (прямое скачивание по URL)', () => {
    it('создаёт <a download> элемент и кликает', async () => {
      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_1' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_1',
        filename: 'file.pdf',
        url: 'https://example.com/file.pdf',
        status: 'completed',
        path: '/tmp/file.pdf',
      } as never);

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.downloadId).toBe('dl_1');
      expect(result.data?.filename).toBe('file.pdf');
      expect(result.data?.status).toBe('completed');
      expect(mockBrowser.evaluate).toHaveBeenCalled();
    });
  });

  describe('режим target_id (клик по элементу)', () => {
    it('кликает по элементу и получает download', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com/page' },
      } as never);
      // Порядок evaluate вызовов:
      // 1. Проверка текущего URL для ленивой навигации (L90)
      // 2. Клик по элементу, возвращает href (L118)
      mockBrowser.evaluate
        .mockResolvedValueOnce('https://example.com/page') // currentUrl === snapshotUrl, skip nav
        .mockResolvedValueOnce('https://example.com/file.pdf'); // downloadUrl from element href

      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_2' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_2',
        filename: 'report.pdf',
        url: 'https://example.com/file.pdf',
        status: 'completed',
        path: null,
      } as never);

      const result = await handleDownload(
        { target_id: 'btn_download' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.downloadId).toBe('dl_2');
    });

    it('использует текущий URL страницы если элемент не имеет href', async () => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com/page' },
      } as never);
      // Порядок evaluate вызовов:
      // 1. Проверка текущего URL для ленивой навигации (L90)
      // 2. Клик по элементу, возвращает '' (нет href) (L118)
      // 3. Fallback: получение текущего URL страницы (L134)
      mockBrowser.evaluate
        .mockResolvedValueOnce('https://example.com/page') // currentUrl === snapshotUrl, skip nav
        .mockResolvedValueOnce('') // element has no href
        .mockResolvedValueOnce('https://example.com/page'); // fallback to current URL

      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_3' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_3',
        filename: 'page.html',
        url: 'https://example.com/page',
        status: 'completed',
        path: null,
      } as never);

      const result = await handleDownload(
        { target_id: 'btn_download' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(result.data?.url).toBe('https://example.com/page');
    });
  });
  describe('ожидание загрузки', () => {
    it('возвращает ошибку если download не был инициирован', async () => {
      mockBrowser.getDownloads.mockReturnValue([]);

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Download was not initiated');
    });

    it('берёт последнюю загрузку из списка', async () => {
      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_old' },
        { downloadId: 'dl_new' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_new',
        filename: 'file.pdf',
        url: 'https://example.com/file.pdf',
        status: 'completed',
        path: null,
      } as never);

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.data?.downloadId).toBe('dl_new');
      expect(mockBrowser.waitForDownload).toHaveBeenCalledWith('dl_new', undefined);
    });

    it('передаёт timeout в waitForDownload', async () => {
      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_1' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_1',
        filename: 'file.pdf',
        url: 'https://example.com/file.pdf',
        status: 'completed',
        path: null,
      } as never);

      await handleDownload(
        { value: 'https://example.com/file.pdf', timeout: 5000 },
        mockBrowser,
        mockSession,
      );

      expect(mockBrowser.waitForDownload).toHaveBeenCalledWith('dl_1', 5000);
    });
  });

  describe('save_path', () => {
    it('сохраняет файл если status completed и save_path указан', async () => {
      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_1' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_1',
        filename: 'file.pdf',
        url: 'https://example.com/file.pdf',
        status: 'completed',
        path: '/tmp/file.pdf',
      } as never);
      mockBrowser.saveDownload.mockResolvedValue(undefined);

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf', save_path: '/home/user/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.saveDownload).toHaveBeenCalledWith('dl_1', '/home/user/file.pdf');
      expect(result.data?.path).toBe('/home/user/file.pdf');
    });

    it('не сохраняет файл если status не completed', async () => {
      mockBrowser.getDownloads.mockReturnValue([
        { downloadId: 'dl_1' },
      ] as never);
      mockBrowser.waitForDownload.mockResolvedValue({
        downloadId: 'dl_1',
        filename: 'file.pdf',
        url: 'https://example.com/file.pdf',
        status: 'failed',
        path: null,
      } as never);

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf', save_path: '/home/user/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      expect(mockBrowser.saveDownload).not.toHaveBeenCalled();
    });
  });

  describe('обработка исключений', () => {
    it('возвращает ошибку при исключении', async () => {
      mockBrowser.isAvailable.mockRejectedValue(new Error('Browser crashed'));

      const result = await handleDownload(
        { value: 'https://example.com/file.pdf' },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('vsl_download failed');
      expect(result.error).toContain('Browser crashed');
    });
  });
});