/**
 * Tool: vsl_clear_cache (T1.6.3).
 *
 * Сбрасывает кэш VSL snapshot.
 * Следующий вызов vsl_get_snapshot создаст новый snapshot с нуля.
 *
 * Flow:
 *  1. Вызов session.clear()
 *  2. Возврат результата
 */

import { computeToolMetrics } from '../utils/metrics.js';
import type { ServerSession } from '../session/serverSession.js';

/** Результат vsl_clear_cache. */
export interface ClearCacheResult {
  status: 'success' | 'error';
  data?: { message: string };
  error?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
}

/**
 * Обработчик vsl_clear_cache.
 *
 * @param session - Server Session
 */
export async function handleClearCache(session: ServerSession): Promise<ClearCacheResult> {
  const startTime = Date.now();

  try {
    session.clear();

    return {
      status: 'success',
      data: {
        message: 'Cache cleared. Next vsl_get_snapshot will create a new snapshot from scratch.',
      },
      metadata: computeToolMetrics({ cleared: true }, startTime),
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_clear_cache failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}