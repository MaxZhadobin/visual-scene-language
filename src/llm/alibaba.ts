/**
 * Alibaba/Qwen adapter (DashScope API, OpenAI-compatible): Chat Completions API
 * + function calling (tools/tool_choice «execute_action») без официального SDK —
 * нативный fetch через инъекцию транспорта (ноль runtime-зависимостей, DEC-002).
 *
 * DashScope compatible-mode endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1
 * Формат запроса/ответа идентичен OpenAI (chat/completions, tool_calls).
 *
 * Модель по умолчанию: qwen3.8-flash — самая быстрая и дешёвая модель Qwen (09.2026).
 * Используется для vision-backend (классификация visual fragments).
 *
 * Retry (AC[8], §10.3): executeJsonWithRetry — до 3 попыток, только
 * сеть/429/5xx. Мультимодальность (AC[7], §4.4): vf-ссылки из входа при
 * наличии данных в сторе превращаются в content-части
 * {type: 'image_url', image_url: {url: 'data:<mediaType>;base64,<data>'}}.
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

const DEFAULT_MODEL = 'qwen3.8-flash';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/** Ответ chat/completions — подмножество полей, нужных адаптеру. */
interface AlibabaChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Один content-блок user-сообщения (текст или image_url). */
type AlibabaContentPart = Record<string, unknown>;

/**
 * Адаптер Alibaba/Qwen (qwen3.8-flash): system prompt + VSL JSON (§2.5)
 * → tool call «execute_action» с действием §7.4.
 *
 * DashScope compatible-mode — OpenAI-compatible API, формат запроса/ответа
 * идентичен OpenAI (chat/completions, tools, tool_choice, tool_calls).
 */
export class AlibabaAdapter implements LlmAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly transport: LlmTransport;
  private readonly sleep: Sleep | undefined;

  constructor(config: LlmAdapterConfig) {
    if (config.apiKey.length === 0) {
      throw new LlmError('AlibabaAdapter: apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
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
   * → DashScope Chat Completions → LlmResponse. Потребители: sendPrompt (tool
   * «execute_action») и LlmVisionClassifier (tool «classify_fragment»).
   * Retry (§10.3) и парсинг tool_calls живут здесь в одном месте.
   */
  async sendRaw(
    system: string,
    userContent: readonly LlmContentPart[],
    tool: LlmToolDef,
  ): Promise<LlmResponse> {
    const content: AlibabaContentPart[] = userContent.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : {
            type: 'image_url',
            image_url: { url: `data:${part.mediaType};base64,${part.data}` },
          },
    );
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.schema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: tool.name } },
    };

    const data = await executeJsonWithRetry<AlibabaChatResponse>(
      this.transport,
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      'Alibaba/Qwen',
      { maxRetries: this.maxRetries, sleep: this.sleep },
    );

    const message = data.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    let rawAction: unknown;
    const args = toolCall?.function?.arguments;
    if (args !== undefined) {
      try {
        rawAction = JSON.parse(args);
      } catch {
        throw new LlmError('Alibaba/Qwen: tool_call.arguments is not valid JSON');
      }
    }
    return {
      text: message?.content ?? null,
      action: rawAction,
      model: data.model ?? this.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
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