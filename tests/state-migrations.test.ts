import { describe, expect, it } from 'vitest';
import {
  CURRENT_STATE_FORMAT_VERSION,
  migratePersistedState,
} from '../src/storage/state-migrations';

const legacyProfile = {
  name: '',
  role: '产品/技术负责人',
  org: '',
  domains: ['AI 产品落地', '模型能力与效果', '研发效率', '客户 ROI'],
  counterparts: ['海外客户', '海外同事', '公司高管'],
  scenarios: ['客户方案沟通会', '和 leader 汇报进展', '跨时区周会', '面向高管的季度复盘'],
  upcoming: '下周要跟一个海外客户讲我们 AI 方案的投入产出',
  variety: 'international',
};

const legacyItems = [
  ['struggle to translate X into Y', 'heard', '老师给的例子：Many companies are struggling to translate AI investment into measurable productivity gains.'],
  ['The bottleneck has shifted from X to Y', 'heard', '在一个播客里听到：The bottleneck has shifted from generation to verification.'],
  ['What matters is not X, but Y', 'heard', '老师列的高频结构之一'],
  ['This creates a gap between X and Y', 'mine', 'The problem is that our model is very good but the users do not feel it is good, so there is a difference between them.'],
  ['That doesn\'t necessarily mean X', 'mine', 'But it is not sure that we can get the same result in other cases, maybe not.'],
  ['less about X and more about Y', 'heard', '客户在会上说：The challenge is less about accuracy and more about trust.'],
].map(([skeleton, kind, raw], index) => ({
  id: `demo-${index}`,
  skeleton,
  source: { kind, raw },
}));

const legacyCompression = {
  id: 'demo-compression',
  long: 'I think one thing we need to be careful about is that even though the model itself has become much better in the last few months, the users in the product do not really feel this improvement, because the workflow around the model has not changed at all, so from their point of view nothing happened.',
  short: 'The model got better, but the workflow around it didn\'t — so users never felt the gain.',
  longWords: 58,
  shortWords: 17,
};

describe('persisted state migration', () => {
  it('keeps a first launch empty', () => {
    expect(migratePersistedState({
      formatVersion: 2,
      seeded: false,
      items: [],
      inbox: [],
      compressions: [],
      notificationReplies: [],
    })).toEqual({
      formatVersion: CURRENT_STATE_FORMAT_VERSION,
      items: [],
      inbox: [],
      compressions: [],
      notificationReplies: [],
    });
  });

  it('removes only legacy bundled data and preserves user state', () => {
    const userItem = {
      id: 'user-item',
      skeleton: legacyItems[0].skeleton,
      source: { kind: 'mine', raw: 'My own sentence.' },
    };
    const migrated = migratePersistedState({
      formatVersion: 2,
      seeded: true,
      profile: legacyProfile,
      items: [...legacyItems, userItem],
      inbox: [
        { id: 'demo-inbox', source: 'demo', text: 'bundled' },
        { id: 'user-inbox', source: 'app', text: 'mine' },
      ],
      compressions: [
        legacyCompression,
        { id: 'user-compression', long: 'My long text', short: 'My short text', longWords: 3, shortWords: 3 },
      ],
      notificationReplies: [
        { itemId: 'demo-0', answer: 'old' },
        { itemId: 'user-item', answer: 'mine' },
      ],
      settings: { baseUrl: 'https://provider.example/v1', model: 'my-model' },
      draft: 'unfinished user text',
      log: [{ type: 'flash' }],
    }) as Record<string, unknown>;

    expect(migrated.formatVersion).toBe(CURRENT_STATE_FORMAT_VERSION);
    expect(migrated).not.toHaveProperty('seeded');
    expect(migrated.profile).toEqual({
      name: '',
      role: '',
      org: '',
      domains: [],
      counterparts: [],
      scenarios: [],
      upcoming: '',
      variety: 'international',
    });
    expect(migrated.items).toEqual([userItem]);
    expect(migrated.inbox).toEqual([{ id: 'user-inbox', source: 'app', text: 'mine' }]);
    expect(migrated.compressions).toEqual([
      { id: 'user-compression', long: 'My long text', short: 'My short text', longWords: 3, shortWords: 3 },
    ]);
    expect(migrated.notificationReplies).toEqual([{ itemId: 'user-item', answer: 'mine' }]);
    expect(migrated.settings).toEqual({
      baseUrl: 'https://provider.example/v1',
      model: 'my-model',
    });
    expect(migrated.draft).toBe('unfinished user text');
    expect(migrated.log).toEqual([{ type: 'flash' }]);
  });

  it('does not clear a profile the user changed', () => {
    const profile = { ...legacyProfile, role: 'Solutions Architect' };
    const migrated = migratePersistedState({
      formatVersion: 2,
      profile,
      items: [],
    }) as Record<string, unknown>;

    expect(migrated.profile).toEqual(profile);
  });
});
