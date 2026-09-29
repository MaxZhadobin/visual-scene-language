/**
 * Тесты VSL Snapshot Session (T1.2.4, ROADMAP.md M1.2; ARCHITECTURE.md §2.4).
 *
 * Реальный пайплайн без моков (extractDomTree → segmentTree → buildVslDocument
 * → Cache Store → diffVslDocuments) на jsdom-фикстуре с data-rect:
 *  - первый вызов → полный VslDocument + заполнение кэша;
 *  - идентичный повтор → валидный пустой дифф (все id в unchanged_refs);
 *  - мутации txt/удаление/добавление → modified/removed/added + синхронизация
 *    кэша (fresh set / invalidate / set поддерева);
 *  - смена URL → снова полный документ (cache.clear сбрасывает даже посторонние
 *    записи), счётчик версий начинается с 1;
 *  - viewport resize при том же URL → пустой дифф + invalidateCoordinates:
 *    p — абсолютные страница-релятивные пиксели (АС[2]) и не зависят от
 *    размера окна, поэтому при фиксированных data-rect все элементы в
 *    unchanged_refs; coordHash всех записей обнуляется (страховка от reflow).
 */

import { createCacheStore } from '../cache/cacheStore';
import type { CacheStore } from '../cache/cacheStore';
import { VSL_VERSION } from '../types/vsl';
import type { VslDocument, VslObject } from '../types/vsl';
import type { VslDiff } from '../diff/diffEngine';
import type { VisualFragmentData } from '../llm/types';
import { FragmentExtractor } from '../vision/fragmentExtractor';
import type { VisionClassification, VisionClassifier } from '../vision/types';
import { VslSnapshotSession, isVslDiff } from './snapshotSession';
import type { SnapshotInput, SnapshotResult } from './snapshotSession';

const TS = '2026-09-21T09:00:00.000Z';
const URL_A = 'https://app.test/dashboard';

/** 4 VSL-объекта фикстуры в tree order: main → button, div → a. */
const ALL_IDS = ['main_0', 'button_0_0', 'div_0_1', 'a_0_1_0'];

const BASE_HTML = `
  <main data-rect="0,0,1280,800">
    <button data-rect="16,16,160,32">Войти</button>
    <div data-rect="0,64,1280,200">
      <a href="/docs" data-rect="16,80,80,24">Ссылка</a>
    </div>
  </main>
`;

function makeHost(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function input(url: string, width = 1280, height = 800): SnapshotInput {
  return { url, viewport: { width, height }, timestamp: TS };
}

function expectDiff(result: SnapshotResult): VslDiff {
  expect(isVslDiff(result)).toBe(true);
  return result as VslDiff;
}

function flatIds(objects: readonly VslObject[]): string[] {
  return objects.flatMap((o) => [o.id, ...flatIds(o.ch ?? [])]);
}

describe('VslSnapshotSession (T1.2.4, ARCHITECTURE §2.4)', () => {
  let store: CacheStore;
  let session: VslSnapshotSession;
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    store = createCacheStore();
    session = new VslSnapshotSession(store);
    host = makeHost(BASE_HTML);
  });

  it('первый вызов → полный VslDocument, кэш заполнен всеми объектами', () => {
    const result = session.snapshot(host, input(URL_A));

    expect(isVslDiff(result)).toBe(false);
    const doc = result as VslDocument;
    expect(doc.vsl_version).toBe(VSL_VERSION);
    expect(doc.canvas.viewport).toEqual({ width: 1280, height: 800, unit: 'px' });
    expect(doc.canvas.url).toBe(URL_A);
    expect(doc.canvas.timestamp).toBe(TS);
    expect(flatIds(doc.objects)).toEqual(ALL_IDS);

    expect(store.size).toBe(ALL_IDS.length);
    expect(store.get('button_0_0')?.object.txt).toBe('Войти');
  });

  it('идентичный повтор → валидный пустой дифф 2/1, все id в unchanged_refs', () => {
    session.snapshot(host, input(URL_A));
    const diff = expectDiff(session.snapshot(host, input(URL_A)));

    expect(diff.diff_version).toBe(2);
    expect(diff.base_version).toBe(1);
    expect(diff.timestamp).toBe(TS);
    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.modified).toEqual([]);
    expect(diff.changes.removed).toEqual([]);
    expect(diff.changes.unchanged_refs).toEqual(ALL_IDS);
  });

  it('мутация txt → modified {id, txt}; кэш перезаписан свежим объектом', () => {
    session.snapshot(host, input(URL_A));
    host.querySelector('button')!.textContent = 'Войти в систему';

    const diff = expectDiff(session.snapshot(host, input(URL_A)));

    expect(diff.changes.modified).toEqual([{ id: 'button_0_0', txt: 'Войти в систему' }]);
    expect(store.get('button_0_0')?.object.txt).toBe('Войти в систему');
  });

  it('удаление поддерева → removed tree order prev, записи инвалидируются', () => {
    session.snapshot(host, input(URL_A));
    host.querySelector('div')!.remove();

    const diff = expectDiff(session.snapshot(host, input(URL_A)));

    // id = tag_indexPath: удалённый div и его a уходят как removed.
    // main_0 и button_0_0 unchanged (ch не участвует в objectsEqual).
    expect(diff.changes.removed).toEqual([{ id: 'div_0_1' }, { id: 'a_0_1_0' }]);
    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.modified).toEqual([]);
    expect(diff.changes.unchanged_refs).toEqual(['main_0', 'button_0_0']);
    expect(store.has('div_0_1')).toBe(false);
    expect(store.has('a_0_1_0')).toBe(false);
    expect(store.has('main_0')).toBe(true);
    expect(store.has('button_0_0')).toBe(true);
  });

  it('добавление элемента → новый ID для добавленного элемента, остальные stable', () => {
    session.snapshot(host, input(URL_A));
    const added = document.createElement('button');
    added.setAttribute('data-rect', '200,16,120,32');
    added.textContent = 'Новая';
    host.querySelector('main')!.appendChild(added);

    const diff = expectDiff(session.snapshot(host, input(URL_A)));

    // id = tag_indexPath: новый button получает индекс 2 внутри main → button_0_2.
    // Остальные ID стабильны (main_0, button_0_0, div_0_1, a_0_1_0).
    expect(diff.changes.removed).toEqual([]);
    expect(diff.changes.added).toHaveLength(1);
    expect(diff.changes.added[0]).toEqual(expect.objectContaining({ id: 'button_0_2' }));
    expect(store.has('main_0')).toBe(true);
    expect(store.has('button_0_0')).toBe(true);
    expect(store.has('button_0_2')).toBe(true);
    expect(store.has('div_0_1')).toBe(true);
    expect(store.has('a_0_1_0')).toBe(true);
  });

  it('смена URL → полный документ; cache.clear удаляет посторонние записи; версии с 1', () => {
    session.snapshot(host, input(URL_A));
    session.snapshot(host, input(URL_A));
    const canary: VslObject = { id: 'canary_0', t: 'container', p: [0, 0], s: [1, 1] };
    store.set(canary.id, canary);

    const result = session.snapshot(host, input('https://app.test/other'));

    expect(isVslDiff(result)).toBe(false);
    expect((result as VslDocument).canvas.url).toBe('https://app.test/other');
    expect(store.has('canary_0')).toBe(false); // cache.clear()
    expect(store.size).toBe(ALL_IDS.length); // заполнен только новым документом

    host.querySelector('button')!.textContent = 'Другая подпись';
    const diff = expectDiff(session.snapshot(host, input('https://app.test/other')));
    expect([diff.diff_version, diff.base_version]).toEqual([2, 1]);
  });

  it('resize при том же URL → пустой дифф + invalidateCoordinates: абсолютные p инвариантны, все в unchanged', () => {
    session.snapshot(host, input(URL_A));
    const diff = expectDiff(session.snapshot(host, input(URL_A, 1920, 1080)));

    // p — абсолютные страница-релятивные пиксели (АС[2]): не зависят от размера
    // окна, а контент и data-rect фикстуры неизменны → полностью пустой дифф.
    expect(diff.changes.added).toEqual([]);
    expect(diff.changes.modified).toEqual([]);
    expect(diff.changes.removed).toEqual([]);
    expect(diff.changes.unchanged_refs).toEqual(ALL_IDS);

    // «Сброс координат» §5.2: при смене viewport session вызывает
    // invalidateCoordinates — все записи в кэше с обнулённым coordHash
    // (страховка от reflow, который мог сдвинуть элементы).
    for (const id of ALL_IDS) {
      expect(store.get(id)?.coordHash).toBe('');
    }
  });

  it('счётчик версий монотонен при том же URL: full → 2/1 → 3/2', () => {
    session.snapshot(host, input(URL_A));
    const first = expectDiff(session.snapshot(host, input(URL_A)));
    const second = expectDiff(session.snapshot(host, input(URL_A)));

    expect([first.diff_version, first.base_version]).toEqual([2, 1]);
    expect([second.diff_version, second.base_version]).toEqual([3, 2]);
  });
});

describe('VslSnapshotSession.snapshotWithVision (T1.5.5): vision-ветка конвейера', () => {
  const NOW = '2026-01-01T00:00:00.000Z';

  /** Фикстура с vision-кандидатом: canvas без семантики (без обогащения builder его отбросит). */
  const VISION_HTML = `
    <main data-rect="0,0,1280,800">
      <button data-rect="16,16,160,32">Войти</button>
      <canvas data-rect="200,16,300,150"></canvas>
    </main>
  `;

  let store: CacheStore;
  let session: VslSnapshotSession;
  let host: HTMLElement;
  let calls: VisualFragmentData[];

  /** Поиск объекта по id в дереве VSL (flatIds не возвращает объекты). */
  function findObject(objects: readonly VslObject[], id: string): VslObject | undefined {
    for (const object of objects) {
      if (object.id === id) return object;
      const inChildren = findObject(object.ch ?? [], id);
      if (inChildren !== undefined) return inChildren;
    }
    return undefined;
  }

  /** Зависимости vision: фейковый классификатор (счётчик вызовов) + экстрактор с фейковыми capture/crop. */
  function makeDeps(classification: VisionClassification | Error) {
    calls = [];
    const classifier: VisionClassifier = {
      async classify(image) {
        calls.push(image);
        if (classification instanceof Error) throw classification;
        return classification;
      },
    };
    const extractor = new FragmentExtractor({
      capture: async () => 'data:image/png;base64,SCREEN',
      crop: async (_screenshot, rect) => ({
        mediaType: 'image/webp',
        data: 'AAAA',
        size: [rect.width, rect.height],
      }),
      now: () => NOW,
    });
    return { classifier, extractor };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    store = createCacheStore();
    session = new VslSnapshotSession(store);
    host = makeHost(VISION_HTML);
  });

  it('первый вызов → полный документ: canvas спасён (t + vf/vf_meta), fragments содержит данные', async () => {
    const result = await session.snapshotWithVision(
      host,
      input(URL_A),
      makeDeps({ type: 'chart', confidence: 0.9 }),
    );

    expect(isVslDiff(result.snapshot)).toBe(false);
    const doc = result.snapshot as VslDocument;
    const canvas = findObject(doc.objects, 'canvas_0_1');
    expect(canvas?.t).toBe('chart');
    expect(canvas?.vf).toBeDefined();
    expect(canvas?.vf_meta).toEqual({
      type: 'chart',
      format: 'webp',
      size: [304, 154],
      hash: expect.any(String),
      cached_at: NOW,
    });
    expect(result.fragments.get(canvas!.vf!)).toEqual({ mediaType: 'image/webp', data: 'AAAA' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ mediaType: 'image/webp', data: 'AAAA' });
  });

  it('повторный вызов → дифф; canvas в unchanged_refs; кэш: классификатор один раз (AC[3])', async () => {
    const deps = makeDeps({ type: 'chart', confidence: 0.9 });
    await session.snapshotWithVision(host, input(URL_A), deps);
    const second = await session.snapshotWithVision(host, input(URL_A), deps);

    const diff = expectDiff(second.snapshot);
    expect(diff.changes.unchanged_refs).toContain('canvas_0_1');
    expect(diff.changes.added).toEqual([]);
    expect(calls).toHaveLength(1); // extractor-кэш: hash совпал → sticky-классификация
  });

  it('ошибка классификатора → best-effort: canvas отброшен, документ собирается без него', async () => {
    const result = await session.snapshotWithVision(
      host,
      input(URL_A),
      makeDeps(new Error('vision down')),
    );

    expect(isVslDiff(result.snapshot)).toBe(false);
    const doc = result.snapshot as VslDocument;
    expect(flatIds(doc.objects)).toEqual(['main_0', 'button_0_0']);
    expect(result.fragments.size).toBe(0);
  });

  it('дифф-режим: добавленный canvas → added несёт vf/vf_meta (метаданные на объектах)', async () => {
    const deps = makeDeps({ type: 'chart', confidence: 0.9 });
    await session.snapshotWithVision(host, input(URL_A), deps);

    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-rect', '200,16,300,150');
    host.querySelector('main')!.appendChild(canvas);

    const second = await session.snapshotWithVision(host, input(URL_A), deps);

    const diff = expectDiff(second.snapshot);
    // id = tag_indexPath: id пересчитывается по DOM-пути детерминированно.
    // Первый вызов: main_0, button_0_0, canvas_0_1
    // Второй вызов (с добавленным canvas): ..., canvas_0_2
    // Diff видит это как добавление canvas_0_2 внутри main.
    expect(diff.changes.removed).toEqual([]);
    expect(diff.changes.added).toHaveLength(1);
    const added = diff.changes.added[0]!;
    expect(added.id).toBe('canvas_0_2');
    // Новый canvas (canvas_0_2) находится внутри children main.
    expect(added.t).toBe('chart');
    expect(added.vf).toBeDefined();
    expect(second.fragments.get(added.vf!)).toEqual({ mediaType: 'image/webp', data: 'AAAA' });
  });
});