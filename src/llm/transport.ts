/**
 * HTTP-транспорт и retry для LLM-адаптеров (T1.3.2/T1.3.3, ARCHITECTURE §10.1/§10.3):
 *  - defaultTransport — нативный fetch (node>=18, ноль runtime-зависимостей);
 *  - retryWithBackoff — до 3 попыток с exponential backoff (§10.3, 2^attempt секунд);
 *  - executeJsonWithRetry — запрос + статус-проверка + парс JSON, с retry.
 *
 * Retry-политика (уточнение §10.1/§10.3): повторяются ТОЛЬКО сетевые ошибки,
 * HTTP 429 и 5xx; прочие 4xx — fast-fail (401/403 повтором не чинятся).
 * Паузы: 1s, 2s перед 2-й и 3-й попыткой (форма 2^attempt секунд из §10.3).
 * sleep инъецируется (RetryOptions.sleep / LlmAdapterConfig.sleep) —
 * тесты идут без реальных задержек.
 */

import { LlmError } from './types';
import type { LlmTransport, Sleep } from './types';

/** Транспорт по умолчанию — нативный fetch (глобальный на момент вызова). */
export const defaultTransport: LlmTransport = (url, init) => fetch(url, init);

/** Задержка по умолчанию — реальный setTimeout (в тестах инъекция). */
export const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface RetryOptions {
  /** Всего попыток, включая первую (§10.3: 3). Значения <1 приводятся к 1. */
  maxRetries?: number;
  /** Задержка между попытками (инъекция для тестов). */
  sleep?: Sleep;
}

/** Задержка §10.3: 2^attempt секунд → 1s, 2s, 4s… */
const backoffDelayMs = (attempt: number): number => 2 ** attempt * 1000;

/**
 * Повторяется ли ошибка: сетевые сбои (не LlmError, напр. TypeError от fetch),
 * LlmError без статуса (обёртка сетевого сбоя), HTTP 429 и 5xx.
 * Прочие 4xx — fast-fail без retry.
 */
const isRetryable = (error: unknown): boolean => {
  if (error instanceof LlmError) {
    return error.status === undefined || error.status === 429 || error.status >= 500;
  }
  return true;
};

/**
 * Исполняет operation с retry до maxRetries попыток и exponential backoff
 * 1s/2s/… (§10.3). После исчерпания попыток (или на неремрабатой ошибке)
 * исключение уходит наружу.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = Math.max(1, options.maxRetries ?? 3);
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxRetries - 1) throw error;
      await sleep(backoffDelayMs(attempt));
    }
  }
}

/**
 * Выполняет HTTP-запрос через transport с retry (§10.3) и статус-проверкой,
 * возвращает распарсенное тело JSON.
 *
 * Ошибки:
 *  - сетевой сбой transport → LlmError без статуса (retryable);
 *  - !res.ok → LlmError со статусом (429/5xx retryable, прочие 4xx — нет);
 *  - тело не JSON → LlmError (после retry — наружу).
 */
export async function executeJsonWithRetry<T>(
  transport: LlmTransport,
  url: string,
  init: RequestInit,
  providerLabel: string,
  options: RetryOptions = {},
): Promise<T> {
  const response = await retryWithBackoff(async () => {
    let res: Response;
    try {
      res = await transport(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmError(`${providerLabel}: network error — ${message}`);
    }
    if (!res.ok) {
      throw new LlmError(`${providerLabel}: HTTP ${res.status} ${res.statusText}`, res.status);
    }
    return res;
  }, options);

  try {
    return (await response.json()) as T;
  } catch {
    throw new LlmError(`${providerLabel}: response is not valid JSON`);
  }
}