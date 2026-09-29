/**
 * Remote Patterns Loader (T1.8.3, M1.8, DEC-027).
 *
 * Загружает паттерны инъекций с удалённого CDN/GitHub, кэширует локально,
 * обеспечивает fallback на bundled patterns при отсутствии интернета.
 *
 * Архитектура:
 *  - Fetch: загрузка с remote URL (https://vsl.dev/patterns/latest.json)
 *  - Cache: локальное кэширование (~/.vsl/cache/remote-patterns.json)
 *  - Fallback: если fetch не удался, используем кэш или bundled patterns
 *  - TTL: кэш валиден 24 часа (настраивается)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { InjectionPattern } from './promptInjectionFilter';

/** Опции remote patterns loader. */
export interface RemotePatternsLoaderOptions {
  /** URL для загрузки remote patterns. */
  remoteUrl?: string;
  /** Путь к локальному кэшу remote patterns. */
  cachePath?: string;
  /** TTL кэша в миллисекундах (по умолчанию 24 часа). */
  cacheTtlMs?: number;
  /** Включить/выключить remote loader (по умолчанию true). */
  enabled?: boolean;
  /** Timeout для HTTP-запроса в миллисекундах (по умолчанию 5000). */
  timeoutMs?: number;
}

/** Метаданные кэша для отслеживания TTL. */
interface CacheMetadata {
  /** Timestamp последней загрузки (ISO 8601). */
  lastFetched: string;
  /** URL, с которого были загружены паттерны. */
  sourceUrl: string;
  /** Количество загруженных паттернов. */
  patternCount: number;
}

/** Формат файла кэша (паттерны + метаданные). */
interface CacheFile {
  metadata: CacheMetadata;
  patterns: InjectionPattern[];
}

/** Результат загрузки remote patterns. */
export interface RemotePatternsResult {
  /** Загруженные паттерны. */
  patterns: InjectionPattern[];
  /** Источник паттернов: 'remote' (свежая загрузка), 'cache' (из кэша), 'none' (нет паттернов). */
  source: 'remote' | 'cache' | 'none';
  /** Был ли использован fallback (если remote fetch не удался). */
  fallbackUsed: boolean;
  /** Ошибка (если произошла). */
  error?: string;
}

/** Default URL для загрузки remote patterns. */
const DEFAULT_REMOTE_URL = 'https://raw.githubusercontent.com/MaxZhadobin/visual-scene-language/vsl_mcp/patterns/latest.json';

/** Default путь к кэшу. */
const DEFAULT_CACHE_PATH = join(homedir(), '.vsl', 'cache', 'remote-patterns.json');

/** Default TTL кэша — 24 часа. */
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Default timeout для HTTP-запроса — 5 секунд. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Remote Patterns Loader — загрузка паттернов с CDN/GitHub.
 *
 * Использование:
 *  * const loader = new RemotePatternsLoader({
 *   remoteUrl: 'https://vsl.dev/patterns/latest.json',
 *   cacheTtlMs: 24 * 60 * 60 * 1000, // 24 часа
 * });
 *
 * const result = await loader.load();
 * console.log(result.patterns); // Загруженные паттерны
 * console.log(result.source); // 'remote' | 'cache' | 'none'
 *  */
export class RemotePatternsLoader {
  private remoteUrl: string;
  private cachePath: string;
  private cacheTtlMs: number;
  private enabled: boolean;
  private timeoutMs: number;

  constructor(options: RemotePatternsLoaderOptions = {}) {
    this.remoteUrl = options.remoteUrl ?? DEFAULT_REMOTE_URL;
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.enabled = options.enabled ?? true;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Загружает remote patterns с fallback на кэш.
   *
   * Логика:
   *  1. Если enabled === false — возвращаем empty
   *  2. Проверяем кэш — если валиден (TTL не истёк), используем кэш
   *  3. Пытаемся загрузить с remote URL
   *  4. Если загрузка успешна — обновляем кэш, возвращаем remote patterns
   *  5. Если загрузка не удалась — используем кэш (fallback)
   *  6. Если кэша нет — возвращаем empty
   */
  async load(): Promise<RemotePatternsResult> {
    if (!this.enabled) {
      return { patterns: [], source: 'none', fallbackUsed: false };
    }

    // Проверяем валидность кэша
    const cachedData = this.readCache();
    const cacheIsValid = this.isCacheValid(cachedData);

    // Если кэш валиден и не нужно обновлять — используем кэш
    if (cacheIsValid) {
      return {
        patterns: cachedData!.patterns,
        source: 'cache',
        fallbackUsed: false,
      };
    }

    // Пытаемся загрузить с remote
    try {
      const patterns = await this.fetchRemotePatterns();
      
      // Обновляем кэш
      this.writeCache(patterns);

      return {
        patterns,
        source: 'remote',
        fallbackUsed: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Fallback на кэш
      if (cachedData) {
        return {
          patterns: cachedData.patterns,
          source: 'cache',
          fallbackUsed: true,
          error: errorMessage,
        };
      }

      // Кэша нет — возвращаем empty
      return {
        patterns: [],
        source: 'none',
        fallbackUsed: true,
        error: errorMessage,
      };
    }
  }

  /**
   * Загружает паттерны с remote URL.
   */
  private async fetchRemotePatterns(): Promise<InjectionPattern[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.remoteUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'VSL-Patterns-Loader/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Поддержка двух форматов:
      // 1. Простой массив паттернов (обратная совместимость)
      // 2. Объект с { metadata, patterns } (новый формат с метаданными)
      let patternsArray: unknown[];
      if (Array.isArray(data)) {
        patternsArray = data;
      } else if (typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>).patterns)) {
        patternsArray = (data as Record<string, unknown>).patterns as unknown[];
      } else {
        throw new Error('Invalid patterns format: expected array or { patterns: [] }');
      }

      // Валидация каждого паттерна
      const patterns: InjectionPattern[] = [];
      for (const item of patternsArray) {
        if (this.isValidPattern(item)) {
          patterns.push(item as InjectionPattern);
        }
      }

      return patterns;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Проверяет валидность паттерна.
   */
  private isValidPattern(item: unknown): boolean {
    if (typeof item !== 'object' || item === null) return false;
    
    const obj = item as Record<string, unknown>;
    return (
      typeof obj.id === 'string' &&
      typeof obj.pattern === 'string' &&
      typeof obj.type === 'string' &&
      (obj.type === 'regex' || obj.type === 'ml') &&
      typeof obj.severity === 'string' &&
      ['low', 'medium', 'high', 'critical'].includes(obj.severity as string) &&
      typeof obj.action === 'string' &&
      ['strip', 'log', 'block'].includes(obj.action as string) &&
      typeof obj.description === 'string'
    );
  }

  /**
   * Читает кэш из файла.
   */
  private readCache(): CacheFile | null {
    if (!existsSync(this.cachePath)) {
      return null;
    }

    try {
      const content = readFileSync(this.cachePath, 'utf-8');
      const data = JSON.parse(content) as CacheFile;

      // Валидация структуры кэша
      if (!data.metadata || !Array.isArray(data.patterns)) {
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Записывает паттерны в кэш.
   */
  private writeCache(patterns: InjectionPattern[]): void {
    const cacheData: CacheFile = {
      metadata: {
        lastFetched: new Date().toISOString(),
        sourceUrl: this.remoteUrl,
        patternCount: patterns.length,
      },
      patterns,
    };

    try {
      // Создаём директорию, если не существует
      const cacheDir = dirname(this.cachePath);
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      writeFileSync(this.cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[RemotePatternsLoader] Failed to write cache: ${error}`);
    }
  }

  /**
   * Проверяет валидность кэша (TTL не истёк).
   */
  private isCacheValid(cachedData: CacheFile | null): boolean {
    if (!cachedData) return false;

    try {
      const lastFetched = new Date(cachedData.metadata.lastFetched).getTime();
      const now = Date.now();
      return (now - lastFetched) <this.cacheTtlMs;
    } catch {
      return false;
    }
  }

  /**
   * Очищает кэш (для тестирования).
   */
  clearCache(): void {
    try {
      if (existsSync(this.cachePath)) {
        writeFileSync(this.cachePath, '', 'utf-8');
      }
    } catch (error) {
      console.error(`[RemotePatternsLoader] Failed to clear cache: ${error}`);
    }
  }

  /**
   * Получает информацию о кэше (для диагностики).
   */
  getCacheInfo(): { exists: boolean; lastFetched?: string; patternCount?: number } {
    const cachedData = this.readCache();
    if (!cachedData) {
      return { exists: false };
    }

    return {
      exists: true,
      lastFetched: cachedData.metadata.lastFetched,
      patternCount: cachedData.metadata.patternCount,
    };
  }

  /**
   * Получает URL для загрузки remote patterns.
   */
  getRemoteUrl(): string {
    return this.remoteUrl;
  }

  /**
   * Устанавливает URL для загрузки remote patterns.
   */
  setRemoteUrl(url: string): void {
    this.remoteUrl = url;
  }
}

/**
 * Фабричная функция для создания remote patterns loader.
 */
export function createRemotePatternsLoader(options?: RemotePatternsLoaderOptions): RemotePatternsLoader {
  return new RemotePatternsLoader(options);
}