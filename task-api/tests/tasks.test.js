const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const createTask = (body = {}) =>
  request(app).post('/tasks').send({ title: 'Task', ...body });

beforeEach(() => {
  taskService._reset();
});

describe('POST /tasks', () => {
  it('creates a task with defaults', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'high',
      dueDate: null,
      completedAt: null,
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(new Date(res.body.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('defaults priority to medium', async () => {
    const res = await createTask();
    expect(res.body.priority).toBe('medium');
  });

  it('trims the title', async () => {
    const res = await createTask({ title: '  padded  ' });
    expect(res.body.title).toBe('padded');
  });

  it('accepts optional fields', async () => {
    const res = await createTask({
      description: 'details',
      status: 'in_progress',
      dueDate: '2030-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ description: 'details', status: 'in_progress' });
  });

  it('sets completedAt when created as done', async () => {
    const res = await createTask({ status: 'done' });
    expect(res.body.completedAt).toEqual(expect.any(String));
  });

  it('ignores a client-supplied id', async () => {
    const res = await createTask({ id: 'hacked' });
    expect(res.body.id).not.toBe('hacked');
  });

  it.each([
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['whitespace title', { title: '   ' }],
    ['non-string title', { title: 123 }],
    ['invalid status', { title: 'x', status: 'pending' }],
    ['empty-string status', { title: 'x', status: '' }],
    ['invalid priority', { title: 'x', priority: 'urgent' }],
    ['non-string description', { title: 'x', description: 5 }],
    ['invalid dueDate', { title: 'x', dueDate: 'not-a-date' }],
    ['numeric dueDate', { title: 'x', dueDate: 12345 }],
  ])('returns 400 for %s', async (_name, body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('returns 400 for a JSON array body', async () => {
    const res = await request(app).post('/tasks').send([{ title: 'x' }]);
    expect(res.status).toBe(400);
  });

  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks', () => {
  it('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all tasks', async () => {
    await createTask({ title: 'a' });
    await createTask({ title: 'b' });
    const res = await request(app).get('/tasks');
    expect(res.body.map((t) => t.title)).toEqual(['a', 'b']);
  });

  describe('status filter', () => {
    beforeEach(async () => {
      await createTask({ title: 'a', status: 'todo' });
      await createTask({ title: 'b', status: 'in_progress' });
      await createTask({ title: 'c', status: 'done' });
    });

    it('filters by exact status', async () => {
      const res = await request(app).get('/tasks?status=done');
      expect(res.body.map((t) => t.title)).toEqual(['c']);
    });

    it('does not do substring matching', async () => {
      const res = await request(app).get('/tasks?status=do');
      expect(res.status).toBe(400);
    });

    it('returns 400 for an unknown status', async () => {
      const res = await request(app).get('/tasks?status=pending');
      expect(res.status).toBe(400);
    });
  });

  describe('priority filter', () => {
    it('filters by priority and combines with status', async () => {
      await createTask({ title: 'a', priority: 'high', status: 'todo' });
      await createTask({ title: 'b', priority: 'high', status: 'done' });
      await createTask({ title: 'c', priority: 'low', status: 'todo' });

      const high = await request(app).get('/tasks?priority=high');
      expect(high.body.map((t) => t.title)).toEqual(['a', 'b']);

      const both = await request(app).get('/tasks?priority=high&status=todo');
      expect(both.body.map((t) => t.title)).toEqual(['a']);
    });

    it('returns 400 for an unknown priority', async () => {
      const res = await request(app).get('/tasks?priority=urgent');
      expect(res.status).toBe(400);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 5; i++) await createTask({ title: `t${i}` });
    });

    it('page 1 starts at the first task', async () => {
      const res = await request(app).get('/tasks?page=1&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['t1', 't2']);
    });

    it('returns later pages', async () => {
      const res = await request(app).get('/tasks?page=2&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['t3', 't4']);
    });

    it('returns a partial last page', async () => {
      const res = await request(app).get('/tasks?page=3&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['t5']);
    });

    it('returns an empty array past the last page', async () => {
      const res = await request(app).get('/tasks?page=10&limit=2');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('defaults to page 1, limit 10 when only one param is given', async () => {
      const res = await request(app).get('/tasks?limit=3');
      expect(res.body.map((t) => t.title)).toEqual(['t1', 't2', 't3']);
      const res2 = await request(app).get('/tasks?page=1');
      expect(res2.body).toHaveLength(5);
    });

    it('clamps limit to 100', async () => {
      for (let i = 0; i < 105; i++) taskService.create({ title: `x${i}` });
      const res = await request(app).get('/tasks?page=1&limit=1000');
      expect(res.body).toHaveLength(100);
    });

    it.each(['page=0', 'page=-1', 'page=abc', 'page=1.5', 'limit=0', 'limit=-5', 'limit=abc', 'page=1&page=2'])(
      'returns 400 for %s',
      async (qs) => {
        const res = await request(app).get(`/tasks?${qs}`);
        expect(res.status).toBe(400);
      }
    );

    it('combines with the status filter', async () => {
      taskService._reset();
      await createTask({ title: 'a', status: 'done' });
      await createTask({ title: 'b', status: 'todo' });
      await createTask({ title: 'c', status: 'done' });
      const res = await request(app).get('/tasks?status=done&page=1&limit=1');
      expect(res.body.map((t) => t.title)).toEqual(['a']);
    });

    it('sets X-Total-Count to the filtered total, not the page size', async () => {
      const res = await request(app).get('/tasks?page=1&limit=2');
      expect(res.headers['x-total-count']).toBe('5');
    });
  });
});

describe('GET /tasks/:id', () => {
  it('returns the task', async () => {
    const { body: created } = await createTask({ title: 'find me' });
    const res = await request(app).get(`/tasks/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(created);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/tasks/nope');
    expect(res.status).toBe(404);
  });
});

describe('PUT /tasks/:id', () => {
  it('updates provided fields and keeps the rest', async () => {
    const { body: created } = await createTask({ title: 'old', priority: 'low' });
    const res = await request(app).put(`/tasks/${created.id}`).send({ title: 'new' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.id, title: 'new', priority: 'low' });
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('does not allow overwriting id, createdAt or completedAt', async () => {
    const { body: created } = await createTask();
    const res = await request(app)
      .put(`/tasks/${created.id}`)
      .send({ id: 'hacked', createdAt: '2000-01-01T00:00:00.000Z', completedAt: '2000-01-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
    expect(res.body.createdAt).toBe(created.createdAt);
    expect(res.body.completedAt).toBeNull();
  });

  it('sets completedAt when status changes to done', async () => {
    const { body: created } = await createTask();
    const res = await request(app).put(`/tasks/${created.id}`).send({ status: 'done' });
    expect(res.body.completedAt).toEqual(expect.any(String));
  });

  it('clears completedAt when a done task is reopened', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/complete`);
    const res = await request(app).put(`/tasks/${created.id}`).send({ status: 'todo' });
    expect(res.body.completedAt).toBeNull();
  });

  it('allows clearing dueDate with null', async () => {
    const { body: created } = await createTask({ dueDate: '2030-01-01T00:00:00.000Z' });
    const res = await request(app).put(`/tasks/${created.id}`).send({ dueDate: null });
    expect(res.status).toBe(200);
    expect(res.body.dueDate).toBeNull();
  });

  it.each([
    ['empty title', { title: '' }],
    ['non-string title', { title: 5 }],
    ['invalid status', { status: 'nope' }],
    ['empty-string status', { status: '' }],
    ['invalid priority', { priority: 'nope' }],
    ['invalid dueDate', { dueDate: 'nope' }],
  ])('returns 400 for %s', async (_name, body) => {
    const { body: created } = await createTask();
    const res = await request(app).put(`/tasks/${created.id}`).send(body);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes the task', async () => {
    const { body: created } = await createTask();
    const res = await request(app).delete(`/tasks/${created.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    const after = await request(app).get(`/tasks/${created.id}`);
    expect(after.status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/tasks/nope');
    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting twice', async () => {
    const { body: created } = await createTask();
    await request(app).delete(`/tasks/${created.id}`);
    const res = await request(app).delete(`/tasks/${created.id}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  it('marks the task done and sets completedAt', async () => {
    const { body: created } = await createTask();
    const res = await request(app).patch(`/tasks/${created.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).toEqual(expect.any(String));
  });

  it('preserves the existing priority (regression: it used to reset to medium)', async () => {
    const { body: created } = await createTask({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${created.id}/complete`);
    expect(res.body.priority).toBe('high');
  });

  it('is idempotent and keeps the original completedAt', async () => {
    const { body: created } = await createTask();
    const first = await request(app).patch(`/tasks/${created.id}/complete`);
    await new Promise((r) => setTimeout(r, 5));
    const second = await request(app).patch(`/tasks/${created.id}/complete`);
    expect(second.status).toBe(200);
    expect(second.body.completedAt).toBe(first.body.completedAt);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/nope/complete');
    expect(res.status).toBe(404);
  });
});

describe('GET /tasks/stats', () => {
  it('returns zeros when empty', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  it('counts by status and overdue tasks', async () => {
    const past = '2000-01-01T00:00:00.000Z';
    const future = '2999-01-01T00:00:00.000Z';
    await createTask({ status: 'todo', dueDate: past });
    await createTask({ status: 'in_progress', dueDate: past });
    await createTask({ status: 'todo', dueDate: future });
    await createTask({ status: 'done', dueDate: past });
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toEqual({ todo: 2, in_progress: 1, done: 1, overdue: 2 });
  });

  it('is not shadowed by /:id', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
  });
});

describe('app-level behaviour', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns 500 JSON when something unexpected throws', async () => {
    const spy = jest.spyOn(taskService, 'getStats').mockImplementation(() => {
      throw new Error('boom');
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    spy.mockRestore();
    errSpy.mockRestore();
  });
});