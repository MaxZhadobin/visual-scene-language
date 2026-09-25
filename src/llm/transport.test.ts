/**
 * Тесты транспорта и retry (AC[8], §10.3): mock-транспорт, sleep-инъекция —
 * без сети и реальных задержек.
 */

import {
  defaultSleep,
  defaultTransport,
  executeJsonWithRetry,
  retryWithBackoff,
} from './transport';
import { LlmError } from './types';
import type { LlmTransport, Sleep } from './types';

const noSleep: Sleep = async () => undefined;

const fakeResponse = (body: unknown, status = 200, statusText = 'OK'): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  }) as unknown as Response;

describe('defaultTransport / defaultSleep', () => {
  it('defaultTransport — делегирование глобальному fetch (инъекция заглушки)', async () => {
    const okResponse = fakeResponse({ delegated: true });
    const fetchMock = jest.fn(async () => okResponse);
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    try {
      await expect(defaultTransport('https://x.test', {})).resolves.toBe(okResponse);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
    expect(fetchMock).toHaveBeenCalledWith('https://x.test', {});
  });

  it('defaultSleep — resolve через реальный таймер (1 мс)', async () => {
    await expect(defaultSleep(1)).resolves.toBeUndefined();
  });
});

describe('retryWithBackoff', () => {
  it('успех с первой попытки — без задержек', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        return 'ok';
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('2 неудачи → успех на 3-й: паузы 1000 и 2000 мс (§10.3)', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new LlmError('HTTP 500', 500);
        return 'done';
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('исчерпание 3 попыток → последняя ошибка наружу', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new LlmError('HTTP 503', 503);
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('HTTP 503');
    expect(calls).toBe(3);
  });

  it('4xx (кроме 429) — fast-fail без повторов', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new LlmError('HTTP 401', 401);
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
  });

  it('сетевая ошибка (не LlmError, напр. TypeError) — повторяется', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('429 — повторяется', async () => {
    let calls = 0;
    await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls === 1) throw new LlmError('HTTP 429', 429);
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(calls).toBe(2);
  });

  it('maxRetries < 1 приводится к 1 (одна попытка)', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new LlmError('boom', 500);
        },
        { maxRetries: 0, sleep: noSleep },
      ),
    ).rejects.toThrow(LlmError);
    expect(calls).toBe(1);
  });
});

describe('executeJsonWithRetry', () => {
  it('успех: возвращает распарсенный JSON', async () => {
    const transport: LlmTransport = async () => fakeResponse({ hello: 1 });
    await expect(
      executeJsonWithRetry(transport, 'https://x.test', {}, 'X', { sleep: noSleep }),
    ).resolves.toEqual({ hello: 1 });
  });

  it('сетевой сбой transport → LlmError без статуса, retry исчерпан', async () => {
    let calls = 0;
    const transport: LlmTransport = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };
    const error: unknown = await executeJsonWithRetry(
      transport,
      'https://x.test',
      {},
      'Provider',
      { maxRetries: 2, sleep: noSleep },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBeUndefined();
    expect((error as Error).message).toContain('Provider');
    expect(calls).toBe(2);
  });

  it('HTTP 500 ×3 → LlmError со статусом после 3 попыток; 401 → 1 попытка', async () => {
    let calls = 0;
    const transport500: LlmTransport = async () => {
      calls += 1;
      return fakeResponse({ error: 'x' }, 500, 'Internal Server Error');
    };
    await expect(
      executeJsonWithRetry(transport500, 'u', {}, 'P', { sleep: noSleep }),
    ).rejects.toThrow('HTTP 500');
    expect(calls).toBe(3);

    calls = 0;
    const transport401: LlmTransport = async () => {
      calls += 1;
      return fakeResponse({}, 401, 'Unauthorized');
    };
    await expect(
      executeJsonWithRetry(transport401, 'u', {}, 'P', { sleep: noSleep }),
    ).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
  });

  it('не-JSON тело → LlmError «не является валидным JSON»', async () => {
    const transport: LlmTransport = async () =>
      ({
        ok: true,
        status: 200,
        statusText: '',
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }) as unknown as Response;
    await expect(
      executeJsonWithRetry(transport, 'u', {}, 'P', { sleep: noSleep }),
    ).rejects.toThrow('is not valid JSON');
  });
});