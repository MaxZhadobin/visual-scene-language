/**
 * Integration-тест LlmVisionClassifier (T1.5.3, 3-контурное тестирование —
 * решение 24.09.2026): РЕАЛЬНЫЕ вызовы OpenAI/Anthropic/Alibaba vision API.
 * Gated env-ключами: OPENAI_API_KEY / ANTHROPIC_API_KEY / QWEN_API_KEY; auto-skip
 * без ключей (условный describe — совместимо со всеми версиями jest). Ключи не
 * хардкодятся и не логируются (constraint). Ассерты — ФОРМА ответа (тип из
 * whitelist VisualFragmentType, confidence 0..1), не семантика тестовой картинки.
 */

import { AnthropicAdapter } from '../llm/anthropic';
import { OpenAIAdapter } from '../llm/openai';
import { LlmVisionClassifier } from './llmVisionClassifier';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const QWEN_KEY = process.env.QWEN_API_KEY;
const QWEN_BASE_URL = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = 'qwen3.7-plus';

/** Валидное изображение 20x20 px (PNG base64) — smoke-вход для vision API.
 * Alibaba требует минимум 10px по стороне (1x1 возвращает ошибку).
 */
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC';

const FRAGMENT_TYPES = ['image', 'icon', 'chart', 'custom_widget', 'unknown'] as const;

const dOpenAI = OPENAI_KEY === undefined ? describe.skip : describe;
const dAnthropic = ANTHROPIC_KEY === undefined ? describe.skip : describe;
const dQwen = QWEN_KEY === undefined ? describe.skip : describe;
dOpenAI('LlmVisionClassifier integration: OpenAI vision (gated OPENAI_API_KEY)', () => {
  it(
    'classify реального изображения через OpenAIAdapter → валидная классификация',
    async () => {
      const classifier = new LlmVisionClassifier(new OpenAIAdapter({ apiKey: OPENAI_KEY! }));
      const result = await classifier.classify(
        { mediaType: 'image/png', data: PIXEL_PNG },
        'tag=canvas',
      );
      expect(FRAGMENT_TYPES).toContain(result.type);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    },
    30000,
  );
});

dAnthropic('LlmVisionClassifier integration: Anthropic vision (gated ANTHROPIC_API_KEY)', () => {
  it(
    'classify реального изображения через AnthropicAdapter → валидная классификация',
    async () => {
      const classifier = new LlmVisionClassifier(new AnthropicAdapter({ apiKey: ANTHROPIC_KEY! }));
      const result = await classifier.classify(
        { mediaType: 'image/png', data: PIXEL_PNG },
        'tag=canvas',
      );
      expect(FRAGMENT_TYPES).toContain(result.type);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    },
    30000,
  );
});

dQwen('LlmVisionClassifier integration: Alibaba Qwen vision (gated QWEN_API_KEY)', () => {
  it(
    'classify реального изображения через OpenAIAdapter+Alibaba baseUrl → валидная классификация',
    async () => {
      const classifier = new LlmVisionClassifier(
        new OpenAIAdapter({
          apiKey: QWEN_KEY!,
          baseUrl: QWEN_BASE_URL,
          model: QWEN_MODEL,
        }),
      );
      const result = await classifier.classify(
        { mediaType: 'image/png', data: PIXEL_PNG },
        'tag=canvas',
      );
      expect(FRAGMENT_TYPES).toContain(result.type);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    },
    30000,
  );
});