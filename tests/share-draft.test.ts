import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));

import { addFlash, flush, saveDraft, state } from '../js/store.js';

describe('incoming shares with an unfinished draft', () => {
  beforeEach(async () => {
    await flush();
    state.inbox = [];
    state.log = [];
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
});
