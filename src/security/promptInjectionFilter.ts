/**
 * Prompt Injection Filter (T1.8.1, M1.8, DEC-027).
 *
 * Слой безопасности на входе Capture Layer — сразу после извлечения текста из любого источника
 * (DOM, raw HTML), до сегментации и упаковки в VSL JSON.
 *
 * Архитектура:
 *  - Scanner — regex-паттерны для обнаружения инъекций
 *  - Logger — security audit trail (локальное хранение)
 *  - Stripper — вырезание инъекций из текста
 *
 * 3 уровня паттернов:
 *  - Bundled (patterns_v1.json в SDK)
 *  - Remote (CDN/GitHub, автозагрузка при запуске)
 *  - Custom (пользовательские через vsl.config.json)
 *
 * Действия:
 *  - strip — вырезать инъекцию, оставить остальной контент
 *  - log — только логировать обнаружение
 *  - block — блокировать весь текст (вернуть пустую строку)
 *
 * False positive strategy:
 *  - Confidence threshold (0.7 по умолчанию)
 *  - Domain whitelist (доверенные домены пропускаются)
 *  - User override (отключение фильтра для конкретных доменов)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { RemotePatternsLoader, type RemotePatternsLoaderOptions } from './remotePatternsLoader';

/** Тип паттерна (пока только regex, ML зарезервирован). */
export type PatternType = 'regex' | 'ml';

/** Уровень серьёзности инъекции. */
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** Действие при обнаружении инъекции. */
export type FilterAction = 'strip' | 'log' | 'block';

/** Формат паттерна для обнаружения инъекций. */
export interface InjectionPattern {
  /** Уникальный идентификатор паттерна. */
  id: string;
  /** Regex-паттерн для обнаружения инъекции. */
  pattern: string;
  /** Тип паттерна (regex или ml). */
  type: PatternType;
  /** Уровень серьёзности. */
  severity: Severity;
  /** Действие при обнаружении. */
  action: FilterAction;
  /** Описание паттерна. */
  description: string;
  /** Confidence threshold (0-1), по умолчанию 0.7. */
  confidence?: number;
}

/** Результат сканирования текста. */
export interface ScanResult {
  /** Очищенный текст (после strip/block). */
  cleanText: string;
  /** Обнаруженные инъекции. */
  detections: Detection[];
  /** Был ли текст заблокирован полностью. */
  blocked: boolean;
  /** Время сканирования (мс). */
  scanTimeMs: number;
}

/** Обнаруженная инъекция. */
export interface Detection {
  /** ID паттерна, который сработал. */
  patternId: string;
  /** Описание паттерна. */
  description: string;
  /** Уровень серьёзности. */
  severity: Severity;
  /** Действие, которое было выполнено. */
  action: FilterAction;
  /** Текст, который совпал с паттерном. */
  matchedText: string;
  /** Позиция в исходном тексте (start index). */
  index: number;
  /** Контекст вокруг совпадения (для аудита). */
  context: string;
}

/** Запись в security audit log. */
export interface SecurityLogEntry {
  /** Timestamp обнаружения (ISO 8601). */
  timestamp: string;
  /** URL страницы (если доступен). */
  url?: string;
  /** ID паттерна. */
  patternId: string;
  /** Описание паттерна. */
  description: string;
  /** Уровень серьёзности. */
  severity: Severity;
  /** Действие, которое было выполнено. */
  action: FilterAction;
  /** Текст, который совпал с паттерном. */
  matchedText: string;
  /** Контекст вокруг совпадения. */
  context: string;
}

/** Опции конфигурации фильтра. */
export interface FilterOptions {
  /** Включить/выключить фильтр (по умолчанию true). */
  enabled?: boolean;
  /** Confidence threshold (0-1, по умолчанию 0.7). */
  confidenceThreshold?: number;
  /** Domain whitelist — доверенные домены, которые пропускаются. */
  domainWhitelist?: string[];
  /** Путь к bundled patterns.json. */
  bundledPatternsPath?: string;
  /** Путь к remote patterns (локальный кэш). */
  remotePatternsPath?: string;
  /** Custom patterns (из vsl.config.json). */
  customPatterns?: InjectionPattern[];
  /** Путь к security audit log. */
  logPath?: string;
  /** Максимальный размер лога (количество записей, по умолчанию 10000). */
  maxLogEntries?: number;
  /** Опции для RemotePatternsLoader (автозагрузка с CDN). */
  remoteLoader?: RemotePatternsLoaderOptions;
}

/** Компилированный паттерн с regex-объектом. */
interface CompiledPattern extends InjectionPattern {
  regex: RegExp;
  confidenceThreshold: number;
}

/** Путь к директории для логов по умолчанию. */
const DEFAULT_LOG_DIR = join(homedir(), '.vsl', 'logs');

/** Путь к security audit log по умолчанию. */
const DEFAULT_LOG_PATH = join(DEFAULT_LOG_DIR, 'security-audit.log');

/** Путь к bundled patterns по умолчанию. */
const DEFAULT_BUNDLED_PATTERNS_PATH = join(__dirname, '..', '..', 'patterns', 'patterns_v1.json');

/** Путь к remote patterns кэшу по умолчанию. */
const DEFAULT_REMOTE_PATTERNS_PATH = join(homedir(), '.vsl', 'cache', 'remote-patterns.json');

/** Confidence threshold по умолчанию. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Максимальный размер лога по умолчанию. */
const DEFAULT_MAX_LOG_ENTRIES = 10000;

/**
 * Prompt Injection Filter — основной класс фильтра.
 *
 * Использование:
 *  * const filter = new PromptInjectionFilter({
 *   enabled: true,
 *   confidenceThreshold: 0.7,
 *   domainWhitelist: ['github.com', 'docs.google.com'],
 * });
 *
 * const result = filter.scan(text, 'https://example.com');
 * console.log(result.cleanText); // Очищенный текст
 * console.log(result.detections); // Обнаруженные инъекции
 *  */
export class PromptInjectionFilter {
  private enabled: boolean;
  private confidenceThreshold: number;
  private domainWhitelist: Set<string>;
  private patterns: CompiledPattern[] = [];
  private logPath: string;
  private maxLogEntries: number;
  private logEntries: SecurityLogEntry[] = [];
  private remoteLoader: RemotePatternsLoader | null = null;

  constructor(options: FilterOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.domainWhitelist = new Set(options.domainWhitelist ?? []);
    this.logPath = options.logPath ?? DEFAULT_LOG_PATH;
    this.maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;

    // Инициализируем RemotePatternsLoader (если включён)
    if (options.remoteLoader?.enabled !== false) {
      this.remoteLoader = new RemotePatternsLoader({
        remoteUrl: options.remoteLoader?.remoteUrl,
        cachePath: options.remoteLoader?.cachePath ?? options.remotePatternsPath,
        cacheTtlMs: options.remoteLoader?.cacheTtlMs,
        enabled: options.remoteLoader?.enabled ?? true,
        timeoutMs: options.remoteLoader?.timeoutMs,
      });
    }

    // Загружаем паттерны (синхронно — bundled + custom)
    this.loadPatterns(options);

    // Загружаем существующие логи (если есть)
    this.loadExistingLogs();
  }

  /**
   * Загружает паттерны из всех источников (bundled, remote, custom).
   */
  private loadPatterns(options: FilterOptions): void {
    const allPatterns: InjectionPattern[] = [];

    // 1. Bundled patterns
    const bundledPath = options.bundledPatternsPath ?? DEFAULT_BUNDLED_PATTERNS_PATH;
    if (existsSync(bundledPath)) {
      try {
        const content = readFileSync(bundledPath, 'utf-8');
        const bundled = JSON.parse(content) as InjectionPattern[];
        allPatterns.push(...bundled);
      } catch (error) {
        console.error(`[PromptInjectionFilter] Failed to load bundled patterns: ${error}`);
      }
    }

    // 2. Remote patterns (локальный кэш)
    const remotePath = options.remotePatternsPath ?? DEFAULT_REMOTE_PATTERNS_PATH;
    if (existsSync(remotePath)) {
      try {
        const content = readFileSync(remotePath, 'utf-8');
        const remote = JSON.parse(content) as InjectionPattern[];
        allPatterns.push(...remote);
      } catch (error) {
        console.error(`[PromptInjectionFilter] Failed to load remote patterns: ${error}`);
      }
    }

    // 3. Custom patterns
    if (options.customPatterns && options.customPatterns.length > 0) {
      allPatterns.push(...options.customPatterns);
    }

    // Компилируем regex-паттерны
    this.patterns = allPatterns
      .filter((p) => p.type === 'regex') // Пока только regex
      .map((p) => ({
        ...p,
        regex: new RegExp(p.pattern, 'gi'), // case-insensitive, global
        confidenceThreshold: p.confidence ?? this.confidenceThreshold,
      }));
  }

  /**
   * Асинхронно загружает remote patterns через RemotePatternsLoader.
   * Вызывается опционально для обновления паттернов с CDN/GitHub.
   *
   * @returns Результат загрузки remote patterns
   */
  async loadRemotePatterns(): Promise<{ patterns: number; source: string; fallbackUsed: boolean; error?: string }> {
    if (!this.remoteLoader) {
      return { patterns: 0, source: 'none', fallbackUsed: false };
    }

    const result = await this.remoteLoader.load();

    // Добавляем remote patterns к существующим
    if (result.patterns.length > 0) {
      const remoteCompiled = result.patterns
        .filter((p) => p.type === 'regex')
        .map((p) => ({
          ...p,
          regex: new RegExp(p.pattern, 'gi'),
          confidenceThreshold: p.confidence ?? this.confidenceThreshold,
        }));

      // Удаляем старые remote patterns (по source) и добавляем новые
      // Для простоты — просто добавляем новые паттерны
      this.patterns.push(...remoteCompiled);
    }

    return {
      patterns: result.patterns.length,
      source: result.source,
      fallbackUsed: result.fallbackUsed,
      error: result.error,
    };
  }

  /**
   * Получает информацию о кэше remote patterns.
   */
  getRemoteCacheInfo(): { exists: boolean; lastFetched?: string; patternCount?: number } {
    if (!this.remoteLoader) {
      return { exists: false };
    }
    return this.remoteLoader.getCacheInfo();
  }

  /**
   * Очищает кэш remote patterns.
   */
  clearRemoteCache(): void {
    if (this.remoteLoader) {
      this.remoteLoader.clearCache();
    }
  }

  /**
   * Загружает существующие логи из файла.
   */
  private loadExistingLogs(): void {
    if (!existsSync(this.logPath)) {
      return;
    }

    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);
      this.logEntries = lines.map((line) => JSON.parse(line) as SecurityLogEntry);
    } catch (error) {
      console.error(`[PromptInjectionFilter] Failed to load existing logs: ${error}`);
      this.logEntries = [];
    }
  }

  /**
   * Проверяет, находится ли URL в whitelist.
   */
  isWhitelisted(url?: string): boolean {
    if (!url) return false;

    try {
      const hostname = new URL(url).hostname;
      return this.domainWhitelist.has(hostname);
    } catch {
      return false;
    }
  }

  /**
   * Сканирует текст на наличие инъекций.
   *
   * @param text — текст для сканирования
   * @param url — URL страницы (для whitelist и логирования)
   * @returns Результат сканирования с очищенным текстом и списком обнаружений
   */
  scan(text: string, url?: string): ScanResult {
    const startTime = performance.now();

    // Если фильтр выключен или URL в whitelist — возвращаем текст как есть
    if (!this.enabled || this.isWhitelisted(url)) {
      return {
        cleanText: text,
        detections: [],
        blocked: false,
        scanTimeMs: performance.now() - startTime,
      };
    }

    const detections: Detection[] = [];
    let cleanText = text;
    let blocked = false;

    // Сканируем каждый паттерн
    for (const pattern of this.patterns) {
      // Сбрасываем lastIndex для global regex
      pattern.regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const matchedText = match[0];
        const index = match.index;

        // Извлекаем контекст (50 символов до и после)
        const contextStart = Math.max(0, index - 50);
        const contextEnd = Math.min(text.length, index + matchedText.length + 50);
        const context = text.slice(contextStart, contextEnd);

        const detection: Detection = {
          patternId: pattern.id,
          description: pattern.description,
          severity: pattern.severity,
          action: pattern.action,
          matchedText,
          index,
          context,
        };

        detections.push(detection);

        // Логируем обнаружение
        this.logDetection(detection, url);

        // Выполняем действие
        if (pattern.action === 'block') {
          blocked = true;
          cleanText = '';
          break; // Блокируем весь текст, выходим из цикла
        } else if (pattern.action === 'strip') {
          // Вырезаем инъекцию из текста
          cleanText = cleanText.replace(matchedText, '');
        }
        // action === 'log' — только логируем, не модифицируем текст

        // Предотвращаем бесконечный цикл для zero-length matches
        if (match.index === pattern.regex.lastIndex) {
          pattern.regex.lastIndex++;
        }
      }
    }

    // Нормализуем пробелы после strip
    if (detections.some((d) => d.action === 'strip')) {
      cleanText = cleanText.replace(/\s+/g, ' ').trim();
    }

    return {
      cleanText,
      detections,
      blocked,
      scanTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Логирует обнаружение в security audit trail.
   */
  private logDetection(detection: Detection, url?: string): void {
    const entry: SecurityLogEntry = {
      timestamp: new Date().toISOString(),
      url,
      patternId: detection.patternId,
      description: detection.description,
      severity: detection.severity,
      action: detection.action,
      matchedText: detection.matchedText,
      context: detection.context,
    };

    this.logEntries.push(entry);

    // Ротация логов — удаляем старые записи, если превышен лимит
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries = this.logEntries.slice(-this.maxLogEntries);
    }

    // Записываем в файл
    this.writeLogEntry(entry);
  }

  /**
   * Записывает одну запись в лог-файл.
   */
  private writeLogEntry(entry: SecurityLogEntry): void {
    try {
      // Создаём директорию, если не существует
      const logDir = join(this.logPath, '..');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      // Добавляем запись в файл (JSON Lines формат)
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (error) {
      console.error(`[PromptInjectionFilter] Failed to write log entry: ${error}`);
    }
  }

  /**
   * Получает все логи (для аудита).
   */
  getLogs(): SecurityLogEntry[] {
    return [...this.logEntries];
  }

  /**
   * Очищает логи (для тестирования).
   */
  clearLogs(): void {
    this.logEntries = [];
    try {
      if (existsSync(this.logPath)) {
        writeFileSync(this.logPath, '', 'utf-8');
      }
    } catch (error) {
      console.error(`[PromptInjectionFilter] Failed to clear logs: ${error}`);
    }
  }

  /**
   * Добавляет custom pattern динамически.
   */
  addCustomPattern(pattern: InjectionPattern): void {
    if (pattern.type !== 'regex') {
      console.warn(`[PromptInjectionFilter] Only regex patterns are supported, skipping: ${pattern.id}`);
      return;
    }

    const compiled: CompiledPattern = {
      ...pattern,
      regex: new RegExp(pattern.pattern, 'gi'),
      confidenceThreshold: pattern.confidence ?? this.confidenceThreshold,
    };

    this.patterns.push(compiled);
  }

  /**
   * Удаляет custom pattern по ID.
   */
  removePattern(patternId: string): boolean {
    const initialLength = this.patterns.length;
    this.patterns = this.patterns.filter((p) => p.id !== patternId);
    return this.patterns.length <initialLength;
  }

  /**
   * Получает количество загруженных паттернов.
   */
  getPatternCount(): number {
    return this.patterns.length;
  }

  /**
   * Включает/выключает фильтр.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Проверяет, включён ли фильтр.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Фабричная функция для создания фильтра с дефолтными настройками.
 */
export function createFilter(options?: FilterOptions): PromptInjectionFilter {
  return new PromptInjectionFilter(options);
}

/**
 * Глобальный экземпляр фильтра (singleton) для использования в модулях.
 * Инициализируется лениво при первом вызове.
 */
let globalFilter: PromptInjectionFilter | null = null;

/**
 * Получает глобальный экземпляр фильтра.
 */
export function getGlobalFilter(): PromptInjectionFilter {
  if (!globalFilter) {
    globalFilter = new PromptInjectionFilter();
  }
  return globalFilter;
}

/**
 * Сбрасывает глобальный экземпляр фильтра (для тестирования).
 */
export function resetGlobalFilter(): void {
  globalFilter = null;
}