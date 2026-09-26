import { describe, expect, it } from 'vitest';
import {
  chunkSourceText,
  normalizeSourceDocument,
  pendingSourceCandidates,
  quoteAppearsInSource,
  sourceTextIssue,
} from '../src/core/source-import';
import { sourceExtractionSchemaFor } from '../src/llm/schemas';

const podcastExcerpt = `
Have you ever had that unsettling feeling that the ground is shifting under
your feet? I am talking about the conceptual ground, the feeling that the very
idea of evidence is evaporating. As deepfakes become common, anyone caught
doing something wrong can point to the evidence and say that it is just a
computer simulation. It creates a vacuum of truth where the default assumption
shifts from seeing is believing to seeing is suspicious. If you cannot prove a
photo is real, how do you prove anything? That question takes us into content
authenticity, provenance, and the digital chain of custody behind a file.
`;

const istioExcerpt = `
Istio generates detailed telemetry for all service communications within a
mesh. This telemetry provides observability of service behavior, empowering
operators to troubleshoot, maintain, and optimize their applications without
imposing any additional burdens on service developers. Metrics provide a way
of monitoring and understanding behavior in aggregate. To monitor service
behavior, Istio generates metrics for all service traffic in, out, and within
an Istio service mesh. Distributed tracing provides a way to monitor and
understand behavior by monitoring individual requests as they flow through a
mesh. Traces empower mesh operators to understand service dependencies and the
sources of latency within their service mesh.
`;

const awsExcerpt = `
A service mesh is a dedicated infrastructure layer that manages communications
between services in a distributed application. A service mesh intercepts
traffic to handle a broad range of functions, including observability, service
discovery, logging and tracing, and service retries, without requiring
developers to make special changes to containerized microservices. In modern
application architectures, you can build your application as a collection of
small, independently deployable microservices. A service mesh solves the
visibility problem by generating metrics, logs, and traces for all traffic.
Administrators can configure advanced traffic behavior independent of
application logic, so a failure in one service does not cascade across the
entire application.
`;

function sourceCandidate(overrides = {}) {
  return {
    id: 'candidate-1',
    documentId: 'document-1',
    chunkIndex: 0,
    kind: 'expression',
    termCategory: '',
    skeleton: 'the default assumption shifts from X to Y',
    zh: '默认假设从 X 转向 Y',
    lemma: '',
    sense: '',
    quote: 'It creates a vacuum of truth where the default assumption shifts from seeing is believing to seeing is suspicious.',
    sourceTitle: 'Podcast transcript',
    sourceUrl: 'https://example.com/transcript',
    consumedAt: 0,
    recommendationId: '',
    createdAt: 100,
    ...overrides,
  };
}

describe('long-text source imports', () => {
  it('accepts transcript and formal documentation prose', () => {
    expect(sourceTextIssue(podcastExcerpt)).toBe('');
    expect(sourceTextIssue(istioExcerpt)).toBe('');
    expect(sourceTextIssue(awsExcerpt)).toBe('');
    expect(sourceTextIssue('A short sentence.')).toContain('至少需要');
  });

  it('splits long input with bounded overlapping chunks', () => {
    const chunks = chunkSourceText(
      [podcastExcerpt, istioExcerpt, awsExcerpt].join('\n\n').repeat(4),
      900,
      100,
    );

    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every(chunk => chunk.length <= 900)).toBe(true);
    expect(chunks.join(' ').toLowerCase()).toContain('distributed tracing');
    expect(chunks.join(' ').toLowerCase()).toContain('default assumption');
  });

  it('requires exact source evidence and an anchored target', () => {
    const accepted = sourceExtractionSchemaFor(podcastExcerpt).safeParse({
      items: [{
        kind: 'expression',
        skeleton: 'the default assumption shifts from X to Y',
        zh: '默认假设从 X 转向 Y',
        lemma: null,
        sense: null,
        quote: 'It creates a vacuum of truth where the default assumption shifts from seeing is believing to seeing is suspicious.',
      }],
    });
    const mixed = sourceExtractionSchemaFor(podcastExcerpt).safeParse({
      items: [{
        kind: 'expression',
        skeleton: 'the default assumption shifts from X to Y',
        zh: '默认假设从 X 转向 Y',
        lemma: null,
        sense: null,
        quote: 'It creates a vacuum of truth where the default assumption shifts from seeing is believing to seeing is suspicious.',
      }, {
        kind: 'expression',
        skeleton: 'the evidence points from X to Y',
        zh: '证据从 X 指向 Y',
        lemma: null,
        sense: null,
        quote: 'The evidence points from doubt to certainty.',
      }],
    });

    expect(accepted.success).toBe(true);
    expect(mixed.success).toBe(true);
    expect(mixed.data?.items).toHaveLength(1);
    expect(quoteAppearsInSource(
      'Metrics provide a way of monitoring and understanding behavior in aggregate.',
      istioExcerpt,
    )).toBe(true);
  });

  it('restores interrupted work and filters consumed, duplicate, and disabled candidates', () => {
    expect(normalizeSourceDocument({
      id: 'document-1',
      title: 'Istio',
      body: istioExcerpt,
      status: 'processing',
      chunkCount: 3,
      nextChunkIndex: 1,
    })).toMatchObject({
      status: 'interrupted',
      nextChunkIndex: 1,
      error: '上次提炼未完成，请继续',
    });

    const candidates = [
      sourceCandidate(),
      sourceCandidate({
        id: 'candidate-2',
        kind: 'term',
        termCategory: 'everyday',
        skeleton: 'chipped',
        lemma: 'chipped',
        zh: '有缺口的',
        sense: '有缺口的',
        quote: 'The rim of the cup is chipped.',
      }),
      sourceCandidate({
        id: 'candidate-3',
        skeleton: 'without imposing X on Y',
        quote: 'It works without imposing extra work on service developers.',
        consumedAt: 200,
      }),
    ];
    const pending = pendingSourceCandidates({
      candidates,
      existingItems: [{
        kind: 'expression',
        skeleton: 'a different existing expression',
      }],
      allowEverydayTerms: false,
    });

    expect(pending.map(item => item.id)).toEqual(['candidate-1']);
    expect(pendingSourceCandidates({
      candidates,
      existingItems: [{
        kind: 'expression',
        skeleton: 'the default assumption shifts from X to Y',
      }],
      allowEverydayTerms: true,
    }).map(item => item.id)).toEqual(['candidate-2']);
  });
});
