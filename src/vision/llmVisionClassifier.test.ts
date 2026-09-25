/**
 * Unit-тесты LlmVisionClassifier (T1.5.3): tool «classify_fragment»,
 * валидация ответа {type, confidence, description} — на фейковом RawLlmCaller,
 * без сети (реальные vision API — integration-тесты, gated env-ключами).
 */

import { LlmValidationError } from '../llm/types';
import type { LlmContentPart, LlmResponse, LlmToolDef, RawLlmCaller } from '../llm/types';
import { CLASSIFY_TOOL, LlmVisionClassifier, validateClassification } from './llmVisionClassifier';

const IMAGE = { mediaType: 'image/webp', data: 'AAAA' };

/** Фейк RawLlmCaller: захватывает аргументы sendRaw, возвращает заданный action. */
function makeCaller(action: unknown): {
  caller: RawLlmCaller;
  calls: Array<{
    system: string;
    userContent: readonly LlmContentPart[];
    tool: LlmToolDef;
  }>;
} {
  const calls: Array<{
    system: string;
    userContent: readonly LlmContentPart[];
    tool: LlmToolDef;
  }> = [];
  return {
    calls,
    caller: {
      async sendRaw(system, userContent, tool) {
        calls.push({ system, userContent, tool });
        const response: LlmResponse = { text: null, action, model: 'fake', usage: {} };
        return response;
      },
    },
  };
}

describe('LlmVisionClassifier', () => {
  it('classify: текст+изображение в userContent, tool classify_fragment, валидированный ответ', async () => {
    const { caller, calls } = makeCaller({
      type: 'chart',
      confidence: 0.9,
      description: 'bar chart',
    });
    const classifier = new LlmVisionClassifier(caller);
    await expect(classifier.classify(IMAGE, 'tag=canvas, no ARIA role')).resolves.toEqual({
      type: 'chart',
      confidence: 0.9,
      description: 'bar chart',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toEqual(CLASSIFY_TOOL);
    expect(calls[0]!.userContent).toEqual([
      {
        type: 'text',
        text: 'Classify the attached visual fragment. Element context: tag=canvas, no ARIA role',
      },
      { type: 'image', mediaType: 'image/webp', data: 'AAAA' },
    ]);
    expect(calls[0]!.system.length).toBeGreaterThan(0);
  });

  it('classify: без hint — промпт без контекста', async () => {
    const { caller, calls } = makeCaller({ type: 'icon', confidence: 0.8 });
    await new LlmVisionClassifier(caller).classify(IMAGE);
    expect(calls[0]!.userContent[0]).toEqual({
      type: 'text',
      text: 'Classify the attached visual fragment.',
    });
  });

  it('classify: неизвестный type → LlmValidationError', async () => {
    const { caller } = makeCaller({ type: 'banner', confidence: 0.9 });
    await expect(new LlmVisionClassifier(caller).classify(IMAGE)).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('classify: confidence вне [0..1] → LlmValidationError', async () => {
    const { caller } = makeCaller({ type: 'icon', confidence: 1.5 });
    await expect(new LlmVisionClassifier(caller).classify(IMAGE)).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('classify: ответ не объект / без tool call → LlmValidationError', async () => {
    const notObject = makeCaller('not an object');
    await expect(new LlmVisionClassifier(notObject.caller).classify(IMAGE)).rejects.toThrow(
      LlmValidationError,
    );
    const noAction = makeCaller(undefined);
    await expect(new LlmVisionClassifier(noAction.caller).classify(IMAGE)).rejects.toThrow(
      LlmValidationError,
    );
  });
});

describe('validateClassification', () => {
  it('валидный ответ: enum-тип, confidence 0..1, description опускается если нет', () => {
    expect(validateClassification({ type: 'custom_widget', confidence: 0 })).toEqual({
      type: 'custom_widget',
      confidence: 0,
    });
    expect(validateClassification({ type: 'unknown', confidence: 1, description: 'd' })).toEqual({
      type: 'unknown',
      confidence: 1,
      description: 'd',
    });
  });

  it('невалидные ответы: не объект / не-строка type / не-число confidence / не-строка description', () => {
    expect(() => validateClassification(null)).toThrow(LlmValidationError);
    expect(() => validateClassification(42)).toThrow(LlmValidationError);
    expect(() => validateClassification({ type: 5, confidence: 0.5 })).toThrow(LlmValidationError);
    expect(() => validateClassification({ type: 'icon', confidence: '0.5' })).toThrow(
      LlmValidationError,
    );
    expect(() =>
      validateClassification({ type: 'icon', confidence: 0.5, description: 7 }),
    ).toThrow(LlmValidationError);
  });
});