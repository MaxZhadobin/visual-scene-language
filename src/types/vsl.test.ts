/**
 * Unit-тесты типов VSL (M1.5, T1.5.3, dev_1).
 *
 * Контракт расширения (change 73476923, ARCHITECTURE.md §2.2.1/§2.2.2):
 *  - VslType: 25 вариантов — L1/L2 + L3-CSS + L4-структурные + L5-vision;
 *  - VslObject.vf/vf_meta и VslDocument.visual_fragments — optional-поля
 *    (обратно-совместимость, vsl_version 1.0.0 сохраняется);
 *  - инвариант vf→map (AC[5]): каждая vf-ссылка объекта — ключ visual_fragments;
 *  - VisualFragment — только метаданные: base64-данные изображений живут
 *    в VisualFragmentStore (src/llm/types.ts, DEC-015, lazy loading §4.4).
 *
 * Валидатор здесь — минимальный (версия + vf→map); полная проверка схемы
 * (canvas, p/s, множества TYPES/STATES/ACTIONS) — validateVslDocument в
 * src/snapshot.integration.test.ts.
 */

import {
  VSL_VERSION,
  type VisualFragment,
  type VslCanvas,
  type VslDocument,
  type VslObject,
  type VslType,
} from './vsl';

/**
 * Все варианты union: литералы проверяются компилятором (ts-jest) —
 * удаление/переименование варианта VslType сломает сборку этого теста.
 */
const ALL_TYPES: readonly VslType[] = [
  'button', 'input', 'link', 'nav', 'header', 'main', 'container',
  'image', 'select', 'textarea', 'modal', 'tab',
  'heading', 'footer', 'scrollable_container',
  'toolbar', 'list', 'grid', 'form_field', 'tab_bar', 'layout',
  'icon', 'chart', 'custom_widget', 'unknown',
];

/** Минимальный валидатор: версия формата + инвариант vf→map. */
function validateDoc(doc: VslDocument): void {
  expect(doc.vsl_version).toBe(VSL_VERSION);
  const walk = (objects: readonly VslObject[]): void => {
    for (const o of objects) {
      if (o.vf !== undefined) {
        // Инвариант vf→map (AC[5]): ссылка обязана указывать в реестр документа.
        expect(doc.visual_fragments?.[o.vf]).toBeDefined();
      }
      walk(o.ch ?? []);
    }
  };
  walk(doc.objects);
}

/** Фабрика валидных метаданных фрагмента (без base64 — данные в сторе). */
function makeFragment(overrides: Partial<VisualFragment> = {}): VisualFragment {
  return {
    type: 'image',
    format: 'webp',
    size: [120, 80],
    hash: 'sha256:abc123',
    cached_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Канонический canvas для фикстур (url/title — optional, опущены). */
function makeCanvas(): VslCanvas {
  return {
    viewport: { width: 1280, height: 800, unit: 'px' },
    background: '#ffffff',
    scale: 1,
    orientation: 'landscape',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

describe('types/vsl — контракт M1.5 (T1.5.1–T1.5.4)', () => {
  it('VSL_VERSION остаётся 1.0.0 (обратно-совместимость формата)', () => {
    expect(VSL_VERSION).toBe('1.0.0');
  });

  it('union VslType содержит ровно 25 вариантов, включая группы L3/L4/L5', () => {
    expect(ALL_TYPES).toHaveLength(25);
    const set = new Set<string>(ALL_TYPES);
    // L3 — CSS-анализ (T1.5.1):
    for (const t of ['heading', 'footer', 'scrollable_container']) {
      expect(set.has(t)).toBe(true);
    }
    // L4 — структурный анализ (T1.5.2):
    for (const t of ['toolbar', 'list', 'grid', 'form_field', 'tab_bar', 'layout']) {
      expect(set.has(t)).toBe(true);
    }
    // L5 — vision fallback (T1.5.4):
    for (const t of ['icon', 'chart', 'custom_widget', 'unknown']) {
      expect(set.has(t)).toBe(true);
    }
  });

  it('документ с visual_fragments и vf/vf_meta валиден (AC[5])', () => {
    const doc: VslDocument = {
      vsl_version: VSL_VERSION,
      canvas: makeCanvas(),
      objects: [
        {
          id: 'img_0',
          t: 'image',
          p: [0.5, 0.5],
          s: [120, 80],
          vf: 'emb_1',
          vf_meta: {
            type: 'image',
            format: 'webp',
            size: [120, 80],
            hash: 'sha256:abc123',
            cached_at: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      visual_fragments: { emb_1: makeFragment() },
    };
    expect(() => validateDoc(doc)).not.toThrow();
  });

  it('vf-ссылка без записи в visual_fragments — нарушение инварианта (AC[5])', () => {
    const doc: VslDocument = {
      vsl_version: VSL_VERSION,
      canvas: makeCanvas(),
      objects: [{ id: 'img_0', t: 'image', p: [0.5, 0.5], s: [120, 80], vf: 'emb_missing' }],
      visual_fragments: {},
    };
    expect(() => validateDoc(doc)).toThrow();
  });

  it('документ без optional-полей валиден (обратно-совместимость)', () => {
    const doc: VslDocument = {
      vsl_version: VSL_VERSION,
      canvas: makeCanvas(),
      objects: [{ id: 'button_0', t: 'button', p: [0.1, 0.1], s: [100, 40] }],
    };
    expect(() => validateDoc(doc)).not.toThrow();
  });

  it('VisualFragment — только метаданные; тип из 5 значений §2.2.2 Шаг 2', () => {
    const fragment = makeFragment({ type: 'chart' });
    expect(['image', 'icon', 'chart', 'custom_widget', 'unknown']).toContain(fragment.type);
    expect(fragment.format).toBe('webp');
  });
});