/**
 * Unit-тесты Segmentation Level 2 (T1.1.4, dev_2).
 *
 * Тестирует функции определения типов VSL по ARIA-атрибутам:
 *  - resolveAriaRoleType: маппинг ARIA-ролей на типы VSL;
 *  - resolveDropdownToggle: определение dropdown toggle по aria-haspopup;
 *  - resolveSt: определение состояния из aria-pressed/expanded/disabled.
 *
 * Контракт: ARCHITECTURE.md таблица «Уровень 2: ARIA-атрибуты».
 */

import { resolveAriaRoleType, resolveDropdownToggle, resolveSt } from './level2';

describe('segmentation/level2 — resolveAriaRoleType', () => {
  it('role="button" → button', () => {
    expect(resolveAriaRoleType('button')).toBe('button');
  });

  it('role="dialog" → modal', () => {
    expect(resolveAriaRoleType('dialog')).toBe('modal');
  });

  it('role="tab" → tab', () => {
    expect(resolveAriaRoleType('tab')).toBe('tab');
  });

  it('role="tabpanel" → container', () => {
    expect(resolveAriaRoleType('tabpanel')).toBe('container');
  });

  it('role="combobox" → input', () => {
    expect(resolveAriaRoleType('combobox')).toBe('input');
  });

  it('role="listbox" → select', () => {
    expect(resolveAriaRoleType('listbox')).toBe('select');
  });

  it('role="searchbox" → input', () => {
    expect(resolveAriaRoleType('searchbox')).toBe('input');
  });

  it('role="spinbutton" → input', () => {
    expect(resolveAriaRoleType('spinbutton')).toBe('input');
  });

  it('role="slider" → input', () => {
    expect(resolveAriaRoleType('slider')).toBe('input');
  });

  it('регистр не учитывается: "BUTTON" → button', () => {
    expect(resolveAriaRoleType('BUTTON')).toBe('button');
    expect(resolveAriaRoleType('Dialog')).toBe('modal');
  });

  it('неизвестная роль → null', () => {
    expect(resolveAriaRoleType('navigation')).toBeNull();
    expect(resolveAriaRoleType('main')).toBeNull();
  });

  it('undefined → null', () => {
    expect(resolveAriaRoleType(undefined)).toBeNull();
  });

  it('пустая строка → null', () => {
    expect(resolveAriaRoleType('')).toBeNull();
  });
});

describe('segmentation/level2 — resolveDropdownToggle (aria-haspopup)', () => {
  it('aria-haspopup="menu" → dropdown_toggle', () => {
    expect(resolveDropdownToggle({ 'aria-haspopup': 'menu' })).toBe('dropdown_toggle');
  });

  it('aria-haspopup="listbox" → dropdown_toggle', () => {
    expect(resolveDropdownToggle({ 'aria-haspopup': 'listbox' })).toBe('dropdown_toggle');
  });

  it('aria-haspopup="dialog" → null (не dropdown)', () => {
    expect(resolveDropdownToggle({ 'aria-haspopup': 'dialog' })).toBeNull();
  });

  it('aria-haspopup="true" → null (не menu/listbox)', () => {
    expect(resolveDropdownToggle({ 'aria-haspopup': 'true' })).toBeNull();
  });

  it('aria-haspopup="false" → null', () => {
    expect(resolveDropdownToggle({ 'aria-haspopup': 'false' })).toBeNull();
  });

  it('без aria-haspopup → null', () => {
    expect(resolveDropdownToggle({})).toBeNull();
    expect(resolveDropdownToggle({ 'aria-label': 'Menu' })).toBeNull();
  });

  it('регистр учитывается: "Menu" → null (только точное совпадение)', () => {
    expect(resolveDropdownToggle({ 'aria-haspopup': 'Menu' })).toBeNull();
    expect(resolveDropdownToggle({ 'aria-haspopup': 'LISTBOX' })).toBeNull();
  });
});

describe('segmentation/level2 — resolveSt (ARIA states)', () => {
  it('aria-pressed="true" → checked', () => {
    expect(resolveSt({ 'aria-pressed': 'true' })).toBe('checked');
  });

  it('aria-expanded="true" → expanded', () => {
    expect(resolveSt({ 'aria-expanded': 'true' })).toBe('expanded');
  });

  it('aria-disabled="true" → disabled', () => {
    expect(resolveSt({ 'aria-disabled': 'true' })).toBe('disabled');
  });

  it('приоритет: checked > expanded > disabled', () => {
    expect(
      resolveSt({
        'aria-pressed': 'true',
        'aria-expanded': 'true',
        'aria-disabled': 'true',
      }),
    ).toBe('checked');

    expect(
      resolveSt({
        'aria-expanded': 'true',
        'aria-disabled': 'true',
      }),
    ).toBe('expanded');
  });

  it('aria-pressed="false" → null (только "true")', () => {
    expect(resolveSt({ 'aria-pressed': 'false' })).toBeNull();
  });

  it('aria-pressed="mixed" → null (только "true")', () => {
    expect(resolveSt({ 'aria-pressed': 'mixed' })).toBeNull();
  });

  it('без ARIA-атрибутов состояния → null', () => {
    expect(resolveSt({})).toBeNull();
    expect(resolveSt({ 'aria-label': 'Toggle' })).toBeNull();
  });
});