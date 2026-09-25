/**
 * Unit tests for vsl_get_text_block tool (M1.7, DEC-026).
 *
 * Test cases:
 *  - Успешное получение текста по block_id
 *  - Ошибка: block_id не указан
 *  - Ошибка: нет VSL snapshot
 *  - Ошибка: нет text_blocks в snapshot
 *  - Ошибка: block_id не найден в text_blocks
 *  - Обработка исключений
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleGetTextBlock } from './getTextBlock.js';
import type { ServerSession } from '../session/serverSession.js';
import type { VslDocument } from '@thinkingos/vsl-sdk';

describe('vsl_get_text_block', () => {
  let mockSession: jest.Mocked<ServerSession>;

  const makeDoc = (textBlocks?: Record<string, string>): VslDocument => ({
    vsl_version: '1.0',
    canvas: { width: 1024, height: 768 },
    objects: [],
    ...(textBlocks ? { text_blocks: textBlocks } : {}),
  } as VslDocument);

  beforeEach(() => {
    mockSession = {
      hasSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getDiff: jest.fn(),
      clear: jest.fn(),
      setOnSnapshotChange: jest.fn(),
    } as unknown as jest.Mocked<ServerSession>;
  });

  it('успешно получает текст по block_id', async () => {
    const fullText = 'Длинный текст '.repeat(20);
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getSnapshot.mockReturnValue(makeDoc({ 'tb_000': fullText }));

    const result = await handleGetTextBlock({ block_id: 'tb_000' }, mockSession);

    expect(result.status).toBe('success');
    expect(result.data?.block_id).toBe('tb_000');
    expect(result.data?.text).toBe(fullText);
  });

  it('возвращает ошибку, если block_id не указан', async () => {
    const result = await handleGetTextBlock({ block_id: '' }, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('block_id is required');
  });

  it('возвращает ошибку, если нет VSL snapshot', async () => {
    mockSession.hasSnapshot.mockReturnValue(false);

    const result = await handleGetTextBlock({ block_id: 'tb_000' }, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('No VSL snapshot available');
  });

  it('возвращает ошибку, если нет text_blocks в snapshot', async () => {
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getSnapshot.mockReturnValue(makeDoc()); // без text_blocks

    const result = await handleGetTextBlock({ block_id: 'tb_000' }, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('No text blocks in current snapshot');
  });

  it('возвращает ошибку, если block_id не найден в text_blocks', async () => {
    mockSession.hasSnapshot.mockReturnValue(true);
    mockSession.getSnapshot.mockReturnValue(makeDoc({ 'tb_000': 'some text' }));

    const result = await handleGetTextBlock({ block_id: 'tb_999' }, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Text block not found');
    expect(result.error).toContain('tb_999');
  });

  it('обрабатывает исключения', async () => {
    mockSession.hasSnapshot.mockImplementation(() => {
      throw new Error('Session corrupted');
    });

    const result = await handleGetTextBlock({ block_id: 'tb_000' }, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('vsl_get_text_block failed');
    expect(result.error).toContain('Session corrupted');
  });

  it('обрабатывает не-Error исключения', async () => {
    mockSession.hasSnapshot.mockImplementation(() => {
      throw 'string error';
    });

    const result = await handleGetTextBlock({ block_id: 'tb_000' }, mockSession);

    expect(result.status).toBe('error');
    expect(result.error).toContain('string error');
  });
});