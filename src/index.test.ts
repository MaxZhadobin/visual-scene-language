/**
 * Тесты публичного API SDK (точка входа src/index.ts).
 *
 * Доступ к каждому реэкспортированному значению выполняет CJS-геттер
 * реэкспорта (ts-jest: export {X} from → Object.defineProperty get) —
 * тем самым покрывается точка входа и фиксируется контракт экспортов:
 * случайное удаление/переименование реэкспорта ломает этот сюит.
 */
import * as VslSdk from './index';

describe('публичное API (src/index.ts)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('экспортирует версию SDK', () => {
    expect(VslSdk.VSL_SDK_VERSION).toBe('0.1.0');
  });

  it('реэкспортирует VSL_VERSION канона формата', () => {
    expect(VslSdk.VSL_VERSION).toBe('1.0.0');
  });

  it('capture: extractDomTree + ownText работают через точку входа', () => {
    document.body.innerHTML = '<button data-rect="0,0,80,32">OK</button>';
    const tree = VslSdk.extractDomTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.tag).toBe('button');
    expect(VslSdk.ownText(document.querySelector('button')!)).toBe('OK');
  });

  it('segmentation: L1-таблица, L2-маппинги, segmentTree через точку входа', () => {
    expect(Object.keys(VslSdk.LEVEL1_TAG_MAP)).toHaveLength(10);
    expect(VslSdk.resolveLevel1Type('BUTTON')).toBe('button');
    expect(VslSdk.resolveAriaRoleType('dialog')).toBe('modal');
    expect(VslSdk.resolveSt({ 'aria-pressed': 'true' })).toBe('checked');
    expect(VslSdk.isAriaHidden({ 'aria-hidden': 'true' })).toBe(true);

    document.body.innerHTML =
      '<div role="button" aria-pressed="true" data-rect="0,0,80,32">Тоггл</div>';
    const [seg] = VslSdk.segmentTree(VslSdk.extractDomTree());
    expect(seg!.t).toBe('button');
    expect(seg!.st).toBe('checked');
  });

  it('builder: полный путь DOM→VSL через публичное API', () => {
    document.body.innerHTML = '<button data-rect="100,50,120,40">OK</button>';
    const doc = VslSdk.buildVslDocument(VslSdk.segmentTree(VslSdk.extractDomTree()), {
      viewport: { width: 1000, height: 500 },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(doc.vsl_version).toBe('1.0.0');
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]!.id).toBe('button_0');
    expect(doc.objects[0]!.t).toBe('button');
  });
});