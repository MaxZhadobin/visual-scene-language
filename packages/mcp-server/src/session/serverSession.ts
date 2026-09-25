/**
 * Server Session — серверная snapshot session для MCP Server.
 *
 * Хранит текущий VSL document, вычисляет diffs при повторных вызовах.
 * Аналог VslSnapshotSession из SDK, но для серверного контекста.
 *
 * Lifecycle:
 *  - setSnapshot(vslDoc) — установить текущий snapshot
 *  - getSnapshot() — получить текущий snapshot
 *  - getDiff() — получить diff с момента предыдущего snapshot
 *  - clear() — сбросить кэш
 *  - setOnSnapshotChange() — зарегистрировать callback для уведомлений
 */

import type { VslDocument } from '@vsl/sdk';
import { diffVslDocuments } from '@vsl/sdk';
import type { DiffOptions, VslDiff } from '@vsl/sdk';

/**
 * Серверная snapshot session.
 * Хранит текущий VSL document и вычисляет diffs.
 */
export class ServerSession {
  private currentSnapshot: VslDocument | null = null;
  private previousSnapshot: VslDocument | null = null;
  private onSnapshotChange: (() => void) | null = null;

  /**
   * Регистрирует callback для уведомлений об изменении snapshot.
   * Вызывается при каждом вызове setSnapshot().
   */
  setOnSnapshotChange(callback: () => void): void {
    this.onSnapshotChange = callback;
  }

  /**
   * Устанавливает новый snapshot.
   * Предыдущий snapshot сохраняется для вычисления diff.
   * Вызывает onSnapshotChange callback если зарегистрирован.
   */
  setSnapshot(doc: VslDocument): void {
    this.previousSnapshot = this.currentSnapshot;
    this.currentSnapshot = doc;
    
    // Уведомляем подписчиков об изменении
    if (this.onSnapshotChange) {
      this.onSnapshotChange();
    }
  }

  /**
   * Возвращает текущий snapshot.
   * @throws Error если snapshot не установлен
   */
  getSnapshot(): VslDocument {
    if (!this.currentSnapshot) {
      throw new Error('No snapshot available. Call vsl_get_snapshot first.');
    }
    return this.currentSnapshot;
  }

  /**
   * Проверяет, есть ли текущий snapshot.
   */
  hasSnapshot(): boolean {
    return this.currentSnapshot !== null;
  }

  /**
   * Вычисляет diff между текущим и предыдущим snapshot.
   * @returns VslDiff или null если нет предыдущего snapshot
   */
  getDiff(): VslDiff | null {
    if (!this.currentSnapshot || !this.previousSnapshot) {
      return null;
    }

    return diffVslDocuments(this.previousSnapshot, this.currentSnapshot, { diffVersion: 2, baseVersion: 1 } as DiffOptions);
  }

  /**
   * Сбрасывает сессию (кэш).
   */
  clear(): void {
    this.currentSnapshot = null;
    this.previousSnapshot = null;
  }
}