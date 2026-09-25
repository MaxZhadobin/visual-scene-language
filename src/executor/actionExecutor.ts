/**
 * Action Executor — исполнение действий Action Model M1.3 на живом DOM
 * (ARCHITECTURE.md §7.4 «Action Executor», ROADMAP.md M1.4: T1.4.1–T1.4.3).
 *
 * Контракт (spec M1.4; value-кодирование — строго по PARAMETER_CONVENTIONS
 * llm/prompt.ts, единый источник правды с LLM — решение dc_4/dc_7):
 *  - вход — LlmAction (llm/types.ts): {action, target_id?, value?, reasoning?};
 *  - target_id резолвится resolveTarget (tag_indexPath → обход DOM от корня
 *    снапшота: ExecutorOptions.root ?? document.body) — executor не аннотирует
 *    DOM и не хранит ссылок на элементы между действиями;
 *  - executeAction — soft-fail: всегда возвращает Promise<ActionResult>, не
 *    бросает; ActionExecutionError (и любой неожиданный error) перехватывается
 *    и отражается в result.error — сбой шага не роняет агентный цикл
 *    (extension background);
 *  - значения input/select/checkbox выставляются программно + dispatch
 *    input/change с bubbles — React-совместимость (AC[2]): React обновляет
 *    controlled-компоненты только по событиям, а не от прямой смены .value;
 *  - type ЗАМЕНЯЕТ значение поля (не дополняет) — детерминизм: повторный type
 *    даёт то же состояние; очистка поля — отдельным действием clear;
 *  - сообщения ошибок — на английском (публичный API @vsl/sdk и вход для
 *    LLM-агента, решение 22.09.2026).
 */

import type { LlmAction } from '../llm/types';
import { resolveTarget } from './resolveTarget';
import { ActionExecutionError } from './types';
import type { ActionResult, DownloadInfo, ExecutorOptions } from './types';

/** Амплитуда скролла по умолчанию для bare-направления (types.ts, дефолт 300). */
const DEFAULT_SCROLL_AMOUNT = 300;

/** Допустимые направления scroll (PARAMETER_CONVENTIONS). */
const SCROLL_DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);

/** Таймаут wait по умолчанию (types.ts ExecutorOptions, дефолт 5000). */
const WAIT_DEFAULT_TIMEOUT_MS = 5000;

/** Интервал опроса условия wait (мс). */
const WAIT_POLL_INTERVAL_MS = 50;
/**
 * Резолвит target_id действия через resolveTarget (§7.4). Обработчики
 * target-действий вызывают его первым шагом: отсутствие строкового target_id —
 * ActionExecutionError (PARAMETER_CONVENTIONS: target-действия требуют цель).
 */
function resolveTargetOf(action: LlmAction, options: ExecutorOptions): Element {
  const targetId = action.target_id;
  if (typeof targetId !== 'string') {
    throw new ActionExecutionError(`Action "${action.action}" requires a string target_id`);
  }
  return resolveTarget(targetId, options);
}

/** Извлекает обязательный строковый value параметризованного действия. */
function requireValue(action: LlmAction): string {
  const value = action.value;
  if (typeof value !== 'string') {
    throw new ActionExecutionError(`Action "${action.action}" requires a string value`);
  }
  return value;
}

/**
 * Dispatch input+change с bubbles после программного изменения значения —
 * AC[2] React-совместимость: React делегирует события на корне, поэтому смена
 * .value без событий не обновляет controlled-компоненты.
 */
function dispatchValueEvents(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Проверяет, что цель — текстовое поле (input/textarea; contenteditable в
 * scope M1.4 не входит: builder даёт type только input/textarea), и возвращает
 * типизированную ссылку.
 */
function requireTextTarget(
  action: LlmAction,
  el: Element,
): HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el;
  }
  throw new ActionExecutionError(
    `Action "${action.action}" requires an <input> or <textarea> target, got <${el.tagName.toLowerCase()}>`,
  );
}

/** type/clear: замена значения поля + input/change (контракт — в шапке файла). */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  el.value = text;
  dispatchValueEvents(el);
}

/**
 * Клик: нативный click() (HTMLElement/SVGElement, HTMLOrSVGElement mixin);
 * фолбэк — синтетический bubbling MouseEvent для элементов без click().
 */
function clickElement(el: Element): void {
  if (typeof (el as HTMLElement).click === 'function') {
    (el as HTMLElement).click();
    return;
  }
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Hover: синтетические mouseover (bubbles) + mouseenter (не bubbling по DOM-семантике). */
function hoverElement(el: Element): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
}

/**
 * Focus/blur: нативные focus()/blur() — браузер (и jsdom) сами диспетчат
 * focus/blur/focusin/focusout; элемент без focus() — ActionExecutionError.
 */
function focusableOrThrow(action: LlmAction, el: Element): { focus(): void; blur(): void } {
  const htmlEl = el as HTMLElement;
  if (typeof htmlEl.focus !== 'function' || typeof htmlEl.blur !== 'function') {
    throw new ActionExecutionError(
      `Action "${action.action}" requires a focusable element, got <${el.tagName.toLowerCase()}>`,
    );
  }
  return htmlEl;
}

/**
 * select: value = option value (PARAMETER_CONVENTIONS), фолбэк — совпадение по
 * видимому тексту option (dc_4); иначе ActionExecutionError. Значение
 * выставляется в value выбранного option'а + input/change (AC[2]).
 */
function selectOption(el: Element, raw: string): void {
  if (!(el instanceof HTMLSelectElement)) {
    throw new ActionExecutionError(
      `Action "select" requires a <select> target, got <${el.tagName.toLowerCase()}>`,
    );
  }
  const wanted = raw.trim();
  for (const option of Array.from(el.options)) {
    if (option.value === raw) {
      el.value = option.value;
      dispatchValueEvents(el);
      return;
    }
  }
  for (const option of Array.from(el.options)) {
    if (option.text.trim() === wanted) {
      el.value = option.value;
      dispatchValueEvents(el);
      return;
    }
  }
  throw new ActionExecutionError(
    `Action "select": option "${raw}" not found in <select> (neither by value nor by visible text)`,
  );
}

/**
 * check/uncheck: цель — input[type=checkbox|radio] (builder defaultActions
 * даёт check/uncheck обоим типам); состояние выставляется программно +
 * input/change (AC[2]).
 */
function setChecked(el: Element, action: LlmAction, checked: boolean): void {
  if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio')) {
    throw new ActionExecutionError(
      `Action "${action.action}" requires an <input type="checkbox"> or <input type="radio"> target, got <${el.tagName.toLowerCase()}>`,
    );
  }
  el.checked = checked;
  dispatchValueEvents(el);
}

/**
 * Разбор value scroll: "dir" либо "dir:amount" (PARAMETER_CONVENTIONS, dc_4);
 * bare-направление берёт amount из ExecutorOptions.defaultScrollAmount.
 * Возвращает дельту (dx, dy) для window.scrollBy.
 */
function parseScrollValue(value: string, defaultAmount: number): { dx: number; dy: number } {
  const parts = value.trim().split(':');
  const dir = parts[0] ?? '';
  const amountPart = parts[1];
  if (parts.length > 2 || !SCROLL_DIRECTIONS.has(dir)) {
    throw new ActionExecutionError(
      `Invalid scroll value "${value}" — expected "up", "down", "left", "right" or "dir:amount" (e.g. "down:300")`,
    );
  }
  let amount = defaultAmount;
  if (amountPart !== undefined) {
    if (!/^\d+(?:\.\d+)?$/.test(amountPart)) {
      throw new ActionExecutionError(
        `Invalid scroll amount in "${value}" — expected a positive number, e.g. "down:300"`,
      );
    }
    amount = Number(amountPart);
  }
  const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
  const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
  return { dx, dy };
}

/**
 * Синтетическая последовательность HTML5 drag-and-drop (dc_4: drag —
 * target_id=source, value=id destination; executor stateless — источник и цель
 * резолвятся заново на каждое действие). DragEvent может отсутствовать в средах
 * вроде jsdom — фолбэк на bubbling Event с той же семантикой.
 */
function dispatchDragEvent(target: Element, type: string): void {
  if (typeof DragEvent === 'function') {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
  } else {
    target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }
}

/** Проверяет, что цель — форма (dc_4: submit/reset — target_id формы). */
function requireForm(action: LlmAction, el: Element): HTMLFormElement {
  if (el instanceof HTMLFormElement) {
    return el;
  }
  throw new ActionExecutionError(
    `Action "${action.action}" requires a <form> target, got <${el.tagName.toLowerCase()}>`,
  );
}

/**
 * open/close (dc_4: target_id без value): <dialog> → showModal()/close(),
 * <details> → атрибут open; у прочих элементов нет стандартной open-семантики —
 * ActionExecutionError. HTMLDialogElement может отсутствовать в jsdom — guard.
 */
function setOpenState(action: LlmAction, el: Element, open: boolean): void {
  if (typeof HTMLDialogElement !== 'undefined' && el instanceof HTMLDialogElement) {
    if (open) {
      el.showModal();
    } else {
      el.close();
    }
    return;
  }
  if (el instanceof HTMLDetailsElement) {
    el.open = open;
    return;
  }
  throw new ActionExecutionError(
    `Action "${action.action}" requires a <dialog> or <details> target, got <${el.tagName.toLowerCase()}>`,
  );
}

/**
 * expand/collapse (dc_4: target_id без value): <details> → атрибут open,
 * иначе элемент с aria-expanded → установка атрибута (состояние читается
 * напрямую, без событий); иначе ActionExecutionError.
 */
function setExpanded(action: LlmAction, el: Element, expanded: boolean): void {
  if (el instanceof HTMLDetailsElement) {
    el.open = expanded;
    return;
  }
  if (el.hasAttribute('aria-expanded')) {
    el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    return;
  }
  throw new ActionExecutionError(
    `Action "${action.action}" requires a <details> or an element with aria-expanded, got <${el.tagName.toLowerCase()}>`,
  );
}

/** Пауза между опросами условия wait. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Условие wait выполнено (dc_4/dc_7): "idle" → документ загрузился
 * (document.readyState === 'complete'); иначе value — CSS-селектор, элемент
 * существует. Невалидный селектор — ActionExecutionError с понятным сообщением.
 */
function isWaitSatisfied(value: string): boolean {
  if (value.trim() === 'idle') {
    return document.readyState === 'complete';
  }
  try {
    return document.querySelector(value) !== null;
  } catch {
    throw new ActionExecutionError(`wait: invalid selector "${value}"`);
  }
}

/**
 * wait: опрос условия (селектор или "idle") до таймаута
 * ExecutorOptions.waitTimeout (дефолт 5000). Таймаут — ActionExecutionError
 * (soft-fail отразит его в ActionResult.error).
 */
async function waitForValue(value: string, options: ExecutorOptions): Promise<void> {
  const timeoutMs = options.waitTimeout ?? WAIT_DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isWaitSatisfied(value)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new ActionExecutionError(
        `wait: condition "${value}" is not met within ${timeoutMs}ms`,
      );
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

/**
 * Исполняет одно действие LLM на живом DOM (§7.4, T1.4.1–T1.4.3).
 *
 * Soft-fail (решение dev_1): любые сбои — невалидные параметры, целевой
 * элемент не найден, DOM изменился с момента снапшота — возвращаются в
 * ActionResult.error, исключение агентному циклу не бросается.
 *
 * @param action — действие от LLM (после validateAction в M1.3; состав VSL
 *   здесь повторно не валидируется — executor проверяет только то, что нужно
 *   для исполнения).
 * @param options — ExecutorOptions; root обязан совпадать с корнем снапшота.
 * @returns ActionResult с эхом action/targetId.
 */
export async function executeAction(
  action: LlmAction,
  options: ExecutorOptions = {},
): Promise<ActionResult> {
  const targetId = action.target_id;
  const echo: ActionResult = {
    success: false,
    action: action.action,
    ...(typeof targetId === 'string' ? { targetId } : {}),
  };
  try {
    switch (action.action) {
      // ——— §7.1 Базовые (T1.4.1) ———
      case 'click':
        clickElement(resolveTargetOf(action, options));
        break;
      case 'type':
        typeInto(
          requireTextTarget(action, resolveTargetOf(action, options)),
          requireValue(action),
        );
        break;
      case 'clear': {
        const field = requireTextTarget(action, resolveTargetOf(action, options));
        typeInto(field, '');
        break;
      }
      case 'scroll': {
        const amount = options.defaultScrollAmount ?? DEFAULT_SCROLL_AMOUNT;
        const { dx, dy } = parseScrollValue(requireValue(action), amount);
        window.scrollBy(dx, dy);
        break;
      }
      case 'hover':
        hoverElement(resolveTargetOf(action, options));
        break;
      case 'focus':
        focusableOrThrow(action, resolveTargetOf(action, options)).focus();
        break;
      case 'blur':
        focusableOrThrow(action, resolveTargetOf(action, options)).blur();
        break;
      case 'select':
        selectOption(resolveTargetOf(action, options), requireValue(action));
        break;
      case 'check':
        setChecked(resolveTargetOf(action, options), action, true);
        break;
      case 'uncheck':
        setChecked(resolveTargetOf(action, options), action, false);
        break;
      // ——— §7.2 Расширенные (T1.4.2) ———
      case 'drag': {
        // dc_4: target_id = source, value = id destination (второй resolveTarget).
        // Каноническая последовательность HTML5 DnD: старт у источника,
        // перетаскивание и сброс у цели, завершение у источника.
        const destinationId = requireValue(action);
        const source = resolveTargetOf(action, options);
        const destination = resolveTarget(destinationId, options);
        dispatchDragEvent(source, 'dragstart');
        dispatchDragEvent(destination, 'dragenter');
        dispatchDragEvent(destination, 'dragover');
        dispatchDragEvent(destination, 'drop');
        dispatchDragEvent(source, 'dragend');
        break;
      }
      case 'drop': {
        // Executor stateless: источник неизвестен — цель получает стандартную
        // последовательность dragover (страница разрешает drop через
        // preventDefault в своём обработчике) и drop.
        const dropTarget = resolveTargetOf(action, options);
        dispatchDragEvent(dropTarget, 'dragover');
        dispatchDragEvent(dropTarget, 'drop');
        break;
      }
      case 'submit': {
        // Синтетический cancelable submit с bubbles: нативный form.submit()
        // обходит submit-обработчики и в jsdom не реализован; делегированные
        // обработчики (React onSubmit) событие получают.
        const form = requireForm(action, resolveTargetOf(action, options));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        break;
      }
      case 'reset':
        // Нативный reset(): по спецификации сам диспетчит cancelable 'reset'
        // и сбрасывает поля, если событие не отменено.
        requireForm(action, resolveTargetOf(action, options)).reset();
        break;
      case 'open':
        setOpenState(action, resolveTargetOf(action, options), true);
        break;
      case 'close':
        setOpenState(action, resolveTargetOf(action, options), false);
        break;
      case 'expand':
        setExpanded(action, resolveTargetOf(action, options), true);
        break;
      case 'collapse':
        setExpanded(action, resolveTargetOf(action, options), false);
        break;
      case 'wait':
        await waitForValue(requireValue(action), options);
        break;
      // ——— §7.3 Навигационные (T1.4.3) ———
      case 'navigate':
        // location.assign: сохраняет запись истории (в отличие от replace),
        // принимает и относительные URL (PARAMETER_CONVENTIONS: navigate=URL).
        window.location.assign(requireValue(action));
        break;
      case 'go_back':
        window.history.back();
        break;
      case 'go_forward':
        window.history.forward();
        break;
      case 'refresh':
        window.location.reload();
        break;
      case 'download': {
        // Гибридный подход (решение dc_6): target_id — клик по элементу, value — прямое скачивание по URL
        const downloadTargetId = action.target_id;
        const downloadValue = action.value;
        
        if (typeof downloadTargetId === 'string') {
          // Клик по элементу (кнопка/ссылка для скачивания)
          const el = resolveTarget(downloadTargetId, options);
          clickElement(el);
          // Браузер инициирует download event, extension context обработает его отдельно
          break;
        }
        
        if (typeof downloadValue === 'string') {
          // Прямое скачивание по URL
          const url = downloadValue;
          const a = document.createElement('a');
          a.href = url;
          a.download = ''; // Браузер сам определит filename из URL
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Генерируем downloadId для отслеживания
          const downloadId = `download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const filename = url.split('/').pop() || 'download';
          const downloadInfo: DownloadInfo = {
            downloadId,
            filename,
            url,
            status: 'pending',
          };
          return {
            ...echo,
            success: true,
            download: downloadInfo,
          };
        }
        
        throw new ActionExecutionError(
          'Action "download" requires either target_id (element to click) or value (URL to download)',
        );
      }
      default:
        // После validateAction (M1.3) сюда попасть нельзя — защита от прямых
        // вызовов executeAction с действием вне VALID_ACTIONS.
        throw new ActionExecutionError(
          `Unknown action: "${action.action}" — must be one of VALID_ACTIONS (24 actions)`,
        );
    }
    return { ...echo, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...echo, success: false, error: message };
  }
}