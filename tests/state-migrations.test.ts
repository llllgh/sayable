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
      dailyRecommendations: null,
      notificationReplies: [],
    })).toEqual({
      formatVersion: CURRENT_STATE_FORMAT_VERSION,
      profile: undefined,
      items: [],
      inbox: [],
      compressions: [],
      dailyRecommendations: null,
      notificationReplies: [],
      settings: {
        providerMode: 'profile',
        serviceRegion: 'cn',
        voiceMode: 'system',
        baseUrl: '',
        model: '',
        protocol: 'chat_completions',
      },
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
      goal: '',
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
      protocol: 'chat_completions',
      providerMode: 'custom',
      serviceRegion: 'cn',
      voiceMode: 'system',
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

  it('adds voice defaults without replacing an existing provider', () => {
    const migrated = migratePersistedState({
      formatVersion: 3,
      settings: {
        baseUrl: 'https://custom.example/v1',
        model: 'custom-model',
        protocol: 'responses',
      },
    }) as Record<string, any>;

    expect(migrated.formatVersion).toBe(CURRENT_STATE_FORMAT_VERSION);
    expect(migrated.settings).toMatchObject({
      providerMode: 'custom',
      serviceRegion: 'cn',
      voiceMode: 'system',
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      protocol: 'responses',
    });
  });

  it('keeps profile-managed connection fields out of user settings', () => {
    const migrated = migratePersistedState({
      formatVersion: 3,
      settings: {
        providerMode: 'profile',
        serviceRegion: 'global',
        baseUrl: 'https://stale.example/v1',
        model: 'stale-model',
      },
    }) as Record<string, any>;

    expect(migrated.settings).toMatchObject({
      providerMode: 'profile',
      serviceRegion: 'global',
      baseUrl: '',
      model: '',
      protocol: 'responses',
    });
  });

  it('preserves a valid daily recommendation deck', () => {
    const migrated = migratePersistedState({
      formatVersion: 4,
      items: [],
      dailyRecommendations: {
        date: '2026-09-01',
        generatedAt: 100,
        currentIndex: 1,
        items: Array.from({ length: 5 }, (_, index) => ({
          id: `recommendation-${index}`,
          skeleton: `move from X to Y ${index}`,
          zh: `从 X 转向 Y ${index}`,
          why: '适合当前沟通场景',
          example: `We moved from option ${index} to a clearer plan.`,
          drill: '说明一次变化',
          register: 'meeting',
          tags: ['推进'],
          collectedItemId: '',
        })),
      },
    }) as Record<string, any>;

    expect(migrated.formatVersion).toBe(CURRENT_STATE_FORMAT_VERSION);
    expect(migrated.dailyRecommendations.currentIndex).toBe(1);
    expect(migrated.dailyRecommendations.items).toHaveLength(5);
  });
});
