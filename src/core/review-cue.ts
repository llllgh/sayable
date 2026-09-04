import { reviewPromptMode } from './review-support';

export interface ReviewCueDrill {
  brief?: string;
  target_zh?: string;
}

export interface ReviewCueItem {
  box: number;
  zh?: string;
  drill?: ReviewCueDrill | string | null;
}

export interface ReviewCue {
  brief: string;
  ctx: string;
  target_zh: string;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function drillFor(item: ReviewCueItem): ReviewCueDrill {
  return item.drill && typeof item.drill === 'object' ? item.drill : {};
}

export function hasSpecificReviewCue(item: ReviewCueItem): boolean {
  const drill = drillFor(item);
  return Boolean(clean(drill.brief) && clean(drill.target_zh));
}

/**
 * 生成一道复习/造句题的提示文案。原则：
 * - 前几档（guided）给「接近翻译」的具体中文，明确告诉学习者要用英文说什么，
 *   提示才真正有作用，而不是给一个泛场景让他自己想。
 * - 后几档（recall）用捕获时模型写好的具体情景任务，不泄露答案。
 * - 全程只用中文文案，绝不把中文模板套在英文画像字段上（避免「与Foreign colleagues沟通…」这类夹杂）。
 */
export function buildReviewCue(item: ReviewCueItem): ReviewCue {
  const drill = drillFor(item);
  const meaning = clean(drill.target_zh) || clean(item.zh);
  const scenarioTask = clean(drill.brief);
  const guided = reviewPromptMode(item.box) === 'guided';

  if (guided && meaning) {
    return {
      brief: `用英文说出下面这句话的意思：${meaning}`,
      ctx: meaning,
      target_zh: meaning,
    };
  }

  if (scenarioTask) {
    return {
      brief: scenarioTask,
      ctx: meaning || scenarioTask,
      target_zh: meaning,
    };
  }

  if (meaning) {
    return {
      brief: `回想并用英文说出这个意思：${meaning}`,
      ctx: meaning,
      target_zh: meaning,
    };
  }

  return {
    brief: '用这个表达，就你手头正在推进的一件事，完整说一句英文。',
    ctx: '',
    target_zh: '',
  };
}
