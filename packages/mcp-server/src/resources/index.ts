/**
 * Регистрация MCP Resources (T1.6.4).
 *
 * 2 ресурса VSL:
 *  - vsl://current: текущий VSL snapshot
 *  - vsl://diff: последний VSL diff
 *
 * Поддержка подписки на изменения (resource subscription).
 * При изменении snapshot отправляется notifications/resources/updated.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { McpServerConfig } from '../config/loader.js';
import type { SessionManager } from '../session/sessionManager.js';
import type { ServerSession } from '../session/serverSession.js';

/** Список всех ресурсов VSL. */
const VSL_RESOURCES = [
  {
    uri: 'vsl://current',
    name: 'Current VSL Snapshot',
    description: 'Current VSL snapshot of the page. Contains the full semantic structure of elements.',
    mimeType: 'application/json',
  },
  {
    uri: 'vsl://diff',
    name: 'Latest VSL Diff',
    description: 'Latest VSL diff since the previous snapshot. Contains only changes (added/modified/removed).',
    mimeType: 'application/json',
  },
];

/**
 * Регистрирует handlers для MCP Resources.
 *
 * @param server - MCP Server instance
 * @param config - Конфигурация сервера
 * @param sessionManager - Session Manager для per-session isolation
 */
export function registerResources(server: Server, _config: McpServerConfig, sessionManager: SessionManager): void {
  // Handler: список ресурсов
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: VSL_RESOURCES,
    };
  });

  // Handler: чтение ресурса
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Per-session isolation: извлекаем sessionId из _meta или используем default из env VSL_SESSION_ID
    const sessionId = (request.params as unknown as { _meta?: { sessionId?: string } })._meta?.sessionId ?? sessionManager.getDefaultSessionId();
    const { session } = sessionManager.getSession(sessionId);

    // Подписываемся на изменения этой session (лениво)
    ensureSubscribed(sessionId, session);


    switch (uri) {
      case 'vsl://current':
        // Получаем текущий snapshot из session
        try {
          const snapshot = session.getSnapshot();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(snapshot, null, 2),
              },
            ],
          };
        } catch {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: 'No snapshot available. Call vsl_get_snapshot first.',
                }),
              },
            ],
          };
        }

      case 'vsl://diff':
        // Получаем последний diff из session
        try {
          const diff = session.getDiff();
          if (!diff) {
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    error: 'No diff available. This is the first snapshot or no changes detected.',
                  }),
                },
              ],
            };
          }
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(diff, null, 2),
              },
            ],
          };
        } catch {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: 'Failed to compute diff.',
                }),
              },
            ],
          };
        }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  // Per-session подписка на изменения ресурсов.
  // Подписываемся лениво при первом запросе ресурса для каждой session.
  const subscribedSessions = new Set<string>();

  // Функция для подписки на изменения session
  function ensureSubscribed(sessionId: string, session: ServerSession): void {
    if (subscribedSessions.has(sessionId)) return;
    subscribedSessions.add(sessionId);

    session.setOnSnapshotChange(() => {
      // Уведомляем клиентов об изменении vsl://current
      server.sendResourceUpdated({ uri: 'vsl://current' }).catch(() => {
        // Игнорируем ошибки отправки (клиент может быть отключён)
      });

      // Уведомляем клиентов об изменении vsl://diff (если есть предыдущий snapshot)
      if (session.getDiff()) {
        server.sendResourceUpdated({ uri: 'vsl://diff' }).catch(() => {
          // Игнорируем ошибки отправки
        });
      }
    });
  }

}