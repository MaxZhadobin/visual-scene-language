/**
 * Unit tests for vsl_clear_cache tool (T1.6.3).
 *
 * Test cases:
 *  - Успешный сброс кэша
 *  - Обработка исключений из session.clear()
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleClearCache } from './clearCache.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_clear_cache', () => {
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

  it('успешно сбрасывает кэш и возвращает success', async () => {
    const result = await handleClearCache(mockSession);

    expect(mockSession.clear).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.data?.message).toContain('Cache cleared');
  });

  it('обрабатывает исключения из session.clear()', async () => {
    mockSession.clear.mockImplementation(() => {
      throw new Error('Session error');
    });

    const result = await handleClearCache(mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Session error');
    expect(result.error).toContain('vsl_clear_cache failed');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockSession.clear.mockImplementation(() => {
      throw 'string error';
    });

    const result = await handleClearCache(mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });
});