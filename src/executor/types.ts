/**
 * Типы Action Executor (ARCHITECTURE.md §7.4 «Action Executor»,
 * ROADMAP.md M1.4: T1.4.1–T1.4.3).
 *
 * Executor исполняет действия Action Model M1.3 (VALID_ACTIONS, 24 действия)
 * на живом DOM. Контракты:
 *  - вход — LlmAction (llm/types.ts): {action, target_id?, value?, reasoning?};
 *  - value-кодирование — строго по PARAMETER_CONVENTIONS (llm/prompt.ts),
 *    единый источник правды с LLM (prompt/schema согласованы в M1.3);
 *  - резолв target_id — чисто вычислительный, executor не аннотирует DOM;
 *  - executeAction — soft-fail: сбои возвращаются в ActionResult (error), а не
 *    бросаются, чтобы шаг агента не прерывал агентный цикл (extension background).
 */

/** Информация о загруженном файле (заполняется при download действии). */
export interface DownloadInfo {
  /** Уникальный идентификатор загрузки. */
  downloadId: string;
  /** Имя файла. */
  filename: string;
  /** URL источника. */
  url: string;
  /** Статус загрузки: pending | completed | cancelled | failed. */
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
}

/** Результат исполнения одного действия (возврат executeAction агенту). */
export interface ActionResult {
  /** true — действие исполнено; false — отклонено (детали в error). */
  success: boolean;
  /** Имя исполненного действия (эхо LlmAction.action). */
  action: string;
  /** target_id, если действие было с целью (эхо из входа). */
  targetId?: string;
  /** Машиночитаемое описание сбоя при success=false; обратная связь агенту. */
  error?: string;
  /** Информация о загрузке (заполняется при action='download' и success=true). */
  download?: DownloadInfo;
}

/**
 * Ошибка исполнения действия: невалидные параметры, целевой элемент не найден
 * (DOM изменился с момента снапшота) или расхождение tag при резолве id.
 * Бросается resolveTarget и внутренними шагами executeAction; снаружи
 * executeAction конвертирует её в ActionResult{success:false, error}.
 */
export class ActionExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionExecutionError';
  }
}

/** Опции исполнения; все опциональны (дефолты рассчитаны на прод в браузере). */
export interface ExecutorOptions {
  /**
   * Корень обхода DOM при резолве target_id; по умолчанию document.body.
   * Обязан совпадать с root, переданным в extractDomTree/VslSnapshotSession:
   * indexPath в VSL id считается от корня обхода (domExtractor, §5.1).
   */
  root?: Element;
  /** Таймаут wait (мс) — для селектора или "idle"; по умолчанию 5000. */
  waitTimeout?: number;
  /**
   * Амплитуда скролла (px) для bare-направления ("down" без amount);
   * по умолчанию 300. Явный "down:300" перекрывает дефолт.
   */
  defaultScrollAmount?: number;
}