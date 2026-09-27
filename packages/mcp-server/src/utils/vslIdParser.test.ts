/**
 * Unit tests for parseVslId() utility function.
 *
 * Test cases:
 *  - Простые теги без underscore (button, input, link)
 *  - Теги с underscore (file_input, dropdown_toggle, custom_widget)
 *  - Различные глубины indexPath (1, 2, 3+ уровня)
 *  - Невалидные ID (без чисел, пустая строка, только tag)
 *  - Edge cases (граничные значения)
 */

import { describe, it, expect } from '@jest/globals';
import { parseVslId } from './vslIdParser.js';

describe('parseVslId', () => {
  describe('простые теги без underscore', () => {
    it('парсит button_0_1', () => {
      const result = parseVslId('button_0_1');
      expect(result).toEqual({
        tag: 'button',
        indexPath: [0, 1],
      });
    });

    it('парсит input_0', () => {
      const result = parseVslId('input_0');
      expect(result).toEqual({
        tag: 'input',
        indexPath: [0],
      });
    });

    it('парсит link_2_3_4', () => {
      const result = parseVslId('link_2_3_4');
      expect(result).toEqual({
        tag: 'link',
        indexPath: [2, 3, 4],
      });
    });

    it('парсит container_0_1_2_3', () => {
      const result = parseVslId('container_0_1_2_3');
      expect(result).toEqual({
        tag: 'container',
        indexPath: [0, 1, 2, 3],
      });
    });
  });

  describe('теги с underscore', () => {
    it('парсит file_input_0_1', () => {
      const result = parseVslId('file_input_0_1');
      expect(result).toEqual({
        tag: 'file_input',
        indexPath: [0, 1],
      });
    });

    it('парсит dropdown_toggle_2_3', () => {
      const result = parseVslId('dropdown_toggle_2_3');
      expect(result).toEqual({
        tag: 'dropdown_toggle',
        indexPath: [2, 3],
      });
    });

    it('парсит scrollable_container_0_1_2', () => {
      const result = parseVslId('scrollable_container_0_1_2');
      expect(result).toEqual({
        tag: 'scrollable_container',
        indexPath: [0, 1, 2],
      });
    });

    it('парсит form_field_5', () => {
      const result = parseVslId('form_field_5');
      expect(result).toEqual({
        tag: 'form_field',
        indexPath: [5],
      });
    });

    it('парсит tab_bar_1_2', () => {
      const result = parseVslId('tab_bar_1_2');
      expect(result).toEqual({
        tag: 'tab_bar',
        indexPath: [1, 2],
      });
    });

    it('парсит custom_widget_2_3_4', () => {
      const result = parseVslId('custom_widget_2_3_4');
      expect(result).toEqual({
        tag: 'custom_widget',
        indexPath: [2, 3, 4],
      });
    });
  });

  describe('различные глубины indexPath', () => {
    it('парсит один индекс (корневой элемент)', () => {
      const result = parseVslId('button_0');
      expect(result).toEqual({
        tag: 'button',
        indexPath: [0],
      });
    });

    it('парсит два индекса', () => {
      const result = parseVslId('input_1_2');
      expect(result).toEqual({
        tag: 'input',
        indexPath: [1, 2],
      });
    });

    it('парсит три индекса', () => {
      const result = parseVslId('link_0_1_2');
      expect(result).toEqual({
        tag: 'link',
        indexPath: [0, 1, 2],
      });
    });

    it('парсит четыре индекса', () => {
      const result = parseVslId('container_0_1_2_3');
      expect(result).toEqual({
        tag: 'container',
        indexPath: [0, 1, 2, 3],
      });
    });

    it('парсит пять индексов', () => {
      const result = parseVslId('button_0_1_2_3_4');
      expect(result).toEqual({
        tag: 'button',
        indexPath: [0, 1, 2, 3, 4],
      });
    });
  });

  describe('невалидные ID', () => {
    it('возвращает null для строки без underscore', () => {
      expect(parseVslId('invalid')).toBeNull();
    });

    it('возвращает null для пустой строки', () => {
      expect(parseVslId('')).toBeNull();
    });

    it('возвращает null для ID только с tag (без чисел)', () => {
      expect(parseVslId('button')).toBeNull();
    });

    it('возвращает null для ID с нечисловыми индексами', () => {
      expect(parseVslId('button_abc')).toBeNull();
    });

    it('возвращает null для ID с mixed индексами', () => {
      expect(parseVslId('button_0_abc_1')).toBeNull();
    });

    it('возвращает null для ID начинающегося с числа', () => {
      expect(parseVslId('0_button_1')).toBeNull();
    });

    it('возвращает null для ID с trailing underscore', () => {
      expect(parseVslId('button_0_1_')).toBeNull();
    });

    it('возвращает null для ID с leading underscore', () => {
      expect(parseVslId('_button_0_1')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('парсит большие индексы', () => {
      const result = parseVslId('button_999_888_777');
      expect(result).toEqual({
        tag: 'button',
        indexPath: [999, 888, 777],
      });
    });

    it('парсит tag с несколькими underscore', () => {
      const result = parseVslId('my_custom_widget_0_1');
      expect(result).toEqual({
        tag: 'my_custom_widget',
        indexPath: [0, 1],
      });
    });

    it('парсит single-char tag', () => {
      const result = parseVslId('a_0');
      expect(result).toEqual({
        tag: 'a',
        indexPath: [0],
      });
    });

    it('парсит tag с цифрами в имени', () => {
      const result = parseVslId('h1_0_1');
      expect(result).toEqual({
        tag: 'h1',
        indexPath: [0, 1],
      });
    });
  });
});