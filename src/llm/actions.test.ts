/**
 * Тесты Action Model (T1.3.5): VALID_ACTIONS/TARGET_ACTIONS, collectIds
 * (VslDocument и VslDiff §6.2), validateAction (whitelist + target_id, §7.4).
 */

import type { VslDiff } from '../diff/diffEngine';
import type { VslDocument } from '../types/vsl';
import { collectIds, TARGET_ACTIONS, validateAction, VALID_ACTIONS } from './actions';
import { LlmValidationError } from './types';

const DOC: VslDocument = {
  vsl_version: '1.0.0',
  canvas: {
    viewport: { width: 1280, height: 800, unit: 'px' },
    background: '#ffffff',
    scale: 1,
    orientation: 'landscape',
    timestamp: '2026-09-22T09:00:00.000Z',
  },
  objects: [
    {
      id: 'header_0',
      t: 'header',
      p: [0, 0],
      s: [1280, 64],
      ch: [
        { id: 'input_0_0', t: 'input', p: [0.1, 0.3], s: [200, 32] },
        {
          id: 'nav_0_1',
          t: 'nav',
          p: [0.5, 0.3],
          s: [300, 32],
          ch: [{ id: 'link_0_1_0', t: 'link', p: [0.5, 0.3], s: [80, 32] }],
        },
      ],
    },
  ],
};

const DIFF: VslDiff = {
  diff_version: 2,
  base_version: 1,
  timestamp: '2026-09-22T09:01:00.000Z',
  changes: {
    added: [
      {
        id: 'form_1_0',
        t: 'container',
        p: [0.1, 0.4],
        s: [400, 200],
        ch: [{ id: 'input_1_0_0', t: 'input', p: [0.12, 0.45], s: [180, 28] }],
      },
    ],
    modified: [{ id: 'header_0', txt: 'Новый заголовок' }],
    removed: [{ id: 'gone_9' }],
    unchanged_refs: ['link_0_1_0'],
  },
};

describe('VALID_ACTIONS / TARGET_ACTIONS', () => {
  it('24 действия §7.1–7.3, без дубликатов', () => {
    expect(VALID_ACTIONS).toHaveLength(24);
    expect(new Set(VALID_ACTIONS).size).toBe(24);
    expect(VALID_ACTIONS).toContain('click');
    expect(VALID_ACTIONS).toContain('type');
    expect(VALID_ACTIONS).toContain('scroll');
    expect(VALID_ACTIONS).toContain('navigate');
    expect(VALID_ACTIONS).toContain('go_back');
    expect(VALID_ACTIONS).toContain('refresh');
  });

  it('TARGET_ACTIONS: 18 с целью; 6 действий без цели (§7.1–7.3)', () => {
    expect(TARGET_ACTIONS.size).toBe(18);
    for (const action of ['scroll', 'wait', 'navigate', 'go_back', 'go_forward', 'refresh']) {
      expect(TARGET_ACTIONS.has(action)).toBe(false);
    }
    expect(TARGET_ACTIONS.has('click')).toBe(true);
    expect(TARGET_ACTIONS.has('type')).toBe(true);
    expect(TARGET_ACTIONS.has('submit')).toBe(true);
    expect(TARGET_ACTIONS.has('drag')).toBe(true);
    expect(TARGET_ACTIONS.has('download')).toBe(true);
  });
});

describe('collectIds', () => {
  it('VslDocument: все id рекурсивно', () => {
    expect([...collectIds(DOC)].sort()).toEqual([
      'header_0',
      'input_0_0',
      'link_0_1_0',
      'nav_0_1',
    ]);
  });

  it('VslDiff: added рекурсивно + modified + unchanged_refs; removed НЕ валидны', () => {
    const ids = collectIds(DIFF);
    expect(ids.has('form_1_0')).toBe(true);
    expect(ids.has('input_1_0_0')).toBe(true); // потомок added-поддерева
    expect(ids.has('header_0')).toBe(true); // modified
    expect(ids.has('link_0_1_0')).toBe(true); // unchanged_refs
    expect(ids.has('gone_9')).toBe(false); // removed — элемент больше не существует
  });
});

describe('validateAction', () => {
  const ids = collectIds(DOC);

  it('валидный click → нормализованный LlmAction (§7.4)', () => {
    expect(
      validateAction(
        { action: 'click', target_id: 'input_0_0', value: null, reasoning: 'ок' },
        ids,
      ),
    ).toEqual({ action: 'click', target_id: 'input_0_0', value: null, reasoning: 'ок' });
  });

  it('scroll/navigate без target_id валидны (действия без цели)', () => {
    expect(validateAction({ action: 'scroll', value: 'down' }, ids)).toEqual({
      action: 'scroll',
      value: 'down',
    });
    expect(validateAction({ action: 'navigate', value: 'https://x.test' }, ids)).toEqual({
      action: 'navigate',
      value: 'https://x.test',
    });
  });

  it('не-объект / массив → LlmValidationError', () => {
    expect(() => validateAction(null, ids)).toThrow(LlmValidationError);
    expect(() => validateAction('click', ids)).toThrow(LlmValidationError);
    expect(() => validateAction(['click'], ids)).toThrow(LlmValidationError);
    expect(() => validateAction(undefined, ids)).toThrow(LlmValidationError);
  });

  it('неизвестное действие → LlmValidationError', () => {
    expect(() => validateAction({ action: 'fly' }, ids)).toThrow(LlmValidationError);
    expect(() => validateAction({ action: 42 }, ids)).toThrow(LlmValidationError);
  });

  it('type без target_id → ошибка; click с чужим target_id → ошибка (T1.3.5)', () => {
    expect(() => validateAction({ action: 'type', value: 'x' }, ids)).toThrow(
      LlmValidationError,
    );
    expect(() => validateAction({ action: 'click', target_id: 'gone_9' }, ids)).toThrow(
      LlmValidationError,
    );
    expect(() => validateAction({ action: 'click', target_id: 'invented_1' }, ids)).toThrow(
      LlmValidationError,
    );
  });

  it('value нестрокового типа отбрасывается, reasoning строковый сохраняется', () => {
    expect(validateAction({ action: 'scroll', value: 42, reasoning: 'вниз' }, ids)).toEqual({
      action: 'scroll',
      reasoning: 'вниз',
    });
  });
});