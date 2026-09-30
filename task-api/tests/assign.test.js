const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');
const { validateAssignTask } = require('../src/utils/validators');

const createTask = (body = {}) =>
  request(app).post('/tasks').send({ title: 'Task', ...body });

const assign = (id, body) => request(app).patch(`/tasks/${id}/assign`).send(body);

beforeEach(() => {
  taskService._reset();
});

describe('PATCH /tasks/:id/assign', () => {
  describe('happy path', () => {
    it('stores the assignee and returns the updated task', async () => {
      const { body: created } = await createTask({ title: 'Ship it', priority: 'high' });
      const res = await assign(created.id, { assignee: 'Alice' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...created, assignee: 'Alice' });
    });

    it('persists the assignee (visible via GET)', async () => {
      const { body: created } = await createTask();
      await assign(created.id, { assignee: 'Alice' });
      const res = await request(app).get(`/tasks/${created.id}`);
      expect(res.body.assignee).toBe('Alice');
    });

    it('new tasks start unassigned (assignee is null)', async () => {
      const res = await createTask();
      expect(res.body.assignee).toBeNull();
    });

    it('trims surrounding whitespace', async () => {
      const { body: created } = await createTask();
      const res = await assign(created.id, { assignee: '  Alice  ' });
      expect(res.body.assignee).toBe('Alice');
    });

    it('accepts names with spaces and non-ASCII characters', async () => {
      const { body: created } = await createTask();
      const res = await assign(created.id, { assignee: 'María José O\u2019Brien' });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('María José O\u2019Brien');
    });

    it('accepts a name at exactly the max length (100)', async () => {
      const { body: created } = await createTask();
      const res = await assign(created.id, { assignee: 'a'.repeat(100) });
      expect(res.status).toBe(200);
    });

    it('does not change any other field', async () => {
      const { body: created } = await createTask({ priority: 'high', status: 'in_progress' });
      const res = await assign(created.id, { assignee: 'Alice' });
      const { assignee, ...rest } = res.body;
      const { assignee: _before, ...restBefore } = created;
      expect(rest).toEqual(restBefore);
    });

    it('works on a completed task', async () => {
      const { body: created } = await createTask();
      await request(app).patch(`/tasks/${created.id}/complete`);
      const res = await assign(created.id, { assignee: 'Alice' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
    });
  });

  describe('already-assigned tasks', () => {
    it('reassigns to a different person (last write wins)', async () => {
      const { body: created } = await createTask();
      await assign(created.id, { assignee: 'Alice' });
      const res = await assign(created.id, { assignee: 'Bob' });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Bob');
    });

    it('is idempotent when assigning the same person again', async () => {
      const { body: created } = await createTask();
      await assign(created.id, { assignee: 'Alice' });
      const res = await assign(created.id, { assignee: 'Alice' });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Alice');
    });
  });

  describe('not found', () => {
    it('returns 404 for an unknown id', async () => {
      const res = await assign('nope', { assignee: 'Alice' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('returns 404 for a deleted task', async () => {
      const { body: created } = await createTask();
      await request(app).delete(`/tasks/${created.id}`);
      const res = await assign(created.id, { assignee: 'Alice' });
      expect(res.status).toBe(404);
    });
  });

  describe('validation', () => {
    it.each([
      ['missing assignee', {}],
      ['empty string', { assignee: '' }],
      ['whitespace only', { assignee: '   ' }],
      ['null', { assignee: null }],
      ['number', { assignee: 42 }],
      ['boolean', { assignee: true }],
      ['object', { assignee: { name: 'Alice' } }],
      ['array', { assignee: ['Alice'] }],
      ['too long (101 chars)', { assignee: 'a'.repeat(101) }],
    ])('returns 400 for %s', async (_name, body) => {
      const { body: created } = await createTask();
      const res = await assign(created.id, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(expect.any(String));
    });

    it('does not modify the task when validation fails', async () => {
      const { body: created } = await createTask();
      await assign(created.id, { assignee: 'Alice' });
      await assign(created.id, { assignee: '' });
      const res = await request(app).get(`/tasks/${created.id}`);
      expect(res.body.assignee).toBe('Alice');
    });

    it('returns 400 for a JSON array body', async () => {
      const { body: created } = await createTask();
      const res = await request(app).patch(`/tasks/${created.id}/assign`).send(['Alice']);
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON', async () => {
      const { body: created } = await createTask();
      const res = await request(app)
        .patch(`/tasks/${created.id}/assign`)
        .set('Content-Type', 'application/json')
        .send('{"assignee": ');
      expect(res.status).toBe(400);
    });

    it('ignores extra fields in the body', async () => {
      const { body: created } = await createTask({ priority: 'low' });
      const res = await assign(created.id, { assignee: 'Alice', priority: 'high', id: 'hacked' });
      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('low');
      expect(res.body.id).toBe(created.id);
    });

    it('validates the body before looking up the task (400 wins over 404)', async () => {
      const res = await assign('nope', { assignee: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('interaction with other endpoints', () => {
    it('PUT cannot be used to set assignee (must use /assign)', async () => {
      const { body: created } = await createTask();
      const res = await request(app).put(`/tasks/${created.id}`).send({ assignee: 'Alice' });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBeNull();
    });

    it('completing a task keeps its assignee', async () => {
      const { body: created } = await createTask();
      await assign(created.id, { assignee: 'Alice' });
      const res = await request(app).patch(`/tasks/${created.id}/complete`);
      expect(res.body.assignee).toBe('Alice');
    });
  });
});

describe('validateAssignTask', () => {
  it('accepts a valid name', () => {
    expect(validateAssignTask({ assignee: 'Alice' })).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(validateAssignTask(null)).toEqual(expect.any(String));
    expect(validateAssignTask([])).toEqual(expect.any(String));
  });
  it('rejects empty, whitespace, non-string and over-long values', () => {
    expect(validateAssignTask({ assignee: '' })).toEqual(expect.any(String));
    expect(validateAssignTask({ assignee: '  ' })).toEqual(expect.any(String));
    expect(validateAssignTask({ assignee: 1 })).toEqual(expect.any(String));
    expect(validateAssignTask({ assignee: 'a'.repeat(101) })).toEqual(expect.any(String));
  });
  it('measures length after trimming', () => {
    expect(validateAssignTask({ assignee: ` ${'a'.repeat(100)} ` })).toBeNull();
  });
});