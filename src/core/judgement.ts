export type JudgementIssueLevel = 'none' | 'minor' | 'blocking';

export interface JudgementResult {
  ok: boolean;
  used_target: boolean;
  meaning_intact: boolean;
  issue_level: JudgementIssueLevel;
  verdict: string;
  fix?: string | null;
  tighter?: string | null;
  note?: string;
  [key: string]: unknown;
}

export function normalizeJudgementText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/['\u2019]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function resolveJudgement(
  result: JudgementResult,
): JudgementResult {
  const ok = result.used_target
    && result.meaning_intact
    && result.issue_level !== 'blocking';

  if (ok === result.ok) return result;

  return {
    ...result,
    ok,
    verdict: ok
      ? '过了，目标结构和语义都对；局部错误已修正。'
      : '还没过，目标结构或核心语义需要调整。',
  };
}
