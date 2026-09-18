import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  reviewCueSchema,
  reviewCueSchemaFor,
} from '../src/llm/schemas';

describe('review cue regeneration', () => {
  it('requires a trigger, a concrete task, and its complete Chinese meaning', () => {
    expect(reviewCueSchema.safeParse({
      trigger: '当对方担心请求成本时，提出先压缩无关上下文',
      brief: '当你想跟同事说明：压缩上下文能明显降低请求成本',
      target_zh: '发送请求前压缩上下文并裁掉无关背景能明显降低成本',
      answer: 'Compressing the context before each request can reduce inference costs.',
    }).success).toBe(true);
    expect(reviewCueSchema.safeParse({
      trigger: '',
      brief: '聊聊成本',
      target_zh: '',
      answer: '',
    }).success).toBe(false);
  });

  it('rejects a regenerated task that repeats the reference example', () => {
    const item = {
      kind: 'expression',
      skeleton: 'Just to give you a rough sense of X',
      seeds: [
        'Just to give you a rough sense of the scale, a typical media customer processes about 2TB of video data per day.',
      ],
      drill: null,
    };
    const schema = reviewCueSchemaFor(item);

    expect(schema.safeParse({
      trigger: '当你需要概括规模时，先给对方一个数量级',
      brief: '向客户说明一家典型媒体客户每天处理约 2TB 视频',
      target_zh: '大致让你了解一下这个规模，一家典型媒体客户每天处理大约 2TB 的视频数据。',
      answer: item.seeds[0],
    }).success).toBe(false);

    expect(schema.safeParse({
      trigger: '当团队讨论迁移周期时，先给出整体时间感',
      brief: '向团队说明迁移通常需要六到八周',
      target_zh: '大致让你了解一下时间安排，类似的迁移通常需要六到八周。',
      answer: 'Just to give you a rough sense of the timeline, a migration like this usually takes six to eight weeks.',
    }).success).toBe(true);
  });

  it('rejects a regeneration that only repeats the current Chinese task', () => {
    const schema = reviewCueSchemaFor({
      kind: 'expression',
      skeleton: 'The bottleneck has shifted from X to Y',
      seeds: ['The bottleneck has shifted from compute to data quality.'],
      drill: {
        target_zh: '真正的瓶颈已经从算力转移到了数据质量。',
      },
    });

    expect(schema.safeParse({
      trigger: '当团队重新定位问题时，说明瓶颈变化',
      brief: '说明真正的瓶颈已经从算力转移到了数据质量',
      target_zh: '真正的瓶颈已经从算力转移到了数据质量。',
      answer: 'The bottleneck has shifted from infrastructure to data quality.',
    }).success).toBe(false);
  });

  it('wires regeneration into old review cards and item details', () => {
    const view = readFileSync('js/views.js', 'utf8');
    const llm = readFileSync('js/llm.js', 'utf8');
    const store = readFileSync('js/store.js', 'utf8');

    expect(view).toContain('生成更具体的提示');
    expect(view).toContain('id="is-cue-regenerate"');
    expect(view).toContain('regenerateCueForItem');
    expect(llm).toContain('export async function regenerateReviewCue');
    expect(llm).toContain('reviewCueSchemaFor(item || {})');
    expect(llm).toContain("task: 'review_cue'");
    expect(store).toContain('export function setItemDrill');
    expect(view).toContain("it.drill?.answer || support.example");
  });
});
