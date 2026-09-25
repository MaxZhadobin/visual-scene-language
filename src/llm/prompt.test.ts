/**
 * Тесты промптов (T1.3.4): buildSystemPrompt (VSL-формат + дифф + few-shot),
 * buildUserPrompt (шаблон §2.5), collectFragmentData (vf → стор, AC[7]).
 */

import type { VslModifiedObject, VslDiff } from '../diff/diffEngine';
import type { VslDocument, VslObject } from '../types/vsl';
import { VALID_ACTIONS } from './actions';
import {
  buildSystemPrompt,
  buildUserPrompt,
  collectFragmentData,
  FEW_SHOT_EXAMPLES,
} from './prompt';
import { ACTION_TOOL_NAME } from './schema';
import type { VisualFragmentData } from './types';

const DOC: VslDocument = {
  vsl_version: '1.0.0',
  canvas: {
    viewport: { width: 1280, height: 800, unit: 'px' },
    background: '#ffffff',
    scale: 1,
    orientation: 'landscape',
    timestamp: '2026-09-22T09:00:00.000Z',
  },
  objects: [
    {
      id: 'header_0',
      t: 'header',
      p: [0, 0],
      s: [1280, 64],
      ch: [{ id: 'button_0_1', t: 'button', p: [0.5, 0.3], s: [120, 40], txt: 'Войти' }],
    },
  ],
};

describe('buildSystemPrompt', () => {
  const system = buildSystemPrompt();

  it('содержит роль агента, описание VSL-формата и семантику диффа §6.2', () => {
    expect(system).toContain('screen understanding agent');
    expect(system).toContain('"unchanged_refs"');
    expect(system).toContain('NEVER target');
    expect(system).toContain('"vf"');
    expect(system).toContain('"diff_version"');
  });

  it('перечисляет все VALID_ACTIONS и правила tool execute_action', () => {
    expect(system).toContain(VALID_ACTIONS.join(' | '));
    expect(system).toContain(ACTION_TOOL_NAME);
    expect(system).toContain('- navigate — value: URL;');
  });

  it('содержит ровно 3 few-shot примера (T1.3.4)', () => {
    expect(FEW_SHOT_EXAMPLES).toHaveLength(3);
    expect(system).toContain('Example 1');
    expect(system).toContain('Example 2');
    expect(system).toContain('Example 3');
  });
});

describe('buildUserPrompt', () => {
  it('шаблон §2.5: Current screen (VSL JSON) + User goal', () => {
    const prompt = buildUserPrompt(DOC, 'Войти в аккаунт');
    expect(prompt).toContain('Current screen (VSL JSON):');
    expect(prompt).toContain('"button_0_1"');
    expect(prompt).toContain('User goal: Войти в аккаунт');
  });

  it('принимает VslDiff (diff-first, §11.2)', () => {
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-09-22T09:01:00.000Z',
      changes: { added: [], modified: [], removed: [], unchanged_refs: ['button_0_1'] },
    };
    const prompt = buildUserPrompt(diff, 'g');
    expect(prompt).toContain('"unchanged_refs":["button_0_1"]');
  });
});

describe('collectFragmentData (AC[7])', () => {
  const imgA: VisualFragmentData = { mediaType: 'image/webp', data: 'AAAA' };
  const imgB: VisualFragmentData = { mediaType: 'image/png', data: 'BBBB' };
  const store = new Map<string, VisualFragmentData>([
    ['emb_a', imgA],
    ['emb_b', imgB],
  ]);

  it('без стора / пустой стор → [] (текстовая подача)', () => {
    expect(collectFragmentData(DOC)).toEqual([]);
    expect(collectFragmentData(DOC, new Map())).toEqual([]);
  });

  it('документ: рекурсивный сбор vf, дедуп ссылок, только ссылки со стора', () => {
    const doc: VslDocument = {
      ...DOC,
      objects: [
        {
          ...DOC.objects[0]!,
          vf: 'emb_a',
          ch: [
            {
              id: 'child_1',
              t: 'container',
              p: [0, 0],
              s: [1, 1],
              vf: 'emb_c', // нет в сторе — пропускается
              ch: [{ id: 'child_1_1', t: 'link', p: [0, 0], s: [1, 1], vf: 'emb_a' }],
            },
          ],
        } as unknown as VslObject,
      ],
    };
    expect(collectFragmentData(doc, store)).toEqual([imgA]);
  });

  it('дифф: added (рекурсивно) + modified; порядок — первое вхождение ссылки', () => {
    const diff: VslDiff = {
      diff_version: 2,
      base_version: 1,
      timestamp: '2026-09-22T09:01:00.000Z',
      changes: {
        added: [
          {
            id: 'add_0',
            t: 'container',
            p: [0, 0],
            s: [1, 1],
            ch: [{ id: 'add_0_0', t: 'image', p: [0, 0], s: [1, 1], vf: 'emb_b' } as unknown as VslObject],
          },
        ],
        modified: [{ id: 'header_0', txt: 'x', vf: 'emb_a' } as VslModifiedObject],
        removed: [],
        unchanged_refs: [],
      },
    };
    expect(collectFragmentData(diff, store)).toEqual([imgB, imgA]);
  });
});