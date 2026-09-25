/**
 * Сборка Chrome Extension M1.4 (dc_6, решение note_1790079046685 —
 * подтверждено пользователем): отдельный tsup-конфиг, extension/ НЕ входит
 * в сборку SDK (корневой tsup.config.ts собирает только src/index.ts).
 *
 * Контракт:
 *  - три самостоятельных бандла: content (content script, isolated world),
 *    background (MV3 service worker), popup (popup UI) — format iife:
 *    самодостаточные файлы без runtime-импортов (MV3 требует самодостаточные
 *    content script и popup);
 *  - target es2022 — как в SDK (tsconfig.json);
 *  - outDir extension/dist/ — на эти пути ссылается manifest.json;
 *  - SDK-модули бандлятся напрямую из ../../src относительным импортом —
 *    реюз tsup devDep, без новых зависимостей;
 *  - entry/outDir резолвятся от корня репо: npm script build:extension
 *    запускается из корня как `tsup --config extension/tsup.config.ts`.
 *  - плагин node-crypto-shim: подмена импорта 'node:crypto' → шим
 *    src/nodeCryptoShim.ts — cacheStore (sha256 для contentHash/coordHash)
 *    импортирует node:crypto, в browser-iife бандле esbuild эмитит top-level
 *    __require("crypto") и краш при загрузке в Chrome (note_1790141280420);
 *    перехват только через onLoad (подмена спецификатора до парсинга):
 *    esbuild не пропускает node:* builtins через onResolve-плагины, alias к
 *    builtins не применяется, а опция plugins — собственный plugin-API tsup
 *    (esbuild-плагины — только esbuildPlugins; диагностика 23.09.2026,
 *    tsup dist/index.js L520); шим — чистый JS sha256, дифференциально
 *    протестирован против node:crypto (tests/extension/nodeCryptoShim.test.ts);
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Plugin } from 'esbuild';
import { defineConfig } from 'tsup';

/**
 * Подмена импорта 'node:crypto' → браузерный шим (extension/src/nodeCryptoShim.ts):
 * cacheStore (sha256 кэша) импортирует node:crypto — в browser-iife бандле
 * esbuild эмитит top-level __require("crypto"), который в Chrome бросает
 * 'Dynamic require of "crypto" is not supported' при загрузке
 * (note_1790141280420). Почему onLoad, а не onResolve/alias: esbuild считает
 * node:* builtins и НЕ пропускает их через onResolve-плагины (эмпирически:
 * onResolve /^node:crypto$/ через esbuildPlugins не сработал — сборки
 * 23.09.2026), alias к builtins тоже не применяется. Единственная точка
 * перехвата — переписать исходник до парсинга: from 'node:crypto' →
 * абсолютный путь шима, который esbuild резолвит как обычный файл. Файлы
 * без такого импорта проходят насквозь (undefined → дефолтная загрузка).
 */
const nodeCryptoShimPlugin: Plugin = {
  name: 'node-crypto-shim',
  setup(build) {
    const shimPath = path.resolve(process.cwd(), 'extension/src/nodeCryptoShim.ts');
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      // Якорь ^import (флаг m): матчатся только реальные import-строки —
      // комментарии и текстовые литералы со словом crypto не затрагиваются;
      // кавычка фиксируется бэктреференсом ('...' и "..." — оба варианта).
      const hasCryptoImport = /^import\s[^;\n]*?from\s+(['"])(?:node:)?crypto\1/m;
      if (!hasCryptoImport.test(source)) return undefined;
      return {
        contents: source.replace(
          /^(import\s[^;\n]*?from\s+)(['"])(?:node:)?crypto\2/gm,
          (_match, prefix: string) => `${prefix}${JSON.stringify(shimPath)}`,
        ),
        loader: 'ts',
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

export default defineConfig({
  entry: [
    'extension/src/content.ts',
    'extension/src/background.ts',
    'extension/src/popup.ts',
  ],
  format: ['iife'],
  target: 'es2022',
  // platform=browser — семантика браузерных контекстов расширения (content
  // script, service worker, popup; mainFields browser-first). Диагностика
  // 23.09.2026: esbuild считает node:* builtins при любой platform —
  // авто-external платформой не отключается (перехват — onLoad-плагин ниже).
  platform: 'browser',
  // node:crypto → браузерный шим (см. nodeCryptoShimPlugin выше и шапку).
  // ВАЖНО: опция tsup для esbuild-плагинов — esbuildPlugins, а НЕ plugins:
  // plugins — собственный plugin-API tsup (pluginContainer, хуки
  // buildStarted/modifyEsbuildOptions), esbuild-плагин там молча игнорируется
  // (диагностика 23.09.2026: ноль onResolve; tsup dist/index.js L520).
  esbuildPlugins: [nodeCryptoShimPlugin],
  outDir: 'extension/dist',
  sourcemap: true,
  clean: true,
});