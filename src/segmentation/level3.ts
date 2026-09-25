/**
 * Segmentation Level 3: CSS-анализ (T1.5.1, ROADMAP.md M1.5).
 *
 * Контракт — таблица «Уровень 3: CSS-анализ» из ARCHITECTURE.md:L145-156:
 * ровно 8 паттернов над CSS-подмножеством, захваченным domExtractor
 * (ElementCss: computed styles через viewOf/getComputedStyle):
 *
 * | CSS-паттерн                          | → Тип                  |
 * |--------------------------------------|------------------------|
 * | cursor: pointer + onclick            | button                 |
 * | display: flex + gap > 0              | container              |
 * | font-weight: bold + font-size > 20px | heading                |
 * | position: fixed + top: 0             | header                 |
 * | position: fixed + bottom: 0          | footer                 |
 * | overflow: hidden + height > 200px    | scrollable_container   |
 * | display: none / visibility: hidden   | пропустить (domExtractor) |
 * | opacity: 0 + pointer-events: none    | пропустить (isPointerInvisible) |
 *
 * Функции чистые и детерминированные. Порядок проверки = порядку таблицы
 * (первое совпадение выигрывает). Итоговый приоритет классификации:
 * L1 > L2 > L3 (интеграция в segmenter — dev_5, T1.5.2).
 */

import type { ElementCss } from '../capture/domExtractor';
import type { VslType } from '../types/vsl';

/** Числовое значение CSS-свойства ('24px' → 24; 'auto'/'normal'/'' → NaN). */
function px(value: string | undefined): number {
  return value === undefined ? Number.NaN : Number.parseFloat(value);
}

/**
 * Возвращает тип VSL по CSS-паттерну (уровень 3) или null, если ни один из
 * 6 классифицирующих паттернов не совпал (skip-паттерны отдельно: см.
 * isPointerInvisible; display:none/visibility:hidden фильтруются в domExtractor).
 *
 * @param css захваченное CSS-подмножество (undefined — захват не производился)
 * @param attributes атрибуты элемента (для onclick в паттерне button)
 */
export function resolveLevel3Type(
  css: ElementCss | undefined,
  attributes: Readonly<Record<string, string>>,
): VslType | null {
  if (css === undefined) return null;

  // 1. cursor: pointer + onclick → button (интерактивный элемент).
  if (css.cursor === 'pointer' && attributes['onclick'] !== undefined) return 'button';

  // 2. display: flex + gap > 0 → container (контейнер с layout).
  if (css.display === 'flex' && px(css.gap) > 0) return 'container';

  // 3. font-weight: bold + font-size > 20px → heading (заголовок).
  //    Computed styles отдают жирность числом ('700'), inline — словом ('bold').
  const isBold = css.fontWeight === 'bold' || px(css.fontWeight) >= 700;
  if (isBold && px(css.fontSize) > 20) return 'heading';

  // 4. position: fixed + top: 0 → header (фиксированный header).
  if (css.position === 'fixed' && px(css.top) === 0) return 'header';

  // 5. position: fixed + bottom: 0 → footer (фиксированный footer).
  if (css.position === 'fixed' && px(css.bottom) === 0) return 'footer';

  // 6. overflow: hidden + height > 200px → scrollable_container.
  if (css.overflow === 'hidden' && px(css.height) > 200) return 'scrollable_container';

  return null;
}

/**
 * Элемент невидим для взаимодействия (skip-паттерн таблицы уровня 3):
 * opacity: 0 + pointer-events: none → пропускается вместе с поддеревом
 * (применяется в segmenter, аналог aria-hidden — dev_5).
 *
 * display: none / visibility: hidden — другие skip-паттерны таблицы,
 * отфильтровываются раньше, в domExtractor (isDisplayNone/isVisibilityHidden).
 */
export function isPointerInvisible(css: ElementCss | undefined): boolean {
  if (css === undefined) return false;
  return px(css.opacity) === 0 && css.pointerEvents === 'none';
}