/**
 * Тесты ID Mapper — маппинг длинных VSL ID в короткие ID для LLM.
 *
 * Проверяет:
 *  - buildIdMap / buildReverseIdMap — построение карты ID;
 *  - replaceIdsInDocument — замена ID в документе;
 *  - replaceIdsInDiff — замена ID в диффе;
 *  - resolveShortId / resolveShortIdOrThrow — резолв коротких ID.
 */

import type { VslObject, VslDocument } from '../types/vsl';
import type { VslDiff } from '../diff/diffEngine';
import {
  buildIdMap,
  buildReverseIdMap,
  replaceIdsInDocument,
  replaceIdsInDiff,
  resolveShortId,
  resolveShortIdOrThrow,
} from './idMapper';

/** Helper: создать VslObject с минимальными полями. */
function makeObj(id: string, children?: VslObject[]): VslObject {
  const tag = id.split('_')[0] ?? id;
  const obj: VslObject = { id, t: tag as VslObject['t'], txt: tag, p: [0, 0], s: [100, 30] };
  if (children && children.length > 0) {
    obj.ch = children;
  }
  return obj;
}

describe('buildIdMap', () => {
  it('строит карту shortId → longId для плоского списка', () => {
    const objects: VslObject[] = [
      makeObj('button_0_0'),
      makeObj('input_0_1'),
      makeObj('div_0_2'),
    ];

    const map = buildIdMap(objects);

    expect(map.size).toBe(3);
    const shortIds = Array.from(map.keys());
    expect(shortIds).toContain('btn_0');
    expect(shortIds).toContain('inp_0');
    expect(shortIds).toContain('div_0');
  });

  it('строит карту для дерева с детьми', () => {
    const objects: VslObject[] = [
      makeObj('div_0', [
        makeObj('button_0_0'),
        makeObj('a_0_1'),
      ]),
    ];

    const map = buildIdMap(objects);

    expect(map.size).toBe(3);
    expect(map.get('div_0')).toBe('div_0');
    expect(map.get('btn_0')).toBe('button_0_0');
    expect(map.get('a_0')).toBe('a_0_1');
  });

  it('использует base36 для счётчиков', () => {
    // Создаём 37 кнопок — 37-й должен иметь counter = 10 (base36)
    const objects: VslObject[] = [];
    for (let i = 0; i < 37; i++) {
      objects.push(makeObj(`button_${i}`));
    }

    const map = buildIdMap(objects);

    expect(map.size).toBe(37);
    // Первый — btn_0, десятый — btn_9, 11-й — btn_a (base36: a=10)
    expect(map.get('btn_0')).toBe('button_0');
    expect(map.get('btn_9')).toBe('button_9');
    expect(map.get('btn_a')).toBe('button_10'); // 10 в base36 = 'a'
    // 37-й элемент (индекс 36) → btn_10 (36 в base36 = '10')
    expect(map.get('btn_10')).toBe('button_36');
  });

  it('сохраняет стабильность ID с previousReverseIdMap', () => {
    const objects: VslObject[] = [
      makeObj('button_0_0'),
      makeObj('input_0_1'),
    ];

    // Первый проход
    const reverseMap1 = buildReverseIdMap(objects);
    // reverseMap1: button_0_0 → btn_0, input_0_1 → inp_0

    // Второй проход с previousReverseIdMap
    const map2 = buildIdMap(objects, reverseMap1);

    // ID должны остаться теми же
    expect(map2.get('btn_0')).toBe('button_0_0');
    expect(map2.get('inp_0')).toBe('input_0_1');
  });

  it('обрабатывает iframe объекты', () => {
    const iframeObj: VslObject = {
      id: 'iframe_0',
      t: 'iframe' as VslObject['t'],
      txt: 'iframe',
      p: [0, 0],
      s: [200, 300],
      iframe: {
        url: 'https://example.com',
        frameId: 0,
        vsl: {
          vsl_version: '1.0',
          canvas: {} as VslDocument['canvas'],
          objects: [makeObj('button_0_0'), makeObj('input_0_1')],
        },
      },
    };

    const map = buildIdMap([iframeObj]);

    // Должны быть маппинги для iframe и его содержимого
    expect(map.size).toBeGreaterThanOrEqual(3);
    // Iframe объекты должны иметь framePrefix
    const iframeEntries = Array.from(map.entries()).filter(([k]) => k.startsWith('iframe_'));
    expect(iframeEntries.length).toBeGreaterThan(0);
  });

  it('обрабатывает пустой массив', () => {
    const map = buildIdMap([]);
    expect(map.size).toBe(0);
  });
});

describe('buildReverseIdMap', () => {
  it('строит обратную карту longId → shortId', () => {
    const objects: VslObject[] = [
      makeObj('button_0_0'),
      makeObj('input_0_1'),
    ];

    const reverseMap = buildReverseIdMap(objects);

    expect(reverseMap.size).toBe(2);
    expect(reverseMap.get('button_0_0')).toBe('btn_0');
    expect(reverseMap.get('input_0_1')).toBe('inp_0');
  });
});

describe('replaceIdsInDocument', () => {
  const doc: VslDocument = {
    vsl_version: '1.0',
    canvas: {
      timestamp: '2026-01-01T00:00:00.000Z',
      viewport: { width: 1920, height: 1080, unit: 'px' },
      background: '#fff',
      scale: 1,
      orientation: 'landscape',
      url: 'https://example.com',
      title: 'Test',
    },
    objects: [
      makeObj('div_0', [
        makeObj('button_0_0'),
        makeObj('a_0_1'),
      ]),
    ],
  };

  it('заменяет длинные ID на короткие в документе', () => {
    const longToShort = new Map<string, string>([
      ['div_0', 'div_0'],
      ['button_0_0', 'btn_0'],
      ['a_0_1', 'a_0'],
    ]);

    const result = replaceIdsInDocument(doc, longToShort);

    expect(result.objects[0]!.id).toBe('div_0');
    expect(result.objects[0]!.ch![0]!.id).toBe('btn_0');
    expect(result.objects[0]!.ch![1]!.id).toBe('a_0');
  });

  it('не мутирует исходный документ', () => {
    const longToShort = new Map<string, string>([
      ['button_0_0', 'btn_0'],
    ]);

    const result = replaceIdsInDocument(doc, longToShort);

    expect(result).not.toBe(doc);
    expect(doc.objects[0]!.ch![0]!.id).toBe('button_0_0'); // оригинал не изменён
  });

  it('документ без objects — возвращает как есть', () => {
    const emptyDoc = { vsl_version: '1.0' } as unknown as VslDocument;
    const longToShort = new Map<string, string>();

    const result = replaceIdsInDocument(emptyDoc, longToShort);

    expect(result).toBe(emptyDoc);
  });

  it('обрабатывает iframe объекты', () => {
    const docWithIframe: VslDocument = {
      ...doc,
      objects: [
        {
          id: 'iframe_0',
          t: 'iframe' as VslObject['t'],
          txt: 'iframe',
          p: [0, 0],
          s: [200, 300],
          iframe: {
            url: 'https://example.com',
            frameId: 0,
            vsl: {
              vsl_version: '1.0',
              canvas: doc.canvas,
              objects: [makeObj('button_0_0')],
            },
          },
        },
      ],
    };

    const longToShort = new Map<string, string>([
      ['iframe_0', 'ifr_0'],
      ['button_0_0', 'btn_0'],
    ]);

    const result = replaceIdsInDocument(docWithIframe, longToShort);

    expect(result.objects[0]!.id).toBe('ifr_0');
    expect(result.objects[0]!.iframe!.vsl.objects[0]!.id).toBe('btn_0');
  });
});

describe('replaceIdsInDiff', () => {
  const diff: VslDiff = {
    diff_version: 2,
    base_version: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    changes: {
      added: [makeObj('button_0_0')],
      modified: [{ id: 'input_0_1', txt: 'updated' }],
      removed: [{ id: 'div_0_2' }],
      unchanged_refs: ['a_0_3'],
    },
  };

  it('заменяет ID в added, modified, removed, unchanged_refs', () => {
    const reverseIdMap = new Map<string, string>([
      ['button_0_0', 'btn_0'],
      ['input_0_1', 'inp_0'],
      ['div_0_2', 'div_0'],
      ['a_0_3', 'a_0'],
    ]);

    const result = replaceIdsInDiff(diff, reverseIdMap);

    expect(result.changes.added[0]!.id).toBe('btn_0');
    expect(result.changes.modified[0]!.id).toBe('inp_0');
    expect(result.changes.removed[0]!.id).toBe('div_0');
    expect(result.changes.unchanged_refs[0]).toBe('a_0');
  });

  it('не мутирует исходный дифф', () => {
    const reverseIdMap = new Map<string, string>([
      ['button_0_0', 'btn_0'],
    ]);

    const result = replaceIdsInDiff(diff, reverseIdMap);

    expect(result).not.toBe(diff);
    expect(diff.changes.added[0]!.id).toBe('button_0_0'); // оригинал не изменён
  });

  it('diff без changes — возвращает как есть', () => {
    const emptyDiff = { diff_version: 1, base_version: 0, timestamp: '' } as unknown as VslDiff;
    const reverseIdMap = new Map<string, string>();

    const result = replaceIdsInDiff(emptyDiff, reverseIdMap);

    expect(result).toBe(emptyDiff);
  });
});

describe('resolveShortId', () => {
  it('резолвит короткий ID в длинный', () => {
    const shortToLong = new Map<string, string>([
      ['btn_0', 'button_0_0'],
      ['inp_0', 'input_0_1'],
    ]);

    expect(resolveShortId('btn_0', shortToLong)).toBe('button_0_0');
    expect(resolveShortId('inp_0', shortToLong)).toBe('input_0_1');
  });

  it('возвращает undefined для неизвестного ID', () => {
    const shortToLong = new Map<string, string>([
      ['btn_0', 'button_0_0'],
    ]);

    expect(resolveShortId('unknown_0', shortToLong)).toBeUndefined();
  });
});

describe('resolveShortIdOrThrow', () => {
  it('резолвит короткий ID в длинный', () => {
    const shortToLong = new Map<string, string>([
      ['btn_0', 'button_0_0'],
    ]);

    expect(resolveShortIdOrThrow('btn_0', shortToLong)).toBe('button_0_0');
  });

  it('бросает ошибку для неизвестного ID', () => {
    const shortToLong = new Map<string, string>([
      ['btn_0', 'button_0_0'],
    ]);

    expect(() => resolveShortIdOrThrow('unknown_0', shortToLong)).toThrow(
      'Unknown short VSL ID: unknown_0'
    );
  });

  it('ошибка содержит список доступных ID', () => {
    const shortToLong = new Map<string, string>([
      ['btn_0', 'button_0_0'],
      ['inp_0', 'input_0_1'],
    ]);

    expect(() => resolveShortIdOrThrow('unknown_0', shortToLong)).toThrow(
      /Available: btn_0, inp_0/
    );
  });
});