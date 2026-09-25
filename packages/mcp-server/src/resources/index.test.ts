/**
 * Unit tests for MCP Resources (T1.6.4).
 *
 * Test cases:
 *  - vsl://current: возвращает snapshot из session
 *  - vsl://current: возвращает error, если snapshot не установлен
 *  - vsl://diff: возвращает diff из session
 *  - vsl://diff: возвращает error, если diff не доступен
 *  - Unknown resource: выбрасывает ошибку
 *  - ListResources: возвращает список всех ресурсов
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { registerResources } from './index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ServerSession } from '../session/serverSession.js';
import type { McpServerConfig } from '../config/loader.js';

describe('MCP Resources', () => {
  let mockServer: {
    setRequestHandler: jest.Mock;
    handlers: Array<{ schema: unknown; handler: (request: unknown) => Promise<unknown> }>;
  };
  let mockSession: jest.Mocked<ServerSession>;
  let mockConfig: McpServerConfig;

  beforeEach(() => {
    mockServer = {
      setRequestHandler: jest.fn(),
      handlers: [],
    };

    // Сохраняем handlers в порядке регистрации
    mockServer.setRequestHandler.mockImplementation((schema, handler) => {
      mockServer.handlers.push({ schema, handler: handler as (request: unknown) => Promise<unknown> });
    });

    mockSession = {
      hasSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      getDiff: jest.fn(),
      clear: jest.fn(),
      setOnSnapshotChange: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;

    mockConfig = {
      vision: { provider: 'openai', model: 'gpt-4o-mini-vision' },
      browser: { headless: true, navigationTimeout: 30000 },
    } as unknown as McpServerConfig;

    registerResources(mockServer as unknown as Server, mockConfig, mockSession);
  });

  it('регистрирует handlers для ListResources и ReadResource', () => {
    expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockServer.handlers).toHaveLength(2);
  });

  it('ListResources возвращает список всех ресурсов', async () => {
    // Первый handler — ListResources
    const listHandler = mockServer.handlers[0].handler;
    const result = await listHandler({});

    expect(result).toEqual({
      resources: [
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
      ],
    });
  });

  it('vsl://current возвращает snapshot из session', async () => {
    const mockSnapshot = {
      vsl_version: '1.0.0',
      canvas: { viewport: { width: 1280, height: 800 } },
      objects: [],
    };
    mockSession.getSnapshot.mockReturnValue(mockSnapshot as never);

    // Второй handler — ReadResource
    const readHandler = mockServer.handlers[1].handler;
    const result = await readHandler({ params: { uri: 'vsl://current' } });

    expect(result).toEqual({
      contents: [
        {
          uri: 'vsl://current',
          mimeType: 'application/json',
          text: JSON.stringify(mockSnapshot, null, 2),
        },
      ],
    });
  });

  it('vsl://current возвращает error, если snapshot не установлен', async () => {
    mockSession.getSnapshot.mockImplementation(() => {
      throw new Error('No snapshot available');
    });

    const readHandler = mockServer.handlers[1].handler;
    const result = await readHandler({ params: { uri: 'vsl://current' } });

    expect(result).toEqual({
      contents: [
        {
          uri: 'vsl://current',
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'No snapshot available. Call vsl_get_snapshot first.',
          }),
        },
      ],
    });
  });

  it('vsl://diff возвращает diff из session', async () => {
    const mockDiff = {
      vsl_version: '1.0.0',
      changes: {
        added: [],
        modified: [],
        removed: [],
      },
    };
    mockSession.getDiff.mockReturnValue(mockDiff as never);

    const readHandler = mockServer.handlers[1].handler;
    const result = await readHandler({ params: { uri: 'vsl://diff' } });

    expect(result).toEqual({
      contents: [
        {
          uri: 'vsl://diff',
          mimeType: 'application/json',
          text: JSON.stringify(mockDiff, null, 2),
        },
      ],
    });
  });

  it('vsl://diff возвращает error, если diff не доступен', async () => {
    mockSession.getDiff.mockReturnValue(null);

    const readHandler = mockServer.handlers[1].handler;
    const result = await readHandler({ params: { uri: 'vsl://diff' } });

    expect(result).toEqual({
      contents: [
        {
          uri: 'vsl://diff',
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'No diff available. This is the first snapshot or no changes detected.',
          }),
        },
      ],
    });
  });

  it('vsl://diff возвращает error при исключении', async () => {
    mockSession.getDiff.mockImplementation(() => {
      throw new Error('Diff computation failed');
    });

    const readHandler = mockServer.handlers[1].handler;
    const result = await readHandler({ params: { uri: 'vsl://diff' } });

    expect(result).toEqual({
      contents: [
        {
          uri: 'vsl://diff',
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'Failed to compute diff.',
          }),
        },
      ],
    });
  });

  it('Unknown resource выбрасывает ошибку', async () => {
    const readHandler = mockServer.handlers[1].handler;

    await expect(readHandler({ params: { uri: 'vsl://unknown' } })).rejects.toThrow(
      'Unknown resource: vsl://unknown',
    );
  });
});