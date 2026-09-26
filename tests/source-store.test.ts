import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));

import {
  completeSourceChunk,
  createSourceDocument,
  deleteSourceDocument,
  failSourceDocument,
  pendingSourceCandidatePool,
  resumeSourceDocument,
  saveDailyRecommendations,
  state,
} from '../js/store.js';

const body = `
A service mesh is a dedicated infrastructure layer that manages communications
between services in a distributed application. It intercepts traffic to handle
observability, service discovery, logging, tracing, and retries without
requiring developers to make special changes to containerized microservices.
In modern application architectures, teams build applications as collections
of small, independently deployable services. As applications scale, it becomes
increasingly challenging to understand how everything works together. A
service mesh generates metrics, logs, and traces for all traffic, giving teams
visibility into upstream and downstream dependencies. Administrators can also
configure traffic behavior independent of application logic.
`;

function recommendation(index: number) {
  return {
    kind: 'expression',
    skeleton: index === 0
      ? 'without requiring X to Y'
      : `shift recommendation ${index} from X to Y`,
    zh: `第 ${index} 个表达`,
    trigger: `当需要说明第 ${index} 个变化时，概括重点`,
    why: '适合真实工作沟通',
    example: index === 0
      ? 'The proxy adds tracing without requiring developers to change application code.'
      : `We should shift recommendation ${index} from speed to reliability.`,
    example_zh: index === 0
      ? '代理增加了追踪能力，而无需开发人员修改应用代码。'
      : `我们应该把第 ${index} 项重点从速度转向可靠性。`,
    drill: {
      brief: `在新场景说明第 ${index} 个变化`,
      target_zh: index === 0
        ? '这项检查无需团队重写部署流程。'
        : `我们应该把第 ${index} 项预算重点从获客转向留存。`,
      answer: index === 0
        ? 'This check works without requiring the team to rewrite the deployment process.'
        : `We should shift recommendation ${index} from acquisition to retention.`,
    },
    register: 'meeting',
    tags: ['协作'],
  };
}

describe('source import store', () => {
  beforeEach(() => {
    state.items = [];
    state.log = [];
    state.sourceDraft = { title: '', sourceUrl: '', body: '' };
    state.sourceDocuments = [];
    state.sourceCandidates = [];
    state.dailyRecommendations = null;
  });

  it('persists chunk progress and deduplicates candidates locally', () => {
    const document = createSourceDocument({
      title: 'AWS service mesh',
      sourceUrl: 'https://aws.amazon.com/what-is/service-mesh/',
      body,
    });
    const candidate = {
      kind: 'expression',
      skeleton: 'without requiring X to Y',
      zh: '无需 X 做 Y',
      quote: 'It intercepts traffic to handle observability, service discovery, logging, tracing, and retries without requiring developers to make special changes to containerized microservices.',
    };

    completeSourceChunk(document.id, 0, [candidate, candidate]);

    expect(document).toMatchObject({
      status: 'ready',
      nextChunkIndex: 1,
      candidateCount: 1,
    });
    expect(state.sourceCandidates).toHaveLength(1);
    expect(pendingSourceCandidatePool()).toHaveLength(1);
  });

  it('continues a multi-chunk import from the next unfinished chunk', () => {
    const document = createSourceDocument({
      title: 'Long transcript',
      body: body.repeat(12),
    });
    expect(document.chunkCount).toBeGreaterThan(1);

    completeSourceChunk(document.id, 0, [{
      kind: 'expression',
      skeleton: 'without requiring X to Y',
      zh: '无需 X 做 Y',
      quote: 'It intercepts traffic to handle observability, service discovery, logging, tracing, and retries without requiring developers to make special changes to containerized microservices.',
    }]);
    expect(document).toMatchObject({
      status: 'processing',
      nextChunkIndex: 1,
    });

    failSourceDocument(document.id, 'network unavailable');
    expect(document).toMatchObject({
      status: 'failed',
      nextChunkIndex: 1,
    });
    resumeSourceDocument(document.id);
    expect(document).toMatchObject({
      status: 'processing',
      nextChunkIndex: 1,
    });
  });

  it('marks a source candidate consumed only after saving a valid daily deck', async () => {
    const document = createSourceDocument({ title: 'AWS service mesh', body });
    completeSourceChunk(document.id, 0, [{
      kind: 'expression',
      skeleton: 'without requiring X to Y',
      zh: '无需 X 做 Y',
      quote: 'It intercepts traffic to handle observability, service discovery, logging, tracing, and retries without requiring developers to make special changes to containerized microservices.',
    }]);
    const source = state.sourceCandidates[0];
    const items = Array.from({ length: 5 }, (_, index) => recommendation(index));
    items[0] = {
      ...items[0],
      sourceCandidateId: source.id,
      sourceDocumentId: source.documentId,
      sourceQuote: source.quote,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
    } as typeof items[number];

    const deck = await saveDailyRecommendations(items);

    expect(source.consumedAt).toBeGreaterThan(0);
    expect(source.recommendationId).toBe(
      deck.items.find(item => item.sourceCandidateId)?.id,
    );
    expect(pendingSourceCandidatePool()).toHaveLength(0);

    deleteSourceDocument(document.id);
    expect(state.sourceDocuments).toHaveLength(0);
    expect(state.sourceCandidates).toHaveLength(0);
  });
});
