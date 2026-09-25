/**
 * Браузерный шим node:crypto#createHash для бандлов extension (M1.4).
 *
 * Зачем: src/cache/cacheStore.ts (L21) импортирует createHash из 'node:crypto'
 * — sha256 для contentHash/coordHash (ARCHITECTURE.md §2.4/§5). В browser-iife
 * бандлах extension (tsup, format iife) esbuild эмитит top-level
 * `__require("crypto")`, который в Chrome бросает 'Dynamic require of "crypto"
 * is not supported' при загрузке — content script и service worker падают на
 * старте (note_1790141280420). Кэш+дифф обязаны жить в content script (dc_6),
 * поэтому хэш должен исполняться в браузере.
 *
 * Решение: esbuild alias 'node:crypto' → этот модуль (extension/tsup.config.ts).
 * Реализована ТОЛЬКО поверхность API, используемая cacheStore:
 * createHash('sha256').update(string).digest('hex'). Чистый JS sha256
 * (FIPS 180-4), без зависимостей, синхронный — WebCrypto.digest асинхронен
 * и несовместим с синхронным контрактом CacheStore (M1.2).
 *
 * Корректность гарантируется дифференциальным тестом против node:crypto
 * (tests/extension/nodeCryptoShim.test.ts): векторы FIPS, границы паддинга,
 * мультибайтные UTF-8 строки, чейнинг update. SDK (src/) не изменяется —
 * в Node используется нативный node:crypto.
 */

/** K-константы sha256 (FIPS 180-4: дробные части кубических корней первых 64 простых). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Начальные значения H (FIPS 180-4: дробные части квадратных корней первых 8 простых). */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/**
 * UTF-8 кодирование строки в байты (включая суррогатные пары).
 * Без TextEncoder — независимость от среды исполнения (браузер/Node/jsdom).
 */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i <input.length; i += 1) {
    let codePoint = input.charCodeAt(i);
    // Суррогатная пара: старшая 0xD800-0xDBFF + младшая 0xDC00-0xDFFF.
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 <input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * sha256 от байтов (FIPS 180-4): паддинг 0x80 + нули + 64-битная длина в битах
 * (big-endian), сжатие 512-битными блоками. Доступ к словам — через DataView
 * (методы возвращают number): проектный tsconfig strict + noUncheckedIndexedAccess
 * сделал бы индексированные чтения Uint32Array типом number | undefined.
 */
function sha256Bytes(bytes: Uint8Array): Uint8Array {
  // H и K копируются в новые буферы ЧЕРЕЗ DataView (big-endian setUint32):
  // конструктор Uint32Array пишет слова в native-endian порядке байтов буфера, а
  // все чтения ниже — big-endian; чтение нативно записанных констант через
  // big-endian View переставляло бы байты слов (поймано дифференциальным тестом).
  const h = new Uint32Array(8);
  const hView = new DataView(h.buffer);
  let hIndex = 0;
  for (const word of H0) {
    hView.setUint32(hIndex * 4, word, false);
    hIndex += 1;
  }
  const w = new Uint32Array(64);
  const wView = new DataView(w.buffer);
  const k = new Uint32Array(64);
  const kView = new DataView(k.buffer);
  let kIndex = 0;
  for (const word of K) {
    kView.setUint32(kIndex * 4, word, false);
    kIndex += 1;
  }

  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  for (let offset = 0; offset <paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      wView.setUint32(i * 4, paddedView.getUint32(offset + i * 4, false), false);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = wView.getUint32((i - 15) * 4, false);
      const w2 = wView.getUint32((i - 2) * 4, false);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      const w16 = wView.getUint32((i - 16) * 4, false);
      const w7 = wView.getUint32((i - 7) * 4, false);
      wView.setUint32(i * 4, (w16 + s0 + w7 + s1) >>> 0, false);
    }

    let a = hView.getUint32(0, false);
    let b = hView.getUint32(4, false);
    let c = hView.getUint32(8, false);
    let d = hView.getUint32(12, false);
    let e = hView.getUint32(16, false);
    let f = hView.getUint32(20, false);
    let g = hView.getUint32(24, false);
    let h7 = hView.getUint32(28, false);

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h7 + S1 + ch + kView.getUint32(i * 4, false) + wView.getUint32(i * 4, false)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h7 = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    hView.setUint32(0, (hView.getUint32(0, false) + a) >>> 0, false);
    hView.setUint32(4, (hView.getUint32(4, false) + b) >>> 0, false);
    hView.setUint32(8, (hView.getUint32(8, false) + c) >>> 0, false);
    hView.setUint32(12, (hView.getUint32(12, false) + d) >>> 0, false);
    hView.setUint32(16, (hView.getUint32(16, false) + e) >>> 0, false);
    hView.setUint32(20, (hView.getUint32(20, false) + f) >>> 0, false);
    hView.setUint32(24, (hView.getUint32(24, false) + g) >>> 0, false);
    hView.setUint32(28, (hView.getUint32(28, false) + h7) >>> 0, false);
  }

  return new Uint8Array(h.buffer.slice(0));
}

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Минимальная поверхность node:crypto#createHash, используемая cacheStore. */
export interface HashInstance {
  /** Накапливает данные (конкатенация вызовов эквивалентна одному update). */
  update(data: string): HashInstance;
  /** Возвращает дайджест; поддерживается только 'hex' (использование cacheStore). */
  digest(encoding?: string): string;
}

/**
 * createHash('sha256') — единственный поддерживаемый алгоритм (использование
 * cacheStore: computeContentHash/computeCoordHash). Остальные алгоритмы и
 * кодировки дайджеста — явная ошибка (runtime-строки на английском, решение 22.09).
 */
export function createHash(algorithm: string): HashInstance {
  if (algorithm !== 'sha256') {
    throw new Error(
      `nodeCryptoShim: unsupported algorithm "${algorithm}" — only "sha256" is implemented`,
    );
  }
  let bytes = new Uint8Array(0);
  return {
    update(data: string): HashInstance {
      const chunk = utf8Bytes(data);
      const merged = new Uint8Array(bytes.length + chunk.length);
      merged.set(bytes);
      merged.set(chunk, bytes.length);
      bytes = merged;
      return this;
    },
    digest(encoding?: string): string {
      if (encoding !== undefined && encoding !== 'hex') {
        throw new Error(
          `nodeCryptoShim: unsupported digest encoding "${String(encoding)}" — only "hex" is implemented`,
        );
      }
      return toHex(sha256Bytes(bytes));
    },
  };
}