/**
 * Тесты Cache invalidation (T1.2.2, ROADMAP.md M1.2).
 *
 * Реальный MutationObserver jsdom (верифицирован в data_collection —
 * note_1789957116655), без моков: attributes, characterData, childList,
 * ближайший предок, мутации вне root, childList на прямых детях root, disconnect.
 */

import { createCacheStore } from './cacheStore';
import { attachMutationObserver } from './invalidation';
import type { CacheStore } from './cacheStore';
import type { VslObject } from '../types/vsl';

function obj(id: string): VslObject {
  return { id, t: 'button', p: [0.1, 0.2], s: [100, 30] };
}

function seed(store: CacheStore, ids: string[]): void {
  for (const id of ids) store.set(id, obj(id));
}

/** Доставка записей MutationObserver асинхронна — ждём макротаск после микротасков. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('attachMutationObserver (T1.2.2, ARCHITECTURE §5.2)', () => {
  let store: CacheStore;
  let root: HTMLElement;
  let handle: ReturnType<typeof attachMutationObserver> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host;
    store = createCacheStore();
  });

  afterEach(() => {
    handle?.disconnect();
    handle = null;
  });

  it('attributes → инвалидирует целевой элемент по id = tag_indexPath', async () => {
    root.innerHTML = `
      <main>
        <div>
          <span>текст</span>
          <button>Кнопка</button>
        </div>
      </main>`;
    seed(store, ['main_0', 'div_0_0', 'span_0_0_0', 'button_0_0_1']);
    handle = attachMutationObserver(root, store);

    root.querySelector('button')!.setAttribute('aria-disabled', 'true');
    await flush();

    expect(store.has('button_0_0_1')).toBe(false);
    expect(store.has('div_0_0')).toBe(true);
    expect(store.has('main_0')).toBe(true);
  });

  it('characterData → инвалидирует owner-элемент текстового узла', async () => {
    root.innerHTML = '<main><span>текст</span></main>';
    seed(store, ['main_0', 'span_0_0']);
    handle = attachMutationObserver(root, store);

    const span = root.querySelector('span')!;
    span.firstChild!.textContent = 'новый текст';
    await flush();

    expect(store.has('span_0_0')).toBe(false);
    expect(store.has('main_0')).toBe(true);
  });

  it('childList → инвалидирует родительский элемент (изменилось его ch)', async () => {
    root.innerHTML = `
      <main>
        <div><button>Кнопка</button></div>
      </main>`;
    seed(store, ['main_0', 'div_0_0', 'button_0_0_0']);
    handle = attachMutationObserver(root, store);

    root.querySelector('div')!.appendChild(document.createElement('a'));
    await flush();

    expect(store.has('div_0_0')).toBe(false);
    expect(store.has('button_0_0_0')).toBe(true);
    expect(store.has('main_0')).toBe(true);
  });

  it('id цели отсутствует в store → инвалидируется ближайший предок из store', async () => {
    root.innerHTML = `
      <main>
        <div><button>Кнопка</button></div>
      </main>`;
    seed(store, ['main_0', 'div_0_0']); // button не кэширован
    handle = attachMutationObserver(root, store);

    root.querySelector('button')!.setAttribute('data-x', '1');
    await flush();

    expect(store.has('div_0_0')).toBe(false);
    expect(store.has('main_0')).toBe(true);
  });

  it('мутация вне поддерева root — no-op', async () => {
    root.innerHTML = '<main><button>Кнопка</button></main>';
    seed(store, ['main_0', 'button_0_0']);
    handle = attachMutationObserver(root, store);

    const outsider = document.createElement('aside');
    document.body.appendChild(outsider);
    outsider.setAttribute('data-x', '1');
    await flush();

    expect(store.size).toBe(2);
  });

  it('childList на прямых детях root — no-op (root не имеет VSL-записи)', async () => {
    root.innerHTML = '<main><button>Кнопка</button></main>';
    seed(store, ['main_0', 'button_0_0']);
    handle = attachMutationObserver(root, store);

    root.appendChild(document.createElement('footer'));
    await flush();

    expect(store.has('main_0')).toBe(true);
    expect(store.has('button_0_0')).toBe(true);
  });

  it('disconnect прекращает инвалидацию', async () => {
    root.innerHTML = '<main><button>Кнопка</button></main>';
    seed(store, ['button_0_0']);
    handle = attachMutationObserver(root, store);
    handle.disconnect();
    handle = null;

    root.querySelector('button')!.setAttribute('data-x', '1');
    await flush();

    expect(store.has('button_0_0')).toBe(true);
  });
});