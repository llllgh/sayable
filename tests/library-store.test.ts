import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));

import {
  addItem,
  addFlash,
  beginToolTask,
  completeFlash,
  completeToolTask,
  findItemBySkeleton,
  getToolTask,
  markFlashHandled,
  state,
  updateFlashText,
} from '../js/store.js';
import { normalizeToolTasks } from '../src/core/tool-tasks';

describe('library record and tool task state', () => {
  beforeEach(() => {
    state.items = [];
    state.inbox = [];
    state.log = [];
    state.toolTasks = normalizeToolTasks(null);
  });

  it('stores terms in the shared learning queue without colliding with expressions', () => {
    const expression = addItem({
      kind: 'expression',
      skeleton: 'latency',
      zh: '延迟',
      srcKind: 'recommendation',
    });
    const term = addItem({
      kind: 'term',
      skeleton: 'latency',
      zh: '系统响应请求所需的延迟时间',
      lemma: 'latency',
      sense: '系统响应请求所需的延迟时间',
      collocations: ['reduce latency', 'latency budget'],
      anchorSentence: 'We need to reduce latency before launch.',
      domainTags: ['性能'],
      srcKind: 'recommendation',
    });

    expect(state.items).toHaveLength(2);
    expect(term).toMatchObject({
      kind: 'term',
      skeleton: 'latency',
      box: 0,
      status: 'learning',
    });
    expect(expression.kind).toBe('expression');
    expect(findItemBySkeleton('latency', 'term')?.id).toBe(term.id);
  });

  it('keeps an analyzed record until the user marks it handled', () => {
    const record = addFlash('Could you confirm the delivery date?');
    if (!record) throw new Error('expected a saved record');
    completeFlash(record.id, { natural: record.text });

    expect(record.status).toBe('ready');
    expect(state.inbox).toContain(record);

    markFlashHandled(record.id, 'item-1');

    expect(record).toMatchObject({
      status: 'handled',
      linkedItemIds: ['item-1'],
    });
    expect(state.inbox).toContain(record);
  });

  it('invalidates stale analysis when the original text changes', () => {
    const record = addFlash('Old text');
    if (!record) throw new Error('expected a saved record');
    completeFlash(record.id, { natural: 'Old result' });
    markFlashHandled(record.id, '', { kind: 'compression', id: 'old-result' });

    updateFlashText(record.id, 'New text');

    expect(record).toMatchObject({ text: 'New text', status: 'raw' });
    expect(record).not.toHaveProperty('analysis');
    expect(record).not.toHaveProperty('processedResult');
  });

  it('preserves tool input, request state, and result for route restoration', () => {
    beginToolTask('preflight', 'Launch review with the client');
    expect(getToolTask('preflight')).toMatchObject({
      status: 'running',
      input: 'Launch review with the client',
    });

    const result = { reuse: [], fresh: [], avoid: '' };
    completeToolTask('preflight', result);

    expect(getToolTask('preflight')).toMatchObject({
      status: 'ready',
      input: 'Launch review with the client',
      result,
    });
  });
});
