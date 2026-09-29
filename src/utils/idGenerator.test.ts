/**
 * Unit tests for IdGenerator and TYPE_ABBREVIATIONS.
 *
 * Test cases:
 *  - TYPE_ABBREVIATIONS: маппинг VSL типов в сокращения
 *  - IdGenerator.generate(): приоритет DOM id + fallback с per-type counter
 *  - IdGenerator.reset(): сброс счётчиков
 *  - IdGenerator.getCounter(): получение значения счётчика
 *  - createIdGenerator(): factory function
 */

import { describe, it, expect } from '@jest/globals';
import {
  TYPE_ABBREVIATIONS,
  IdGenerator,
  createIdGenerator,
} from './idGenerator';

describe('TYPE_ABBREVIATIONS', () => {
  it('содержит сокращения для всех основных VSL типов', () => {
    expect(TYPE_ABBREVIATIONS['button']).toBe('btn');
    expect(TYPE_ABBREVIATIONS['input']).toBe('inp');
    expect(TYPE_ABBREVIATIONS['link']).toBe('link');
    expect(TYPE_ABBREVIATIONS['container']).toBe('cont');
    expect(TYPE_ABBREVIATIONS['image']).toBe('img');
    expect(TYPE_ABBREVIATIONS['select']).toBe('sel');
    expect(TYPE_ABBREVIATIONS['textarea']).toBe('txt');
    expect(TYPE_ABBREVIATIONS['heading']).toBe('h');
    expect(TYPE_ABBREVIATIONS['text']).toBe('txt');
    expect(TYPE_ABBREVIATIONS['file_input']).toBe('file');
    expect(TYPE_ABBREVIATIONS['modal']).toBe('modal');
    expect(TYPE_ABBREVIATIONS['tab']).toBe('tab');
    expect(TYPE_ABBREVIATIONS['dropdown_toggle']).toBe('dropdown');
    expect(TYPE_ABBREVIATIONS['footer']).toBe('footer');
    expect(TYPE_ABBREVIATIONS['scrollable_container']).toBe('scroll');
    expect(TYPE_ABBREVIATIONS['toolbar']).toBe('toolbar');
    expect(TYPE_ABBREVIATIONS['list']).toBe('list');
    expect(TYPE_ABBREVIATIONS['grid']).toBe('grid');
    expect(TYPE_ABBREVIATIONS['form_field']).toBe('form');
    expect(TYPE_ABBREVIATIONS['tab_bar']).toBe('tabs');
    expect(TYPE_ABBREVIATIONS['layout']).toBe('layout');
    expect(TYPE_ABBREVIATIONS['nav']).toBe('nav');
    expect(TYPE_ABBREVIATIONS['header']).toBe('header');
    expect(TYPE_ABBREVIATIONS['main']).toBe('main');
    expect(TYPE_ABBREVIATIONS['icon']).toBe('icon');
    expect(TYPE_ABBREVIATIONS['chart']).toBe('chart');
    expect(TYPE_ABBREVIATIONS['custom_widget']).toBe('widget');
    expect(TYPE_ABBREVIATIONS['unknown']).toBe('el');
  });

});

describe('IdGenerator', () => {
  describe('generate()', () => {
    it('использует DOM id если он есть (приоритет 1)', () => {
      const gen = new IdGenerator();
      expect(gen.generate('my-button', 'button')).toBe('my-button');
      expect(gen.generate('submit-form', 'button')).toBe('submit-form');
      expect(gen.generate('nav-main', 'nav')).toBe('nav-main');
    });

    it('игнорирует пустой DOM id', () => {
      const gen = new IdGenerator();
      expect(gen.generate('', 'button')).toBe('btn_1');
      expect(gen.generate('   ', 'button')).toBe('btn_2');
    });

    it('игнорирует null/undefined DOM id', () => {
      const gen = new IdGenerator();
      expect(gen.generate(null, 'button')).toBe('btn_1');
      expect(gen.generate(undefined, 'button')).toBe('btn_2');
    });

    it('генерирует короткие ID с per-type counter (fallback)', () => {
      const gen = new IdGenerator();
      expect(gen.generate(null, 'button')).toBe('btn_1');
      expect(gen.generate(null, 'button')).toBe('btn_2');
      expect(gen.generate(null, 'button')).toBe('btn_3');
    });

    it('per-type counter: разные типы имеют независимые счётчики', () => {
      const gen = new IdGenerator();
      expect(gen.generate(null, 'button')).toBe('btn_1');
      expect(gen.generate(null, 'input')).toBe('inp_1');
      expect(gen.generate(null, 'link')).toBe('link_1');
      expect(gen.generate(null, 'container')).toBe('cont_1');
      expect(gen.generate(null, 'button')).toBe('btn_2');
      expect(gen.generate(null, 'input')).toBe('inp_2');
    });

    it('использует сокращения из TYPE_ABBREVIATIONS', () => {
      const gen = new IdGenerator();
      expect(gen.generate(null, 'file_input')).toBe('file_1');
      expect(gen.generate(null, 'tab_bar')).toBe('tabs_1');
      expect(gen.generate(null, 'form_field')).toBe('form_1');
      expect(gen.generate(null, 'scrollable_container')).toBe('scroll_1');
      expect(gen.generate(null, 'custom_widget')).toBe('widget_1');
    });

    it('использует "el" для неизвестных типов', () => {
      const gen = new IdGenerator();
      expect(gen.generate(null, 'nonexistent_type')).toBe('el_1');
      expect(gen.generate(null, 'another_unknown')).toBe('el_2');
    });

    it('использует "el" для null типа', () => {
      const gen = new IdGenerator();
      expect(gen.generate(null, null)).toBe('el_1');
    });
  });

  describe('reset()', () => {
    it('сбрасывает все счётчики', () => {
      const gen = new IdGenerator();
      gen.generate(null, 'button');
      gen.generate(null, 'button');
      gen.generate(null, 'input');

      gen.reset();

      // После сброса счётчики начинаются заново
      expect(gen.generate(null, 'button')).toBe('btn_1');
      expect(gen.generate(null, 'input')).toBe('inp_1');
    });

    it('полный сброс — все типы обнуляются', () => {
      const gen = new IdGenerator();
      gen.generate(null, 'button');
      gen.generate(null, 'input');
      gen.generate(null, 'link');

      gen.reset();

      expect(gen.getCounter()).toBe(0);
    });
  });

  describe('getCounter()', () => {
    it('возвращает 0 для нового генератора', () => {
      const gen = new IdGenerator();
      expect(gen.getCounter()).toBe(0);
    });

    it('возвращает общий счётчик (сумма всех типов)', () => {
      const gen = new IdGenerator();
      gen.generate(null, 'button');
      gen.generate(null, 'button');
      gen.generate(null, 'input');

      expect(gen.getCounter()).toBe(3);
    });

    it('возвращает счётчик для конкретного типа', () => {
      const gen = new IdGenerator();
      gen.generate(null, 'button');
      gen.generate(null, 'button');
      gen.generate(null, 'input');

      expect(gen.getCounter('btn')).toBe(2);
      expect(gen.getCounter('inp')).toBe(1);
      expect(gen.getCounter('link')).toBe(0);
    });

    it('возвращает 0 для неизвестного типа', () => {
      const gen = new IdGenerator();
      expect(gen.getCounter('nonexistent')).toBe(0);
    });
  });
});

describe('createIdGenerator()', () => {
  it('создаёт новый экземпляр IdGenerator', () => {
    const gen = createIdGenerator();
    expect(gen).toBeInstanceOf(IdGenerator);
  });

  it('каждый вызов создаёт независимый генератор', () => {
    const gen1 = createIdGenerator();
    const gen2 = createIdGenerator();

    gen1.generate(null, 'button');
    gen1.generate(null, 'button');

    // gen2 не зависит от gen1
    expect(gen2.generate(null, 'button')).toBe('btn_1');
    expect(gen1.generate(null, 'button')).toBe('btn_3');
  });
});