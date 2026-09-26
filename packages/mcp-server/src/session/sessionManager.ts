/**
 * Session Manager — управление per-session изоляцией для MCP Server.
 *
 * Проблема: при подключении множественных агентов к одному MCP server процессу
 * (например, 7 окон TaoCoder с 3-4 параллельными агентами в каждом),
 * все агенты делят ОДНО состояние: один snapshot, один browser, один cache.
 * Это приводит к race conditions и перезаписи данных.
 *
 * Решение: per-session isolation через Map<sessionId, SessionContext>.
 * Каждый агент получает свою изолированную сессию с собственным:
 *  - ServerSession (snapshot, diff, cache)
 *  - BrowserManager (browser context, page, downloads)
 *
 * Session ID извлекается из MCP request context (_meta.sessionId).
 * Если sessionId не передан — используется 'default' (для обратной совместимости).
 *
 * Lifecycle:
 *  - getSession(sessionId) — получить или создать сессию
 *  - closeSession(sessionId) — закрыть сессию и освободить ресурсы
 *  - closeAll() — закрыть все сессии (при shutdown)
 */

import type { BrowserConfig } from '../config/loader.js';
import { BrowserManager } from '../browser/manager.js';
import { ServerSession } from './serverSession.js';

/** Контекст одной сессии: browser + session state. */
export interface SessionContext {
  sessionId: string;
  browser: BrowserManager;
  session: ServerSession;
  createdAt: number;
  lastAccessedAt: number;
}

/** Менеджер сессий для per-session isolation. */
export class SessionManager {
  private readonly sessions = new Map<string, SessionContext>();
  private readonly browserConfig: BrowserConfig;
  private readonly cleanupIntervalMs: number;
  private readonly sessionTtlMs: number;
  private readonly defaultSessionId: string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    browserConfig: BrowserConfig,
    options?: {
      /** Интервал cleanup неактивных сессий (default: 60000ms = 1min). */
      cleanupIntervalMs?: number;
      /** TTL неактивной сессии (default: 300000ms = 5min). */
      sessionTtlMs?: number;
      /** Default session ID (из env VSL_SESSION_ID, fallback: 'default'). */
      defaultSessionId?: string;
    },
  ) {
    this.browserConfig = browserConfig;
    this.cleanupIntervalMs = options?.cleanupIntervalMs ?? 60_000;
    this.sessionTtlMs = options?.sessionTtlMs ?? 300_000;
    this.defaultSessionId = options?.defaultSessionId ?? 'default';

    // Запускаем периодический cleanup
    this.startCleanup();
  }

  /**
   * Возвращает default session ID (из env VSL_SESSION_ID или 'default').
   * Используется для fallback, когда _meta.sessionId не передан.
   */
  getDefaultSessionId(): string {
    return this.defaultSessionId;
  }

  /**
   * Получает или создаёт сессию по sessionId.
   * Если сессия не существует — создаёт новую с собственным BrowserManager и ServerSession.
   */
  getSession(sessionId: string): SessionContext {
    const normalizedId = sessionId || this.defaultSessionId;

    if (!this.sessions.has(normalizedId)) {
      const context: SessionContext = {
        sessionId: normalizedId,
        browser: new BrowserManager(this.browserConfig),
        session: new ServerSession(),
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      this.sessions.set(normalizedId, context);
    }

    const context = this.sessions.get(normalizedId)!;
    context.lastAccessedAt = Date.now();
    return context;
  }

  /**
   * Проверяет, существует ли сессия.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId || this.defaultSessionId);
  }

  /**
   * Закрывает сессию и освобождает ресурсы (browser, cache).
   */
  async closeSession(sessionId: string): Promise<void> {
    const normalizedId = sessionId || this.defaultSessionId;
    const context = this.sessions.get(normalizedId);

    if (context) {
      await context.browser.close();
      this.sessions.delete(normalizedId);
    }
  }

  /**
   * Закрывает все сессии (при shutdown сервера).
   */
  async closeAll(): Promise<void> {
    this.stopCleanup();

    const closePromises = Array.from(this.sessions.values()).map((context) =>
      context.browser.close(),
    );

    await Promise.all(closePromises);
    this.sessions.clear();
  }

  /**
   * Возвращает список активных сессий (для мониторинга).
   */
  getActiveSessions(): Array<{
    sessionId: string;
    createdAt: number;
    lastAccessedAt: number;
    hasSnapshot: boolean;
  }> {
    return Array.from(this.sessions.values()).map((context) => ({
      sessionId: context.sessionId,
      createdAt: context.createdAt,
      lastAccessedAt: context.lastAccessedAt,
      hasSnapshot: context.session.hasSnapshot(),
    }));
  }

  /**
   * Возвращает количество активных сессий.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Запускает периодический cleanup неактивных сессий.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupIntervalMs);

    // Разрешаем процессу завершиться, даже если таймер активен
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Останавливает cleanup таймер.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Очищает сессии, которые не использовались дольше sessionTtlMs.
   */
  private async cleanupInactiveSessions(): Promise<void> {
    const now = Date.now();
    const sessionsToClose: string[] = [];

    for (const [sessionId, context] of this.sessions.entries()) {
      const idleTime = now - context.lastAccessedAt;
      if (idleTime > this.sessionTtlMs) {
        sessionsToClose.push(sessionId);
      }
    }

    for (const sessionId of sessionsToClose) {
      await this.closeSession(sessionId);
    }
  }
}