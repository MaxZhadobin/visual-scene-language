/**
 * Smoke-тест публичного API M1.3 (AC[6]): все новые экспорты src/index.ts
 * доступны и работают. Обращение к каждому экспорту через namespace-импорт
 * покрывает getter-функции re-экспортов (ts-jest CJS), которые иначе не
 * вызываются и занижают покрытие по functions (см. neg note по S7-гейту).
 */

import * as sdk from './index';
import type { VslDocument } from './types/vsl';

const MIN_DOC: VslDocument = {
  vsl_version: '1.0.0',
  canvas: {
    viewport: { width: 1280, height: 800, unit: 'px' },
    background: '#ffffff',
    scale: 1,
    orientation: 'landscape',
    timestamp: '2026-09-22T09:00:00.000Z',
  },
  objects: [{ id: 'button_0', t: 'button', p: [0.5, 0.5], s: [120, 40], txt: 'OK' }],
};

describe('M1.3 публичное API (smoke, AC[6])', () => {
  it('адаптеры и ошибки провайдеров экспортированы', () => {
    expect(typeof sdk.OpenAIAdapter).toBe('function');
    expect(typeof sdk.AnthropicAdapter).toBe('function');
    expect(typeof sdk.LlmError).toBe('function');
    expect(typeof sdk.LlmValidationError).toBe('function');
  });

  it('Action Model: VALID_ACTIONS/collectIds/validateAction работают', () => {
    expect(sdk.VALID_ACTIONS).toContain('click');
    const ids = sdk.collectIds(MIN_DOC);
    expect(ids.has('button_0')).toBe(true);
    expect(sdk.validateAction({ action: 'click', target_id: 'button_0' }, ids)).toEqual({
      action: 'click',
      target_id: 'button_0',
    });
    expect(() => sdk.validateAction({ action: 'fly' }, ids)).toThrow(sdk.LlmValidationError);
  });

  it('schema tool «execute_action» экспортирована', () => {
    expect(sdk.ACTION_TOOL_NAME).toBe('execute_action');
    expect(sdk.ACTION_TOOL_DESCRIPTION.length).toBeGreaterThan(0);
    expect(sdk.ACTION_TOOL_SCHEMA.type).toBe('object');
  });

  it('промпты и retry экспортированы и работают', () => {
    expect(sdk.buildSystemPrompt()).toContain('execute_action');
    expect(sdk.buildUserPrompt(MIN_DOC, 'g')).toContain('User goal: g');
    expect(typeof sdk.retryWithBackoff).toBe('function');
    expect(sdk.VSL_SDK_VERSION).toBe('0.1.0');
  });
});