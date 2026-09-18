import { describe, expect, it } from 'vitest';
import {
  CURRENT_STATE_FORMAT_VERSION,
  migratePersistedState,
} from '../src/storage/state-migrations';
import { emptyToolTask } from '../src/core/tool-tasks';

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
      roleplaySessions: [],
      dailyRecommendations: null,
      notificationReplies: [],
    })).toEqual({
      formatVersion: CURRENT_STATE_FORMAT_VERSION,
      profile: undefined,
      items: [],
      inbox: [],
      compressions: [],
      drafts: {
        quickCapture: '',
        expression: '',
        compression: '',
        preflight: '',
      },
      toolTasks: {
        compression: emptyToolTask(),
        preflight: emptyToolTask(),
      },
      practiceSessions: [],
      roleplaySessions: [],
      dailyRecommendations: null,
      notificationReplies: [],
      settings: {
        providerMode: 'profile',
        textProviderId: 'modelark-cn',
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
      englishLevel: null,
    });
    expect(migrated.items).toEqual([{
      ...userItem,
      kind: 'expression',
      trigger: '',
    }]);
    expect(migrated.inbox).toEqual([{
      id: 'user-inbox',
      source: 'app',
      text: 'mine',
      status: 'raw',
      failReason: '',
    }]);
    expect(migrated.compressions).toEqual([
      { id: 'user-compression', long: 'My long text', short: 'My short text', longWords: 3, shortWords: 3 },
    ]);
    expect(migrated.roleplaySessions).toEqual([]);
    expect(migrated.notificationReplies).toEqual([{ itemId: 'user-item', answer: 'mine' }]);
    expect(migrated.settings).toEqual({
      baseUrl: 'https://provider.example/v1',
      model: 'my-model',
      protocol: 'chat_completions',
      providerMode: 'custom',
      textProviderId: 'modelark-cn',
      serviceRegion: 'cn',
      voiceMode: 'system',
    });
    expect(migrated).not.toHaveProperty('draft');
    expect(migrated.drafts).toEqual({
      quickCapture: 'unfinished user text',
      expression: '',
      compression: '',
      preflight: '',
    });
    expect(migrated.practiceSessions).toEqual([]);
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
      textProviderId: 'byteplus-global',
      serviceRegion: 'global',
      baseUrl: '',
      model: '',
      protocol: 'responses',
    });
  });

  it('preserves an explicitly selected Gemini provider', () => {
    const migrated = migratePersistedState({
      formatVersion: 5,
      settings: {
        providerMode: 'profile',
        serviceRegion: 'global',
        textProviderId: 'google-gemini',
        protocol: 'responses',
      },
    }) as Record<string, any>;

    expect(migrated.settings).toMatchObject({
      providerMode: 'profile',
      serviceRegion: 'global',
      textProviderId: 'google-gemini',
      baseUrl: '',
      model: '',
      protocol: 'chat_completions',
    });
  });

  it('removes legacy hidden request limits', () => {
    const migrated = migratePersistedState({
      formatVersion: 6,
      settings: {
        providerMode: 'profile',
        serviceRegion: 'global',
        textProviderId: 'google-gemini',
        maxTokens: 1600,
        timeoutMs: 30000,
      },
    }) as Record<string, any>;

    expect(migrated.settings).not.toHaveProperty('maxTokens');
    expect(migrated.settings).not.toHaveProperty('timeoutMs');
  });

  it('invalidates legacy recommendation decks without transfer drills', () => {
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
    expect(migrated.dailyRecommendations).toBeNull();
  });

  it('backfills an old item trigger only from a structured review cue', () => {
    const migrated = migratePersistedState({
      formatVersion: 7,
      items: [
        {
          id: 'with-cue',
          skeleton: 'move from X to Y',
          drill: {
            brief: '当客户担心一次性投入过大时，提出先做小范围试点',
            target_zh: '我们可以先在一个部门试点，再推广到整个组织',
          },
        },
        {
          id: 'without-cue',
          skeleton: 'X remains unclear',
          why: '这个表达适合澄清问题',
        },
      ],
    }) as Record<string, any>;

    expect(migrated.items[0].trigger)
      .toBe('当客户担心一次性投入过大时，提出先做小范围试点');
    expect(migrated.items[1].trigger).toBe('');
  });

  it('preserves existing roleplay sessions and initializes missing storage', () => {
    const session = {
      id: 'roleplay-1',
      itemId: 'item-1',
      startedAt: 100,
      completedAt: 0,
      scenario: '客户担心风险',
      role: '客户 CTO',
      turns: [{ speaker: 'ai', text: 'How would you reduce the risk?', at: 100 }],
      result: null,
    };
    const migrated = migratePersistedState({
      formatVersion: 8,
      items: [],
      roleplaySessions: [session],
    }) as Record<string, any>;

    expect(migrated.roleplaySessions).toEqual([session]);
  });

  it('normalizes interrupted practice sessions without treating legacy drafts as answers', () => {
    const migrated = migratePersistedState({
      formatVersion: 9,
      draft: 'unfinished capture',
      practiceSessions: [{
        id: 'practice-1',
        itemId: 'item-1',
        source: 'due-review',
        sourceId: 'item-1',
        startedAt: 100,
        updatedAt: 200,
        phase: 'submitting',
        cue: {
          brief: '向客户确认时间',
          ctx: '项目会议',
          target_zh: '我们能否周五前确认？',
        },
        answerDraft: 'Could we confirm this by Friday?',
        attempts: [{
          id: 'attempt-1',
          kind: 'initial',
          status: 'submitting',
          answer: 'Could we confirm this by Friday?',
          inputMode: 'text',
          startedAt: 200,
        }],
      }],
    }) as Record<string, any>;

    expect(migrated.drafts.quickCapture).toBe('unfinished capture');
    expect(migrated.practiceSessions[0]).toMatchObject({
      id: 'practice-1',
      phase: 'answering',
      answerDraft: 'Could we confirm this by Friday?',
      cue: {
        context: '项目会议',
      },
    });
    expect(migrated.practiceSessions[0].attempts[0]).toMatchObject({
      status: 'error',
      answer: 'Could we confirm this by Friday?',
    });
  });

  it('migrates analyzed records and interrupted tool requests without losing results', () => {
    const migrated = migratePersistedState({
      formatVersion: 10,
      inbox: [{
        id: 'record-1',
        text: 'Confirm the delivery plan',
        status: 'done',
        analysis: { natural: 'Could we confirm the delivery plan?' },
      }],
      toolTasks: {
        compression: {
          status: 'ready',
          input: 'A long explanation',
          resultId: 'compression-1',
        },
        preflight: {
          status: 'running',
          input: 'Launch review',
          startedAt: 100,
        },
      },
    }) as Record<string, any>;

    expect(migrated.inbox[0]).toMatchObject({
      status: 'ready',
      analysis: { natural: 'Could we confirm the delivery plan?' },
    });
    expect(migrated.toolTasks.compression).toMatchObject({
      status: 'ready',
      input: 'A long explanation',
      resultId: 'compression-1',
    });
    expect(migrated.toolTasks.preflight).toMatchObject({
      status: 'interrupted',
      input: 'Launch review',
      error: '上次请求未完成，请重试',
    });
  });

  it('defaults old items to expressions and normalizes professional term fields', () => {
    const migrated = migratePersistedState({
      formatVersion: 11,
      items: [
        {
          id: 'old-expression',
          skeleton: 'move from X to Y',
          zh: '从 X 转向 Y',
        },
        {
          id: 'term-1',
          kind: 'term',
          skeleton: 'stale value',
          zh: '旧释义',
          lemma: 'latency',
          sense: '系统响应请求所需的延迟时间',
          collocations: ['reduce latency', 'latency budget'],
          anchorSentence: 'We need to reduce latency before launch.',
          relatedExpressionIds: ['old-expression'],
          domainTags: ['性能'],
        },
      ],
    }) as Record<string, any>;

    expect(migrated.formatVersion).toBe(12);
    expect(migrated.items[0]).toMatchObject({
      kind: 'expression',
      skeleton: 'move from X to Y',
    });
    expect(migrated.items[1]).toMatchObject({
      kind: 'term',
      skeleton: 'latency',
      zh: '系统响应请求所需的延迟时间',
      lemma: 'latency',
      relatedExpressionIds: ['old-expression'],
    });
  });
});
