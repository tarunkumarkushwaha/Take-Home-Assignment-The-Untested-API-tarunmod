const { validateCreateTask, validateUpdateTask } = require('../src/utils/validators');

describe('validateCreateTask', () => {
  it('accepts a minimal valid body', () => {
    expect(validateCreateTask({ title: 'ok' })).toBeNull();
  });
  it('rejects null, arrays and non-objects', () => {
    expect(validateCreateTask(null)).toEqual(expect.any(String));
    expect(validateCreateTask([])).toEqual(expect.any(String));
    expect(validateCreateTask('str')).toEqual(expect.any(String));
  });
  it('accepts a null dueDate', () => {
    expect(validateCreateTask({ title: 'ok', dueDate: null })).toBeNull();
  });
});

describe('validateUpdateTask', () => {
  it('accepts an empty body (no changes)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });
  it('validates falsy-but-present values instead of skipping them', () => {
    expect(validateUpdateTask({ status: '' })).toEqual(expect.any(String));
    expect(validateUpdateTask({ priority: '' })).toEqual(expect.any(String));
    expect(validateUpdateTask({ dueDate: '' })).toEqual(expect.any(String));
  });
});