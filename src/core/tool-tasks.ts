export type ToolTaskStatus = 'idle' | 'running' | 'ready' | 'failed' | 'interrupted';

export interface ToolTaskSource {
  kind: string;
  id: string;
}

export interface ToolTask {
  status: ToolTaskStatus;
  input: string;
  result: unknown;
  resultId: string;
  error: string;
  source: ToolTaskSource | null;
  startedAt: number;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeSource(value: unknown): ToolTaskSource | null {
  if (!isRecord(value)) return null;
  const kind = text(value.kind).trim();
  const id = text(value.id).trim();
  return kind && id ? { kind, id } : null;
}

export function emptyToolTask(): ToolTask {
  return {
    status: 'idle',
    input: '',
    result: null,
    resultId: '',
    error: '',
    source: null,
    startedAt: 0,
    updatedAt: 0,
  };
}

export function normalizeToolTask(value: unknown): ToolTask {
  if (!isRecord(value)) return emptyToolTask();
  const rawStatus = text(value.status);
  const status: ToolTaskStatus = rawStatus === 'running'
    ? 'interrupted'
    : ['idle', 'ready', 'failed', 'interrupted'].includes(rawStatus)
      ? rawStatus as ToolTaskStatus
      : 'idle';
  return {
    status,
    input: text(value.input),
    result: value.result ?? null,
    resultId: text(value.resultId),
    error: status === 'interrupted'
      ? text(value.error) || '上次请求未完成，请重试'
      : text(value.error),
    source: normalizeSource(value.source),
    startedAt: timestamp(value.startedAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

export function normalizeToolTasks(value: unknown): Record<'compression' | 'preflight', ToolTask> {
  const tasks = isRecord(value) ? value : {};
  return {
    compression: normalizeToolTask(tasks.compression),
    preflight: normalizeToolTask(tasks.preflight),
  };
}
