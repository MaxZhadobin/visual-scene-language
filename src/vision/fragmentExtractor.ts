/**
 * FragmentExtractor (T1.5.3): извлечение визуальных фрагментов по bounding box.
 *
 * Конвейер §2.2.2 Шаг 1 + Шаг 4:
 *  1. Расширить rect на 2px с каждой стороны (захват border) — expandRect;
 *  2. capture() — полный скриншот viewport (порт, chrome.tabs.captureVisibleTab);
 *  3. crop(screenshot, rect) — вырезание области → WebP base64 (порт/дефолт);
 *  4. hash = sha256('x,y,w,h|data') — hash(bounding_box + pixel_content);
 *  5. Кэш: hit → та же запись (vfId/cached_at исходные, cached=true —
 *     классификатор не вызывается повторно, AC[3]); miss → новая запись.
 *
 * vfId детерминированный: 'emb_' + первые 12 hex-символов hash — одинаковые
 * фрагменты (позиция+пиксели) получают один vfId (стабильность в diff-режиме).
 *
 * Инъекции (Dependency Inversion): capture обязателен; crop опционален
 * (дефолт — Image + offscreen canvas браузера; в jsdom getContext('2d')
 * возвращает null → в unit-тестах инъекция фейка); now опционален
 * (детерминизм cached_at в тестах). createHash — прямой импорт node:crypto
 * как в cacheStore (esbuild alias → nodeCryptoShim в extension-сборке).
 */

import { createHash } from 'node:crypto';
import type { Rect } from '../capture/domExtractor';
import type { VisualFragmentData } from '../llm/types';
import type {
  FragmentCropper,
  ViewportCapture,
  VisionClassification,
} from './types';

/** Отступ вокруг bounding box, чтобы захватить border (§2.2.2 Шаг 1). */
const MARGIN_PX = 2;

/** Длина hex-префикса hash в vfId (пример контракта: «emb_abc123»). */
const VF_ID_HASH_LENGTH = 12;

/** Метаданные фрагмента в кэше (заполняются полностью при extract). */
export interface FragmentMeta {
  /** Формат закодированных данных без префикса 'image/' (например, 'webp'). */
  format: string;
  /** Фактический размер кропа в px [width, height] (после клампинга). */
  size: [number, number];
  /** sha256(expanded_rect + '|' + base64-данные) — ключ кэша (§2.2.2 Шаг 4). */
  hash: string;
  /** ISO 8601 — время первого кэширования (сохраняется при cache hit). */
  cached_at: string;
}

/** Запись кэша фрагментов: данные + метаданные + классификация (после enrich). */
export interface FragmentCacheEntry {
  vfId: string;
  meta: FragmentMeta;
  data: VisualFragmentData;
  /** Классификация — дозаполняется enrichWithVision после classify. */
  classification?: VisionClassification;
}

/** Результат extract: запись кэша + признак «уже была в кэше». */
export interface FragmentExtraction {
  entry: FragmentCacheEntry;
  /** true — фрагмент уже был в кэше: классификатор вызывать не нужно (AC[3]). */
  cached: boolean;
}

/** Опции конструктора FragmentExtractor. */
export interface FragmentExtractorOptions {
  /** Порт скриншота viewport (data-URL), например chrome.tabs.captureVisibleTab. */
  capture: ViewportCapture;
  /** Кроп скриншота; дефолт — Image + offscreen canvas (браузер). */
  crop?: FragmentCropper;
  /** Часы для cached_at (инъекция для детерминированных тестов). */
  now?: () => string;
}

/**
 * Расширяет rect на MARGIN_PX с каждой стороны (§2.2.2: «отступить 2px,
 * чтобы захватить border»). Чистая функция.
 */
export function expandRect(rect: Rect): Rect {
  return {
    x: rect.x - MARGIN_PX,
    y: rect.y - MARGIN_PX,
    width: rect.width + MARGIN_PX * 2,
    height: rect.height + MARGIN_PX * 2,
  };
}

/**
 * Дефолтный кроп: Image + offscreen canvas (браузер). Загружает data-URL
 * скриншота, клампит rect к границам изображения, вырезает область и
 * кодирует в WebP (q 0.6). MIME берётся из фактического data-URL — браузер
 * без поддержки WebP-кодирования вернёт PNG, и это честно попадёт в meta.format.
 */
const defaultCrop: FragmentCropper = async (screenshot, rect) => {
  const image = new Image();
  image.src = screenshot;
  await image.decode();
  const x = Math.max(0, Math.min(rect.x, image.naturalWidth));
  const y = Math.max(0, Math.min(rect.y, image.naturalHeight));
  const width = Math.max(0, Math.min(rect.width, image.naturalWidth - x));
  const height = Math.max(0, Math.min(rect.height, image.naturalHeight - y));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('FragmentExtractor: canvas 2d context is unavailable');
  }
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/webp', 0.6);
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('FragmentExtractor: canvas.toDataURL returned unexpected value');
  }
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(';'));
  return { mediaType, data: dataUrl.slice(commaIndex + 1), size: [width, height] };
};

/**
 * Извлекатель визуальных фрагментов (T1.5.3). Stateful: держит кэш
 * hash → запись (§2.2.2 Шаг 4). Экземпляр живёт столько же, сколько сессия
 * снапшотов (кэш переживает повторные snapshot() той же страницы).
 */
export class FragmentExtractor {
  private readonly capture: ViewportCapture;
  private readonly crop: FragmentCropper;
  private readonly now: () => string;
  private readonly cache = new Map<string, FragmentCacheEntry>();

  constructor(options: FragmentExtractorOptions) {
    this.capture = options.capture;
    this.crop = options.crop ?? defaultCrop;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Число записей в кэше (для тестов и диагностики). */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Извлекает визуальный фрагмент по прямоугольнику: capture → crop(+2px
   * margin) → hash → кэш. Возвращает null для пустой геометрии (нулевые
   * размеры или кроп полностью вне скриншота). Ошибки capture/crop не
   * глушатся — их обрабатывает enrichWithVision (vision — best-effort).
   */
  async extract(rect: Rect): Promise<FragmentExtraction | null> {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const expanded = expandRect(rect);

    const screenshot = await this.capture();
    const cropped = await this.crop(screenshot, expanded);
    if (cropped.size[0] <= 0 || cropped.size[1] <= 0) return null;

    const hash = createHash('sha256')
      .update(`${expanded.x},${expanded.y},${expanded.width},${expanded.height}|${cropped.data}`)
      .digest('hex');

    const existing = this.cache.get(hash);
    if (existing !== undefined) return { entry: existing, cached: true };

    const entry: FragmentCacheEntry = {
      vfId: `emb_${hash.slice(0, VF_ID_HASH_LENGTH)}`,
      meta: {
        format: cropped.mediaType.replace('image/', ''),
        size: cropped.size,
        hash,
        cached_at: this.now(),
      },
      data: { mediaType: cropped.mediaType, data: cropped.data },
    };
    this.cache.set(hash, entry);
    return { entry, cached: false };
  }
}