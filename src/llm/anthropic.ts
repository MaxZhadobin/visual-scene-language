/**
 * Anthropic adapter (T1.3.3): Messages API (/v1/messages) + tool use
 * (tools/tool_choice «execute_action») без официального SDK — нативный fetch
 * через инъекцию транспорта (ноль runtime-зависимостей, DEC-002).
 *
 * Retry (AC[8], §10.3): executeJsonWithRetry — до 3 попыток, только
 * сеть/429/5xx. Мультимодальность (AC[7], §4.4): vf-ссылки из входа при
 * наличии данных в сторе превращаются в content-блоки
 * {type: 'image', source: {type: 'base64', media_type, data}}.
 */

import { collectIds, validateAction } from './actions';
import { buildSystemPrompt, buildUserPrompt, collectFragmentData } from './prompt';
import {
  ACTION_TOOL_DESCRIPTION,
  ACTION_TOOL_NAME,
  ACTION_TOOL_SCHEMA,
} from './schema';
import { defaultTransport, executeJsonWithRetry } from './transport';
import { LlmError } from './types';
import type {
  DecideInput,
  LlmAction,
  LlmAdapter,
  LlmAdapterConfig,
  LlmContentPart,
  LlmResponse,
  LlmToolDef,
  LlmTransport,
  SendPromptOptions,
  Sleep,
  VslInput,
} from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic требует max_tokens в каждом запросе (§7.4-ответ компактен). */
const DEFAULT_MAX_TOKENS = 1024;

/** Блок content-ответа /v1/messages — подмножество полей, нужных адаптеру. */
interface AnthropicReplyBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/** Ответ /v1/messages — подмножество полей, нужных адаптеру. */
interface AnthropicMessagesResponse {
  model?: string;
  content?: AnthropicReplyBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Один content-блок user-сообщения (текст или image). */
type AnthropicContentBlock = Record<string, unknown>;

/**
 * Адаптер Anthropic (claude-sonnet-4-20250514): system prompt + VSL JSON (§2.5)
 * → tool_use «execute_action» с действием §7.4.
 */
export class AnthropicAdapter implements LlmAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly maxRetries: number;
  private readonly transport: LlmTransport;
  private readonly sleep: Sleep | undefined;

  constructor(config: LlmAdapterConfig) {
    if (config.apiKey.length === 0) {
      throw new LlmError('AnthropicAdapter: apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxTokens = DEFAULT_MAX_TOKENS;
    this.maxRetries = config.maxRetries ?? 3;
    this.transport = config.transport ?? defaultTransport;
    this.sleep = config.sleep;
  }

  async sendPrompt(
    vslJson: VslInput,
    task: string,
    options?: SendPromptOptions,
  ): Promise<LlmResponse> {
    const userContent: LlmContentPart[] = [
      { type: 'text', text: buildUserPrompt(vslJson, task) },
      ...collectFragmentData(vslJson, options?.visualFragments).map((fragment) => ({
        type: 'image' as const,
        mediaType: fragment.mediaType,
        data: fragment.data,
      })),
    ];
    return this.sendRaw(buildSystemPrompt(), userContent, {
      name: ACTION_TOOL_NAME,
      description: ACTION_TOOL_DESCRIPTION,
      schema: ACTION_TOOL_SCHEMA,
    });
  }

  /**
   * Низкоуровневый вызов (T1.5.4, вариант C): провайдер-независимые аргументы
   * → Messages API → LlmResponse. Потребители: sendPrompt (tool
   * «execute_action») и LlmVisionClassifier (tool «classify_fragment»).
   * tool_use-блоки фильтруются по tool.name (ранее — константа ACTION_TOOL_NAME):
   * параметризация безопасна, sendPrompt передаёт ACTION_TOOL_NAME.
   */
  async sendRaw(
    system: string,
    userContent: readonly LlmContentPart[],
    tool: LlmToolDef,
  ): Promise<LlmResponse> {
    const content: AnthropicContentBlock[] = userContent.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : {
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mediaType,
              data: part.data,
            },
          },
    );
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: 'user', content }],
      tools: [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.schema,
        },
      ],
      tool_choice: { type: 'tool', name: tool.name },
    };

    const data = await executeJsonWithRetry<AnthropicMessagesResponse>(
      this.transport,
      `${this.baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      },
      'Anthropic',
      { maxRetries: this.maxRetries, sleep: this.sleep },
    );

    let text: string | null = null;
    let rawAction: unknown;
    for (const block of data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text = text === null ? block.text : `${text}\n${block.text}`;
      } else if (block.type === 'tool_use' && block.name === tool.name) {
        rawAction = block.input;
      }
    }
    return {
      text,
      action: rawAction,
      model: data.model ?? this.model,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
    };
  }

  /** Convenience §9.4: решение для цели + валидация (whitelist + target_id). */
  async decide(input: DecideInput): Promise<LlmAction> {
    const response = await this.sendPrompt(input.vslJson, input.goal, {
      visualFragments: input.visualFragments,
    });
    return validateAction(response.action, collectIds(input.vslJson));
  }
}