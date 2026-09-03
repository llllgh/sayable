export type LlmErrorKind =
  | 'auth'
  | 'model'
  | 'unsupported_region'
  | 'rate_limit'
  | 'network'
  | 'output_truncated'
  | 'invalid_output'
  | 'daily_limit'
  | 'configuration'
  | 'unknown';

const ACTIONS: Record<LlmErrorKind, string> = {
  auth: 'API Key 不对或没有权限，请到设置里重新填写后点“测一下”。',
  model: '接入点能访问，但模型标识不可用。请检查模型名或 Endpoint ID 后重试。',
  unsupported_region: '当前网络位置不在该模型服务支持范围内。请切换到可用网络，或选择其他文本模型服务。',
  rate_limit: '接入点正在限流，原文已保留到待处理，可稍后重试。',
  network: '当前网络不可用或接入点超时，原文已保留到待处理。',
  output_truncated: '模型推理占满了输出预算，结果未生成完整。请重试；若持续出现，请换用可关闭思考的模型。',
  invalid_output: '模型输出不符合格式，原文已保留，可稍后重新分析。',
  daily_limit: '今天的模型调用已到上限。闪存、召回和句库仍可使用。',
  configuration: '模型配置不完整，请填写接入点、API Key、模型和协议。',
  unknown: '模型调用失败，原文已保留，可稍后重试。',
};

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  readonly detail: string;

  constructor(kind: LlmErrorKind, detail = '', status?: number) {
    super(ACTIONS[kind]);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
    this.detail = detail.slice(0, 500);
  }
}

export function classifyHttpError(status: number, detail = ''): LlmError {
  const normalized = detail.toLowerCase();
  if (status === 401 || status === 403) return new LlmError('auth', detail, status);
  if (
    /location.+not supported/i.test(normalized)
    || /region.+not supported/i.test(normalized)
  ) {
    return new LlmError('unsupported_region', detail, status);
  }
  if (
    status === 404
    || /model.+(not found|not allowed|unavailable|invalid)/i.test(normalized)
    || /endpoint.+(not found|invalid)/i.test(normalized)
  ) {
    return new LlmError('model', detail, status);
  }
  if (status === 429 || status >= 500) return new LlmError('rate_limit', detail, status);
  return new LlmError('unknown', detail, status);
}

export function userMessage(error: unknown): string {
  if (error instanceof LlmError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
