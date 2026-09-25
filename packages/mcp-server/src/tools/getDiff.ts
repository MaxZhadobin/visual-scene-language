/**
 * Tool: vsl_get_diff (T1.6.3).
 *
 * Получает только изменения с момента последнего snapshot.
 * Использует ServerSession для вычисления diff между текущим и предыдущим snapshot.
 *
 * Flow:
 *  1. Проверяем, что есть текущий snapshot
 *  2. Получаем diff из ServerSession
 *  3. Возвращаем Diff JSON (или ошибку, если нет предыдущего snapshot)
 */

import type { ServerSession } from '../session/serverSession.js';

/** Результат vsl_get_diff. */
export interface GetDiffResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

/**
 * Обработчик vsl_get_diff.
 *
 * @param session - Server Session
 */
export async function handleGetDiff(session: ServerSession): Promise<GetDiffResult> {
  try {
    // 1. Проверяем, что есть текущий snapshot
    if (!session.hasSnapshot()) {
      return {
        status: 'error',
        error: 'No snapshot available. Call vsl_get_snapshot first.',
      };
    }

    // 2. Получаем diff
    const diff = session.getDiff();

    if (!diff) {
      return {
        status: 'error',
        error: 'No previous snapshot to compare against. This is the first snapshot.',
      };
    }

    // 3. Возвращаем Diff JSON
    return {
      status: 'success',
      data: diff,
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_diff failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}