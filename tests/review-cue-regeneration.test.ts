import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewCueSchema } from '../src/llm/schemas';

describe('review cue regeneration', () => {
  it('requires both a concrete task and its complete Chinese meaning', () => {
    expect(reviewCueSchema.safeParse({
      brief: '当你想跟同事说明：压缩上下文能明显降低请求成本',
      target_zh: '发送请求前压缩上下文并裁掉无关背景能明显降低成本',
    }).success).toBe(true);
    expect(reviewCueSchema.safeParse({
      brief: '聊聊成本',
      target_zh: '',
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
    expect(llm).toContain("task: 'review_cue'");
    expect(store).toContain('export function setItemDrill');
  });
});
