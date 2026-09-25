/**
 * JSON Schema tool «execute_action» (T1.3.4) — одна схема для обоих провайдеров:
 *  - OpenAI function calling: tools[0].function.parameters;
 *  - Anthropic tool use: tools[0].input_schema.
 * Список действий — enum из VALID_ACTIONS (actions.ts): единый источник правды
 * с system prompt. Формат аргументов — §7.4 {action, target_id, value, reasoning}.
 */

import { VALID_ACTIONS } from './actions';

/** Имя tool, через которое модель возвращает действие. */
export const ACTION_TOOL_NAME = 'execute_action' as const;

/** Описание tool для моделей. */
export const ACTION_TOOL_DESCRIPTION =
  'Execute exactly one next browser action toward the user goal.';

/**
 * JSON Schema аргументов tool (подмножество Draft 2020-12, совместимое
 * с OpenAI function calling и Anthropic tool use).
 */
export const ACTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action name from the Action Model (ARCHITECTURE.md §7.1–7.3).',
      enum: [...VALID_ACTIONS],
    },
    target_id: {
      type: 'string',
      description: 'Element id from the provided VSL JSON (required for target actions).',
    },
    value: {
      type: ['string', 'null'],
      description:
        'Value for parameterized actions: type/select/scroll/navigate/wait/drag.',
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of the chosen action.',
    },
  },
  required: ['action'],
  additionalProperties: false,
};