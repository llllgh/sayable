import { describe, expect, it } from 'vitest';
import {
  emptyToolTask,
  normalizeToolTask,
  normalizeToolTasks,
} from '../src/core/tool-tasks';

describe('tool task persistence', () => {
  it('creates isolated empty tasks for both tools', () => {
    const tasks = normalizeToolTasks(null);

    expect(tasks.compression).toEqual(emptyToolTask());
    expect(tasks.preflight).toEqual(emptyToolTask());
    expect(tasks.compression).not.toBe(tasks.preflight);
  });

  it('turns a request interrupted by restart into an explicit retry state', () => {
    expect(normalizeToolTask({
      status: 'running',
      input: 'Discuss the launch risks with the client.',
      startedAt: 100,
      source: { kind: 'record', id: 'record-1' },
    })).toMatchObject({
      status: 'interrupted',
      input: 'Discuss the launch risks with the client.',
      error: '上次请求未完成，请重试',
      source: { kind: 'record', id: 'record-1' },
    });
  });

  it('preserves a completed result without changing its status', () => {
    const result = { reuse: [], fresh: [], avoid: 'Avoid vague promises.' };
    expect(normalizeToolTask({
      status: 'ready',
      input: 'Customer launch review',
      result,
      updatedAt: 200,
    })).toMatchObject({
      status: 'ready',
      input: 'Customer launch review',
      result,
      updatedAt: 200,
    });
  });
});
