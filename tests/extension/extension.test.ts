/**
 * Структурные тесты extension (M1.4, dc_6, note_1790079041609): проверяют
 * ИСХОДНИКИ (manifest MV3 валиден, файлы на месте, константы протокола), НЕ
 * артефакты сборки — extension/dist появляется только после
 * npm run build:extension и в гейты не входит (решение dc_6).
 *
 * Размещение в tests/ — extension/ вне collectCoverageFrom (порог 80% не
 * задевается), testEnvironment jsdom; fs/path доступны (jest исполняется в
 * Node). extension/src/protocol.ts не обращается к chrome API — ts-jest
 * компилирует его вместе с SDK-типами (../../src/llm/types).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AGENT_STATE_KEY,
  DEFAULT_MAX_STEPS,
  MSG_CAPTURE,
  MSG_CLASSIFY,
  MSG_EXECUTE,
  MSG_SNAPSHOT,
  MSG_START,
  MSG_STOP,
} from '../../extension/src/protocol';

const extensionRoot = join(__dirname, '..', '..', 'extension');

const readSource = (relativePath: string): string =>
  readFileSync(join(extensionRoot, relativePath), 'utf8');

/** Структура extension/manifest.json, проверяемая тестами (решение dc_6). */
interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  background: { service_worker: string };
  content_scripts: Array<{ matches: string[]; js: string[]; run_at: string }>;
  action: { default_popup: string };
  permissions: string[];
  host_permissions: string[];
}

describe('extension/manifest.json — MV3 (dc_6)', () => {
  let manifest: Manifest;

  beforeAll(() => {
    manifest = JSON.parse(readSource('manifest.json')) as Manifest;
  });

  it('парсится как JSON, manifest_version = 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('background — service worker dist/background.global.js (агентный цикл)', () => {
    expect(manifest.background.service_worker).toBe('dist/background.global.js');
  });

  it('content script: <all_urls>, dist/content.global.js, run_at document_idle', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    const script = manifest.content_scripts[0];
    expect(script).toBeDefined();
    expect(script?.matches).toEqual(['<all_urls>']);
    expect(script?.js).toEqual(['dist/content.global.js']);
    expect(script?.run_at).toBe('document_idle');
  });

  it('popup: action.default_popup = popup.html', () => {
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  it('permissions: storage (статусы цикла и настройки popup)', () => {
    expect(manifest.permissions).toContain('storage');
  });

  it('host_permissions: <all_urls>', () => {
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });
});

describe('extension/src/protocol.ts — константы протокола сообщений (dc_6)', () => {
  it('background → content: vsl/snapshot и vsl/execute', () => {
    expect(MSG_SNAPSHOT).toBe('vsl/snapshot');
    expect(MSG_EXECUTE).toBe('vsl/execute');
  });

  it('popup → background: vsl/start и vsl/stop', () => {
    expect(MSG_START).toBe('vsl/start');
    expect(MSG_STOP).toBe('vsl/stop');
  });

  it('content → background: vsl/capture и vsl/classify (vision-ветка T1.5.5)', () => {
    expect(MSG_CAPTURE).toBe('vsl/capture');
    expect(MSG_CLASSIFY).toBe('vsl/classify');
  });

  it('статус агентного цикла — ключ chrome.storage.local', () => {
    expect(AGENT_STATE_KEY).toBe('vsl/agentState');
  });

  it('дефолтный лимит шагов агентного цикла — 10', () => {
    expect(DEFAULT_MAX_STEPS).toBe(10);
  });
});

describe('extension/ — структура исходников (dc_6)', () => {
  it('все исходники на месте', () => {
    for (const file of [
      'manifest.json',
      'popup.html',
      'tsup.config.ts',
      join('src', 'protocol.ts'),
      join('src', 'chrome.d.ts'),
      join('src', 'content.ts'),
      join('src', 'background.ts'),
      join('src', 'popup.ts'),
    ]) {
      expect(existsSync(join(extensionRoot, file))).toBe(true);
    }
  });

  it('popup.html подключает собранный бандл dist/popup.global.js', () => {
    expect(readSource('popup.html')).toContain('dist/popup.global.js');
  });

  it('content.ts: обработчики vsl/snapshot и vsl/execute (сессия + executor)', () => {
    const source = readSource(join('src', 'content.ts'));
    expect(source).toContain('MSG_SNAPSHOT');
    expect(source).toContain('MSG_EXECUTE');
    expect(source).toContain('VslSnapshotSession');
    expect(source).toContain('executeAction');
  });

  it('background.ts: агентный цикл snapshot → decide → execute (OpenAI/Anthropic)', () => {
    const source = readSource(join('src', 'background.ts'));
    expect(source).toContain('MSG_START');
    expect(source).toContain('MSG_STOP');
    expect(source).toContain('decide');
    expect(source).toContain('OpenAIAdapter');
    expect(source).toContain('AnthropicAdapter');
    expect(source).toContain('AGENT_STATE_KEY');
  });

  it('popup.ts: start/stop, статус из chrome.storage, настройки provider+apiKey', () => {
    const source = readSource(join('src', 'popup.ts'));
    expect(source).toContain('MSG_START');
    expect(source).toContain('MSG_STOP');
    expect(source).toContain('AGENT_STATE_KEY');
    expect(source).toContain('chrome.storage.local.set');
    expect(source).toContain('chrome.storage.onChanged');
  });

  it('tsup.config.ts: три entry — content/background/popup', () => {
    const source = readSource('tsup.config.ts');
    expect(source).toContain('content');
    expect(source).toContain('background');
    expect(source).toContain('popup');
  });

  it('npm script build:extension добавлен (tsup)', () => {
    const pkg = JSON.parse(readFileSync(join(extensionRoot, '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:extension']).toContain('tsup');
  });
});

describe('extension/src — vision-ветка T1.5.5 (end-to-end pipeline)', () => {
  it('content.ts: порты-прокси capture/classify + module-level extractor-кэш (AC[3])', () => {
    const source = readSource(join('src', 'content.ts'));
    expect(source).toContain('MSG_CAPTURE');
    expect(source).toContain('MSG_CLASSIFY');
    expect(source).toContain('snapshotWithVision');
    expect(source).toContain('FragmentExtractor');
    expect(source).toContain('let extractor');
  });

  it('background.ts: visionClassifier на время цикла + обработчики vsl/capture и vsl/classify', () => {
    const source = readSource(join('src', 'background.ts'));
    expect(source).toContain('captureVisibleTab');
    expect(source).toContain('LlmVisionClassifier');
    expect(source).toContain('MSG_CAPTURE');
    expect(source).toContain('MSG_CLASSIFY');
    expect(source).toContain('visionClassifier = null');
    expect(source).toContain('visualFragments');
  });

  it('chrome.d.ts: типы captureVisibleTab, ChromeSender, windowId', () => {
    const source = readSource(join('src', 'chrome.d.ts'));
    expect(source).toContain('captureVisibleTab');
    expect(source).toContain('ChromeSender');
    expect(source).toContain('windowId');
  });

  it('protocol.ts: SnapshotResponse с фрагментами (vision-ветка T1.5.5)', () => {
    const source = readSource(join('src', 'protocol.ts'));
    expect(source).toContain('SnapshotResponse');
    expect(source).toContain('fragments');
    expect(source).toContain('vision');
  });
});