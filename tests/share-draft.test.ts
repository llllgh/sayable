import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));

import {
  addFlash,
  flush,
  getDraft,
  saveQuickCapture,
  saveDraft,
  setDraft,
  state,
} from '../js/store.js';
import { savePersistedState } from '../src/storage/database';

describe('incoming shares with an unfinished draft', () => {
  beforeEach(async () => {
    await flush();
    state.inbox = [];
    state.log = [];
    state.drafts = {
      quickCapture: '',
      expression: '',
      compression: '',
      preflight: '',
    };
    saveDraft('My unfinished thought');
  });

  it('retains the draft while queuing multiple external shares', async () => {
    addFlash(' A shared expression. ', null, 'share');
    addFlash('Another shared expression.', null, 'share');
    await flush();

    expect(state.draft).toBe('My unfinished thought');
    expect(state.inbox).toMatchObject([
      { source: 'share', text: 'Another shared expression.' },
      { source: 'share', text: 'A shared expression.' },
    ]);
  });

  it('still clears the draft when the user saves it in the app', async () => {
    addFlash(state.draft);
    await flush();

    expect(state.draft).toBe('');
    expect(state.inbox[0]).toMatchObject({
      source: 'app',
      text: 'My unfinished thought',
    });
  });

  it('keeps the draft and removes the staged record when persistence fails', async () => {
    await flush();
    vi.mocked(savePersistedState).mockRejectedValueOnce(
      new Error('disk unavailable'),
    );

    await expect(saveQuickCapture(state.draft)).rejects.toThrow(
      'disk unavailable',
    );

    expect(state.draft).toBe('My unfinished thought');
    expect(state.inbox).toHaveLength(0);
  });

  it('keeps tool and expression drafts isolated from quick capture', async () => {
    setDraft('expression', 'An expression draft');
    setDraft('compression', 'A long paragraph draft');
    setDraft('preflight', 'Tomorrow planning meeting');
    addFlash(state.draft);
    await flush();

    expect(getDraft('quickCapture')).toBe('');
    expect(getDraft('expression')).toBe('An expression draft');
    expect(getDraft('compression')).toBe('A long paragraph draft');
    expect(getDraft('preflight')).toBe('Tomorrow planning meeting');
  });
});
