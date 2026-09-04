import { describe, expect, it } from 'vitest';
import {
  buildReviewCue,
  hasSpecificReviewCue,
} from '../src/core/review-cue';

describe('buildReviewCue', () => {
  it('gives a near-translation Chinese prompt in guided (early) boxes', () => {
    const cue = buildReviewCue({
      box: 0,
      zh: '瓶颈从 X 转移到了 Y',
      drill: {
        brief: '当你想跟同事说：真正的瓶颈已经从算力转移到数据质量了',
        target_zh: '真正的瓶颈已经从算力转移到了数据质量',
      },
    });
    expect(cue.brief).toContain('真正的瓶颈已经从算力转移到了数据质量');
    expect(cue.target_zh).toBe('真正的瓶颈已经从算力转移到了数据质量');
    // guided 阶段应直接给可直译的具体中文，而不是泛场景
    expect(cue.brief).toContain('用英文说出');
  });

  it('falls back to the item meaning when no drill target is stored', () => {
    const cue = buildReviewCue({ box: 1, zh: '从成本角度看，这样做更划算' });
    expect(cue.brief).toContain('从成本角度看，这样做更划算');
    expect(cue.target_zh).toBe('从成本角度看，这样做更划算');
  });

  it('uses the model scenario task in recall (later) boxes', () => {
    const cue = buildReviewCue({
      box: 4,
      zh: '压缩上下文能省钱',
      drill: {
        brief: '跟同事解释：发请求前压缩上下文、裁掉无关背景能明显降本',
        target_zh: '发请求前压缩上下文、裁掉无关背景能明显降本',
      },
    });
    expect(cue.brief).toBe('跟同事解释：发请求前压缩上下文、裁掉无关背景能明显降本');
    expect(cue.target_zh).toBe('发请求前压缩上下文、裁掉无关背景能明显降本');
  });

  it('never mixes Chinese templates with English profile fields', () => {
    const cue = buildReviewCue({ box: 0, zh: '' });
    // 没有具体中文时也不拼接英文画像字段，避免「与Foreign colleagues沟通…」
    expect(cue.brief).not.toMatch(/[A-Za-z]{3,}/);
    expect(cue.brief).not.toContain('与');
  });

  it('handles a completely empty item without crashing', () => {
    const cue = buildReviewCue({ box: 9 });
    expect(cue.brief.length).toBeGreaterThan(0);
    expect(cue.ctx).toBe('');
    expect(cue.target_zh).toBe('');
  });

  it('recognizes only complete structured cues as specific', () => {
    expect(hasSpecificReviewCue({
      box: 0,
      drill: '旧版本保存的宽泛提示',
    })).toBe(false);
    expect(hasSpecificReviewCue({
      box: 0,
      drill: { brief: '说明一次变化' },
    })).toBe(false);
    expect(hasSpecificReviewCue({
      box: 0,
      drill: {
        brief: '说明成本瓶颈已经转移',
        target_zh: '成本瓶颈已经从算力转移到了数据质量',
      },
    })).toBe(true);
  });
});
