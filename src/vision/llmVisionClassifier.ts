/**
 * LlmVisionClassifier (T1.5.3): реализация порта VisionClassifier через LLM
 * vision API — РЕАЛЬНЫЕ вызовы OpenAI/Anthropic (решение пользователя 24.09.2026).
 *
 * Механика — низкоуровневый sendRaw адаптеров (вариант C, T1.5.4): system-промпт
 * + user-контент (инструкция + изображение base64) + tool «classify_fragment»
 * {type, confidence, description} по паттернам schema.ts (одна JSON Schema на
 * оба провайдера) и actions.ts (валидация raw-ответа с whitelist).
 *
 * Инъекция RawLlmCaller (Dependency Inversion): OpenAIAdapter/AnthropicAdapter
 * структурно удовлетворяют интерфейсу; в unit-тестах — фейк, в integration —
 * реальные адаптеры (gated env-ключами).
 */

import { LlmValidationError } from '../llm/types';
import type {
  LlmContentPart,
  LlmToolDef,
  RawLlmCaller,
  VisualFragmentData,
} from '../llm/types';
import type { VisionClassification, VisionClassifier } from './types';

/** Типы фрагмента (§2.2.2 Шаг 2) — runtime-список для enum схемы и валидации. */
const FRAGMENT_TYPES: readonly string[] = ['image', 'icon', 'chart', 'custom_widget', 'unknown'];

/**
 * Tool классификации: одна JSON Schema на оба провайдера (OpenAI
 * function.parameters / Anthropic input_schema) — паттерн schema.ts.
 */
export const CLASSIFY_TOOL: LlmToolDef = {
  name: 'classify_fragment',
  description:
    'Classify the attached visual fragment cropped from a web page element ' +
    '(an element without accessible semantics).',
  schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...FRAGMENT_TYPES] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      description: { type: 'string' },
    },
    required: ['type', 'confidence'],
    additionalProperties: false,
  },
};

/** System-промпт классификации (§2.2.2 Шаг 2: вход — кроп, выход — type/confidence/description). */
const CLASSIFY_SYSTEM_PROMPT = [
  'You are a visual classifier for web page fragments.',
  'You receive an image cropped from a page element that has no accessible semantics.',
  'Classify it by calling the classify_fragment tool:',
  '- type: image | icon | chart | custom_widget | unknown;',
  '- confidence: 0..1;',
  '- description: optional short visual description (useful for custom_widget and unknown).',
].join('\n');

/** Строит user-промпт: инструкция + опциональная подсказка контекстом элемента. */
function buildClassifyUserPrompt(hint?: string): string {
  const base = 'Classify the attached visual fragment.';
  return hint === undefined ? base : `${base} Element context: ${hint}`;
}

/**
 * Валидация raw-ответа модели (паттерн validateAction, actions.ts):
 * объект, type из whitelist (VisualFragmentType), confidence — число [0..1],
 * description — опциональная строка. Нарушения → LlmValidationError.
 */
export function validateClassification(raw: unknown): VisionClassification {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmValidationError('classification: response is not an object');
  }
  const record = raw as Record<string, unknown>;
  const type = record['type'];
  const confidence = record['confidence'];
  if (typeof type !== 'string' || !FRAGMENT_TYPES.includes(type)) {
    throw new LlmValidationError(`classification: unknown fragment type ${JSON.stringify(type)}`);
  }
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new LlmValidationError('classification: confidence must be a number in [0..1]');
  }
  const description = record['description'];
  if (description !== undefined && typeof description !== 'string') {
    throw new LlmValidationError('classification: description must be a string');
  }
  return {
    type: type as VisionClassification['type'],
    confidence,
    ...(description !== undefined ? { description } : {}),
  };
}

/** LLM-реализация порта VisionClassifier (M1.5): sendRaw + tool «classify_fragment». */
export class LlmVisionClassifier implements VisionClassifier {
  private readonly caller: RawLlmCaller;

  constructor(caller: RawLlmCaller) {
    this.caller = caller;
  }

  async classify(image: VisualFragmentData, hint?: string): Promise<VisionClassification> {
    const userContent: LlmContentPart[] = [
      { type: 'text', text: buildClassifyUserPrompt(hint) },
      { type: 'image', mediaType: image.mediaType, data: image.data },
    ];
    const response = await this.caller.sendRaw(CLASSIFY_SYSTEM_PROMPT, userContent, CLASSIFY_TOOL);
    return validateClassification(response.action);
  }
}