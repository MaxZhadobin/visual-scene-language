/**
 * Unit tests for vsl_get_diff tool (T1.6.3).
 *
 * Test cases:
 *  - Успешное получение diff
 *  - Ошибка, если нет текущего snapshot
 *  - Ошибка, если нет предыдущего snapshot (первый вызов)
 *  - Обработка исключений из session
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleGetDiff } from './getDiff.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_get_diff', () => {
  let mockSession: jest.Mocked<ServerSession>;

  beforeEach(() => {
    mockSession = {
      clear: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      hasSnapshot: jest.fn(),
      getDiff: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;
  });

  it('возвращает diff, если snapshot и предыдущий snapshot существуют', async () => {
    const mockDiff = { added: [], modified: [], removed: [] };
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getDiff.mockReturnValue(mockDiff as never);

    const result = await handleGetDiff(mockSession);

    expect(result.status).toBe('success');
    expect(result.data).toBe(mockDiff);
  });

  it('возвращает ошибку, если нет текущего snapshot', async () => {
    mockSession.hasSnapshot.mockReturnValue(false);

    const result = await handleGetDiff(mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('No snapshot available');
    expect(result.error).toContain('vsl_get_snapshot');
  });

  it('возвращает ошибку, если нет предыдущего snapshot (первый вызов)', async () => {
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getDiff.mockReturnValue(null);

    const result = await handleGetDiff(mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('No previous snapshot');
    expect(result.error).toContain('first snapshot');
  });

  it('обрабатывает исключения из session', async () => {
    mockSession.hasSnapshot.mockImplementation(() => {
      throw new Error('Session crashed');
    });

    const result = await handleGetDiff(mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Session crashed');
    expect(result.error).toContain('vsl_get_diff failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockSession.hasSnapshot.mockImplementation(() => {
      throw 'string error';
    });

    const result = await handleGetDiff(mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });
});