/**
 * Тесты executeAction (M1.4, T1.4.5): базовые действия §7.1 (dev_7),
 * расширенные §7.2 + навигационные §7.3 + контракт soft-fail (dev_8).
 *
 * Среда: jsdom (jest.config.js, setupFiles jest.setup.ts). Контракты:
 *  - target_id резолвится реальным resolveTarget (формат vslBuilder.ts:100):
 *    фикстура строится от document.body — body.children[0] = <div>, уровни
 *    считаются по Element.children (текстовые узлы не считаются), id = tag_0_i;
 *  - программные изменения значений (type/clear/select/check/uncheck) обязаны
 *    диспетчить input+change с bubbles — AC[2] React-совместимость (делегирование
 *    проверяется слушателем на document);
 *  - scroll — window.scrollBy(dx, dy): jsdom не имеет layout-движка, реальной
 *    прокрутки нет — spy фиксирует дельты (гипотеза note_1790078680269);
 *  - soft-fail: сбой действия — ActionResult{success:false, error}, не исключение;
 *    сообщения ошибок сверяются verbatim с реализацией (английские, решение
 *    22.09.2026).
 */

import { executeAction } from './actionExecutor';

/**
 * Фикстура: body > div > [button, input(text), textarea, select,
 * input(checkbox), input(radio), form>input, details, div[aria-expanded],
 * span(source), span(dest)] → target_id = tag_0_<i> (indexPath от body).
 */
const FIXTURE_HTML = [
  '<div>',
  '  <button>Click me</button>',
  '  <input type="text" value="">',
  '  <textarea></textarea>',
  '  <select>',
  '    <option value="us">United States</option>',
  '    <option value="uk">United Kingdom</option>',
  '  </select>',
  '  <input type="checkbox">',
  '  <input type="radio">',
  '  <form>',
  '    <input type="text" value="default">',
  '  </form>',
  '  <details>',
  '    <summary>More</summary>',
  '    <p>Hidden content</p>',
  '  </details>',
  '  <div aria-expanded="false">Accordion</div>',
  '  <span draggable="true">Drag source</span>',
  '  <span>Drag destination</span>',
  '</div>',
].join('\n');

/** Целевые id фикстуры (формат id — vslBuilder.ts:100; корень — document.body). */
const IDS = {
  button: 'button_0_0',
  textInput: 'input_0_1',
  textarea: 'textarea_0_2',
  select: 'select_0_3',
  checkbox: 'input_0_4',
  radio: 'input_0_5',
  form: 'form_0_6',
  formInput: 'input_0_6_0',
  details: 'details_0_7',
  accordion: 'div_0_8',
  dragSource: 'span_0_9',
  dragDest: 'span_0_10',
} as const;

/** Поиск элемента фикстуры с явным сбоем вместо null (noUncheckedIndexedAccess). */
function q<T extends Element>(selector: string): T {
  const el = document.querySelector(selector);
  if (el === null) {
    throw new Error(`fixture: element not found: ${selector}`);
  }
  return el as T;
}

describe('executeAction — базовые действия §7.1', () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE_HTML;
  });

  describe('click', () => {
    it('нативный click(): обработчик цели получает событие, результат — эхо действия', async () => {
      const handler = jest.fn();
      q<HTMLButtonElement>('button').addEventListener('click', handler);

      const result = await executeAction({ action: 'click', target_id: IDS.button });

      expect(result.success).toBe(true);
      expect(result.action).toBe('click');
      expect(result.targetId).toBe(IDS.button);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('click всплывает до document (делегирование, как в React)', async () => {
      const delegated = jest.fn();
      document.addEventListener('click', delegated, { once: true });

      await executeAction({ action: 'click', target_id: IDS.button });

      expect(delegated).toHaveBeenCalledTimes(1);
    });
  });

  describe('type', () => {
    it('заменяет значение поля и диспетчит input+change с bubbles', async () => {
      const input = q<HTMLInputElement>('input[type="text"]');
      const events: string[] = [];
      input.addEventListener('input', () => events.push('input'));
      input.addEventListener('change', () => events.push('change'));
      const delegatedChange = jest.fn();
      document.addEventListener('change', delegatedChange, { once: true });

      const result = await executeAction({
        action: 'type',
        target_id: IDS.textInput,
        value: 'hello',
      });

      expect(result.success).toBe(true);
      expect(input.value).toBe('hello');
      expect(events).toEqual(['input', 'change']);
      expect(delegatedChange).toHaveBeenCalledTimes(1);
    });

    it('повторный type ЗАМЕНЯЕТ значение (детерминизм), а не дополняет', async () => {
      const input = q<HTMLInputElement>('input[type="text"]');
      await executeAction({ action: 'type', target_id: IDS.textInput, value: 'first' });
      await executeAction({ action: 'type', target_id: IDS.textInput, value: 'second' });
      expect(input.value).toBe('second');
    });

    it('работает с textarea', async () => {
      const area = q<HTMLTextAreaElement>('textarea');
      const result = await executeAction({
        action: 'type',
        target_id: IDS.textarea,
        value: 'многострочный',
      });
      expect(result.success).toBe(true);
      expect(area.value).toBe('многострочный');
    });

    it('без value — soft-fail с сообщением про string value', async () => {
      const result = await executeAction({ action: 'type', target_id: IDS.textInput });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action "type" requires a string value');
    });

    it('цель не поле ввода — soft-fail с типом элемента', async () => {
      const result = await executeAction({
        action: 'type',
        target_id: IDS.button,
        value: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Action "type" requires an <input> or <textarea> target, got <button>',
      );
    });
  });

  describe('clear', () => {
    it('очищает значение и диспетчит input+change', async () => {
      const input = q<HTMLInputElement>('input[type="text"]');
      input.value = 'to-be-cleared';
      const events: string[] = [];
      input.addEventListener('input', () => events.push('input'));
      input.addEventListener('change', () => events.push('change'));

      const result = await executeAction({ action: 'clear', target_id: IDS.textInput });

      expect(result.success).toBe(true);
      expect(input.value).toBe('');
      expect(events).toEqual(['input', 'change']);
    });
  });

  describe('scroll', () => {
    let scrollBySpy: jest.SpyInstance;

    beforeEach(() => {
      // jsdom не прокручивает: spy фиксирует (dx, dy) вместо реального скролла.
      scrollBySpy = jest.spyOn(window, 'scrollBy').mockImplementation(() => {});
    });

    afterEach(() => {
      scrollBySpy.mockRestore();
    });

    it('bare "down" берёт дефолтную амплитуду 300', async () => {
      await executeAction({ action: 'scroll', value: 'down' });
      expect(scrollBySpy).toHaveBeenCalledWith(0, 300);
    });

    it('"down:300" — явный amount', async () => {
      await executeAction({ action: 'scroll', value: 'down:300' });
      expect(scrollBySpy).toHaveBeenCalledWith(0, 300);
    });

    it('"up:150" — вертикаль вверх отрицательной дельтой', async () => {
      await executeAction({ action: 'scroll', value: 'up:150' });
      expect(scrollBySpy).toHaveBeenCalledWith(0, -150);
    });

    it('"left:200" / "right:200" — горизонтальные дельты', async () => {
      await executeAction({ action: 'scroll', value: 'left:200' });
      expect(scrollBySpy).toHaveBeenLastCalledWith(-200, 0);
      await executeAction({ action: 'scroll', value: 'right:200' });
      expect(scrollBySpy).toHaveBeenLastCalledWith(200, 0);
    });

    it('ExecutorOptions.defaultScrollAmount перекрывает дефолт 300', async () => {
      await executeAction({ action: 'scroll', value: 'down' }, { defaultScrollAmount: 777 });
      expect(scrollBySpy).toHaveBeenCalledWith(0, 777);
    });

    it('невалидное направление — soft-fail с ожидаемым форматом', async () => {
      const result = await executeAction({ action: 'scroll', value: 'sideways' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Invalid scroll value "sideways" — expected "up", "down", "left", "right" or "dir:amount" (e.g. "down:300")',
      );
    });

    it('невалидный amount — soft-fail', async () => {
      const result = await executeAction({ action: 'scroll', value: 'down:abc' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Invalid scroll amount in "down:abc" — expected a positive number, e.g. "down:300"',
      );
    });
  });

  describe('hover', () => {
    it('mouseover (bubbles) + mouseenter (не всплывает по DOM-семантике)', async () => {
      const button = q<HTMLButtonElement>('button');
      const over = jest.fn();
      const enter = jest.fn();
      button.addEventListener('mouseover', over);
      button.addEventListener('mouseenter', enter);
      const delegatedOver = jest.fn();
      document.addEventListener('mouseover', delegatedOver, { once: true });

      const result = await executeAction({ action: 'hover', target_id: IDS.button });

      expect(result.success).toBe(true);
      expect(over).toHaveBeenCalledTimes(1);
      expect(enter).toHaveBeenCalledTimes(1);
      expect(delegatedOver).toHaveBeenCalledTimes(1);
    });
  });

  describe('focus/blur', () => {
    it('focus: цель становится document.activeElement', async () => {
      const result = await executeAction({ action: 'focus', target_id: IDS.textInput });
      expect(result.success).toBe(true);
      expect(document.activeElement).toBe(q<HTMLInputElement>('input[type="text"]'));
    });

    it('blur: фокус возвращается на body', async () => {
      q<HTMLInputElement>('input[type="text"]').focus();
      const result = await executeAction({ action: 'blur', target_id: IDS.textInput });
      expect(result.success).toBe(true);
      expect(document.activeElement).toBe(document.body);
    });
  });

  describe('select', () => {
    it('точное совпадение по option.value', async () => {
      const result = await executeAction({ action: 'select', target_id: IDS.select, value: 'uk' });
      expect(result.success).toBe(true);
      expect(q<HTMLSelectElement>('select').value).toBe('uk');
    });

    it('фолбэк: матч по видимому тексту option (dc_4)', async () => {
      await executeAction({ action: 'select', target_id: IDS.select, value: 'United States' });
      expect(q<HTMLSelectElement>('select').value).toBe('us');
    });

    it('выбор диспетчит input+change с bubbles', async () => {
      const selectEl = q<HTMLSelectElement>('select');
      const events: string[] = [];
      selectEl.addEventListener('input', () => events.push('input'));
      selectEl.addEventListener('change', () => events.push('change'));
      const delegated = jest.fn();
      document.addEventListener('change', delegated, { once: true });

      await executeAction({ action: 'select', target_id: IDS.select, value: 'uk' });

      expect(events).toEqual(['input', 'change']);
      expect(delegated).toHaveBeenCalledTimes(1);
    });

    it('нет совпадений ни по value, ни по тексту — soft-fail', async () => {
      const result = await executeAction({
        action: 'select',
        target_id: IDS.select,
        value: 'mars',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Action "select": option "mars" not found in <select> (neither by value nor by visible text)',
      );
    });

    it('цель не <select> — soft-fail с типом элемента', async () => {
      const result = await executeAction({
        action: 'select',
        target_id: IDS.button,
        value: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action "select" requires a <select> target, got <button>');
    });
  });

  describe('check/uncheck', () => {
    it('check: чекбокс становится checked + change', async () => {
      const box = q<HTMLInputElement>('input[type="checkbox"]');
      const events: string[] = [];
      box.addEventListener('change', () => events.push('change'));

      const result = await executeAction({ action: 'check', target_id: IDS.checkbox });

      expect(result.success).toBe(true);
      expect(box.checked).toBe(true);
      expect(events).toEqual(['change']);
    });

    it('uncheck: снимает checked', async () => {
      const box = q<HTMLInputElement>('input[type="checkbox"]');
      box.checked = true;
      const result = await executeAction({ action: 'uncheck', target_id: IDS.checkbox });
      expect(result.success).toBe(true);
      expect(box.checked).toBe(false);
    });

    it('radio допустим для check (builder даёт check/uncheck обоим типам)', async () => {
      const radio = q<HTMLInputElement>('input[type="radio"]');
      const result = await executeAction({ action: 'check', target_id: IDS.radio });
      expect(result.success).toBe(true);
      expect(radio.checked).toBe(true);
    });

    it('цель не чекбокс/radio — soft-fail с типом элемента', async () => {
      const result = await executeAction({ action: 'check', target_id: IDS.button });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Action "check" requires an <input type="checkbox"> or <input type="radio"> target, got <button>',
      );
    });
  });
});

describe('executeAction — расширенные действия §7.2', () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE_HTML;
  });

  describe('drag', () => {
    it('последовательность HTML5 DnD: dragstart/dragend у источника, dragenter/dragover/drop у цели', async () => {
      const source = q<HTMLSpanElement>('span[draggable="true"]');
      const dest = q<HTMLSpanElement>('span:not([draggable])');
      const sourceEvents: string[] = [];
      const destEvents: string[] = [];
      source.addEventListener('dragstart', () => sourceEvents.push('dragstart'));
      source.addEventListener('dragend', () => sourceEvents.push('dragend'));
      dest.addEventListener('dragenter', () => destEvents.push('dragenter'));
      dest.addEventListener('dragover', () => destEvents.push('dragover'));
      dest.addEventListener('drop', () => destEvents.push('drop'));

      const result = await executeAction({
        action: 'drag',
        target_id: IDS.dragSource,
        value: IDS.dragDest,
      });

      expect(result.success).toBe(true);
      expect(sourceEvents).toEqual(['dragstart', 'dragend']);
      expect(destEvents).toEqual(['dragenter', 'dragover', 'drop']);
    });

    it('без value (id destination) — soft-fail', async () => {
      const result = await executeAction({ action: 'drag', target_id: IDS.dragSource });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action "drag" requires a string value');
    });
  });

  describe('drop', () => {
    it('цель получает dragover + drop (executor stateless — источник неизвестен)', async () => {
      const dest = q<HTMLSpanElement>('span:not([draggable])');
      const destEvents: string[] = [];
      dest.addEventListener('dragover', () => destEvents.push('dragover'));
      dest.addEventListener('drop', () => destEvents.push('drop'));

      const result = await executeAction({ action: 'drop', target_id: IDS.dragDest });

      expect(result.success).toBe(true);
      expect(destEvents).toEqual(['dragover', 'drop']);
    });
  });

  describe('submit', () => {
    it('синтетический cancelable submit с bubbles — обработчик формы и document получают событие', async () => {
      const handler = jest.fn();
      q<HTMLFormElement>('form').addEventListener('submit', handler);
      const delegated = jest.fn();
      document.addEventListener('submit', delegated, { once: true });

      const result = await executeAction({ action: 'submit', target_id: IDS.form });

      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(delegated).toHaveBeenCalledTimes(1);
    });

    it('цель не форма — soft-fail с типом элемента', async () => {
      const result = await executeAction({ action: 'submit', target_id: IDS.button });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action "submit" requires a <form> target, got <button>');
    });
  });

  describe('reset', () => {
    it('нативный reset(): поля возвращаются к дефолтам, событие reset диспетчится', async () => {
      const form = q<HTMLFormElement>('form');
      const input = q<HTMLInputElement>('form input[type="text"]');
      input.value = 'changed';
      const resetHandler = jest.fn();
      form.addEventListener('reset', resetHandler);

      const result = await executeAction({ action: 'reset', target_id: IDS.form });

      expect(result.success).toBe(true);
      expect(input.value).toBe('default');
      expect(resetHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('open/close', () => {
    it('open: <details> получает open', async () => {
      const result = await executeAction({ action: 'open', target_id: IDS.details });
      expect(result.success).toBe(true);
      expect(q<HTMLDetailsElement>('details').open).toBe(true);
    });

    it('close: <details> теряет open', async () => {
      q<HTMLDetailsElement>('details').open = true;
      const result = await executeAction({ action: 'close', target_id: IDS.details });
      expect(result.success).toBe(true);
      expect(q<HTMLDetailsElement>('details').open).toBe(false);
    });

    it('цель без open-семантики — soft-fail с типом элемента', async () => {
      const result = await executeAction({ action: 'open', target_id: IDS.button });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Action "open" requires a <dialog> or <details> target, got <button>',
      );
    });
  });

  describe('expand/collapse', () => {
    it('expand/collapse: <details> → атрибут open', async () => {
      const details = q<HTMLDetailsElement>('details');
      const expandResult = await executeAction({ action: 'expand', target_id: IDS.details });
      expect(expandResult.success).toBe(true);
      expect(details.open).toBe(true);
      const collapseResult = await executeAction({ action: 'collapse', target_id: IDS.details });
      expect(collapseResult.success).toBe(true);
      expect(details.open).toBe(false);
    });

    it('expand/collapse: элемент с aria-expanded получает "true"/"false"', async () => {
      const accordion = q<HTMLDivElement>('div[aria-expanded]');
      const expandResult = await executeAction({ action: 'expand', target_id: IDS.accordion });
      expect(expandResult.success).toBe(true);
      expect(accordion.getAttribute('aria-expanded')).toBe('true');
      const collapseResult = await executeAction({ action: 'collapse', target_id: IDS.accordion });
      expect(collapseResult.success).toBe(true);
      expect(accordion.getAttribute('aria-expanded')).toBe('false');
    });

    it('цель без aria-expanded и не details — soft-fail', async () => {
      const result = await executeAction({ action: 'expand', target_id: IDS.button });
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Action "expand" requires a <details> or an element with aria-expanded, got <button>',
      );
    });
  });

  describe('wait', () => {
    it('существующий селектор — условие выполнено сразу', async () => {
      const result = await executeAction({ action: 'wait', value: 'button' });
      expect(result.success).toBe(true);
    });

    it('"idle" — document.readyState === "complete" в jsdom', async () => {
      const result = await executeAction({ action: 'wait', value: 'idle' });
      expect(result.success).toBe(true);
    });

    it('таймаут — soft-fail с сообщением о невыполненном условии', async () => {
      const result = await executeAction(
        { action: 'wait', value: '#never-appears' },
        { waitTimeout: 60 },
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('wait: condition "#never-appears" is not met within 60ms');
    });

    it('невалидный селектор — soft-fail', async () => {
      const result = await executeAction({ action: 'wait', value: '>>>[' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('wait: invalid selector ">>>["');
    });
  });

  describe('download', () => {
    it('target_id: клик по элементу (кнопка/ссылка для скачивания)', async () => {
      const handler = jest.fn();
      q<HTMLButtonElement>('button').addEventListener('click', handler);

      const result = await executeAction({ action: 'download', target_id: IDS.button });

      expect(result.success).toBe(true);
      expect(result.action).toBe('download');
      expect(result.targetId).toBe(IDS.button);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('value (URL): создание <a download> элемента и возврат DownloadInfo', async () => {
      const url = 'https://example.com/file.pdf';

      const result = await executeAction({ action: 'download', value: url });

      expect(result.success).toBe(true);
      expect(result.action).toBe('download');
      expect(result.download).toBeDefined();
      expect(result.download?.url).toBe(url);
      expect(result.download?.filename).toBe('file.pdf');
      expect(result.download?.status).toBe('pending');
      expect(result.download?.downloadId).toMatch(/^download_/);
    });

    it('value (URL) без расширения файла: filename = "download"', async () => {
      const url = 'https://example.com/api/download';

      const result = await executeAction({ action: 'download', value: url });

      expect(result.success).toBe(true);
      expect(result.download?.filename).toBe('download');
    });

    it('без target_id и value — soft-fail', async () => {
      const result = await executeAction({ action: 'download' });

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Action "download" requires either target_id (element to click) or value (URL to download)',
      );
    });
  });
});

describe('executeAction — навигационные действия §7.3', () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE_HTML;
  });

  describe('navigate', () => {
    it('location.assign: same-document hash-навигация реально меняет URL (Location unforgeable — spy невозможен)', async () => {
      const before = window.location.href;
      const result = await executeAction({ action: 'navigate', value: '#dev-8-anchor' });
      expect(result.success).toBe(true);
      expect(window.location.hash).toBe('#dev-8-anchor');
      expect(window.location.href).toBe(`${before}#dev-8-anchor`);
    });

    it('полный URL: executor делегирует location.assign и не бросает (jsdom не навигирует)', async () => {
      const result = await executeAction({
        action: 'navigate',
        value: 'https://example.com/next',
      });
      expect(result.success).toBe(true);
    });

    it('без value — soft-fail', async () => {
      const result = await executeAction({ action: 'navigate' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action "navigate" requires a string value');
    });
  });

  describe('go_back/go_forward', () => {
    it('go_back вызывает window.history.back()', async () => {
      const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});
      const result = await executeAction({ action: 'go_back' });
      expect(result.success).toBe(true);
      expect(backSpy).toHaveBeenCalledTimes(1);
      backSpy.mockRestore();
    });

    it('go_forward вызывает window.history.forward()', async () => {
      const forwardSpy = jest.spyOn(window.history, 'forward').mockImplementation(() => {});
      const result = await executeAction({ action: 'go_forward' });
      expect(result.success).toBe(true);
      expect(forwardSpy).toHaveBeenCalledTimes(1);
      forwardSpy.mockRestore();
    });
  });

  describe('refresh', () => {
    it('refresh: делегирует location.reload() — success без исключения (Location unforgeable: reload не мокается в jsdom)', async () => {
      const result = await executeAction({ action: 'refresh' });
      expect(result.success).toBe(true);
    });
  });
});

describe('executeAction — контракт soft-fail', () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE_HTML;
  });

  it('неизвестное действие — soft-fail со ссылкой на VALID_ACTIONS', async () => {
    const result = await executeAction({ action: 'teleport' });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Unknown action: "teleport" — must be one of VALID_ACTIONS (24 actions)',
    );
  });

  it('target-действие без target_id — soft-fail', async () => {
    const result = await executeAction({ action: 'click' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Action "click" requires a string target_id');
  });

  it('невалидный формат target_id (без indexPath) — soft-fail от resolveTarget', async () => {
    const result = await executeAction({ action: 'click', target_id: 'button' });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Invalid target_id "button": missing index path — expected format "tag_index1_index2_..."',
    );
  });

  it('элемент по indexPath не найден (DOM изменился) — soft-fail', async () => {
    const result = await executeAction({ action: 'click', target_id: 'button_9_9' });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to resolve target_id "button_9_9": no element child at index 9 on depth 1 — DOM may have changed since the snapshot',
    );
  });

  it('value: null эквивалентен отсутствию value (LlmAction.value: string | null)', async () => {
    const result = await executeAction({ action: 'type', target_id: IDS.textInput, value: null });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Action "type" requires a string value');
  });
});