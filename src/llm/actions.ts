/**
 * Action Model (ARCHITECTURE.md §7) для M1.3: канонический список действий,
 * классификация по цели и валидация ответа LLM (§7.4, T1.3.5).
 *
 * Валидация (§7.4 «Action Executor», п.1): action — валидное действие,
 * target_id существует в поданном VSL JSON. Поля value/reasoning проходят
 * сквозь с мягкой нормализацией типов (string | null).
 */

import { isVslDiff } from '../session/snapshotSession';
import type { VslObject } from '../types/vsl';
import { LlmValidationError } from './types';
import type { LlmAction, VslInput } from './types';

/**
 * Канонический список действий Action Model (§7.1–7.3) — 24 действия:
 * базовые (10) + расширенные (9) + навигационные (4) + download (1).
 */
export const VALID_ACTIONS = [
  // §7.1 Базовые
  'click',
  'type',
  'clear',
  'scroll',
  'hover',
  'focus',
  'blur',
  'select',
  'check',
  'uncheck',
  // §7.2 Расширенные
  'drag',
  'drop',
  'submit',
  'reset',
  'open',
  'close',
  'expand',
  'collapse',
  'wait',
  // §7.3 Навигационные
  'navigate',
  'go_back',
  'go_forward',
  'refresh',
  // §7.4 Загрузка файлов
  'download',
] as const;

/** Имя валидного действия Action Model. */
export type ValidAction = (typeof VALID_ACTIONS)[number];

/**
 * Действия, требующие target_id (§7.1–7.2): воздействие на элемент/форму.
 * Без цели: scroll, wait, navigate, go_back, go_forward, refresh.
 */
export const TARGET_ACTIONS: ReadonlySet<string> = new Set([
  'click',
  'type',
  'clear',
  'hover',
  'focus',
  'blur',
  'select',
  'check',
  'uncheck',
  'drag',
  'drop',
  'submit',
  'reset',
  'open',
  'close',
  'expand',
  'collapse',
  'download',
]);

const collectFromObjects = (objects: readonly VslObject[], ids: Set<string>): void => {
  for (const object of objects) {
    ids.add(object.id);
    collectFromObjects(object.ch ?? [], ids);
  }
};

/**
 * Собирает множество валидных target_id из входа LLM (§7.4 валидация):
 *  - VslDocument — все id рекурсивно;
 *  - VslDiff — added (рекурсивно) + modified + unchanged_refs;
 *    removed НЕ включаются: элементы удалены и не могут быть целью.
 */
export function collectIds(vslJson: VslInput): ReadonlySet<string> {
  const ids = new Set<string>();
  if (isVslDiff(vslJson)) {
    collectFromObjects(vslJson.changes.added, ids);
    for (const modified of vslJson.changes.modified) ids.add(modified.id);
    for (const ref of vslJson.changes.unchanged_refs) ids.add(ref);
  } else {
    collectFromObjects(vslJson.objects, ids);
  }
  return ids;
}

/**
 * Валидирует raw-объект действия из tool call модели (§7.4):
 *  - action — строка из VALID_ACTIONS;
 *  - для TARGET_ACTIONS target_id обязателен и должен присутствовать в validIds;
 *  - value/reasoning — passthrough с мягкой нормализацией (string | null);
 *    target_id у действий без цели игнорируется.
 * Бросает LlmValidationError при нарушении любого условия.
 */
export function validateAction(raw: unknown, validIds: ReadonlySet<string>): LlmAction {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LlmValidationError('Model response: action must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== 'string' || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    const shown = typeof action === 'string' ? action : (JSON.stringify(action) ?? 'undefined');
    throw new LlmValidationError(`Unknown action: ${shown}`);
  }
  const result: LlmAction = { action };
  if (TARGET_ACTIONS.has(action)) {
    const targetId = record.target_id;
    if (typeof targetId !== 'string') {
      throw new LlmValidationError(`Action "${action}" requires a string target_id`);
    }
    if (!validIds.has(targetId)) {
      throw new LlmValidationError(`target_id "${targetId}" not found in VSL JSON`);
    }
    result.target_id = targetId;
  }
  const value = record.value;
  if (typeof value === 'string' || value === null) result.value = value;
  const reasoning = record.reasoning;
  if (typeof reasoning === 'string') result.reasoning = reasoning;
  return result;
}