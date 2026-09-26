/**
 * Общие метрики производительности для всех MCP tools (DEC-029).
 *
 * Каждый tool возвращает ToolMetadata с информацией о размере ответа,
 * количестве токенов и времени выполнения. Это позволяет агенту
 * отслеживать расход токенов и оптимизировать вызовы.
 */

/** Метрики производительности tool (DEC-029). */
export interface ToolMetadata {
  /** Размер JSON ответа в байтах. */
  json_size_bytes: number;
  /** Приблизительное количество токенов (size / 4). */
  estimated_tokens: number;
  /** Время выполнения в миллисекундах. */
  execution_time_ms: number;
  /** Timestamp выполнения (ISO 8601). */
  timestamp: string;
}

/**
 * Вычисляет метрики для результата tool.
 *
 * @param result - Результат tool (будет сериализован в JSON)
 * @param startTime - Время начала выполнения (Date.now())
 * @returns ToolMetadata с вычисленными метриками
 */
export function computeToolMetrics(result: unknown, startTime: number): ToolMetadata {
  const executionTimeMs = Date.now() - startTime;
  const resultJson = JSON.stringify(result);
  const jsonSizeBytes = Buffer.byteLength(resultJson, 'utf-8');
  const estimatedTokens = Math.ceil(jsonSizeBytes / 4);

  return {
    json_size_bytes: jsonSizeBytes,
    estimated_tokens: estimatedTokens,
    execution_time_ms: executionTimeMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Вычисляет метрики для результата tool с дополнительными полями.
 *
 * @param result - Результат tool (будет сериализован в JSON)
 * @param startTime - Время начала выполнения (Date.now())
 * @param extra - Дополнительные поля для метрик (например, object_count)
 * @returns ToolMetadata с вычисленными метриками + дополнительные поля
 */
export function computeToolMetricsWithExtra<T extends Record<string, unknown>>(
  result: unknown,
  startTime: number,
  extra: T,
): ToolMetadata & T {
  const base = computeToolMetrics(result, startTime);
  return { ...base, ...extra };
}