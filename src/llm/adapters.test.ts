/**
 * Тесты адаптеров (T1.3.2/T1.3.3/T1.3.5): форма запросов, парсинг ответов,
 * image-блоки (AC[7]), retry (AC[8]), decide() e2e на VslDocument и VslDiff
 * с валидацией target_id — всё на mock-транспорте, без сети.
 */

import type { VslModifiedObject, VslDiff } from '../diff/diffEngine';
import type { VslDocument, VslObject } from '../types/vsl';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';
import { AlibabaAdapter } from './alibaba';
import { VALID_ACTIONS } from './actions';
import { LlmError, LlmValidationError } from './types';
import type { LlmTransport, Sleep, VisualFragmentData } from './types';

const noSleep: Sleep = async () => undefined;

const fakeResponse = (body: unknown, status = 200, statusText = 'OK'): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  }) as unknown as Response;

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
          id: 'button_0_1',
          t: 'button',
          p: [0.5, 0.3],
          s: [120, 40],
          txt: 'Войти',
          act: ['click'],
        },
      ],
    },
  ],
};

const DOC_WITH_VF: VslDocument = {
  ...DOC,
  objects: [{ ...DOC.objects[0]!, vf: 'emb_1' } as VslObject],
};

const DIFF: VslDiff = {
  diff_version: 2,
  base_version: 1,
  timestamp: '2026-09-22T09:01:00.000Z',
  changes: {
    added: [],
    modified: [{ id: 'button_0_1', txt: 'Скачать' } as VslModifiedObject],
    removed: [],
    unchanged_refs: ['input_0_0'],
  },
};

const openAiOk = (action: Record<string, unknown>): Response =>
  fakeResponse({
    model: 'gpt-4o',
    choices: [
      {
        message: {
          content: 'Выбираю действие',
          tool_calls: [
            { function: { name: 'execute_action', arguments: JSON.stringify(action) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });

const anthropicOk = (action: Record<string, unknown>): Response =>
  fakeResponse({
    model: 'claude-sonnet-4-20250514',
    content: [
      { type: 'text', text: 'Выбираю действие' },
      { type: 'tool_use', name: 'execute_action', input: action },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
  });

const alibabaOk = (action: Record<string, unknown>): Response =>
  fakeResponse({
    model: 'qwen3.8-flash',
    choices: [
      {
        message: {
          content: 'Выбираю действие',
          tool_calls: [
            { function: { name: 'execute_action', arguments: JSON.stringify(action) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 80, completion_tokens: 15 },
  });

describe('OpenAIAdapter', () => {
  const makeAdapter = (transport: LlmTransport): OpenAIAdapter =>
    new OpenAIAdapter({ apiKey: 'sk-test', transport, sleep: noSleep });

  it('конструктор: пустой apiKey → LlmError', () => {
    expect(() => new OpenAIAdapter({ apiKey: '' })).toThrow(LlmError);
  });

  it('sendPrompt: URL, Bearer, форма тела (model/messages/tools/tool_choice, enum из VALID_ACTIONS)', async () => {
    let url = '';
    let init: RequestInit = {};
    const transport: LlmTransport = async (u, i) => {
      url = u;
      init = i;
      return openAiOk({ action: 'click', target_id: 'button_0_1' });
    };
    const response = await makeAdapter(transport).sendPrompt(DOC, 'Войти');

    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{
        type: string;
        function: { name: string; parameters: { properties: { action: { enum: string[] } } } };
      }>;
      tool_choice: { type: string; function: { name: string } };
    };
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]!.role).toBe('user');
    expect(body.tools[0]!.function.name).toBe('execute_action');
    expect(body.tools[0]!.function.parameters.properties.action.enum).toEqual([
      ...VALID_ACTIONS,
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'execute_action' } });

    expect(response.text).toBe('Выбираю действие');
    expect(response.action).toEqual({ action: 'click', target_id: 'button_0_1' });
    expect(response.model).toBe('gpt-4o');
    expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('sendPrompt: кастомные model и baseUrl (с хвостовым слэшем)', async () => {
    let url = '';
    let body: { model: string } | undefined;
    const transport: LlmTransport = async (u, i) => {
      url = u;
      body = JSON.parse(String(i.body));
      return openAiOk({ action: 'scroll' });
    };
    const adapter = new OpenAIAdapter({
      apiKey: 'k',
      model: 'gpt-4o-mini',
      baseUrl: 'https://proxy.test/api/v1/',
      transport,
      sleep: noSleep,
    });
    await adapter.sendPrompt(DOC, 'x');
    expect(url).toBe('https://proxy.test/api/v1/chat/completions');
    expect(body!.model).toBe('gpt-4o-mini');
  });

  it('image-блоки (AC[7]): vf со стором → image_url data-URL после текста', async () => {
    let content: Array<{ type: string; image_url?: { url: string } }> = [];
    const transport: LlmTransport = async (_u, i) => {
      content = JSON.parse(String(i.body)).messages[1].content;
      return openAiOk({ action: 'scroll' });
    };
    const store = new Map<string, VisualFragmentData>([
      ['emb_1', { mediaType: 'image/webp', data: 'AAAA' }],
    ]);
    await makeAdapter(transport).sendPrompt(DOC_WITH_VF, 'x', { visualFragments: store });
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe('text');
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/webp;base64,AAAA' },
    });
  });

  it('без стора image-блоков нет — только текст (§4.4 lazy loading)', async () => {
    let content: unknown[] = [];
    const transport: LlmTransport = async (_u, i) => {
      content = JSON.parse(String(i.body)).messages[1].content;
      return openAiOk({ action: 'scroll' });
    };
    await makeAdapter(transport).sendPrompt(DOC_WITH_VF, 'x');
    expect(content).toHaveLength(1);
  });

  it('decide(): click по документу — валидированное действие (T1.3.5)', async () => {
    const transport: LlmTransport = async () =>
      openAiOk({ action: 'click', target_id: 'button_0_1', value: null, reasoning: 'кнопка входа' });
    await expect(
      makeAdapter(transport).decide({ vslJson: DOC, goal: 'Войти' }),
    ).resolves.toEqual({
      action: 'click',
      target_id: 'button_0_1',
      value: null,
      reasoning: 'кнопка входа',
    });
  });

  it('decide() на VslDiff (§11.2 diff-first): unchanged_refs — валидная цель', async () => {
    const transport: LlmTransport = async () =>
      openAiOk({ action: 'type', target_id: 'input_0_0', value: 'a@b.c' });
    await expect(
      makeAdapter(transport).decide({ vslJson: DIFF, goal: 'Заполнить email' }),
    ).resolves.toEqual({ action: 'type', target_id: 'input_0_0', value: 'a@b.c' });
  });

  it('decide(): scroll без target_id валиден', async () => {
    const transport: LlmTransport = async () => openAiOk({ action: 'scroll', value: 'down' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).resolves.toEqual({
      action: 'scroll',
      value: 'down',
    });
  });

  it('decide(): невалидный target_id → LlmValidationError (T1.3.5)', async () => {
    const transport: LlmTransport = async () =>
      openAiOk({ action: 'click', target_id: 'invented_1' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('decide(): неизвестное действие → LlmValidationError', async () => {
    const transport: LlmTransport = async () => openAiOk({ action: 'fly' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('decide(): без tool call (только текст) → LlmValidationError', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({ model: 'gpt-4o', choices: [{ message: { content: 'не могу' } }] });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('retry (AC[8]): 500, 500 → успех на 3-й попытке', async () => {
    let calls = 0;
    const transport: LlmTransport = async () => {
      calls += 1;
      if (calls < 3) return fakeResponse({}, 500, 'Internal');
      return openAiOk({ action: 'click', target_id: 'button_0_1' });
    };
    const action = await makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' });
    expect(calls).toBe(3);
    expect(action.action).toBe('click');
  });

  it('arguments не JSON → LlmError', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({
        model: 'gpt-4o',
        choices: [
          { message: { tool_calls: [{ function: { name: 'execute_action', arguments: '{oops' } }] } },
        ],
      });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      'is not valid JSON',
    );
  });

  it('usage/content отсутствуют → text null, usage с undefined-полями', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({ model: 'gpt-4o', choices: [{ message: { content: null } }] });
    const response = await makeAdapter(transport).sendPrompt(DOC, 'g');
    expect(response.text).toBeNull();
    expect(response.usage).toEqual({ inputTokens: undefined, outputTokens: undefined });
  });
});

describe('AnthropicAdapter', () => {
  const makeAdapter = (transport: LlmTransport): AnthropicAdapter =>
    new AnthropicAdapter({ apiKey: 'sk-ant-test', transport, sleep: noSleep });

  it('конструктор: пустой apiKey → LlmError', () => {
    expect(() => new AnthropicAdapter({ apiKey: '' })).toThrow(LlmError);
  });

  it('sendPrompt: URL, x-api-key/anthropic-version, тело (max_tokens/system/tools.input_schema/tool_choice)', async () => {
    let url = '';
    let init: RequestInit = {};
    const transport: LlmTransport = async (u, i) => {
      url = u;
      init = i;
      return anthropicOk({ action: 'type', target_id: 'input_0_0', value: 'a@b.c' });
    };
    const response = await makeAdapter(transport).sendPrompt(DOC, 'Заполнить email');

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string }>;
      tools: Array<{
        name: string;
        input_schema: { properties: { action: { enum: string[] } } };
      }>;
      tool_choice: { type: string; name: string };
    };
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.max_tokens).toBe(1024);
    expect(typeof body.system).toBe('string');
    expect(body.messages[0]!.role).toBe('user');
    expect(body.tools[0]!.name).toBe('execute_action');
    expect(body.tools[0]!.input_schema.properties.action.enum).toEqual([...VALID_ACTIONS]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'execute_action' });

    expect(response.text).toBe('Выбираю действие');
    expect(response.action).toEqual({ action: 'type', target_id: 'input_0_0', value: 'a@b.c' });
    expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('image-блоки (AC[7]): {type:image, source:{type:base64, media_type, data}}', async () => {
    let content: Array<Record<string, unknown>> = [];
    const transport: LlmTransport = async (_u, i) => {
      content = JSON.parse(String(i.body)).messages[0].content;
      return anthropicOk({ action: 'scroll' });
    };
    const store = new Map<string, VisualFragmentData>([
      ['emb_1', { mediaType: 'image/png', data: 'BBBB' }],
    ]);
    await makeAdapter(transport).sendPrompt(DOC_WITH_VF, 'x', { visualFragments: store });
    expect(content).toHaveLength(2);
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'BBBB' },
    });
  });

  it('decide(): click по документу — валидированное действие (T1.3.5)', async () => {
    const transport: LlmTransport = async () =>
      anthropicOk({ action: 'click', target_id: 'button_0_1', reasoning: 'ok' });
    await expect(
      makeAdapter(transport).decide({ vslJson: DOC, goal: 'Войти' }),
    ).resolves.toEqual({ action: 'click', target_id: 'button_0_1', reasoning: 'ok' });
  });

  it('decide(): scroll без цели; дифф (§11.2) с modified — валидный вход', async () => {
    const transport: LlmTransport = async () => anthropicOk({ action: 'scroll', value: 'down' });
    await expect(
      makeAdapter(transport).decide({ vslJson: DIFF, goal: 'g' }),
    ).resolves.toEqual({ action: 'scroll', value: 'down' });
  });

  it('decide(): невалидный target_id → LlmValidationError', async () => {
    const transport: LlmTransport = async () =>
      anthropicOk({ action: 'click', target_id: 'gone_9' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('несколько text-блоков склеиваются; tool_use чужого имени игнорируется', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'text', text: 'часть 1' },
          { type: 'text', text: 'часть 2' },
          { type: 'tool_use', name: 'other_tool', input: { action: 'click' } },
        ],
      });
    const response = await makeAdapter(transport).sendPrompt(DOC, 'g');
    expect(response.text).toBe('часть 1\nчасть 2');
    expect(response.action).toBeUndefined();
  });

  it('retry (AC[8]): 429 → успех на 2-й попытке', async () => {
    let calls = 0;
    const transport: LlmTransport = async () => {
      calls += 1;
      if (calls === 1) return fakeResponse({}, 429, 'Too Many Requests');
      return anthropicOk({ action: 'click', target_id: 'button_0_1' });
    };
    const action = await makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' });
    expect(calls).toBe(2);
    expect(action.action).toBe('click');
  });

  it('usage/content отсутствуют → text null, usage с undefined-полями', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({ model: 'claude-sonnet-4-20250514', content: [] });
    const response = await makeAdapter(transport).sendPrompt(DOC, 'g');
    expect(response.text).toBeNull();
    expect(response.usage).toEqual({ inputTokens: undefined, outputTokens: undefined });
  });
});

describe('AlibabaAdapter', () => {
  const makeAdapter = (transport: LlmTransport): AlibabaAdapter =>
    new AlibabaAdapter({ apiKey: 'sk-qwen-test', transport, sleep: noSleep });

  it('конструктор: пустой apiKey → LlmError', () => {
    expect(() => new AlibabaAdapter({ apiKey: '' })).toThrow(LlmError);
  });

  it('sendPrompt: URL (DashScope compatible-mode), Bearer, форма тела (model/messages/tools/tool_choice)', async () => {
    let url = '';
    let init: RequestInit = {};
    const transport: LlmTransport = async (u, i) => {
      url = u;
      init = i;
      return alibabaOk({ action: 'click', target_id: 'button_0_1' });
    };
    const response = await makeAdapter(transport).sendPrompt(DOC, 'Войти');

    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-qwen-test');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{
        type: string;
        function: { name: string; parameters: { properties: { action: { enum: string[] } } } };
      }>;
      tool_choice: { type: string; function: { name: string } };
    };
    expect(body.model).toBe('qwen3.8-flash');
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]!.role).toBe('user');
    expect(body.tools[0]!.function.name).toBe('execute_action');
    expect(body.tools[0]!.function.parameters.properties.action.enum).toEqual([
      ...VALID_ACTIONS,
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'execute_action' } });

    expect(response.text).toBe('Выбираю действие');
    expect(response.action).toEqual({ action: 'click', target_id: 'button_0_1' });
    expect(response.model).toBe('qwen3.8-flash');
    expect(response.usage).toEqual({ inputTokens: 80, outputTokens: 15 });
  });

  it('sendPrompt: кастомные model и baseUrl (с хвостовым слэшем)', async () => {
    let url = '';
    let body: { model: string } | undefined;
    const transport: LlmTransport = async (u, i) => {
      url = u;
      body = JSON.parse(String(i.body));
      return alibabaOk({ action: 'scroll' });
    };
    const adapter = new AlibabaAdapter({
      apiKey: 'k',
      model: 'qwen-max',
      baseUrl: 'https://proxy.test/api/v1/',
      transport,
      sleep: noSleep,
    });
    await adapter.sendPrompt(DOC, 'x');
    expect(url).toBe('https://proxy.test/api/v1/chat/completions');
    expect(body!.model).toBe('qwen-max');
  });

  it('image-блоки (AC[7]): vf со стором → image_url data-URL после текста (OpenAI-compatible формат)', async () => {
    let content: Array<{ type: string; image_url?: { url: string } }> = [];
    const transport: LlmTransport = async (_u, i) => {
      content = JSON.parse(String(i.body)).messages[1].content;
      return alibabaOk({ action: 'scroll' });
    };
    const store = new Map<string, VisualFragmentData>([
      ['emb_1', { mediaType: 'image/webp', data: 'CCCC' }],
    ]);
    await makeAdapter(transport).sendPrompt(DOC_WITH_VF, 'x', { visualFragments: store });
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe('text');
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/webp;base64,CCCC' },
    });
  });

  it('без стора image-блоков нет — только текст (§4.4 lazy loading)', async () => {
    let content: unknown[] = [];
    const transport: LlmTransport = async (_u, i) => {
      content = JSON.parse(String(i.body)).messages[1].content;
      return alibabaOk({ action: 'scroll' });
    };
    await makeAdapter(transport).sendPrompt(DOC_WITH_VF, 'x');
    expect(content).toHaveLength(1);
  });

  it('decide(): click по документу — валидированное действие (T1.3.5)', async () => {
    const transport: LlmTransport = async () =>
      alibabaOk({ action: 'click', target_id: 'button_0_1', value: null, reasoning: 'кнопка входа' });
    await expect(
      makeAdapter(transport).decide({ vslJson: DOC, goal: 'Войти' }),
    ).resolves.toEqual({
      action: 'click',
      target_id: 'button_0_1',
      value: null,
      reasoning: 'кнопка входа',
    });
  });

  it('decide() на VslDiff (§11.2 diff-first): unchanged_refs — валидная цель', async () => {
    const transport: LlmTransport = async () =>
      alibabaOk({ action: 'type', target_id: 'input_0_0', value: 'a@b.c' });
    await expect(
      makeAdapter(transport).decide({ vslJson: DIFF, goal: 'Заполнить email' }),
    ).resolves.toEqual({ action: 'type', target_id: 'input_0_0', value: 'a@b.c' });
  });

  it('decide(): scroll без target_id валиден', async () => {
    const transport: LlmTransport = async () => alibabaOk({ action: 'scroll', value: 'down' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).resolves.toEqual({
      action: 'scroll',
      value: 'down',
    });
  });

  it('decide(): невалидный target_id → LlmValidationError (T1.3.5)', async () => {
    const transport: LlmTransport = async () =>
      alibabaOk({ action: 'click', target_id: 'invented_1' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('decide(): неизвестное действие → LlmValidationError', async () => {
    const transport: LlmTransport = async () => alibabaOk({ action: 'fly' });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('decide(): без tool call (только текст) → LlmValidationError', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({ model: 'qwen3.8-flash', choices: [{ message: { content: 'не могу' } }] });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      LlmValidationError,
    );
  });

  it('retry (AC[8]): 500 → успех на 2-й попытке', async () => {
    let calls = 0;
    const transport: LlmTransport = async () => {
      calls += 1;
      if (calls < 2) return fakeResponse({}, 500, 'Internal');
      return alibabaOk({ action: 'click', target_id: 'button_0_1' });
    };
    const action = await makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' });
    expect(calls).toBe(2);
    expect(action.action).toBe('click');
  });

  it('arguments не JSON → LlmError', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({
        model: 'qwen3.8-flash',
        choices: [
          { message: { tool_calls: [{ function: { name: 'execute_action', arguments: '{oops' } }] } },
        ],
      });
    await expect(makeAdapter(transport).decide({ vslJson: DOC, goal: 'g' })).rejects.toThrow(
      'is not valid JSON',
    );
  });

  it('usage/content отсутствуют → text null, usage с undefined-полями', async () => {
    const transport: LlmTransport = async () =>
      fakeResponse({ model: 'qwen3.8-flash', choices: [{ message: { content: null } }] });
    const response = await makeAdapter(transport).sendPrompt(DOC, 'g');
    expect(response.text).toBeNull();
    expect(response.usage).toEqual({ inputTokens: undefined, outputTokens: undefined });
  });
});

describe('sendRaw (T1.5.4, вариант C): произвольный tool — база LlmVisionClassifier', () => {
  const CLASSIFY_TOOL = {
    name: 'classify_fragment',
    description: 'Classify the visual fragment.',
    schema: {
      type: 'object',
      properties: { type: { type: 'string' }, confidence: { type: 'number' } },
      required: ['type', 'confidence'],
    },
  };

  it('OpenAI: кастомный tool → tools[0].function.name/tool_choice; image-часть → image_url data-URL', async () => {
    let init: RequestInit = {};
    const transport: LlmTransport = async (_u, i) => {
      init = i;
      return fakeResponse({
        model: 'gpt-4o',
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'classify_fragment',
                    arguments: JSON.stringify({ type: 'chart', confidence: 0.9 }),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const response = await new OpenAIAdapter({ apiKey: 'sk-test', transport, sleep: noSleep }).sendRaw(
      'Classify fragments.',
      [
        { type: 'text', text: 'What is this?' },
        { type: 'image', mediaType: 'image/webp', data: 'AAAA' },
      ],
      CLASSIFY_TOOL,
    );
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ type: string; function: { name: string; parameters: unknown } }>;
      tool_choice: { type: string; function: { name: string } };
    };
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]!.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/webp;base64,AAAA' } },
    ]);
    expect(body.tools[0]!.function.name).toBe('classify_fragment');
    expect(body.tools[0]!.function.parameters).toEqual(CLASSIFY_TOOL.schema);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'classify_fragment' } });
    expect(response.action).toEqual({ type: 'chart', confidence: 0.9 });
  });

  it('Anthropic: кастомный tool → tools[0].name/input_schema; tool_use с этим именем парсится (параметризация фильтра)', async () => {
    let init: RequestInit = {};
    const transport: LlmTransport = async (_u, i) => {
      init = i;
      return fakeResponse({
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'tool_use', name: 'classify_fragment', input: { type: 'icon', confidence: 0.8 } },
        ],
      });
    };
    const response = await new AnthropicAdapter({
      apiKey: 'sk-ant-test',
      transport,
      sleep: noSleep,
    }).sendRaw(
      'Classify fragments.',
      [{ type: 'image', mediaType: 'image/png', data: 'BBBB' }],
      CLASSIFY_TOOL,
    );
    const body = JSON.parse(String(init.body)) as {
      system: string;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ name: string; input_schema: unknown }>;
      tool_choice: { type: string; name: string };
    };
    expect(body.system).toBe('Classify fragments.');
    expect(body.messages[0]!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
    ]);
    expect(body.tools[0]!.name).toBe('classify_fragment');
    expect(body.tools[0]!.input_schema).toEqual(CLASSIFY_TOOL.schema);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'classify_fragment' });
    expect(response.action).toEqual({ type: 'icon', confidence: 0.8 });
  });

  it('Alibaba: кастомный tool → tools[0].function.name/tool_choice; image-часть → image_url data-URL (OpenAI-compatible)', async () => {
    let init: RequestInit = {};
    const transport: LlmTransport = async (_u, i) => {
      init = i;
      return fakeResponse({
        model: 'qwen3.8-flash',
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'classify_fragment',
                    arguments: JSON.stringify({ type: 'chart', confidence: 0.85 }),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const response = await new AlibabaAdapter({ apiKey: 'sk-qwen-test', transport, sleep: noSleep }).sendRaw(
      'Classify fragments.',
      [
        { type: 'text', text: 'What is this?' },
        { type: 'image', mediaType: 'image/webp', data: 'DDDD' },
      ],
      CLASSIFY_TOOL,
    );
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ type: string; function: { name: string; parameters: unknown } }>;
      tool_choice: { type: string; function: { name: string } };
    };
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]!.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/webp;base64,DDDD' } },
    ]);
    expect(body.tools[0]!.function.name).toBe('classify_fragment');
    expect(body.tools[0]!.function.parameters).toEqual(CLASSIFY_TOOL.schema);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'classify_fragment' } });
    expect(response.action).toEqual({ type: 'chart', confidence: 0.85 });
  });
});