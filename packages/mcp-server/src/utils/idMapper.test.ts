import { describe, it, expect } from '@jest/globals';
import type { VslObject } from '@thinkingos/vsl-sdk';
import {
  buildIdMap,
  buildReverseIdMap,
  replaceIdsInDocument,
  replaceIdsInDiff,
  resolveShortId,
  resolveShortIdOrThrow,
} from './idMapper';

function makeObj(id: string, children?: VslObject[]): VslObject {
  const obj: VslObject = { id, t: id.split('_')[0] };
  if (children) obj.ch = children;
  return obj;
}

describe('idMapper', () => {
  describe('buildIdMap', () => {
    it('создаёт карту shortId→longId для плоского списка', () => {
      const objects: VslObject[] = [
        makeObj('button_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_4'),
        makeObj('input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0'),
        makeObj('div_0_1'),
        makeObj('a_0_1_0'),
      ];

      const map = buildIdMap(objects);

      expect(map.size).toBe(4);
      // Первые элементы каждого типа получают счётчик 0
      expect(map.get('btn_0')).toBe('button_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_4');
      expect(map.get('inp_0')).toBe('input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0');
      expect(map.get('div_0')).toBe('div_0_1');
      expect(map.get('a_0')).toBe('a_0_1_0');
    });

    it('инкрементирует счётчик per-prefix для нескольких элементов одного типа', () => {
      const objects: VslObject[] = [
        makeObj('button_0'),
        makeObj('button_0_0'),
        makeObj('button_0_1'),
        makeObj('div_0'),
        makeObj('button_0_2'),
      ];

      const map = buildIdMap(objects);

      expect(map.size).toBe(5);
      expect(map.get('btn_0')).toBe('button_0');
      expect(map.get('btn_1')).toBe('button_0_0');
      expect(map.get('btn_2')).toBe('button_0_1');
      expect(map.get('div_0')).toBe('div_0');
      expect(map.get('btn_3')).toBe('button_0_2');
    });

    it('рекурсивно обходит потомков (ch)', () => {
      const objects: VslObject[] = [
        makeObj('div_0', [
          makeObj('button_0_0', [
            makeObj('a_0_0_0'),
          ]),
          makeObj('input_0_1'),
        ]),
        makeObj('div_1'),
      ];

      const map = buildIdMap(objects);

      expect(map.size).toBe(5);
      expect(map.get('div_0')).toBe('div_0');
      expect(map.get('btn_0')).toBe('button_0_0');
      expect(map.get('a_0')).toBe('a_0_0_0');
      expect(map.get('inp_0')).toBe('input_0_1');
      expect(map.get('div_1')).toBe('div_1');
    });

    it('возвращает пустую карту для пустого списка', () => {
      const map = buildIdMap([]);
      expect(map.size).toBe(0);
    });

    it('обрабатывает теги с underscore (file_input)', () => {
      const objects: VslObject[] = [
        makeObj('file_input_0'),
        makeObj('file_input_0_1'),
      ];

      const map = buildIdMap(objects);

      expect(map.size).toBe(2);
      // file_input → префикс "fil" (первые 3 символа)
      expect(map.get('fil_0')).toBe('file_input_0');
      expect(map.get('fil_1')).toBe('file_input_0_1');
    });

    it('использует base36 для счётчиков > 9', () => {
      const objects: VslObject[] = Array.from({ length: 12 }, (_, i) =>
        makeObj(`button_${i}`)
      );

      const map = buildIdMap(objects);

      expect(map.size).toBe(12);
      expect(map.get('btn_0')).toBe('button_0');
      expect(map.get('btn_9')).toBe('button_9');
      expect(map.get('btn_a')).toBe('button_10'); // 10 в base36 = 'a'
      expect(map.get('btn_b')).toBe('button_11'); // 11 в base36 = 'b'
    });
  });

  describe('buildReverseIdMap', () => {
    it('создаёт обратную карту longId→shortId', () => {
      const objects: VslObject[] = [
        makeObj('button_0'),
        makeObj('div_0_1'),
      ];

      const reverse = buildReverseIdMap(objects);

      expect(reverse.size).toBe(2);
      expect(reverse.get('button_0')).toBe('btn_0');
      expect(reverse.get('div_0_1')).toBe('div_0');
    });
  });

  describe('replaceIdsInDocument', () => {
    it('заменяет длинные ID на короткие в документе', () => {
      const objects: VslObject[] = [
        makeObj('button_0', [
          makeObj('a_0_0'),
        ]),
        makeObj('div_0_1'),
      ];

      const longToShort = buildReverseIdMap(objects);
      const doc = { objects };
      const replaced = replaceIdsInDocument(doc, longToShort);

      expect(replaced.objects![0]!.id).toBe('btn_0');
      expect(replaced.objects![0]!.ch![0]!.id).toBe('a_0');
      expect(replaced.objects![1]!.id).toBe('div_0');
    });

    it('не мутирует исходный документ', () => {
      const objects: VslObject[] = [makeObj('button_0')];
      const longToShort = buildReverseIdMap(objects);
      const doc = { objects };

      replaceIdsInDocument(doc, longToShort);

      expect(doc.objects[0]!.id).toBe('button_0'); // оригинал не изменён
    });

    it('возвращает документ без изменений если objects отсутствует', () => {
      const doc = { title: 'test' };
      const result = replaceIdsInDocument(doc, new Map());
      expect(result).toEqual(doc);
    });
  });

  describe('replaceIdsInDiff', () => {
    it('заменяет длинные ID на короткие в added объектах', () => {
      const objects: VslObject[] = [
        makeObj('button_0'),
        makeObj('div_0_1'),
        makeObj('a_0_1_0'),
      ];
      const longToShort = buildReverseIdMap(objects);
      const diff = {
        changes: {
          added: [
            { id: 'button_0', t: 'button' },
            { id: 'div_0_1', t: 'div', ch: [makeObj('a_0_1_0')] },
          ],
        },
      };

      const replaced = replaceIdsInDiff(diff, longToShort);

      expect(replaced.changes!.added![0]!.id).toBe('btn_0');
      expect(replaced.changes!.added![1]!.id).toBe('div_0');
      expect(replaced.changes!.added![1]!.ch![0]!.id).toBe('a_0');
    });

    it('заменяет длинные ID на короткие в modified объектах', () => {
      const objects: VslObject[] = [makeObj('button_0')];
      const longToShort = buildReverseIdMap(objects);
      const diff = {
        changes: {
          modified: [{ id: 'button_0', txt: 'Новый текст' }],
        },
      };

      const replaced = replaceIdsInDiff(diff, longToShort);

      expect(replaced.changes!.modified![0]!.id).toBe('btn_0');
      expect(replaced.changes!.modified![0]!.txt).toBe('Новый текст');
    });

    it('заменяет длинные ID на короткие в removed объектах', () => {
      const objects: VslObject[] = [makeObj('button_0')];
      const longToShort = buildReverseIdMap(objects);
      const diff = {
        changes: {
          removed: [{ id: 'button_0' }],
        },
      };

      const replaced = replaceIdsInDiff(diff, longToShort);

      expect(replaced.changes!.removed![0]!.id).toBe('btn_0');
    });

    it('заменяет длинные ID на короткие в unchanged_refs', () => {
      const objects: VslObject[] = [
        makeObj('button_0'),
        makeObj('div_0_1'),
      ];
      const longToShort = buildReverseIdMap(objects);
      const diff = {
        changes: {
          unchanged_refs: ['button_0', 'div_0_1'],
        },
      };

      const replaced = replaceIdsInDiff(diff, longToShort);

      expect(replaced.changes!.unchanged_refs).toEqual(['btn_0', 'div_0']);
    });

    it('не мутирует исходный дифф', () => {
      const objects: VslObject[] = [makeObj('button_0')];
      const longToShort = buildReverseIdMap(objects);
      const diff = {
        changes: {
          added: [{ id: 'button_0', t: 'button' }],
          modified: [{ id: 'button_0', txt: 'Текст' }],
          removed: [{ id: 'button_0' }],
          unchanged_refs: ['button_0'],
        },
      };

      replaceIdsInDiff(diff, longToShort);

      expect(diff.changes.added[0]!.id).toBe('button_0');
      expect(diff.changes.modified[0]!.id).toBe('button_0');
      expect(diff.changes.removed[0]!.id).toBe('button_0');
      expect(diff.changes.unchanged_refs[0]).toBe('button_0');
    });

    it('возвращает дифф без изменений если changes отсутствует', () => {
      const diff = {};
      const result = replaceIdsInDiff(diff, new Map());
      expect(result).toEqual(diff);
    });
  });

  describe('resolveShortId', () => {
    it('резолвит короткий ID в длинный', () => {
      const map = new Map([['btn_0', 'button_0_0_0_2']]);
      expect(resolveShortId('btn_0', map)).toBe('button_0_0_0_2');
    });

    it('возвращает undefined для неизвестного ID', () => {
      const map = new Map([['btn_0', 'button_0']]);
      expect(resolveShortId('btn_99', map)).toBeUndefined();
    });
  });

  describe('resolveShortIdOrThrow', () => {
    it('резолвит короткий ID в длинный', () => {
      const map = new Map([['btn_0', 'button_0']]);
      expect(resolveShortIdOrThrow('btn_0', map)).toBe('button_0');
    });

    it('бросает ошибку для неизвестного ID', () => {
      const map = new Map([['btn_0', 'button_0']]);
      expect(() => resolveShortIdOrThrow('btn_99', map)).toThrow('Unknown short VSL ID: btn_99');
    });
  });

  describe('iframe support', () => {
    function makeIframeObj(
      id: string,
      frameId: number,
      iframeObjects: VslObject[]
    ): VslObject {
      return {
        id,
        t: 'iframe',
        iframe: {
          url: `https://example.com/frame-${frameId}`,
          frameId,
          vsl: { objects: iframeObjects },
        },
      };
    }

    it('buildIdMap: элементы внутри iframe получают короткие ID с frame prefix', () => {
      const objects: VslObject[] = [
        makeObj('div_0'),
        makeIframeObj('iframe_0', 0, [
          makeObj('button_0_0'),
          makeObj('span_0_1'),
        ]),
      ];

      const map = buildIdMap(objects);

      // Обычные элементы вне iframe
      expect(map.get('div_0')).toBe('div_0');
      // Iframe object сам по себе
      expect(map.get('ifr_0')).toBe('iframe_0');
      // Элементы внутри iframe получают frame prefix
      expect(map.get('iframe_0:btn_0')).toBe('button_0_0');
      expect(map.get('iframe_0:spn_0')).toBe('span_0_1');
    });

    it('buildIdMap: вложенные children внутри iframe также получают frame prefix', () => {
      const objects: VslObject[] = [
        makeIframeObj('iframe_0', 0, [
          makeObj('div_0_0', [
            makeObj('button_0_0_0'),
            makeObj('a_0_0_1'),
          ]),
        ]),
      ];

      const map = buildIdMap(objects);

      expect(map.get('iframe_0:div_0')).toBe('div_0_0');
      expect(map.get('iframe_0:btn_0')).toBe('button_0_0_0');
      expect(map.get('iframe_0:a_0')).toBe('a_0_0_1');
    });

    it('buildIdMap: несколько iframe получают разные frame prefix', () => {
      const objects: VslObject[] = [
        makeIframeObj('iframe_0', 0, [
          makeObj('button_0_0'),
        ]),
        makeIframeObj('iframe_1', 1, [
          makeObj('button_0_1'),
        ]),
      ];

      const map = buildIdMap(objects);

      // Первый iframe: btn счётчик = 0
      expect(map.get('iframe_0:btn_0')).toBe('button_0_0');
      // Второй iframe: btn счётчик = 1 (глобальный счётчик продолжается)
      expect(map.get('iframe_1:btn_1')).toBe('button_0_1');
      // Убедимся, что iframe_1:btn_0 НЕ существует (счётчик уже был 1)
      expect(map.has('iframe_1:btn_0')).toBe(false);
    });

    it('buildIdMap: обычные элементы вне iframe не получают frame prefix', () => {
      const objects: VslObject[] = [
        makeObj('button_0'),
        makeIframeObj('iframe_0', 0, [
          makeObj('div_0_0'),
        ]),
        makeObj('button_1'),
      ];

      const map = buildIdMap(objects);

      // Обычные элементы без prefix
      expect(map.get('btn_0')).toBe('button_0');
      expect(map.get('btn_1')).toBe('button_1');
      // Iframe элементы с prefix
      expect(map.get('iframe_0:div_0')).toBe('div_0_0');
      // Убедимся, что обычные элементы НЕ имеют iframe prefix
      expect(map.has('iframe_0:btn_0')).toBe(false);
      expect(map.has('iframe_0:btn_1')).toBe(false);
    });

    it('buildReverseIdMap: создаёт обратную карту для iframe элементов', () => {
      const objects: VslObject[] = [
        makeIframeObj('iframe_0', 0, [
          makeObj('button_0_0'),
        ]),
      ];

      const reverse = buildReverseIdMap(objects);

      expect(reverse.get('button_0_0')).toBe('iframe_0:btn_0');
    });

    it('replaceIdsInDocument: заменяет ID в iframe.vsl.objects', () => {
      const objects: VslObject[] = [
        makeIframeObj('iframe_0', 0, [
          makeObj('button_0_0'),
          makeObj('span_0_1'),
        ]),
      ];

      const longToShort = buildReverseIdMap(objects);
      const doc = { objects };
      const replaced = replaceIdsInDocument(doc, longToShort);

      // Iframe object сам
      expect(replaced.objects![0]!.id).toBe('ifr_0');
      // Элементы внутри iframe
      const iframeVslObjects = replaced.objects![0]!.iframe!.vsl.objects;
      expect(iframeVslObjects[0]!.id).toBe('iframe_0:btn_0');
      expect(iframeVslObjects[1]!.id).toBe('iframe_0:spn_0');
    });

    it('replaceIdsInDocument: не мутирует исходный документ с iframe', () => {
      const objects: VslObject[] = [
        makeIframeObj('iframe_0', 0, [
          makeObj('button_0_0'),
        ]),
      ];

      const longToShort = buildReverseIdMap(objects);
      const doc = { objects };

      replaceIdsInDocument(doc, longToShort);

      // Оригинальные ID не изменены
      expect(doc.objects[0]!.id).toBe('iframe_0');
      expect(doc.objects[0]!.iframe!.vsl.objects[0]!.id).toBe('button_0_0');
    });

    it('replaceIdsInDiff: заменяет ID в added objects с iframe', () => {
      const objects: VslObject[] = [
        makeIframeObj('iframe_0', 0, [
          makeObj('button_0_0'),
        ]),
      ];
      const longToShort = buildReverseIdMap(objects);
      const diff = {
        changes: {
          added: [
            makeIframeObj('iframe_0', 0, [
              makeObj('button_0_0'),
            ]),
          ],
        },
      };

      const replaced = replaceIdsInDiff(diff, longToShort);

      expect(replaced.changes!.added![0]!.id).toBe('ifr_0');
      expect(replaced.changes!.added![0]!.iframe!.vsl.objects[0]!.id).toBe('iframe_0:btn_0');
    });
  });
});