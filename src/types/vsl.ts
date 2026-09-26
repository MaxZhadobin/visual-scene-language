/**
 * Типы VSL JSON (DESIGN_SYSTEM.md §4, ARCHITECTURE.md §2.3).
 */

/**
 * Семантический тип объекта VSL (поле `t`): L1-теги + L2-роли (T1.1.3/T1.1.4),
 * L3-CSS (T1.5.1), L4-структурные (T1.5.2), L5-vision (T1.5.4).
 */
export type VslType =
  | 'button'
  | 'input'
  | 'file_input'
  | 'link'
  | 'nav'
  | 'header'
  | 'main'
  | 'container'
  | 'image'
  | 'select'
  | 'textarea'
  | 'modal'
  | 'tab'
  // Level 3 — CSS-анализ (§2.2.1):
  | 'heading'
  | 'footer'
  | 'scrollable_container'
  // Level 4 — структурный анализ (§2.2.1):
  | 'toolbar'
  | 'list'
  | 'grid'
  | 'form_field'
  | 'tab_bar'
  | 'layout'
  // Level 5 — vision fallback (§2.2.2):
  | 'icon'
  | 'chart'
  | 'custom_widget'
  | 'unknown';

/** Состояние объекта VSL (поле `st`) — из ARIA-атрибутов (T1.1.4). */
export type VslState = 'checked' | 'expanded' | 'disabled';

/** Тип визуального фрагмента — выход классификации vision (§2.2.2 Шаг 2). */
export type VisualFragmentType = 'image' | 'icon' | 'chart' | 'custom_widget' | 'unknown';

/** Метаданные visual fragment (DESIGN_SYSTEM.md §4.4). */
export interface VslFragmentMeta {
  type?: string;
  format?: string;
  size?: [number, number];
  hash?: string;
  cached_at?: string;
}

/**
 * Визуальные стили объекта VSL (DESIGN_SYSTEM.md §4.3).
 * Optional: только для визуально значимых элементов.
 * Все значения — computed styles в момент snapshot.
 */
export interface VslStyle {
  /** Background color (computed). */
  bg?: string;
  /** Text/foreground color (computed). */
  fg?: string;
  /** Border shorthand (computed). */
  border?: string;
  /** Border radius (computed). */
  radius?: string;
  /** Box shadow (computed). */
  shadow?: string;
  /** Font properties. */
  font?: {
    family?: string;
    size?: string;
    weight?: string;
  };
}

/**
 * Запись реестра visual_fragments документа (§2.2.2, ARCHITECTURE.md:L265-284).
 * ТОЛЬКО метаданные: base64-данные изображений живут в VisualFragmentStore
 * (src/llm/types.ts, DEC-015) и подаются по запросу (lazy loading §4.4) —
 * документ остаётся в бюджете 10-100 KB (ARCHITECTURE.md:L16-18).
 */
export interface VisualFragment {
  /** Тип фрагмента (§2.2.2 Шаг 2). */
  type: VisualFragmentType;
  /** Формат закодированных данных (например, 'webp'). */
  format: string;
  /** Размер [ширина, высота] в px. */
  size: [number, number];
  /** Хэш кэша hash(bounding_box + pixel_content) — ключ инвалидации (§5.2). */
  hash?: string;
  /** ISO 8601 — время кэширования. */
  cached_at?: string;
  /** Эмбеддинг (512-dim CLIP) — контракт §2.2.2; в M1.5 не заполняется. */
  embedding?: number[];
}

/** Версия формата VSL (DESIGN_SYSTEM.md §4.1). */
export const VSL_VERSION = '1.0.0' as const;

export interface VslViewport {
  width: number;
  height: number;
  unit: 'px';
}

export interface VslCanvas {
  viewport: VslViewport;
  background: string;
  scale: number;
  orientation: 'landscape' | 'portrait';
  /** ISO 8601; для детерминизма тестов фиксируется через BuildOptions. */
  timestamp: string;
  url?: string;
  title?: string;
}

export interface VslObject {
  /** Детерминированный ID из DOM-пути (note_1789916091535, база M1.2 diff). */
  id: string;
  t: VslType;
  /** Роль (атрибут role), уточняет семантику. */
  r?: string;
  /** Позиция [x, y] — относительные координаты 0.0–1.0 от viewport. */
  p: [number, number];
  /** Размер [width, height] в px. */
  s: [number, number];
  st?: VslState;
  txt?: string;
  /** Preview длинного текста (первые ~50 символов) — lazy text loading (M1.7, DEC-026). */
  txt_preview?: string;
  /** Ссылка на полный текст в text_blocks документа — lazy text loading (M1.7, DEC-026). */
  txt_ref?: string;
  act?: string[];
  ch?: VslObject[];
  /** Ссылка на визуальный фрагмент (§2.2.2) — ключ в visual_fragments документа. */
  vf?: string;
  /** Метаданные фрагмента (§4.4). */
  vf_meta?: VslFragmentMeta;
  /** Визуальные стили (DESIGN_SYSTEM.md §4.3). Optional: только для визуально значимых элементов. */
  sty?: VslStyle;
  /** Accept attribute для file_input (например, '.pdf,.docx'). */
  accept?: string;
  /** Multiple attribute для file_input — разрешена загрузка нескольких файлов. */
  multiple?: boolean;
}

export interface VslDocument {
  vsl_version: string;
  canvas: VslCanvas;
  objects: VslObject[];
  /**
   * Реестр визуальных фрагментов (§2.2.2): ключ — vf-ссылка объекта
   * (инвариант: каждый vf объекта — ключ этой map). Только метаданные:
   * base64-данные изображений живут в VisualFragmentStore (src/llm/types.ts,
   * DEC-015) и подаются по запросу (lazy loading §4.4) — документ остаётся
   * в бюджете 10-100 KB (ARCHITECTURE.md:L16-18). Optional: документы
   * без фрагментов валидны (обратно-совместимость).
   */
  visual_fragments?: Record<string, VisualFragment>;
  /**
   * Кэш полных текстов для lazy text loading (M1.7, DEC-026): ключ — txt_ref
   * объекта (формат tb_xxx, инкрементный счётчик). Значение — полный текст.
   * Только для элементов с txt > 200 символов. Optional: документы без
   * текстовых блоков валидны (обратно-совместимость).
   */
  text_blocks?: Record<string, string>;
}