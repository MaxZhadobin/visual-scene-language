/**
 * Unit-тесты FragmentExtractor (dev_8, T1.5.3): capture/crop — инъекции фейков
 * (jsdom не рендерит и не кодирует canvas — negative_knowledge note_1790213529352),
 * поэтому тестируются чистая логика margin/hash/кэша и детерминированный vfId.
 * Реальный рендеринг/WebP-кроп (defaultCrop) — только Playwright/Chromium.
 */
import { createHash } from 'node:crypto';
import type { Rect } from '../capture/domExtractor';
import { FragmentExtractor, expandRect } from './fragmentExtractor';

const RECT: Rect = { x: 10, y: 20, width: 100, height: 50 };
const NOW = '2026-01-01T00:00:00.000Z';

/** Фейковый кроп: детерминированные «пиксели» (data) по фактическому rect. */
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

/** Экстрактор с фиксированным кропом и счётчиком вызовов capture. */
function makeExtractor(cropData: string, calls: { count: number }): FragmentExtractor {
  return new FragmentExtractor({
    capture: async () => {
      calls.count += 1;
      return 'data:image/png;base64,SCREEN';
    },
    crop: fakeCrop(cropData),
    now: () => NOW,
  });
}

describe('expandRect', () => {
  it('расширяет rect на 2px с каждой стороны (§2.2.2: захват border)', () => {
    expect(expandRect(RECT)).toEqual({ x: 8, y: 18, width: 104, height: 54 });
  });
});

describe('FragmentExtractor', () => {
  it('первый extract: cache miss, vfId=emb_<hash12>, meta и data заполнены полностью', async () => {
    const calls = { count: 0 };
    const extractor = makeExtractor('AAAA', calls);
    const result = await extractor.extract(RECT);
    expect(result).not.toBeNull();
    const hash = createHash('sha256').update('8,18,104,54|AAAA').digest('hex');
    expect(result!.entry.vfId).toBe(`emb_${hash.slice(0, 12)}`);
    expect(result!.cached).toBe(false);
    expect(result!.entry.meta).toEqual({
      format: 'webp',
      size: [104, 54],
      hash,
      cached_at: NOW,
    });
    expect(result!.entry.data).toEqual({ mediaType: 'image/webp', data: 'AAAA' });
    expect(calls.count).toBe(1);
  });

  it('повторный extract того же rect: cache hit — та же запись (identity), capture вызывается снова (свежие пиксели для hash)', async () => {
    const calls = { count: 0 };
    const extractor = makeExtractor('AAAA', calls);
    const first = await extractor.extract(RECT);
    const second = await extractor.extract(RECT);
    expect(second!.cached).toBe(true);
    expect(second!.entry).toBe(first!.entry);
    expect(calls.count).toBe(2);
    expect(extractor.size).toBe(1);
  });

  it('изменение пикселей при том же rect → новый hash → cache miss, вторая запись в кэше', async () => {
    const box = { data: 'AAAA' };
    const calls = { count: 0 };
    const extractor = new FragmentExtractor({
      capture: async () => {
        calls.count += 1;
        return 'data:image/png;base64,SCREEN';
      },
      crop: async (_screenshot, rect) => ({
        mediaType: 'image/webp',
        data: box.data,
        size: [rect.width, rect.height],
      }),
      now: () => NOW,
    });
    const first = await extractor.extract(RECT);
    box.data = 'BBBB';
    const second = await extractor.extract(RECT);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.cached).toBe(false);
    expect(second!.entry.vfId).not.toBe(first!.entry.vfId);
    expect(extractor.size).toBe(2);
  });

  it('нулевая геометрия элемента → null без вызова capture (margin не воскресает пустой элемент)', async () => {
    const calls = { count: 0 };
    const extractor = makeExtractor('AAAA', calls);
    expect(await extractor.extract({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
    expect(calls.count).toBe(0);
  });

  it('кроп нулевого размера (область полностью вне скриншота после клампинга) → null', async () => {
    const extractor = new FragmentExtractor({
      capture: async () => 'data:image/png;base64,SCREEN',
      crop: async () => ({ mediaType: 'image/webp', data: 'AAAA', size: [0, 0] }),
      now: () => NOW,
    });
    expect(await extractor.extract(RECT)).toBeNull();
  });

  it('формат meta берётся из фактического mediaType кропа (браузер без WebP → png)', async () => {
    const extractor = new FragmentExtractor({
      capture: async () => 'data:image/png;base64,SCREEN',
      crop: async (_screenshot, rect) => ({
        mediaType: 'image/png',
        data: 'CCCC',
        size: [rect.width, rect.height],
      }),
      now: () => NOW,
    });
    const result = await extractor.extract(RECT);
    expect(result!.entry.meta.format).toBe('png');
    expect(result!.entry.data.mediaType).toBe('image/png');
  });
});