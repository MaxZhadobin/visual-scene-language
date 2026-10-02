/**
 * idMapper — маппинг длинных VSL ID (tag_indexPath) в короткие ID для выдачи LLM.
 *
 * Карта строится НА ЛЕТУ для каждого снапшота, хранится рядом с ним в кэше.
 * Снапшот обновился — карта перестраивается.
 *
 * Формат короткого ID: <prefix>_<counter_base36>
 *   prefix = сокращение тега из TAG_PREFIXES (button→btn, input→inp, div→div, a→a)
 *   counter = порядковый номер per-prefix в base36 (0,1,...,9,a,b,...,z,10,...)
 *
 * Пример: button_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_4 → btn_0
 *         input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0 → inp_0
 */

import type { VslObject, VslDocument } from '../types/vsl.js';
import type { VslDiff, VslModifiedObject, VslRemovedObject } from '../diff/diffEngine.js';

/** Маппинг HTML-тегов в их сокращения для коротких ID. */
const TAG_PREFIXES: Record<string, string> = {
  button: 'btn',
  input: 'inp',
  div: 'div',
  a: 'a',
  img: 'img',
  span: 'spn',
  p: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  nav: 'nav',
  header: 'hdr',
  footer: 'ftr',
  main: 'mn',
  section: 'sec',
  article: 'art',
  aside: 'asd',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  table: 'tbl',
  tr: 'tr',
  td: 'td',
  th: 'th',
  form: 'frm',
  label: 'lbl',
  textarea: 'txt',
  select: 'sel',
  option: 'opt',
  video: 'vid',
  audio: 'aud',
  canvas: 'cvs',
  svg: 'svg',
  iframe: 'ifr',
  script: 'scr',
  style: 'sty',
  link: 'lnk',
  meta: 'mta',
  title: 'ttl',
  body: 'bdy',
  html: 'htm',
  head: 'hd',
};

/** Префикс для тега: маппинг в сокращение или первые 3 символа. */
function tagPrefix(tag: string): string {
  if (!tag) return 'el';
  return TAG_PREFIXES[tag] ?? (tag.length <= 3 ? tag : tag.slice(0, 3));
}

/** Извлечь тег из длинного ID формата tag_indexPath. */
function extractTag(longId: string): string {
  // ID формат: tag_indexPath (например button_0_0_0_2)
  // Тег может содержать underscore (file_input), поэтому ищем первый underscore перед цифрами
  const match = longId.match(/^(.+?)_(\d+)/);
  return match?.[1] ?? longId;
}

/** Число → base36 строка (0-9, a-z, 10-1z, ...). */
function toBase36(n: number): string {
  return n.toString(36);
}

/**
 * Построить карту shortId → longId для всех объектов в дереве.
 * Обходит рекурсивно все объекты и их потомков (ch).
 *
 * @param objects - Объекты для маппинга
 * @param previousReverseIdMap - Опциональная карта longId → shortId из предыдущего snapshot.
 *   Используется для сохранения стабильности ID: если элемент с тем же longId существовал
 *   в предыдущем snapshot, ему назначается тот же shortId (fix: ID reassignment после fill).
 */
export function buildIdMap(
  objects: readonly VslObject[],
  previousReverseIdMap?: Map<string, string>
): Map<string, string> {
  const map = new Map<string, string>();
  const counters = new Map<string, number>(); // prefix → next counter
  const assignedShortIds = new Set<string>(); // ID, назначенные в текущем проходе

  // Первый проход: собираем все элементы и их framePrefix
  const elementsWithPrefix: Array<{ obj: VslObject; framePrefix?: string }> = [];

  function collect(obj: VslObject, framePrefix?: string): void {
    elementsWithPrefix.push({ obj, framePrefix });
    if (obj.ch) {
      for (const child of obj.ch) {
        collect(child, framePrefix);
      }
    }
    if (obj.iframe?.vsl?.objects) {
      const frameIndex = obj.iframe.frameId;
      const iframeFramePrefix = `iframe_${frameIndex}`;
      for (const iframeObj of obj.iframe.vsl.objects) {
        collect(iframeObj, iframeFramePrefix);
      }
    }
  }

  for (const obj of objects) {
    collect(obj);
  }

  // Второй проход: сначала назначаем ID элементам из previousReverseIdMap
  if (previousReverseIdMap) {
    for (const { obj, framePrefix } of elementsWithPrefix) {
      const oldShortId = previousReverseIdMap.get(obj.id);
      if (oldShortId && !assignedShortIds.has(oldShortId)) {
        // Проверяем что oldShortId имеет правильный framePrefix
        const expectedPrefix = framePrefix ? `${framePrefix}:` : '';
        if (oldShortId.startsWith(expectedPrefix) || (!framePrefix && !oldShortId.includes(':'))) {
          map.set(oldShortId, obj.id);
          assignedShortIds.add(oldShortId);
        }
      }
    }
  }

  // Третий проход: назначаем ID остальным элементам
  for (const { obj, framePrefix } of elementsWithPrefix) {
    if (map.has(framePrefix ? `${framePrefix}:${obj.id}` : obj.id)) continue; // уже назначен
    // Проверяем, есть ли этот элемент в map (по longId)
    const alreadyAssigned = Array.from(map.entries()).some(([_, longId]) => longId === obj.id);
    if (alreadyAssigned) continue;

    const tag = extractTag(obj.id);
    const prefix = tagPrefix(tag);
    let counter = counters.get(prefix) ?? 0;
    let shortId: string;
    do {
      shortId = framePrefix 
        ? `${framePrefix}:${prefix}_${toBase36(counter)}`
        : `${prefix}_${toBase36(counter)}`;
      counter++;
    } while (assignedShortIds.has(shortId));

    counters.set(prefix, counter);
    assignedShortIds.add(shortId);
    map.set(shortId, obj.id);
  }

  return map;
}

/**
 * Построить обратную карту longId → shortId.
 *
 * @param objects - Объекты для маппинга
 * @param previousReverseIdMap - Опциональная карта из предыдущего snapshot для стабильности ID.
 */
export function buildReverseIdMap(
  objects: readonly VslObject[],
  previousReverseIdMap?: Map<string, string>
): Map<string, string> {
  const forward = buildIdMap(objects, previousReverseIdMap);
  const reverse = new Map<string, string>();
  for (const [shortId, longId] of forward) {
    reverse.set(longId, shortId);
  }
  return reverse;
}

/**
 * Заменить длинные ID на короткие во всех объектах документа (рекурсивно).
 * Возвращает НОВЫЙ документ (не мутирует исходный).
 */
export function replaceIdsInDocument(
  document: VslDocument,
  longToShort: Map<string, string>
): VslDocument {
  if (!document.objects) return document;

  function replaceObj(obj: VslObject): VslObject {
    const shortId = longToShort.get(obj.id) ?? obj.id;
    const result: VslObject = { ...obj, id: shortId };
    if (obj.ch) {
      result.ch = obj.ch.map(replaceObj);
    }
    // Рекурсивная замена ID в iframe.vsl.objects
    if (obj.iframe?.vsl?.objects) {
      result.iframe = {
        ...obj.iframe,
        vsl: {
          ...obj.iframe.vsl,
          objects: obj.iframe.vsl.objects.map(replaceObj),
        },
      };
    }
    return result;
  }

  return { ...document, objects: document.objects.map(replaceObj) };
}

/**
 * Обрабатывает changes.added, changes.modified, changes.removed, changes.unchanged_refs.
 */
export function replaceIdsInDiff(
  diff: VslDiff,
  reverseIdMap: Map<string, string>
): VslDiff {
  if (!diff.changes) return diff;

  const changes = diff.changes;

  // Replace in added objects
  const added = changes.added?.map(obj => replaceIdsInVslObject(obj, reverseIdMap)) ?? [];

  // Replace in modified objects
  const modified = changes.modified?.map(obj => replaceIdsInModifiedObject(obj, reverseIdMap)) ?? [];

  // Replace in removed objects
  const removed = changes.removed?.map(obj => replaceIdsInRemovedObject(obj, reverseIdMap)) ?? [];

  // Replace in unchanged_refs (array of string IDs)
  const unchanged_refs = changes.unchanged_refs?.map(ref => 
    reverseIdMap.get(ref) ?? ref
  ) ?? [];

  return {
    ...diff,
    changes: {
      added,
      modified,
      removed,
      unchanged_refs
    }
  };
}

function replaceIdsInModifiedObject(
  obj: VslModifiedObject,
  reverseIdMap: Map<string, string>
): VslModifiedObject {
  const result: VslModifiedObject = {
    id: reverseIdMap.get(obj.id) ?? obj.id
  };

  if (obj.p !== undefined) result.p = obj.p;
  if (obj.s !== undefined) result.s = obj.s;
  if (obj.t !== undefined) result.t = obj.t;
  if (obj.txt !== undefined) result.txt = obj.txt;
  if (obj.act !== undefined) result.act = obj.act;

  return result;
}

function replaceIdsInRemovedObject(
  obj: VslRemovedObject,
  reverseIdMap: Map<string, string>
): VslRemovedObject {
  return {
    id: reverseIdMap.get(obj.id) ?? obj.id
  };
}

function replaceIdsInVslObject(
  obj: VslObject,
  reverseIdMap: Map<string, string>
): VslObject {
  const result: VslObject = {
    ...obj,
    id: reverseIdMap.get(obj.id) ?? obj.id
  };

  if (obj.ch && obj.ch.length > 0) {
    result.ch = obj.ch.map(child => replaceIdsInVslObject(child, reverseIdMap));
  }

  // Рекурсивная замена ID в iframe.vsl.objects
  if (obj.iframe?.vsl?.objects) {
    result.iframe = {
      ...obj.iframe,
      vsl: {
        ...obj.iframe.vsl,
        objects: obj.iframe.vsl.objects.map(child => replaceIdsInVslObject(child, reverseIdMap)),
      },
    };
  }

  return result;
}
/**
 * Резолвить короткий ID в длинный.
 * Возвращает undefined если короткий ID не найден в карте.
 */
export function resolveShortId(shortId: string, shortToLong: Map<string, string>): string | undefined {
  return shortToLong.get(shortId);
}

/**
 * Резолвить короткий ID в длинный с ошибкой если не найден.
 */
export function resolveShortIdOrThrow(shortId: string, shortToLong: Map<string, string>): string {
  const longId = shortToLong.get(shortId);
  if (!longId) {
    throw new Error(`Unknown short VSL ID: ${shortId}. Available: ${[...shortToLong.keys()].join(', ')}`);
  }
  return longId;
}