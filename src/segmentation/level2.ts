/**
 * Segmentation Level 2: ARIA-атрибуты (T1.1.4, ROADMAP.md M1.1).
 *
 * Контракт — таблица «Уровень 2: ARIA-атрибуты» из ARCHITECTURE.md:
 *  - role → тип VSL (button / dialog→modal / tab / tabpanel→container);
 *  - aria-label → txt (доступное имя элемента);
 *  - aria-pressed / aria-expanded / aria-disabled = "true" → st
 *    (checked / expanded / disabled);
 *  - aria-hidden="true" → элемент декоративный (обрезается в segmenter.ts).
 *
 * L2 дополняет L1: тип из ARIA-роли применяется только если тег не дал типа.
 */

import type { VslState, VslType } from '../types/vsl';

/** Таблица маппинга ARIA-ролей (нижний регистр) → типы VSL. */
export const ARIA_ROLE_TYPE_MAP: Readonly<Record<string, VslType>> = {
  button: 'button',
  dialog: 'modal',
  tab: 'tab',
  tabpanel: 'container',
};

/**
 * Возвращает тип VSL по ARIA-роли или null, если роль не из контракта
 * (или роли нет). Регистр не учитывается.
 */
export function resolveAriaRoleType(role: string | undefined): VslType | null {
  if (!role) return null;
  return ARIA_ROLE_TYPE_MAP[role.toLowerCase()] ?? null;
}

const TRUE = 'true';

/**
 * Состояние VSL из ARIA-атрибутов. По контракту маппируется только точное
 * значение "true" ("false"/"mixed"/прочее → null). При нескольких состояниях
 * приоритет — порядок таблицы контракта: checked → expanded → disabled.
 */
export function resolveSt(attributes: Record<string, string>): VslState | null {
  if (attributes['aria-pressed'] === TRUE) return 'checked';
  if (attributes['aria-expanded'] === TRUE) return 'expanded';
  if (attributes['aria-disabled'] === TRUE) return 'disabled';
  return null;
}