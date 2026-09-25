/**
 * Cache invalidation через MutationObserver (T1.2.2, ROADMAP.md M1.2; ARCHITECTURE.md §5.2).
 *
 * attachMutationObserver(root, store) подписывается на мутации поддерева root
 * и точечно инвалидирует записи Cache Store:
 *  - childList (изменился состав детей) → родительский элемент (его поле ch);
 *  - attributes → сам целевой элемент;
 *  - characterData → owner-элемент текстового узла.
 *
 * Маппинг element → id воспроизводит арифметику domExtractor + vslBuilder
 * (id = tag_indexPath): подъём от элемента до root, на каждом уровне — индекс
 * среди ЭЛЕМЕНТНЫХ детей (Array.from(parent.children)); domExtractor считает
 * indexPath по живому DOM ДО фильтрации, поэтому индексы совпадают 1:1.
 * Контракт: root наблюдателя === корень extraction (document.body по умолчанию).
 *
 * Если id элемента мутации нет в store — инвалидируется ближайший предок из
 * store (подъём вверх до root). Root сам не имеет VSL-записи (extractDomTree
 * не включает корень) → childList на прямых детях root — no-op в MVP.
 *
 * Известное MVP-ограничение (соответствует дизайну фикстур dc_6: добавления/
 * удаления только в конец списков детей): вставка/удаление в середину сдвигает
 * indexPath последующих сиблингов — их id меняются; точечная инвалидация
 * «переехавших» записей вне MVP, итоговую консистентность гарантирует diff
 * по полному переизвлечению (T1.2.4).
 */

import type { CacheStore } from './cacheStore';

/** Результат attachMutationObserver: наблюдатель + ручная отписка. */
export interface MutationObserverHandle {
  /** Живой MutationObserver (для тестов и расширенного контроля). */
  observer: MutationObserver;
  /** Отписаться от мутаций. */
  disconnect(): void;
}

/** id = tag_indexPath — в точности формула vslBuilder.toVslObject. */
function elementId(el: Element, root: Element): string | null {
  const indexPath: number[] = [];
  let current: Element | null = el;
  while (current !== null && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (parent === null) return null; // элемент вне поддерева root
    indexPath.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }
  if (current !== root || indexPath.length === 0) return null; // сам root
  return `${el.tagName.toLowerCase()}_${indexPath.join('_')}`;
}

/**
 * Инвалидация цели мутации: собственный id из store — удаляется; иначе
 * ближайший предок из store. Цели вне root / сам root — no-op (см. шапку).
 */
function invalidateMutationTarget(node: Node, root: Element, store: CacheStore): void {
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (start === null || start === root || !root.contains(start)) return;

  let current: Element | null = start;
  while (current !== null && current !== root) {
    const id = elementId(current, root);
    if (id !== null && store.has(id)) {
      store.invalidate(id);
      return;
    }
    current = current.parentElement;
  }
}

/**
 * Подписывает store на мутации поддерева root (§5.2 «DOM mutation observer →
 * invalidation изменённых элементов»). Возвращает handle с disconnect().
 */
export function attachMutationObserver(root: Element, store: CacheStore): MutationObserverHandle {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      invalidateMutationTarget(record.target, root, store);
    }
  });
  observer.observe(root, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
  });
  return { observer, disconnect: () => observer.disconnect() };
}