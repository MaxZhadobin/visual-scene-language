/**
 * Tool: vsl_get_full_json (plan_dev_10).
 *
 * Явный запрос полного VSL JSON, минуя diff-first логику Snapshot Session.
 * Используется, когда агент потерял контекст (история обрезалась) и не может
 * восстановить полную картину из инкрементальных диффов.
 *
 * Flow:
 *  1. Проверить наличие snapshot в ServerSession
 *  2. Если есть — вернуть полный VSL JSON
 *  3. Если нет — вернуть ошибку с инструкцией вызвать vsl_get_snapshot
 */

import { computeToolMetrics } from '../utils/metrics.js';
import type { ServerSession } from '../session/serverSession.js';

/** Аргументы vsl_get_full_json (нет параметров). */
export type GetFullJsonArgs = Record<string, never>;

/** Результат vsl_get_full_json. */
export interface GetFullJsonResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  hint?: string;
  /** Метрики производительности (DEC-029). */
  metadata?: { json_size_bytes: number; estimated_tokens: number; execution_time_ms: number; timestamp: string };
}

/**
 * Обработчик vsl_get_full_json.
 *
 * @param session - Server Session для получения текущего snapshot
 */
export async function handleGetFullJson(
  _args: GetFullJsonArgs,
  session: ServerSession,
): Promise<GetFullJsonResult> {
  const startTime = Date.now();

  try {
    // Проверяем наличие snapshot
    if (!session.hasSnapshot()) {
      return {
        status: 'error',
        error: 'No VSL snapshot available',
        hint: 'Call vsl_get_snapshot first to capture the current page state.',
      };
    }

    // Получаем полный VSL JSON
    const snapshot = session.getSnapshot();

    return {
      status: 'success',
      data: snapshot,
      metadata: computeToolMetrics(snapshot, startTime),
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_full_json failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}