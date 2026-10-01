/**
 * Unit tests for ID stability after DOM changes (fix: ID reassignment после fill).
 *
 * Test cases:
 *  - ID не меняются для элементов, которые остались в DOM после перестроения snapshot
 *  - Новые элементы получают новые ID, не конфликтуя со старыми
 *  - Удалённые элементы не занимают ID новых элементов
 */

import { describe, it, expect } from '@jest/globals';
import { buildIdMap, buildReverseIdMap } from './idMapper.js';
import type { VslObject } from '@thinkingos/vsl-sdk';

describe('idMapper — ID stability after DOM changes', () => {
  // Вспомогательная функция для создания VslObject
  function makeObj(id: string, tag: string): VslObject {
    return {
      id,
      t: tag as VslObject['t'],
      bbox: [0, 0, 100, 30],
    } as VslObject;
  }

  describe('buildIdMap with previousReverseIdMap', () => {
    it('сохраняет старые ID для элементов, которые остались в DOM', () => {
      // Initial snapshot: 3 элемента
      const initialObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
        makeObj('div_0_0', 'div'),
      ];

      // Строим initial reverseIdMap
      const initialReverseMap = buildReverseIdMap(initialObjects);
      // button_0_0 → btn_0, input_0_0 → inp_0, div_0_0 → div_0
      expect(initialReverseMap.get('button_0_0')).toBe('btn_0');
      expect(initialReverseMap.get('input_0_0')).toBe('inp_0');
      expect(initialReverseMap.get('div_0_0')).toBe('div_0');

      // After fill: DOM изменился, но те же элементы остались
      // (порядок может измениться из-за добавления новых элементов)
      const afterFillObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
        makeObj('div_0_0', 'div'),
        makeObj('span_0_0', 'span'), // новый элемент
      ];

      // Строим новый idMap с previousReverseIdMap
      const newIdMap = buildIdMap(afterFillObjects, initialReverseMap);

      // Старые элементы должны сохранить свои ID
      expect(newIdMap.get('btn_0')).toBe('button_0_0');
      expect(newIdMap.get('inp_0')).toBe('input_0_0');
      expect(newIdMap.get('div_0')).toBe('div_0_0');
      // Новый элемент получает новый ID
      expect(newIdMap.get('spn_0')).toBe('span_0_0');
    });

    it('новые элементы не занимают ID удалённых элементов', () => {
      // Initial snapshot: 2 элемента
      const initialObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
      ];

      const initialReverseMap = buildReverseIdMap(initialObjects);
      expect(initialReverseMap.get('button_0_0')).toBe('btn_0');
      expect(initialReverseMap.get('input_0_0')).toBe('inp_0');

      // After action: input удалён, добавлен span
      const afterActionObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('span_0_0', 'span'),
      ];

      const newIdMap = buildIdMap(afterActionObjects, initialReverseMap);

      // button сохраняет ID
      expect(newIdMap.get('btn_0')).toBe('button_0_0');
      // span получает новый ID (spn_0, а не inp_0)
      expect(newIdMap.get('spn_0')).toBe('span_0_0');
      // inp_0 больше не в карте
      expect(newIdMap.get('inp_0')).toBeUndefined();
    });

    it('работает без previousReverseIdMap (первый snapshot)', () => {
      const objects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
      ];

      // Без previousReverseIdMap — обычное поведение
      const idMap = buildIdMap(objects);

      expect(idMap.get('btn_0')).toBe('button_0_0');
      expect(idMap.get('inp_0')).toBe('input_0_0');
    });

    it('обрабатывает ситуацию когда старый ID уже занят другим элементом', () => {
      // Initial snapshot
      const initialObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
      ];

      const initialReverseMap = buildReverseIdMap(initialObjects);
      // button_0_0 → btn_0, input_0_0 → inp_0

      // After action: элементы поменялись местами в DOM,
      // но первый button теперь имеет другой longId
      const afterActionObjects = [
        makeObj('button_1_0', 'button'), // новый button, но хочет btn_0
        makeObj('button_0_0', 'button'), // старый button
      ];

      const newIdMap = buildIdMap(afterActionObjects, initialReverseMap);

      // button_0_0 сохраняет btn_0 (он был в previousReverseIdMap)
      expect(newIdMap.get('btn_0')).toBe('button_0_0');
      // button_1_0 получает следующий доступный ID (btn_1)
      expect(newIdMap.get('btn_1')).toBe('button_1_0');
    });

    it('сохраняет ID для iframe элементов', () => {
      // Initial snapshot с iframe
      const initialObjects = [
        {
          id: 'iframe_0',
          t: 'iframe' as const,
          bbox: [0, 0, 300, 200],
          iframe: {
            url: 'https://example.com/iframe',
            frameId: 0,
            vsl: {
              objects: [
                makeObj('button_0_0', 'button'),
                makeObj('input_0_0', 'input'),
              ],
            },
          },
        } as unknown as VslObject,
      ];

      const initialReverseMap = buildReverseIdMap(initialObjects);
      // iframe элементы имеют frame prefix
      expect(initialReverseMap.get('button_0_0')).toBe('iframe_0:btn_0');
      expect(initialReverseMap.get('input_0_0')).toBe('iframe_0:inp_0');

      // After action: те же элементы в iframe
      const afterActionObjects = [
        {
          id: 'iframe_0',
          t: 'iframe' as const,
          bbox: [0, 0, 300, 200],
          iframe: {
            url: 'https://example.com/iframe',
            frameId: 0,
            vsl: {
              objects: [
                makeObj('button_0_0', 'button'),
                makeObj('input_0_0', 'input'),
                makeObj('span_0_0', 'span'), // новый
              ],
            },
          },
        } as unknown as VslObject,
      ];

      const newIdMap = buildIdMap(afterActionObjects, initialReverseMap);

      // Старые iframe элементы сохраняют ID с frame prefix
      expect(newIdMap.get('iframe_0:btn_0')).toBe('button_0_0');
      expect(newIdMap.get('iframe_0:inp_0')).toBe('input_0_0');
      // Новый элемент получает новый ID
      expect(newIdMap.get('iframe_0:spn_0')).toBe('span_0_0');
    });
  });

  describe('buildReverseIdMap with previousReverseIdMap', () => {
    it('передаёт previousReverseIdMap в buildIdMap', () => {
      const initialObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
      ];

      const initialReverseMap = buildReverseIdMap(initialObjects);

      const afterActionObjects = [
        makeObj('button_0_0', 'button'),
        makeObj('input_0_0', 'input'),
        makeObj('div_0_0', 'div'),
      ];

      const newReverseMap = buildReverseIdMap(afterActionObjects, initialReverseMap);

      // Старые элементы сохраняют ID
      expect(newReverseMap.get('button_0_0')).toBe('btn_0');
      expect(newReverseMap.get('input_0_0')).toBe('inp_0');
      // Новый элемент
      expect(newReverseMap.get('div_0_0')).toBe('div_0');
    });
  });
});