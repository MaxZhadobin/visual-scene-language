/**
 * Unit tests for SessionManager — per-session isolation with singleton BrowserManager.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock BrowserManager
const mockBrowserClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../browser/manager.js', () => ({
  BrowserManager: jest.fn().mockImplementation(() => ({
    close: mockBrowserClose,
  })),
}));

// Mock ServerSession
const mockSessionHasSnapshot = jest.fn<() => boolean>().mockReturnValue(false);
jest.unstable_mockModule('./serverSession.js', () => ({
  ServerSession: jest.fn().mockImplementation(() => ({
    hasSnapshot: mockSessionHasSnapshot,
  })),
}));

// Dynamic import after mocks
const { SessionManager } = await import('./sessionManager.js');
const { BrowserManager } = await import('../browser/manager.js');
const { ServerSession } = await import('./serverSession.js');

describe('SessionManager', () => {
  let manager: InstanceType<typeof SessionManager>;
  const browserConfig = { headless: true } as never;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    manager = new SessionManager(browserConfig, {
      cleanupIntervalMs: 60_000,
      sessionTtlMs: 300_000,
    });
  });

  afterEach(async () => {
    await manager.closeAll();
    jest.useRealTimers();
  });

  describe('getSession', () => {
    it('создаёт новую сессию при первом вызове', () => {
      const ctx = manager.getSession('session-1');

      expect(ctx.sessionId).toBe('session-1');
      expect(ctx.session).toBeDefined();
      expect(ctx.createdAt).toBeGreaterThan(0);
      expect(ctx.lastAccessedAt).toBeGreaterThanOrEqual(ctx.createdAt);
      expect(ServerSession).toHaveBeenCalledTimes(1);
    });

    it('возвращает ту же сессию при повторном вызове', () => {
      const ctx1 = manager.getSession('session-1');
      const ctx2 = manager.getSession('session-1');

      expect(ctx1).toBe(ctx2);
    });

    it('создаёт разные сессии для разных sessionId', () => {
      const ctx1 = manager.getSession('session-1');
      const ctx2 = manager.getSession('session-2');

      expect(ctx1).not.toBe(ctx2);
      expect(ctx1.sessionId).toBe('session-1');
      expect(ctx2.sessionId).toBe('session-2');
      expect(ServerSession).toHaveBeenCalledTimes(2);
    });

    it('использует "default" для пустого sessionId', () => {
      const ctx = manager.getSession('');

      expect(ctx.sessionId).toBe('default');
    });
  });

  describe('getBrowserManager', () => {
    it('создаёт singleton BrowserManager при первом вызове', () => {
      const bm = manager.getBrowserManager();

      expect(bm).toBeDefined();
      expect(BrowserManager).toHaveBeenCalledTimes(1);
    });

    it('возвращает тот же экземпляр при повторном вызове', () => {
      const bm1 = manager.getBrowserManager();
      const bm2 = manager.getBrowserManager();

      expect(bm1).toBe(bm2);
      expect(BrowserManager).toHaveBeenCalledTimes(1);
    });

    it('разные сессии делят один BrowserManager', () => {
      manager.getSession('session-1');
      manager.getSession('session-2');

      const bm = manager.getBrowserManager();
      expect(bm).toBeDefined();
      // BrowserManager создаётся только через getBrowserManager, не через getSession
      expect(BrowserManager).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasSession', () => {
    it('возвращает false для несуществующей сессии', () => {
      expect(manager.hasSession('nonexistent')).toBe(false);
    });

    it('возвращает true после getSession', () => {
      manager.getSession('session-1');
      expect(manager.hasSession('session-1')).toBe(true);
    });

    it('возвращает false после closeSession', async () => {
      manager.getSession('session-1');
      await manager.closeSession('session-1');
      expect(manager.hasSession('session-1')).toBe(false);
    });

    it('обрабатывает пустой sessionId как "default"', () => {
      manager.getSession('');
      expect(manager.hasSession('')).toBe(true);
      expect(manager.hasSession('default')).toBe(true);
    });
  });

  describe('closeSession', () => {
    it('НЕ закрывает браузер (browser — singleton, общий для всех)', async () => {
      manager.getSession('session-1');
      // Инициализируем singleton browser
      manager.getBrowserManager();
      await manager.closeSession('session-1');

      // browser.close() НЕ должен вызываться при закрытии отдельной сессии
      expect(mockBrowserClose).not.toHaveBeenCalled();
    });

    it('удаляет сессию из map', async () => {
      manager.getSession('session-1');
      await manager.closeSession('session-1');

      expect(manager.hasSession('session-1')).toBe(false);
      expect(manager.getSessionCount()).toBe(0);
    });

    it('не падает при закрытии несуществующей сессии', async () => {
      await expect(manager.closeSession('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('closeAll', () => {
    it('закрывает singleton браузер один раз', async () => {
      manager.getSession('session-1');
      manager.getSession('session-2');
      manager.getSession('session-3');

      // Инициализируем singleton browser
      manager.getBrowserManager();

      await manager.closeAll();

      // BrowserManager.close() вызывается ровно 1 раз (singleton)
      expect(mockBrowserClose).toHaveBeenCalledTimes(1);
      expect(manager.getSessionCount()).toBe(0);
    });

    it('останавливает cleanup таймер', async () => {
      manager.getSession('session-1');
      await manager.closeAll();

      // После closeAll таймер должен быть остановлен — advanceTimersByTime не должен вызывать cleanup
      const closeCountBefore = mockBrowserClose.mock.calls.length;
      jest.advanceTimersByTime(600_000);
      expect(mockBrowserClose.mock.calls.length).toBe(closeCountBefore);
    });
  });

  describe('getActiveSessions', () => {
    it('возвращает пустой массив при отсутствии сессий', () => {
      expect(manager.getActiveSessions()).toEqual([]);
    });

    it('возвращает информацию об активных сессиях', () => {
      manager.getSession('session-1');
      manager.getSession('session-2');

      const sessions = manager.getActiveSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('session-1');
      expect(sessions[1].sessionId).toBe('session-2');
      expect(sessions[0].hasSnapshot).toBe(false);
    });
  });

  describe('getSessionCount', () => {
    it('возвращает 0 при отсутствии сессий', () => {
      expect(manager.getSessionCount()).toBe(0);
    });

    it('возвращает правильное количество сессий', () => {
      manager.getSession('session-1');
      manager.getSession('session-2');
      expect(manager.getSessionCount()).toBe(2);
    });
  });

  describe('cleanupInactiveSessions', () => {
    it('очищает сессии, неактивные дольше TTL', async () => {
      const shortTtlManager = new SessionManager(browserConfig, {
        cleanupIntervalMs: 1000,
        sessionTtlMs: 5000,
      });

      shortTtlManager.getSession('session-1');
      expect(shortTtlManager.getSessionCount()).toBe(1);

      // Продвигаем время на 6 секунд (больше TTL)
      jest.advanceTimersByTime(6000);

      // Даём промису cleanup завершиться
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(shortTtlManager.getSessionCount()).toBe(0);

      await shortTtlManager.closeAll();
    });

    it('не очищает активные сессии', async () => {
      const shortTtlManager = new SessionManager(browserConfig, {
        cleanupIntervalMs: 1000,
        sessionTtlMs: 5000,
      });

      shortTtlManager.getSession('session-1');

      // Продвигаем время на 3 секунды (меньше TTL)
      jest.advanceTimersByTime(3000);

      // Обновляем lastAccessedAt
      shortTtlManager.getSession('session-1');

      // Ещё 3 секунды (итого 6с с начала, но 3с с последнего доступа)
      jest.advanceTimersByTime(3000);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(shortTtlManager.getSessionCount()).toBe(1);

      await shortTtlManager.closeAll();
    });

    it('unref таймера позволяет процессу завершиться', () => {
      // Просто проверяем, что менеджер создаётся без ошибок
      // unref вызывается внутри конструктора
      const m = new SessionManager(browserConfig);
      expect(m).toBeDefined();
      m.closeAll();
    });
  });

  describe('defaultSessionId', () => {
    it('использует "default" когда defaultSessionId не передан', () => {
      const ctx = manager.getSession('');
      expect(ctx.sessionId).toBe('default');
      expect(manager.getDefaultSessionId()).toBe('default');
    });

    it('использует custom defaultSessionId из options', () => {
      const customManager = new SessionManager(browserConfig, {
        defaultSessionId: 'agent-1',
        cleanupIntervalMs: 60_000,
        sessionTtlMs: 300_000,
      });

      expect(customManager.getDefaultSessionId()).toBe('agent-1');

      const ctx = customManager.getSession('');
      expect(ctx.sessionId).toBe('agent-1');

      customManager.closeAll();
    });

    it('hasSession использует defaultSessionId для пустого sessionId', () => {
      const customManager = new SessionManager(browserConfig, {
        defaultSessionId: 'my-session',
      });

      customManager.getSession('');
      expect(customManager.hasSession('my-session')).toBe(true);
      expect(customManager.hasSession('')).toBe(true);

      customManager.closeAll();
    });

    it('closeSession использует defaultSessionId для пустого sessionId', async () => {
      const customManager = new SessionManager(browserConfig, {
        defaultSessionId: 'close-test',
      });

      customManager.getSession('');
      expect(customManager.getSessionCount()).toBe(1);

      await customManager.closeSession('');
      expect(customManager.getSessionCount()).toBe(0);

      customManager.closeAll();
    });

    it('явный sessionId имеет приоритет над defaultSessionId', () => {
      const customManager = new SessionManager(browserConfig, {
        defaultSessionId: 'default-agent',
      });

      const ctx = customManager.getSession('explicit-session');
      expect(ctx.sessionId).toBe('explicit-session');
      expect(customManager.getDefaultSessionId()).toBe('default-agent');

      customManager.closeAll();
    });
  });
});