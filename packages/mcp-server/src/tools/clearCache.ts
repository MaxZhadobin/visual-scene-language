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

import type { ServerSession } from '../session/serverSession.js';

/** Результат vsl_clear_cache. */
export interface ClearCacheResult {
  status: 'success' | 'error';
  data?: { message: string };
  error?: string;
}

/**
 * Обработчик vsl_clear_cache.
 *
 * @param session - Server Session
 */
export async function handleClearCache(session: ServerSession): Promise<ClearCacheResult> {
  try {
    session.clear();

    return {
      status: 'success',
      data: {
        message: 'Cache cleared. Next vsl_get_snapshot will create a new snapshot from scratch.',
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_clear_cache failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}