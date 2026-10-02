/* eslint-disable @typescript-eslint/no-explicit-any */
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
    // Inject mock page, browser, and context directly into private fields
    (manager as any).page = mockPage;
    (manager as any).browser = {}; // prevent launch() call in getPage()
    (manager as any).context = { newPage: jest.fn().mockResolvedValue(mockPage), on: jest.fn() }; // support getPage(sessionId)
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

      const result = await manager.waitForFileChooser('default');

      expect(result).toBe(mockFileChooser);
      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: expect.any(Number),
      });
    });

    it('использует дефолтный timeout из config.downloadTimeout', async () => {
      await manager.waitForFileChooser('default');

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: 30000, // mockConfig.downloadTimeout
      });
    });

    it('использует кастомный timeout если передан', async () => {
      await manager.waitForFileChooser('default', 5000);

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: 5000,
      });
    });

    it('использует дефолт 60000 если downloadTimeout не задан в config', async () => {
      const managerNoTimeout = new BrowserManager({} as BrowserConfig);
      (managerNoTimeout as any).page = mockPage;
      (managerNoTimeout as any).context = { newPage: jest.fn().mockResolvedValue(mockPage), on: jest.fn() };
      await managerNoTimeout.waitForFileChooser('default');

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('filechooser', {
        timeout: 60000,
      });
    });
  });
});

describe('launch scenarios', () => {
  let manager: BrowserManager;
  let mockChromium: {
    launch: jest.Mock;
    connectOverCDP: jest.Mock;
    launchPersistentContext: jest.Mock;
  };
  let mockBrowser: {
    contexts: jest.Mock;
    newContext: jest.Mock;
    close: jest.Mock;
  };
  let mockContext: {
    newPage: jest.Mock;
    close: jest.Mock;
    on: jest.Mock;
  };

  beforeEach(() => {
    mockContext = {
      newPage: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    mockBrowser = {
      contexts: jest.fn().mockReturnValue([mockContext]),
      newContext: jest.fn().mockResolvedValue(mockContext),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockChromium = {
      launch: jest.fn().mockResolvedValue(mockBrowser),
      connectOverCDP: jest.fn().mockResolvedValue(mockBrowser),
      launchPersistentContext: jest.fn().mockResolvedValue(mockContext),
    };

    manager = new BrowserManager({} as BrowserConfig);

    // Mock loadPlaywright to return our mock chromium
    jest.spyOn(manager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });
  });

  it('launch() с CDP: вызывает connectOverCDP с правильным endpointURL', async () => {
    const cdpConfig: BrowserConfig = { cdpPort: 9222 } as BrowserConfig;
    const cdpManager = new BrowserManager(cdpConfig);
    jest.spyOn(cdpManager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });

    await cdpManager.launch();

    expect(mockChromium.connectOverCDP).toHaveBeenCalledWith({
      endpointURL: 'http://localhost:9222',
    });
    expect((cdpManager as any).connectedViaCDP).toBe(true);
    expect((cdpManager as any).context).toBe(mockContext);
  });

  it('launch() с CDP: использует существующий context из browser.contexts()', async () => {
    const cdpConfig: BrowserConfig = { cdpPort: 9222 } as BrowserConfig;
    const cdpManager = new BrowserManager(cdpConfig);
    jest.spyOn(cdpManager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });

    await cdpManager.launch();

    expect(mockBrowser.contexts).toHaveBeenCalled();
    expect(mockBrowser.newContext).not.toHaveBeenCalled();
  });

  it('launch() с CDP: создаёт новый context если contexts() пустой', async () => {
    mockBrowser.contexts.mockReturnValue([]);
    const cdpConfig: BrowserConfig = { cdpPort: 9223 } as BrowserConfig;
    const cdpManager = new BrowserManager(cdpConfig);
    jest.spyOn(cdpManager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });

    await cdpManager.launch();

    expect(mockBrowser.newContext).toHaveBeenCalledWith({
      acceptDownloads: true,
    });
  });

  it('launch() с cdpPort: если connectOverCDP упал → запускает launchPersistentContext с --remote-debugging-port', async () => {
    // connectOverCDP падает (браузер не запущен)
    mockChromium.connectOverCDP.mockRejectedValueOnce(new Error('Connection refused'));
    const cdpConfig: BrowserConfig = { cdpPort: 9222, headless: true } as BrowserConfig;
    const cdpManager = new BrowserManager(cdpConfig);
    jest.spyOn(cdpManager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });

    await cdpManager.launch();

    // Должен вызвать launchPersistentContext с --remote-debugging-port
    expect(mockChromium.launchPersistentContext).toHaveBeenCalledWith(
      expect.stringContaining('.vsl/browser-profile'),
      expect.objectContaining({
        args: ['--remote-debugging-port=9222'],
        headless: true,
        acceptDownloads: true,
      }),
    );
    expect((cdpManager as any).browser).toBeNull();
    expect((cdpManager as any).context).toBe(mockContext);
  });

  it('launch() с userDataDir: вызывает launchPersistentContext', async () => {
    const persistentConfig: BrowserConfig = {
      userDataDir: '/tmp/test-profile',
      headless: true,
    } as BrowserConfig;
    const persistentManager = new BrowserManager(persistentConfig);
    jest.spyOn(persistentManager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });

    await persistentManager.launch();

    expect(mockChromium.launchPersistentContext).toHaveBeenCalledWith(
      '/tmp/test-profile',
      {
        headless: true,
        acceptDownloads: true,
      },
    );
    expect((persistentManager as any).browser).toBeNull();
    expect((persistentManager as any).context).toBe(mockContext);
  });

  it('launch() без cdpPort и userDataDir: использует persistent context с дефолтным путём ~/.vsl/browser-profile', async () => {
    const defaultConfig: BrowserConfig = { headless: false } as BrowserConfig;
    const defaultManager = new BrowserManager(defaultConfig);
    jest.spyOn(defaultManager as any, 'loadPlaywright').mockResolvedValue({
      chromium: mockChromium,
    });

    await defaultManager.launch();

    // Проверяем, что launchPersistentContext вызван с дефолтным путём
    expect(mockChromium.launchPersistentContext).toHaveBeenCalledWith(
      expect.stringContaining('.vsl/browser-profile'),
      {
        headless: false,
        acceptDownloads: true,
      },
    );
    expect((defaultManager as any).browser).toBeNull();
    expect((defaultManager as any).context).toBe(mockContext);
  });

  it('launch() не вызывает loadPlaywright повторно если уже запущен', async () => {
    const ephemeralConfig: BrowserConfig = {} as BrowserConfig;
    const ephemeralManager = new BrowserManager(ephemeralConfig);
    const loadSpy = jest
      .spyOn(ephemeralManager as any, 'loadPlaywright')
      .mockResolvedValue({ chromium: mockChromium });

    await ephemeralManager.launch();
    await ephemeralManager.launch(); // Second call

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('close scenarios', () => {
  let manager: BrowserManager;
  let mockBrowser: { close: jest.Mock };
  let mockContext: { close: jest.Mock };

  beforeEach(() => {
    mockBrowser = { close: jest.fn().mockResolvedValue(undefined) };
    mockContext = { close: jest.fn().mockResolvedValue(undefined) };
    manager = new BrowserManager({} as BrowserConfig);
  });

  it('close() с CDP: закрывает context, но НЕ закрывает browser', async () => {
    (manager as any).browser = mockBrowser;
    (manager as any).context = mockContext;
    (manager as any).connectedViaCDP = true;

    await manager.close();

    expect(mockContext.close).toHaveBeenCalled();
    expect(mockBrowser.close).not.toHaveBeenCalled();
    expect((manager as any).connectedViaCDP).toBe(false);
  });

  it('close() без CDP: закрывает и context, и browser', async () => {
    (manager as any).browser = mockBrowser;
    (manager as any).context = mockContext;
    (manager as any).connectedViaCDP = false;

    await manager.close();

    expect(mockContext.close).toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('close() с persistent context (browser=null): закрывает только context', async () => {
    (manager as any).browser = null;
    (manager as any).context = mockContext;

    await manager.close();

    expect(mockContext.close).toHaveBeenCalled();
  });
});