/**
 * Unit tests for vsl_get_full_json tool (plan_dev_10).
 *
 * Tests:
 *  - Returns full VSL JSON when snapshot exists
 *  - Returns error with hint when no snapshot available
 *  - Handles exceptions gracefully
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleGetFullJson } from './getFullJson.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_get_full_json', () => {
  let mockSession: jest.Mocked<ServerSession>;

  beforeEach(() => {
    mockSession = {
      hasSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;
  });

  it('возвращает полный VSL JSON, если snapshot существует', async () => {
    const mockVslDoc = {
      vsl_version: '1.0.0',
      canvas: {
        viewport: { width: 1280, height: 800, unit: 'px' },
        background: '#ffffff',
        scale: 1,
        orientation: 'landscape',
        timestamp: '2026-09-24T12:00:00.000Z',
      },
      objects: [
        {
          id: 'btn_0',
          t: 'button',
          p: [100, 200],
          s: [120, 40],
          text: 'Click me',
        },
      ],
    };

    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getSnapshot.mockReturnValue(mockVslDoc as never);

    const result = await handleGetFullJson({}, mockSession);

    expect(result.status).toBe('success');
    expect(result.data).toEqual(mockVslDoc);
    expect(result.error).toBeUndefined();
    expect(mockSession.hasSnapshot).toHaveBeenCalled();
    expect(mockSession.getSnapshot).toHaveBeenCalled();
  });

  it('возвращает ошибку с hint, если snapshot отсутствует', async () => {
    mockSession.hasSnapshot.mockReturnValue(false);

    const result = await handleGetFullJson({}, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toBe('No VSL snapshot available');
    expect(result.hint).toBe('Call vsl_get_snapshot first to capture the current page state.');
    expect(result.data).toBeUndefined();
    expect(mockSession.hasSnapshot).toHaveBeenCalled();
    expect(mockSession.getSnapshot).not.toHaveBeenCalled();
  });

  it('обрабатывает исключения из getSnapshot()', async () => {
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getSnapshot.mockImplementation(() => {
      throw new Error('Session corrupted');
    });

    const result = await handleGetFullJson({}, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('vsl_get_full_json failed');
    expect(result.error).toContain('Session corrupted');
    expect(result.data).toBeUndefined();
  });

  it('обрабатывает исключения из hasSnapshot()', async () => {
    mockSession.hasSnapshot.mockImplementation(() => {
      throw new Error('Database connection lost');
    });

    const result = await handleGetFullJson({}, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('vsl_get_full_json failed');
    expect(result.error).toContain('Database connection lost');
  });

  it('принимает пустые аргументы (инструмент без параметров)', async () => {
    mockSession.hasSnapshot.mockReturnValue(false);

    const result = await handleGetFullJson({}, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toBe('No VSL snapshot available');
  });
});