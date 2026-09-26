/**
 * Unit tests for BrowserManager upload methods (uploadFile, waitForFileChooser).
 *
 * Test cases:
 *  - uploadFile: успешная загрузка одного файла (абсолютный путь)
 *  - uploadFile: успешная загрузка нескольких файлов
 *  - uploadFile: относительный путь разрешается относительно CWD
 *  - uploadFile: path traversal — относительный путь с ../ выходит за CWD → Error
 *  - uploadFile: пустой массив filePaths → Error
 *  - uploadFile: вызывает page.setInputFiles с правильными аргументами (один файл → string, несколько → array)
 *  - waitForFileChooser: успешный возврат fileChooser
 *  - waitForFileChooser: использует дефолтный timeout из config
 *  - waitForFileChooser: передаёт кастомный timeout
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import path from 'node:path';
import { BrowserManager } from './manager.js';
import type { BrowserConfig } from '../config/loader.js';

describe('BrowserManager upload methods', () => {
  let manager: BrowserManager;
  let mockPage: {
    setInputFiles: jest.Mock;
    waitForEvent: jest.Mock;
  };

  const mockConfig: BrowserConfig = {
    downloadsPath: '~/.vsl/downloads',
    downloadTimeout: 30000,
  } as BrowserConfig;

  beforeEach(() => {
    mockPage = {
      setInputFiles: jest.fn().mockResolvedValue(undefined),
      waitForEvent: jest.fn().mockResolvedValue({
        setFiles: jest.fn().mockResolvedValue(undefined),
      }),
    };

    manager = new BrowserManager(mockConfig);
    // Inject mock page directly into private field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).page = mockPage;
  });

  describe('uploadFile', () => {
    it('загружает один файл с абсолютным путём', async () => {
      const absolutePath = '/tmp/test-file.txt';
      await manager.uploadFile('input[type=file]', [absolutePath]);

      expect(mockPage.setInputFiles).toHaveBeenCalledWith(
        'input[type=file]',
        absolutePath,
      );
    });

    it('загружает несколько файлов', async () => {
      const paths = ['/tmp/file1.txt', '/tmp/file2.txt'];
      await manager.uploadFile('input[type=file]', paths);

      expect(mockPage.setInputFiles).toHaveBeenCalledWith(
        'input[type=file]',
        paths,
      );
    });

    it('разрешает относительный путь относительно CWD', async () => {
      const cwd = process.cwd();
      const relativePath = 'test-file.txt';
      const expectedResolved = path.resolve(cwd, relativePath);

      await manager.uploadFile('input[type=file]', [relativePath]);

      expect(mockPage.setInputFiles).toHaveBeenCalledWith(
        'input[type=file]',
        expectedResolved,
      );
    });

    it('выбрасывает Error при path traversal (относительный путь выходит за CWD)', async () => {
      const traversalPath = '../../../etc/passwd';

      await expect(
        manager.uploadFile('input[type=file]', [traversalPath]),
      ).rejects.toThrow('Path traversal detected');
    });

    it('выбрасывает Error при пустом массиве filePaths', async () => {
      await expect(
        manager.uploadFile('input[type=file]', []),
      ).rejects.toThrow('filePaths must contain at least one file path');
    });

    it('передаёт string для одного файла и array для нескольких', async () => {
      // Один файл → string
      await manager.uploadFile('#file', ['/tmp/single.txt']);
      expect(mockPage.setInputFiles).toHaveBeenLastCalledWith(
        '#file',
        '/tmp/single.txt',
      );

      // Несколько файлов → array
      await manager.uploadFile('#file', ['/tmp/a.txt', '/tmp/b.txt']);
      expect(mockPage.setInputFiles).toHaveBeenLastCalledWith('#file', [
        '/tmp/a.txt',
        '/tmp/b.txt',
      ]);
    });

    it('абсолютный путь используется напрямую без проверки traversal', async () => {
      // Абсолютные пути не проходят path traversal проверку (пользователь явно указал)
      const absolutePath = '/etc/passwd';
      await manager.uploadFile('input[type=file]', [absolutePath]);

      expect(mockPage.setInputFiles).toHaveBeenCalledWith(
        'input[type=file]',
        absolutePath,
      );
    });
  });

  describe('waitForFileChooser', () => {
    it('возвращает fileChooser объект', async () => {
      const mockFileChooser = { setFiles: jest.fn() };
      mockPage.waitForEvent.mockResolvedValue(mockFileChooser);

      const result = await manager.waitForFileChooser();

      expect(result).toBe(mockFileChooser);
      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: expect.any(Number),
      });
    });

    it('использует дефолтный timeout из config.downloadTimeout', async () => {
      await manager.waitForFileChooser();

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: 30000, // mockConfig.downloadTimeout
      });
    });

    it('использует кастомный timeout если передан', async () => {
      await manager.waitForFileChooser(5000);

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: 5000,
      });
    });

    it('использует дефолт 60000 если downloadTimeout не задан в config', async () => {
      const managerNoTimeout = new BrowserManager({} as BrowserConfig);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (managerNoTimeout as any).page = mockPage;

      await managerNoTimeout.waitForFileChooser();

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: 60000,
      });
    });
  });
});