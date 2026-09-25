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
import type { ServerSession } from '../session/serverSession.js';

/** Список всех ресурсов VSL. */
const VSL_RESOURCES = [
  {
    uri: 'vsl://current',
    name: 'Current VSL Snapshot',
    description: 'Текущий VSL snapshot страницы. Содержит полную семантическую структуру элементов.',
    mimeType: 'application/json',
  },
  {
    uri: 'vsl://diff',
    name: 'Latest VSL Diff',
    description: 'Последний VSL diff с момента предыдущего snapshot. Содержит только изменения (added/modified/removed).',
    mimeType: 'application/json',
  },
];

/**
 * Регистрирует handlers для MCP Resources.
 *
 * @param server - MCP Server instance
 * @param config - Конфигурация сервера
 * @param session - Server Session для получения snapshot/diff
 */
export function registerResources(server: Server, _config: McpServerConfig, session: ServerSession): void {
  // Handler: список ресурсов
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: VSL_RESOURCES,
    };
  });

  // Handler: чтение ресурса
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

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

  // Подписка на изменения: при каждом setSnapshot() отправляем уведомления
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