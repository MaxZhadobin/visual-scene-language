/**
 * VSL Builder (T1.1.5, ROADMAP.md M1.1; контракт ARCHITECTURE.md §2.3).
 *
 * Вход: семантическое дерево от Segmentation Engine (segmentTree).
 * Выход: VSL JSON по DESIGN_SYSTEM.md §4 (vsl_version, canvas, objects tree).
 *
 * Отбор элементов — эвристика Semantic Density (ARCHITECTURE.md) в адаптации
 * к L1/L2-сегментации:
 *  - t !== null (типизирован L1/L2) → семантический объект, включается;
 *  - t === null → score = role(3) + aria-label(2) + interactive-атрибуты(2) +
 *    txt(1) + включённые дети(1); score >= 3 → контейнер;
 *  - t === null и есть включённые потомки → контейнер-обёртка (обобщение
 *    контракта «== 0 с семантическими детьми → grouping» на зазор 1–2);
 *  - иначе — декоративный, пропускается вместе с поддеревом.
 *
 * Детерминизм (решение для M1.2 Cache/Diff): id = tag_indexPath из DOM-пути,
 * без Date.now()/Math.random(); timestamp/url/title фиксируются через
 * BuildOptions (в тестах — обязательно).
 */

import type { SegmentedElement } from '../segmentation/segmenter';
import type { ElementCss } from '../capture/domExtractor';
import {
  VSL_VERSION,
  type VisualFragment,
  type VisualFragmentType,
  type VslCanvas,
  type VslDocument,
  type VslObject,
  type VslState,
  type VslStyle,
  type VslType,
} from '../types/vsl';

/** Порог lazy text loading: тексты длиннее этого порога заменяются на preview + ref (DEC-026, M1.7). */
const LAZY_TEXT_THRESHOLD = 200;
/** Длина preview для lazy text (DEC-026, M1.7). */
const LAZY_TEXT_PREVIEW_LENGTH = 50;

/** Опции сборки: для детерминированных тестов фиксируйте timestamp/url/title. */
export interface BuildOptions {
  viewport?: { width: number; height: number };
  background?: string;
  timestamp?: string;
  url?: string;
  title?: string;
}

const INTERACTIVE_ATTRS: readonly string[] = [
  'onclick',
  'onmousedown',
  'ontouchstart',
  'tabindex',
  'contenteditable',
];

/** Относительная координата [0..1], округление до 4 знаков (компактность JSON). */
function relative(value: number, dimension: number): number {
  if (dimension <= 0) return 0;
  return Math.round((value / dimension) * 10000) / 10000;
}

/** Умные дефолты act по README_AI §4.4; disabled → взаимодействие недоступно. */
function defaultActions(
  t: VslType,
  st: VslState | null,
  attributes: Record<string, string>,
): string[] | undefined {
  if (st === 'disabled') return undefined;
  switch (t) {
    case 'button':
    case 'link':
    case 'tab':
      return ['click'];
    case 'modal':
      return ['close'];
    case 'input': {
      const type = attributes['type'];
      return type === 'checkbox' || type === 'radio'
        ? ['click', 'check', 'uncheck']
        : ['click', 'type', 'clear'];
    }
    case 'select':
      return ['click', 'select'];
    case 'textarea':
      return ['click', 'type', 'clear'];
    case 'file_input':
      return ['click', 'upload'];
    default:
      return undefined;
  }
}

/** Score нетипизированного элемента без учёта детей (дети учтены включённостью). */
function baseSemanticScore(el: SegmentedElement): number {
  let score = 0;
  if (el.attributes['role'] !== undefined) score += 3;
  if (el.attributes['aria-label'] !== undefined) score += 2;
  if (INTERACTIVE_ATTRS.some((attr) => el.attributes[attr] !== undefined)) score += 2;
  if (el.txt) score += 1;
  return score;
}

/**
 * Извлекает визуальные стили из CSS-подмножества для VslObject.
 * Возвращает undefined, если нет значимых стилей (экономия JSON).
 * Фильтрует дефолтные значения: transparent, none, 0px, rgb(0,0,0).
 */
function extractVisualStyles(css?: ElementCss): VslStyle | undefined {
  if (!css) return undefined;

  const style: VslStyle = {};
  let hasContent = false;

  // Background (пропускаем transparent и rgba(0,0,0,0))
  if (
    css.backgroundColor &&
    css.backgroundColor !== 'transparent' &&
    !css.backgroundColor.includes('rgba(0, 0, 0, 0)')
  ) {
    style.bg = css.backgroundColor;
    hasContent = true;
  }

  // Foreground (пропускаем черный по умолчанию) — ВСЕГДА включаем, если есть
  if (css.color && css.color !== 'rgb(0, 0, 0)') {
    style.fg = css.color;
    hasContent = true;
  }

  // Border (пропускаем none и 0px) — ВСЕГДА включаем, если есть
  if (css.border && css.border !== 'none' && !css.border.startsWith('0px')) {
    style.border = css.border;
    hasContent = true;
  }

  // Border radius (пропускаем 0px) — ВСЕГДА включаем, если есть
  if (css.borderRadius && css.borderRadius !== '0px') {
    style.radius = css.borderRadius;
    hasContent = true;
  }

  // Box shadow (пропускаем none) — ВСЕГДА включаем, если есть
  if (css.boxShadow && css.boxShadow !== 'none') {
    style.shadow = css.boxShadow;
    hasContent = true;
  }

  // Font (только если есть family/size/weight) — ВСЕГДА включаем, если есть
  if (css.fontFamily || css.fontSize || css.fontWeight) {
    style.font = {};
    if (css.fontFamily) style.font.family = css.fontFamily;
    if (css.fontSize) style.font.size = css.fontSize;
    if (css.fontWeight) style.font.weight = css.fontWeight;
    hasContent = true;
  }

  return hasContent ? style : undefined;
}


function toVslObject(
  el: SegmentedElement,
  viewport: { width: number; height: number },
  includedChildren: VslObject[],
  textBlocks: Map<string, string>,
  counter: { value: number },
): VslObject {
  const t: VslType = el.t ?? 'container';
  const object: VslObject = {
    id: `${el.tag}_${el.indexPath.join('_')}`,
    t,
    p: [relative(el.rect.x, viewport.width), relative(el.rect.y, viewport.height)],
    s: [Math.round(el.rect.width), Math.round(el.rect.height)],
  };
  const role = el.attributes['role'];
  if (role !== undefined) object.r = role;
  if (el.st) object.st = el.st;
  if (el.txt) {
    if (el.txt.length > LAZY_TEXT_THRESHOLD) {
      object.txt_preview = el.txt.slice(0, LAZY_TEXT_PREVIEW_LENGTH) + '…';
      const refId = `tb_${String(counter.value++).padStart(3, '0')}`;
      object.txt_ref = refId;
      textBlocks.set(refId, el.txt);
    } else {
      object.txt = el.txt;
    }
  }
  const act = defaultActions(t, el.st, el.attributes);
  if (act !== undefined) object.act = act;
  if (includedChildren.length > 0) object.ch = includedChildren;
  if (el.vf !== undefined) object.vf = el.vf;
  if (el.vf_meta !== undefined) object.vf_meta = el.vf_meta;
  const sty = extractVisualStyles(el.css);
  if (sty !== undefined) object.sty = sty;
  // file_input: извлекаем accept и multiple атрибуты
  if (t === 'file_input') {
    if (el.attributes['accept'] !== undefined) object.accept = el.attributes['accept'];
    if (el.attributes['multiple'] !== undefined) object.multiple = true;
  }
  return object;
}

/** Нижняя граница обхода: сначала дети, затем решение о включении элемента. */
function convert(
  el: SegmentedElement,
  viewport: { width: number; height: number },
  textBlocks: Map<string, string>,
  counter: { value: number },
): VslObject | null {
  const includedChildren = el.ch
    .map((child) => convert(child, viewport, textBlocks, counter))
    .filter((obj): obj is VslObject => obj !== null);

  if (el.t !== null) return toVslObject(el, viewport, includedChildren, textBlocks, counter);

  const score = baseSemanticScore(el) + (includedChildren.length > 0 ? 1 : 0);
  if (score >= 3 || includedChildren.length > 0) {
    return toVslObject(el, viewport, includedChildren, textBlocks, counter);
  }
  return null; // декоративный — пропускается вместе с поддеревом
}

/**
 * Будет ли элемент включён в VSL (решение convert без построения объектов):
 * типизирован, или score ≥ 3, или есть включённые дети. Используется
 * enrichWithVision для отбора vision-кандидатов (спасение отбрасываемых
 * элементов, T1.5.4) — единственный источник правды об отбрасывании.
 */
export function isIncludedInVsl(el: SegmentedElement): boolean {
  if (el.t !== null) return true;
  const includedChildren = el.ch.filter(isIncludedInVsl).length;
  const score = baseSemanticScore(el) + (includedChildren > 0 ? 1 : 0);
  return score >= 3 || includedChildren > 0;
}

function buildCanvas(
  options: BuildOptions,
  viewport: { width: number; height: number },
): VslCanvas {
  const url = options.url ?? window.location.href;
  const title = options.title ?? document.title;
  return {
    viewport: { ...viewport, unit: 'px' },
    background: options.background ?? '#ffffff',
    scale: 1,
    orientation: viewport.width >= viewport.height ? 'landscape' : 'portrait',
    timestamp: options.timestamp ?? new Date().toISOString(),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

/**
 * Собирает реестр visual_fragments документа (§2.2.2, AC[5]): обходит
 * построенные объекты, для каждого объекта с vf-ссылкой копирует метаданные
 * из vf_meta (заполняются enrichWithVision). Инвариант vf→map выполняется
 * по построению: запись создаётся ровно для каждой встреченной vf-ссылки;
 * дубликаты vf (одинаковые фрагменты на разных объектах) дедуплицируются
 * ключом map. Возвращает undefined, если фрагментов нет (обратно-совместимость:
 * документы без фрагментов валидны).
 */
function collectVisualFragments(
  objects: readonly VslObject[],
): Record<string, VisualFragment> | undefined {
  const map: Record<string, VisualFragment> = {};
  const visit = (list: readonly VslObject[]): void => {
    for (const object of list) {
      if (object.vf !== undefined && object.vf_meta !== undefined) {
        map[object.vf] = {
          type: object.vf_meta.type as VisualFragmentType,
          format: object.vf_meta.format ?? 'webp',
          size: object.vf_meta.size ?? [0, 0],
          hash: object.vf_meta.hash,
          cached_at: object.vf_meta.cached_at,
        };
      }
      visit(object.ch ?? []);
    }
  };
  visit(objects);
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * Строит VSL JSON из семантического дерева (segmentTree) по DESIGN_SYSTEM §4.
 * Viewport фиксируется один раз на всю сборку — p-нормализация консистентна.
 */
export function buildVslDocument(
  elements: readonly SegmentedElement[],
  options: BuildOptions = {},
): VslDocument {
  const viewport = {
    width: options.viewport?.width ?? window.innerWidth,
    height: options.viewport?.height ?? window.innerHeight,
  };
  const textBlocks = new Map<string, string>();
  const counter = { value: 0 };
  const objects = elements
    .map((el) => convert(el, viewport, textBlocks, counter))
    .filter((obj): obj is VslObject => obj !== null);
  const vslDocument: VslDocument = {
    vsl_version: VSL_VERSION,
    canvas: buildCanvas(options, viewport),
    objects,
  };
  const visualFragments = collectVisualFragments(objects);
  if (visualFragments !== undefined) vslDocument.visual_fragments = visualFragments;
  if (textBlocks.size > 0) vslDocument.text_blocks = Object.fromEntries(textBlocks);
  return vslDocument;
}