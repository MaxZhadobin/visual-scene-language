/**
 * Unit-тесты enrichWithVision (dev_8, T1.5.4): отбор кандидатов (t===null &&
 * !isIncludedInVsl — элементы, которые builder отбросит), extract → classify →
 * аннотация t + vf/vf_meta, кэш AC[3] (классификатор один раз на фрагмент),
 * best-effort ошибки. Реальный FragmentExtractor с фейковыми capture/crop
 * (паттерн fragmentExtractor.test.ts) + фейковый VisionClassifier — без сети.
 */

import { createHash } from 'node:crypto';
import type { Rect } from '../capture/domExtractor';
import type { VisualFragmentData } from '../llm/types';
import type { SegmentedElement } from '../segmentation/segmenter';
import { buildVslDocument, type BuildOptions } from '../builder/vslBuilder';
import { enrichWithVision } from './enrichWithVision';
import { expandRect, FragmentExtractor } from './fragmentExtractor';
import type { VisionClassification, VisionClassifier } from './types';

const NOW = '2026-01-01T00:00:00.000Z';
const RECT: Rect = { x: 10, y: 20, width: 100, height: 50 };

const OPTIONS: BuildOptions = {
  viewport: { width: 1280, height: 800 },
  url: 'https://example.test/',
};

/** Фейковый кроп: детерминированные «пиксели» по фактическому (расширенному) rect. */
function fakeCrop(data: string) {
  return async (
    _screenshot: string,
    rect: Rect,
  ): Promise<{ mediaType: string; data: string; size: [number, number] }> => ({
    mediaType: 'image/webp',
    data,
    size: [rect.width, rect.height],
  });
}

/** Экстрактор с фиксированным кропом; capture можно подменить (тест ошибки). */
function makeExtractor(cropData: string, capture?: () => Promise<string>): FragmentExtractor {
  return new FragmentExtractor({
    capture: capture ?? (async () => 'data:image/png;base64,SCREEN'),
    crop: fakeCrop(cropData),
    now: () => NOW,
  });
}

interface ClassifierCalls {
  images: VisualFragmentData[];
  hints: string[];
}

/** Фейковый классификатор: выдаёт результаты по очереди (последний — для остальных вызовов). */
function fakeClassifier(
  results: Array<VisionClassification | Error>,
  calls: ClassifierCalls,
): VisionClassifier {
  let index = 0;
  return {
    async classify(image, hint) {
      calls.images.push(image);
      calls.hints.push(hint ?? '');
      const result = results[Math.min(index, results.length - 1)]!;
      index += 1;
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** Синтетический элемент (паттерн vslBuilder.test.ts). */
const base = (overrides: Partial<SegmentedElement> = {}): SegmentedElement => ({
  tag: 'div',
  indexPath: [0],
  rect: { x: 0, y: 0, width: 100, height: 100 },
  attributes: {},
  t: null,
  txt: null,
  st: null,
  ch: [],
  ...overrides,
});

/** Ожидаемые vfId/hash для rect+данных (тот же конвейер, что в extract). */
function expectedFragment(rect: Rect, data: string): { vfId: string; hash: string } {
  const expanded = expandRect(rect);
  const hash = createHash('sha256')
    .update(`${expanded.x},${expanded.y},${expanded.width},${expanded.height}|${data}`)
    .digest('hex');
  return { vfId: `emb_${hash.slice(0, 12)}`, hash };
}

describe('enrichWithVision (T1.5.4): vision fallback для отбрасываемых элементов', () => {
  it('спасение: кандидат t=null аннотируется t + vf/vf_meta, store заполнен', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'chart', confidence: 0.9 }], calls);
    const canvas = base({ tag: 'canvas', indexPath: [1], rect: RECT });
    const elements = [base({ tag: 'button', t: 'button', txt: 'OK' }), canvas];

    const result = await enrichWithVision(elements, {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    const { vfId, hash } = expectedFragment(RECT, 'AAAA');
    expect(result.enrichedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(canvas.t).toBe('chart');
    expect(canvas.vf).toBe(vfId);
    expect(canvas.vf_meta).toEqual({
      type: 'chart',
      format: 'webp',
      size: [104, 54],
      hash,
      cached_at: NOW,
    });
    expect(result.fragments.get(vfId)).toEqual({ mediaType: 'image/webp', data: 'AAAA' });
    expect(calls.images).toEqual([{ mediaType: 'image/webp', data: 'AAAA' }]);
  });

  it('не-кандидаты не классифицируются: типизированные, score≥3, контейнеры с включёнными детьми', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'icon', confidence: 0.8 }], calls);
    const includedChild = base({ tag: 'button', t: 'button', indexPath: [0, 0] });
    const container = base({ ch: [includedChild] });
    const highScore = base({ attributes: { role: 'navigation' } });
    const elements = [base({ tag: 'a', t: 'link', txt: 'x' }), container, highScore];

    const result = await enrichWithVision(elements, {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    expect(calls.images).toHaveLength(0);
    expect(result.enrichedCount).toBe(0);
    expect(result.fragments.size).toBe(0);
  });

  it('кэш (AC[3]): два кандидата с одинаковым rect+пикселями → классификатор ОДИН раз, один vfId', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'icon', confidence: 0.8 }], calls);
    const a = base({ tag: 'canvas', indexPath: [0], rect: RECT });
    const b = base({ tag: 'canvas', indexPath: [1], rect: RECT });

    const result = await enrichWithVision([a, b], {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    expect(calls.images).toHaveLength(1);
    expect(result.enrichedCount).toBe(2);
    const { vfId } = expectedFragment(RECT, 'AAAA');
    expect(a.vf).toBe(vfId);
    expect(b.vf).toBe(vfId);
    expect(result.fragments.size).toBe(1);
  });

  it('нулевая геометрия → элемент пропущен без классификатора (не ошибка)', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'icon', confidence: 0.8 }], calls);
    const invisible = base({ rect: { x: 0, y: 0, width: 0, height: 0 } });

    const result = await enrichWithVision([invisible], {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    expect(calls.images).toHaveLength(0);
    expect(invisible.t).toBeNull();
    expect(invisible.vf).toBeUndefined();
    expect(result.enrichedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it('ошибка классификатора → элемент не аннотирован (best-effort), следующий спасён', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier(
      [new Error('vision API down'), { type: 'icon', confidence: 0.8 }],
      calls,
    );
    const first = base({ tag: 'canvas', indexPath: [0], rect: RECT });
    const second = base({
      tag: 'canvas',
      indexPath: [1],
      rect: { x: 200, y: 20, width: 100, height: 50 },
    });

    const result = await enrichWithVision([first, second], {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    expect(first.t).toBeNull();
    expect(first.vf).toBeUndefined();
    expect(second.t).toBe('icon');
    expect(result.enrichedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  it('ошибка capture → failedCount, элемент не аннотирован (extract не глушит ошибки)', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'icon', confidence: 0.8 }], calls);
    const extractor = makeExtractor('AAAA', async () => {
      throw new Error('captureVisibleTab failed');
    });
    const el = base({ tag: 'canvas', rect: RECT });

    const result = await enrichWithVision([el], { classifier, extractor });

    expect(calls.images).toHaveLength(0);
    expect(el.t).toBeNull();
    expect(result.enrichedCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  it('вложенные кандидаты: родитель и ребёнок оба спасены (pre-order)', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'custom_widget', confidence: 0.7 }], calls);
    const child = base({
      tag: 'canvas',
      indexPath: [0, 0],
      rect: { x: 0, y: 0, width: 50, height: 50 },
    });
    const parent = base({
      tag: 'div',
      indexPath: [0],
      rect: { x: 0, y: 0, width: 400, height: 200 },
      ch: [child],
    });

    const result = await enrichWithVision([parent], {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    expect(parent.t).toBe('custom_widget');
    expect(child.t).toBe('custom_widget');
    expect(result.enrichedCount).toBe(2);
    expect(calls.images).toHaveLength(2);
  });

  it('hint: тег элемента; текст добавляется, если есть', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'unknown', confidence: 0.5 }], calls);
    const withText = base({ tag: 'div', txt: 'Скачать', rect: RECT });
    const withoutText = base({
      tag: 'canvas',
      indexPath: [1],
      rect: { x: 200, y: 20, width: 100, height: 50 },
    });

    await enrichWithVision([withText, withoutText], {
      classifier,
      extractor: makeExtractor('AAAA'),
    });

    expect(calls.hints).toEqual(['tag=div; text: Скачать', 'tag=canvas']);
  });

  it('интеграция: после enrich buildVslDocument включает спасённый элемент (vf/vf_meta + visual_fragments)', async () => {
    const calls: ClassifierCalls = { images: [], hints: [] };
    const classifier = fakeClassifier([{ type: 'chart', confidence: 0.9 }], calls);
    const canvas = base({ tag: 'canvas', indexPath: [0], rect: RECT });
    const elements = [canvas];

    await enrichWithVision(elements, { classifier, extractor: makeExtractor('AAAA') });
    const doc = buildVslDocument(elements, OPTIONS);

    const { vfId, hash } = expectedFragment(RECT, 'AAAA');
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]!.t).toBe('chart');
    expect(doc.objects[0]!.vf).toBe(vfId);
    expect(doc.visual_fragments?.[vfId]).toEqual({
      type: 'chart',
      format: 'webp',
      size: [104, 54],
      hash,
      cached_at: NOW,
    });
  });
});