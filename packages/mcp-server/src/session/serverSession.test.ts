import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ServerSession } from './serverSession.js';
import type { VslDocument } from '@thinkingos/vsl-sdk';

/** Минимальный VSL document для тестов. */
function makeDoc(id: string): VslDocument {
  return {
    version: '1.0',
    viewport: { width: 1024, height: 768 },
    state: { id },
    objects: [
      {
        id: 'obj-1',
        type: 'button',
        state: 'idle',
        actions: ['click'],
        text: `Button ${id}`,
        rect: { x: 0, y: 0, width: 100, height: 40 },
      },
    ],
  } as unknown as VslDocument;
}

/** VSL document с несколькими объектами для тестов idMap. */
function makeMultiDoc(id: string): VslDocument {
  return {
    version: '1.0',
    viewport: { width: 1024, height: 768 },
    state: { id },
    objects: [
      {
        id: 'button_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_4',
        type: 'button',
        state: 'idle',
        actions: ['click'],
        text: 'Кнопка',
        rect: { x: 0, y: 0, width: 100, height: 40 },
      },
      {
        id: 'input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0',
        type: 'input',
        state: 'idle',
        actions: ['type'],
        text: '',
        rect: { x: 0, y: 50, width: 200, height: 30 },
      },
      {
        id: 'div_0_1',
        type: 'container',
        state: 'idle',
        actions: [],
        text: null,
        rect: { x: 0, y: 100, width: 300, height: 200 },
      },
    ],
  } as unknown as VslDocument;
}

describe('ServerSession', () => {
  let session: ServerSession;

  beforeEach(() => {
    session = new ServerSession();
  });

  describe('getSnapshot', () => {
    it('throws if no snapshot is set', () => {
      expect(() => session.getSnapshot()).toThrow('No snapshot available');
    });

    it('returns the current snapshot after setSnapshot', () => {
      const doc = makeDoc('v1');
      session.setSnapshot(doc);
      expect(session.getSnapshot()).toBe(doc);
    });
  });

  describe('hasSnapshot', () => {
    it('returns false initially', () => {
      expect(session.hasSnapshot()).toBe(false);
    });

    it('returns true after setSnapshot', () => {
      session.setSnapshot(makeDoc('v1'));
      expect(session.hasSnapshot()).toBe(true);
    });

    it('returns false after clear', () => {
      session.setSnapshot(makeDoc('v1'));
      session.clear();
      expect(session.hasSnapshot()).toBe(false);
    });
  });

  describe('getDiff', () => {
    it('returns null if no snapshot is set', () => {
      expect(session.getDiff()).toBeNull();
    });

    it('returns null if only one snapshot is set (no previous)', () => {
      session.setSnapshot(makeDoc('v1'));
      expect(session.getDiff()).toBeNull();
    });

    it('returns diff between previous and current snapshots', () => {
      const doc1 = makeDoc('v1');
      const doc2 = makeDoc('v2');
      session.setSnapshot(doc1);
      session.setSnapshot(doc2);
      const diff = session.getDiff();
      expect(diff).not.toBeNull();
      // VslDiff structure: { changes: { added, modified, removed, unchanged_refs }, ... }
      expect(diff).toHaveProperty('changes');
      expect(diff!.changes).toHaveProperty('added');
      expect(diff!.changes).toHaveProperty('modified');
      expect(diff!.changes).toHaveProperty('removed');
    });

    it('detects added objects in diff', () => {
      const doc1 = makeDoc('v1');
      const doc2 = {
        ...makeDoc('v2'),
        objects: [
          ...makeDoc('v2').objects,
          {
            id: 'obj-2',
            type: 'input',
            state: 'idle',
            actions: ['type'],
            text: 'New input',
            rect: { x: 0, y: 50, width: 200, height: 30 },
          },
        ],
      } as unknown as VslDocument;
      session.setSnapshot(doc1);
      session.setSnapshot(doc2);
      const diff = session.getDiff();
      expect(diff).not.toBeNull();
      expect(diff!.changes.added.length).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('resets both current and previous snapshots', () => {
      session.setSnapshot(makeDoc('v1'));
      session.setSnapshot(makeDoc('v2'));
      session.clear();
      expect(session.hasSnapshot()).toBe(false);
      expect(session.getDiff()).toBeNull();
      expect(() => session.getSnapshot()).toThrow('No snapshot available');
    });
  });

  describe('setOnSnapshotChange', () => {
    it('calls callback when snapshot changes', () => {
      const callback = jest.fn();
      session.setOnSnapshotChange(callback);
      session.setSnapshot(makeDoc('v1'));
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('calls callback on each setSnapshot', () => {
      const callback = jest.fn();
      session.setOnSnapshotChange(callback);
      session.setSnapshot(makeDoc('v1'));
      session.setSnapshot(makeDoc('v2'));
      session.setSnapshot(makeDoc('v3'));
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('does not throw if no callback is registered', () => {
      expect(() => session.setSnapshot(makeDoc('v1'))).not.toThrow();
    });

    it('replaces previous callback', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      session.setOnSnapshotChange(callback1);
      session.setSnapshot(makeDoc('v1'));
      expect(callback1).toHaveBeenCalledTimes(1);

      session.setOnSnapshotChange(callback2);
      session.setSnapshot(makeDoc('v2'));
      expect(callback1).toHaveBeenCalledTimes(1); // not called again
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('idMap (rw1_idmapper)', () => {
    it('строит карты idMap при setSnapshot', () => {
      const doc = makeMultiDoc('v1');
      session.setSnapshot(doc);

      const idMap = session.getIdMap();
      const reverseIdMap = session.getReverseIdMap();

      expect(idMap.size).toBe(3);
      expect(reverseIdMap.size).toBe(3);

      // Короткие ID → длинные
      expect(idMap.get('btn_0')).toBe('button_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_4');
      expect(idMap.get('inp_0')).toBe('input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0');
      expect(idMap.get('div_0')).toBe('div_0_1');

      // Длинные ID → короткие
      expect(reverseIdMap.get('button_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_4')).toBe('btn_0');
      expect(reverseIdMap.get('input_0_0_0_2_2_0_1_0_1_0_1_0_1_1_0_0_1_0_0_0')).toBe('inp_0');
      expect(reverseIdMap.get('div_0_1')).toBe('div_0');
    });

    it('возвращает пустые карты если objects отсутствует', () => {
      const doc = { version: '1.0', viewport: { width: 1024, height: 768 }, state: { id: 'v1' } } as unknown as VslDocument;
      session.setSnapshot(doc);

      expect(session.getIdMap().size).toBe(0);
      expect(session.getReverseIdMap().size).toBe(0);
    });

    it('перестраивает карты при новом setSnapshot', () => {
      session.setSnapshot(makeMultiDoc('v1'));
      expect(session.getIdMap().size).toBe(3);

      // Новый snapshot с другим набором объектов
      const doc2 = {
        version: '1.0',
        viewport: { width: 1024, height: 768 },
        state: { id: 'v2' },
        objects: [
          { id: 'a_0_1_0', type: 'link', state: 'idle', actions: ['click'], text: 'Ссылка', rect: { x: 0, y: 0, width: 50, height: 20 } },
        ],
      } as unknown as VslDocument;
      session.setSnapshot(doc2);

      const idMap = session.getIdMap();
      expect(idMap.size).toBe(1);
      expect(idMap.get('a_0')).toBe('a_0_1_0');
    });

    it('clear() сбрасывает карты idMap', () => {
      session.setSnapshot(makeMultiDoc('v1'));
      expect(session.getIdMap().size).toBe(3);

      session.clear();

      expect(session.getIdMap().size).toBe(0);
      expect(session.getReverseIdMap().size).toBe(0);
    });
  });
});