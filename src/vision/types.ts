/**
 * Vision-подсистема (T1.5.3/T1.5.4): порты и типы (§2.2.2).
 *
 * Порты (Dependency Inversion) — SDK не зависит от платформы:
 *  - ViewportCapture: скриншот текущего viewport (chrome.tabs.captureVisibleTab
 *    в extension background, Playwright screenshot в e2e; jsdom не рендерит —
 *    в unit-тестах инъекция фейка);
 *  - FragmentCropper: кроп скриншота по прямоугольнику → WebP base64
 *    (дефолтная реализация — Image + offscreen canvas в браузере;
 *    getContext('2d') в jsdom возвращает null — в unit-тестах инъекция фейка);
 *  - VisionClassifier: классификация визуального фрагмента — реализация M1.5 —
 *    LlmVisionClassifier через LLM vision API (решение пользователя 24.09.2026);
 *    CLIP-эмбеддинги — будущие реализации порта (контракт §2.2.2 Шаг 3).
 *
 * Кэш фрагментов — по hash(bounding_box + pixel_content) (§2.2.2 Шаг 4):
 * sync sha256 через createHash (node:crypto / nodeCryptoShim в браузере),
 * как в cacheStore — переиспользование готового механизма.
 */

import type { Rect } from '../capture/domExtractor';
import type { VisualFragmentData } from '../llm/types';
import type { VisualFragmentType } from '../types/vsl';

/** Результат классификации фрагмента vision-моделью (§2.2.2 Шаг 2). */
export interface VisionClassification {
  /** Тип фрагмента: image | icon | chart | custom_widget | unknown. */
  type: VisualFragmentType;
  /** Уверенность модели 0..1. */
  confidence: number;
  /** Опциональное описание, например «blue submit button with white text». */
  description?: string;
}

/**
 * Порт классификатора визуальных фрагментов (§2.2.2 Шаг 2).
 * Реализация M1.5 — LlmVisionClassifier (LLM vision API); unit-тесты — моки.
 */
export interface VisionClassifier {
  /**
   * Классифицирует изображение фрагмента.
   * @param image Данные изображения (mediaType + base64 без data:-префикса).
   * @param hint  Контекст элемента (тег/атрибуты) — подсказка модели.
   */
  classify(image: VisualFragmentData, hint?: string): Promise<VisionClassification>;
}

/**
 * Порт скриншота текущего viewport (§2.2.2 Шаг 1). Возвращает полный скриншот
 * как data-URL (например, 'data:image/png;base64,...').
 * Extension — chrome.tabs.captureVisibleTab; unit-тесты — инъекция фейка.
 */
export type ViewportCapture = () => Promise<string>;

/** Результат кропа: данные фрагмента + фактический размер (после клампинга). */
export interface CroppedFragment {
  /** MIME-тип фактически закодированных данных, например 'image/webp'. */
  mediaType: string;
  /** Base64-данные (без data:-префикса). */
  data: string;
  /** Фактический размер кропа в px [width, height] — после клампинга к границам скриншота. */
  size: [number, number];
}

/**
 * Кроп скриншота по прямоугольнику (§2.2.2 Шаг 1: +2px margin применяется
 * вызывающей стороной; здесь — вырезание области и кодирование WebP q~0.6).
 * Дефолтная реализация — Image + offscreen canvas (браузер).
 */
export type FragmentCropper = (screenshot: string, rect: Rect) => Promise<CroppedFragment>;