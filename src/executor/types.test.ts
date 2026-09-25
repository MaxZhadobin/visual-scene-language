/** Тесты контрактов executor (types.ts): ActionExecutionError. */

import { ActionExecutionError } from './types';

describe('ActionExecutionError', () => {
  it('создаётся с сообщением, именем и цепочкой прототипов Error', () => {
    const error = new ActionExecutionError('DOM has changed since the snapshot');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ActionExecutionError);
    expect(error.message).toBe('DOM has changed since the snapshot');
    expect(error.name).toBe('ActionExecutionError');
  });
});