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

describe('extension — iframe support M2.1 (all_frames)', () => {
  it('manifest.json: content_scripts содержит all_frames: true', () => {
    const manifest = JSON.parse(readSource('manifest.json')) as Manifest;
    expect(manifest.content_scripts).toHaveLength(1);
    const script = manifest.content_scripts[0];
    expect(script).toBeDefined();
    expect((script as unknown as Record<string, unknown>)['all_frames']).toBe(true);
  });

  it('protocol.ts: содержит тип FrameSnapshotResponse и MSG_FRAME_SNAPSHOT', () => {
    const source = readSource(join('src', 'protocol.ts'));
    expect(source).toContain('FrameSnapshotResponse');
    expect(source).toContain('MSG_FRAME_SNAPSHOT');
  });

  it('protocol.ts: SnapshotResponse содержит frameId поле', () => {
    const source = readSource(join('src', 'protocol.ts'));
    expect(source).toContain('frameId');
  });

  it('content.ts: детектит iframe context (window.top !== window.self)', () => {
    const source = readSource(join('src', 'content.ts'));
    expect(source).toContain('window.top');
    expect(source).toContain('window.self');
    expect(source).toContain('MSG_FRAME_SNAPSHOT');
  });

  it('background.ts: содержит frameRegistry для хранения iframe snapshots', () => {
    const source = readSource(join('src', 'background.ts'));
    expect(source).toContain('frameRegistry');
    expect(source).toContain('Map<number');
  });

  it('background.ts: содержит aggregateSnapshotsWithFrames функцию', () => {
    const source = readSource(join('src', 'background.ts'));
    expect(source).toContain('aggregateSnapshotsWithFrames');
  });

  it('background.ts: содержит parseFramePrefix для маршрутизации execute', () => {
    const source = readSource(join('src', 'background.ts'));
    expect(source).toContain('parseFramePrefix');
    expect(source).toContain('frame_');
  });

  it('types/vsl.ts: содержит VslIframeData интерфейс', () => {
    const vslTypesPath = join(__dirname, '..', '..', 'src', 'types', 'vsl.ts');
    const source = readFileSync(vslTypesPath, 'utf8');
    expect(source).toContain('VslIframeData');
    expect(source).toContain('frameId: number');
    expect(source).toContain('vsl: VslDocument');
  });

  it('types/vsl.ts: VslObject содержит iframe поле', () => {
    const vslTypesPath = join(__dirname, '..', '..', 'src', 'types', 'vsl.ts');
    const source = readFileSync(vslTypesPath, 'utf8');
    expect(source).toContain('iframe?: VslIframeData');
  });

  it('types/vsl.ts: VslType содержит iframe тип', () => {
    const vslTypesPath = join(__dirname, '..', '..', 'src', 'types', 'vsl.ts');
    const source = readFileSync(vslTypesPath, 'utf8');
    expect(source).toContain("'iframe'");
  });

  // Iframe support (M2.1 rework): data-vsl-id injection для iframe элементов
  it('protocol.ts: содержит MSG_IFRAME_FRAME_IDS для запроса frameId по URL', () => {
    const source = readSource(join('src', 'protocol.ts'));
    expect(source).toContain('MSG_IFRAME_FRAME_IDS');
    expect(source).toContain('IframeFrameIdsRequest');
    expect(source).toContain('IframeFrameIdsResponse');
  });

  it('content.ts: содержит injectIframeIdsIntoDom функцию', () => {
    const source = readSource(join('src', 'content.ts'));
    expect(source).toContain('injectIframeIdsIntoDom');
    expect(source).toContain('data-vsl-id');
    expect(source).toContain('iframe_');
  });

  it('content.ts: вызывает injectIframeIdsIntoDom в top-frame handler', () => {
    const source = readSource(join('src', 'content.ts'));
    expect(source).toContain('await injectIframeIdsIntoDom()');
  });

  it('background.ts: содержит handler для MSG_IFRAME_FRAME_IDS', () => {
    const source = readSource(join('src', 'background.ts'));
    expect(source).toContain('MSG_IFRAME_FRAME_IDS');
    expect(source).toContain('frameIds[url]');
  });
});

describe('extension — iframe runtime behavior M2.1', () => {
  // Runtime тесты для экспортированных функций background.ts
  // parseFramePrefix и aggregateSnapshotsWithFrames
  
  // Mock chrome API перед импортом background.ts
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).chrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn(),
        },
        sendMessage: jest.fn(),
      },
      tabs: {
        sendMessage: jest.fn(),
        captureVisibleTab: jest.fn(),
      },
      storage: {
        local: {
          get: jest.fn(),
          set: jest.fn(),
        },
      },
    };
  });

  it('parseFramePrefix: извлекает frameId и localId из frame_N:id формата', async () => {
    const { parseFramePrefix } = await import('../../extension/src/background');
    expect(parseFramePrefix('frame_3:button_0_1')).toEqual({
      frameId: 3,
      localId: 'button_0_1',
    });
  });
  
  it('parseFramePrefix: возвращает frameId=null для обычного target_id', async () => {
    const { parseFramePrefix } = await import('../../extension/src/background');
    expect(parseFramePrefix('button_0_1')).toEqual({
      frameId: null,
      localId: 'button_0_1',
    });
  });
  
  it('parseFramePrefix: обрабатывает сложные localId с двоеточиями', async () => {
    const { parseFramePrefix } = await import('../../extension/src/background');
    expect(parseFramePrefix('frame_42:input_1_2_3')).toEqual({
      frameId: 42,
      localId: 'input_1_2_3',
    });
  });
  
  it('aggregateSnapshotsWithFrames: возвращает topFrameSnapshot без изменений при пустом frameRegistry', async () => {
    const { aggregateSnapshotsWithFrames } = await import('../../extension/src/background');
    const topFrameSnapshot = {
      snapshot: {
        viewport: { width: 1920, height: 1080 },
        objects: [{ id: 'btn_1', t: 'button' as const, p: [100, 200] as [number, number], s: [80, 30] as [number, number] }],
      },
    };
    const result = aggregateSnapshotsWithFrames(topFrameSnapshot);
    expect(result).toBe(topFrameSnapshot); // тот же объект
  });
});

describe('extension — iframe rework improvements (synchronization, nested, cleanup)', () => {
  // Structural tests for rework_1/2/3 improvements
  
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
      },
      tabs: {
        sendMessage: jest.fn(),
        captureVisibleTab: jest.fn(),
      },
      storage: {
        local: { get: jest.fn(), set: jest.fn() },
      },
      webNavigation: {
        getParentFrameId: jest.fn(),
      },
    };
  });
  
  describe('rework_1: explicit synchronization mechanism', () => {
    it('protocol.ts: IframeRectsMessage содержит iframeCount для countdown', () => {
      const source = readSource(join('src', 'protocol.ts'));
      expect(source).toContain('iframeCount');
      expect(source).toContain('IframeRectsMessage');
    });
    
    it('background.ts: pendingFrameSync и frameSyncTimeout для синхронизации', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('pendingFrameSync');
      expect(source).toContain('frameSyncTimeout');
      expect(source).toContain('expected:');
      expect(source).toContain('received:');
    });
    
    it('background.ts: MSG_IFRAME_RECTS создаёт pendingFrameSync с iframeCount', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('rectsMessage.iframeCount');
      expect(source).toContain('pendingFrameSync = {');
    });
    
    it('background.ts: MSG_FRAME_SNAPSHOT decrement received count', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('pendingFrameSync.received++');
      expect(source).toContain('pendingFrameSync.received >= pendingFrameSync.expected');
    });
    
    it('background.ts: timeout fallback предотвращает deadlock', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('setTimeout');
      expect(source).toContain('frameSyncTimeout');
    });
  });
  
  describe('rework_2: nested iframes support', () => {
    it('background.ts: использует chrome.webNavigation.getParentFrameId для parentFrameId', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('webNavigation.getParentFrameId');
      expect(source).toContain('parentFrameId');
    });
    
    it('manifest.json: webNavigation permission для nested iframes API', () => {
      const manifest = JSON.parse(readSource('manifest.json')) as Manifest;
      expect(manifest.permissions).toContain('webNavigation');
    });
    
    it('background.ts: frameRegistry хранит parentFrameId для иерархии фреймов', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('frameRegistry.set(frameId, { ...frameSnapshot, frameId, parentFrameId })');
    });
    
    it('background.ts: aggregateSnapshotsWithFrames строит дерево фреймов через childrenMap', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('childrenMap');
      expect(source).toContain('parentId');
    });
  });
  
  describe('rework_3: dynamic iframes cleanup', () => {
    it('background.ts: MSG_IFRAME_RECTS очищает stale frames из frameRegistry', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('currentUrls');
      expect(source).toContain('frameRegistry.delete');
    });
    
    it('background.ts: MSG_IFRAME_RECTS очищает stale URLs из iframeRectsMap', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('iframeRectsMap.delete');
    });
    
    it('background.ts: использует Set для efficient URL lookup', () => {
      const source = readSource(join('src', 'background.ts'));
      expect(source).toContain('new Set(');
      expect(source).toContain('currentUrls.has');
    });
  });
});