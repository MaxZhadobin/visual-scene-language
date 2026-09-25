/**
 * Дифференциальные тесты nodeCryptoShim (M1.4, note_1790141280420):
 * чистый JS sha256 для browser-бандлов extension обязан давать те же дайджесты,
 * что node:crypto (источник истины в Node-среде jest). Покрытие: векторы FIPS
 * 180-4, границы паддинга (0..130 байт ASCII — перекрывают 55/56/63/64/65),
 * мультибайтные UTF-8 строки (кириллица, эмодзи, суррогатные пары), длинные
 * строки (много 512-битных блоков), чейнинг update, отклонение
 * неподдерживаемых алгоритмов/кодировок.
 */
import { createHash as nodeCreateHash } from 'node:crypto';

import { createHash as shimCreateHash } from '../../extension/src/nodeCryptoShim';

const shimHex = (input: string): string =>
  shimCreateHash('sha256').update(input).digest('hex');

const nodeHex = (input: string): string =>
  nodeCreateHash('sha256').update(input).digest('hex');

describe('extension/src/nodeCryptoShim.ts — sha256 для browser-бандлов (note_1790141280420)', () => {
  it('известные векторы FIPS 180-4', () => {
    expect(shimHex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(shimHex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(shimHex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('эквивалентность node:crypto на границах паддинга (0..130 байт ASCII)', () => {
    for (let length = 0; length <= 130; length += 1) {
      const input = 'x'.repeat(length);
      expect(shimHex(input)).toBe(nodeHex(input));
    }
  });

  it('эквивалентность node:crypto на мультибайтных UTF-8 строках', () => {
    const inputs = [
      'привет мир',
      'VSL: снапшот страницы 🚀',
      'emoji 👨‍👩‍👧‍👦 family',
      'смешанный mixed текст with ASCII and 中文',
    ];
    for (const input of inputs) {
      expect(shimHex(input)).toBe(nodeHex(input));
    }
  });

  it('эквивалентность node:crypto на длинных строках (много 512-битных блоков)', () => {
    const input = 'vsl-cache-key-'.repeat(1000);
    expect(shimHex(input)).toBe(nodeHex(input));
  });

  it('чейнинг update эквивалентен node:crypto', () => {
    expect(
      shimCreateHash('sha256').update('a').update('b').update('c').digest('hex'),
    ).toBe(nodeCreateHash('sha256').update('a').update('b').update('c').digest('hex'));
  });

  it('неподдерживаемый алгоритм/кодировка — понятная ошибка (runtime-строки на английском)', () => {
    expect(() => shimCreateHash('md5')).toThrow('unsupported algorithm "md5"');
    expect(() => shimCreateHash('sha256').update('x').digest('base64')).toThrow(
      'unsupported digest encoding "base64"',
    );
  });
});