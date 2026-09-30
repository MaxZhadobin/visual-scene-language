/**
 * Server Session — серверная snapshot session для MCP Server.
 *
 * Управляет состоянием snapshot (текущий документ, предыдущий документ, версия)
 * и делегирует вычисление diff в SDK функцию diffVslDocuments.
 *
 * Принцип: MCP сервер построен ПОВЕРХ SDK, а не копирует его логику.
 * SDK предоставляет pipeline (segmentTree → buildVslDocument) и diff engine,
 * но состояние (lastDocument, version) хранится здесь.
 *
 * Единый пайплайн отдачи (АС[3]): кэш хранит ПОЛНЫЙ документ в абсолютных
 * координатах; сессия дополнительно хранит метаданные скролла страницы
 * (scrollContext) для вычисления видимого окна и метаданных scrollable.
 *
 * Lifecycle:
 *  - setSnapshot(vslDoc) — установить текущий snapshot (для обратной совместимости)
 *  - getSnapshot() — получить текущий snapshot
 *  - getPreviousSnapshot() — получить предыдущий snapshot (для вьюпорт-фильтра диффа)
 *  - getDiff() — получить diff с момента предыдущего snapshot
 *  - getScrollContext() — метаданные скролла последнего снапшота
 *  - setScrollContext() — явно установить скролл-контекст
 *  - clear() — сбросить состояние
 *  - hasSnapshot() — проверить наличие snapshot
 */

import { buildIdMap, buildReverseIdMap } from '../utils/idMapper.js';
import { diffVslDocuments, segmentTree, buildVslDocument, type VslDiff, type VslDocument, type SnapshotInput, type SnapshotResult, type ExtractedElement } from '@thinkingos/vsl-sdk';
import type { ScrollContext } from '../utils/viewportFilter.js';

/**
 * Серверная snapshot session.
 * Хранит состояние snapshot и вычисляет diff через SDK.
 */
export class ServerSession {
  private currentDocument: VslDocument | null = null;
  private previousDocument: VslDocument | null = null;
  private version = 0;
  private onSnapshotChange: (() => void) | null = null;
  /** Метаданные скролла последнего снапшота (единый пайплайн отдачи, АС[3]). */
  private scrollContext: ScrollContext | null = null;
  /** Карта shortId → longId для маппинга коротких ID в длинные (rw1_idmapper). */
  private idMap: Map<string, string> = new Map();
  /** Обратная карта longId → shortId для замены ID в выдаче LLM. */
  private reverseIdMap: Map<string, string> = new Map();

  /**
   * Регистрирует callback для уведомлений об изменении snapshot.
   * Вызывается при каждом вызове setSnapshot().
   */
  setOnSnapshotChange(callback: () => void): void {
    this.onSnapshotChange = callback;
  }

  /**
   * Устанавливает новый snapshot (VslDocument).
   * Сохраняет текущий документ как previousDocument для getDiff().
   */
  setSnapshot(doc: VslDocument): void {
    // Сохраняем текущий документ как предыдущий (для getDiff)
    if (this.currentDocument) {
      this.previousDocument = this.currentDocument;
    }
    this.currentDocument = doc;
    this.version += 1;
    // Путь setSnapshot (HTTP-путь read_page) не несёт данных о скролле
    this.scrollContext = null;

    // Строим карты маппинга ID для нового снапшота
    // idMap (short→long) — только из текущего документа (для резолвинга ID от агента)
    // reverseIdMap (long→short) — из union current + previous, чтобы removed объекты
    // из previousDocument тоже получали короткие ID (fix: raw IDs in diff removed/unchanged_refs)
    const currentObjects = doc.objects ?? [];
    const previousObjects = this.previousDocument?.objects ?? [];
    const unionObjects = [...currentObjects, ...previousObjects];

    if (currentObjects.length > 0) {
      this.idMap = buildIdMap(currentObjects);
    } else {
      this.idMap = new Map();
    }
    if (unionObjects.length > 0) {
      this.reverseIdMap = buildReverseIdMap(unionObjects);
    } else {
      this.reverseIdMap = new Map();
    }

    // Уведомляем подписчиков об изменении
    if (this.onSnapshotChange) {
      this.onSnapshotChange();
    }
  }

  /**
   * Делает snapshot из pre-extracted elements через SDK pipeline.
   * segmentTree → buildVslDocument → store as current document.
   * Возвращает VslDocument (первый вызов) или VslDiff (последующие).
   */
  snapshotFromElements(
    extractedElements: readonly unknown[],
    input: SnapshotInput,
  ): SnapshotResult {
    // SDK pipeline: segment → build
    const segmented = segmentTree(extractedElements as ExtractedElement[]);
    const doc = buildVslDocument(segmented, {
      viewport: input.viewport,
      timestamp: input.timestamp,
      url: input.url,
      title: input.title,
    });

    // Сохраняем текущий документ как предыдущий (для getDiff)
    if (this.currentDocument) {
      this.previousDocument = this.currentDocument;
    }
    this.currentDocument = doc;
    this.version += 1;

    // Сохраняем метаданные скролла для единого пайплайна отдачи (АС[3])
    this.scrollContext = input.scroll ? { ...input.scroll } : null;

    // Строим карты маппинга ID для нового снапшота
    // idMap (short→long) — только из текущего документа (для резолвинга ID от агента)
    // reverseIdMap (long→short) — из union current + previous, чтобы removed объекты
    // из previousDocument тоже получали короткие ID (fix: raw IDs in diff removed/unchanged_refs)
    const currentObjects = doc.objects ?? [];
    const previousObjects = this.previousDocument?.objects ?? [];
    const unionObjects = [...currentObjects, ...previousObjects];

    if (currentObjects.length > 0) {
      this.idMap = buildIdMap(currentObjects);
    } else {
      this.idMap = new Map();
    }
    if (unionObjects.length > 0) {
      this.reverseIdMap = buildReverseIdMap(unionObjects);
    } else {
      this.reverseIdMap = new Map();
    }

    // Уведомляем подписчиков об изменении
    if (this.onSnapshotChange) {
      this.onSnapshotChange();
    }

    // Первый вызов → возвращаем полный документ
    if (!this.previousDocument) {
      return doc;
    }

    // Последующие вызовы → возвращаем diff
    return diffVslDocuments(this.previousDocument, doc, {
      diffVersion: this.version,
      baseVersion: this.version - 1,
    });
  }

  /**
   * Возвращает текущий snapshot (последний полный документ).
   * @throws Error если snapshot не установлен
   */
  getSnapshot(): VslDocument {
    if (!this.currentDocument) {
      throw new Error('No snapshot available. Call vsl_get_snapshot first.');
    }
    return this.currentDocument;
  }

  /**
   * Возвращает предыдущий полный документ (для вьюпорт-фильтра диффа:
   * видимость removed-объектов определяется по prev-документу).
   */
  getPreviousSnapshot(): VslDocument | null {
    return this.previousDocument;
  }

  /**
   * Проверяет, есть ли текущий snapshot.
   */
  hasSnapshot(): boolean {
    return this.currentDocument !== null;
  }

  /**
   * Вычисляет diff между текущим и предыдущим snapshot.
   * Использует SDK функцию diffVslDocuments.
   * @returns VslDiff или null если нет предыдущего snapshot
   */
  getDiff(): VslDiff | null {
    if (!this.currentDocument || !this.previousDocument) {
      return null;
    }

    // Используем SDK для вычисления diff
    return diffVslDocuments(this.previousDocument, this.currentDocument, {
      diffVersion: this.version,
      baseVersion: this.version - 1,
    });
  }

  /**
   * Сбрасывает сессию (состояние).
   */
  clear(): void {
    this.currentDocument = null;
    this.previousDocument = null;
    this.version = 0;
    this.scrollContext = null;
    this.idMap = new Map();
    this.reverseIdMap = new Map();
  }

  /**
   * Возвращает текущую версию snapshot.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Возвращает метаданные скролла последнего снапшота (единый пайплайн отдачи).
   * Используются для вычисления видимого окна и метаданных scrollable {top, bottom}.
   */
  getScrollContext(): ScrollContext | null {
    return this.scrollContext;
  }

  /**
   * Устанавливает скролл-контекст явно (для путей, идущих мимо
   * snapshotFromElements).
   */
  setScrollContext(scroll: ScrollContext | null): void {
    this.scrollContext = scroll;
  }

  /**
   * Возвращает карту shortId → longId для маппинга коротких ID в длинные.
   * Используется в executeAction/getVisual для резолвинга коротких ID от агента.
   */
  getIdMap(): Map<string, string> {
    return this.idMap;
  }

  /**
   * Возвращает обратную карту longId → shortId для замены ID в выдаче LLM.
   * Используется в путях отдачи для замены длинных ID на короткие.
   */
  getReverseIdMap(): Map<string, string> {
    return this.reverseIdMap;
  }

  /**
   * Перестраивает карты маппинга ID (idMap и reverseIdMap) на основе текущего документа.
   * Используется после добавления iframe объектов в currentDoc.objects,
   * чтобы reverseIdMap содержал маппинг для iframe элементов.
   * 
   * Context: snapshotFromElements() строит карты ДО добавления iframe объектов,
   * поэтому iframe элементы не попадают в reverseIdMap. Этот метод вызывается
   * после добавления iframe объектов для перестроения карт.
   */
  rebuildIdMaps(): void {
    if (!this.currentDocument) return;

    const currentObjects = this.currentDocument.objects ?? [];
    const previousObjects = this.previousDocument?.objects ?? [];
    const unionObjects = [...currentObjects, ...previousObjects];

    if (currentObjects.length > 0) {
      this.idMap = buildIdMap(currentObjects);
    } else {
      this.idMap = new Map();
    }
    if (unionObjects.length > 0) {
      this.reverseIdMap = buildReverseIdMap(unionObjects);
    } else {
      this.reverseIdMap = new Map();
    }
  }
}