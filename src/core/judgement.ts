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

export type JudgementDiffKind = 'equal' | 'delete' | 'insert';

export interface JudgementDiffSegment {
  value: string;
  changed: boolean;
}

export interface JudgementDiffChange {
  before: string;
  after: string;
}

export interface JudgementDiff {
  before: JudgementDiffSegment[];
  after: JudgementDiffSegment[];
  changes: JudgementDiffChange[];
  summary: string;
}

export interface JudgementFeedback {
  verdict: string;
  note: string;
  correction: JudgementDiff | null;
  tighter: JudgementDiff | null;
}

interface DisplayToken {
  value: string;
  key: string;
  wordIndex: number;
}

interface WordDiffOperation {
  kind: JudgementDiffKind;
  before?: string;
  after?: string;
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

function wordKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/['\u2019]/gu, '');
}

function displayTokens(value: string): DisplayToken[] {
  const text = String(value || '');
  const tokens: DisplayToken[] = [];
  const wordPattern = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;
  let lastIndex = 0;
  let wordIndex = 0;

  for (const match of text.matchAll(wordPattern)) {
    const index = match.index || 0;
    if (index > lastIndex) {
      tokens.push({
        value: text.slice(lastIndex, index),
        key: '',
        wordIndex: -1,
      });
    }
    tokens.push({
      value: match[0],
      key: wordKey(match[0]),
      wordIndex,
    });
    wordIndex += 1;
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      value: text.slice(lastIndex),
      key: '',
      wordIndex: -1,
    });
  }

  return tokens;
}

function wordDiff(
  before: DisplayToken[],
  after: DisplayToken[],
): WordDiffOperation[] {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const lcs = Array.from(
    { length: rows },
    () => Array<number>(columns).fill(0),
  );

  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lcs[left][right] = before[left].key === after[right].key
        ? lcs[left + 1][right + 1] + 1
        : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
    }
  }

  const operations: WordDiffOperation[] = [];
  let left = 0;
  let right = 0;

  while (left < before.length || right < after.length) {
    if (
      left < before.length
      && right < after.length
      && before[left].key === after[right].key
    ) {
      operations.push({
        kind: 'equal',
        before: before[left].value,
        after: after[right].value,
      });
      left += 1;
      right += 1;
    } else if (
      left < before.length
      && (
        right >= after.length
        || lcs[left + 1][right] >= lcs[left][right + 1]
      )
    ) {
      operations.push({
        kind: 'delete',
        before: before[left].value,
      });
      left += 1;
    } else {
      operations.push({
        kind: 'insert',
        after: after[right].value,
      });
      right += 1;
    }
  }

  return operations;
}

function mergeSegments(
  tokens: DisplayToken[],
  changedWords: Set<number>,
): JudgementDiffSegment[] {
  return tokens.reduce<JudgementDiffSegment[]>((segments, token) => {
    const changed = token.wordIndex >= 0 && changedWords.has(token.wordIndex);
    const previous = segments[segments.length - 1];
    if (previous && previous.changed === changed) {
      previous.value += token.value;
    } else {
      segments.push({
        value: token.value,
        changed,
      });
    }
    return segments;
  }, []);
}

function collectChanges(
  operations: WordDiffOperation[],
): JudgementDiffChange[] {
  const changes: JudgementDiffChange[] = [];
  let before: string[] = [];
  let after: string[] = [];

  const flush = () => {
    if (!before.length && !after.length) return;
    changes.push({
      before: before.join(' '),
      after: after.join(' '),
    });
    before = [];
    after = [];
  };

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      flush();
    } else if (operation.kind === 'delete' && operation.before) {
      before.push(operation.before);
    } else if (operation.kind === 'insert' && operation.after) {
      after.push(operation.after);
    }
  }
  flush();

  return changes;
}

function changeSummary(changes: JudgementDiffChange[]): string {
  const visible = changes.slice(0, 2).map((change) => {
    if (change.before && change.after) {
      return `“${change.before}”改为“${change.after}”`;
    }
    if (change.before) return `删去“${change.before}”`;
    return `补上“${change.after}”`;
  });
  const remainder = changes.length - visible.length;
  return `具体变化：${visible.join('；')}${remainder > 0 ? `；另有 ${remainder} 处` : ''}。`;
}

export function compareJudgementText(
  before: string,
  after: string | null | undefined,
): JudgementDiff | null {
  if (
    !after?.trim()
    || normalizeJudgementText(before) === normalizeJudgementText(after)
  ) {
    return null;
  }

  const beforeTokens = displayTokens(before);
  const afterTokens = displayTokens(after);
  const beforeWords = beforeTokens.filter((token) => token.wordIndex >= 0);
  const afterWords = afterTokens.filter((token) => token.wordIndex >= 0);
  const operations = wordDiff(beforeWords, afterWords);
  const changedBefore = new Set<number>();
  const changedAfter = new Set<number>();
  let beforeIndex = 0;
  let afterIndex = 0;

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      beforeIndex += 1;
      afterIndex += 1;
    } else if (operation.kind === 'delete') {
      changedBefore.add(beforeIndex);
      beforeIndex += 1;
    } else {
      changedAfter.add(afterIndex);
      afterIndex += 1;
    }
  }

  const changes = collectChanges(operations);
  if (!changes.length) return null;

  return {
    before: mergeSegments(beforeTokens, changedBefore),
    after: mergeSegments(afterTokens, changedAfter),
    changes,
    summary: changeSummary(changes),
  };
}

export function buildJudgementFeedback(
  answer: string,
  result: Partial<JudgementResult>,
): JudgementFeedback {
  const correction = compareJudgementText(answer, result.fix);
  const tighter = compareJudgementText(answer, result.tighter);
  const correctionTarget = normalizeJudgementText(result.fix || '');
  const tighterTarget = normalizeJudgementText(result.tighter || '');
  const distinctTighter = tighter && tighterTarget !== correctionTarget
    ? tighter
    : null;

  if (result.ok) {
    if (correction) {
      return {
        verdict: '通过，骨架和语义都对；只需调整下面高亮的部分。',
        note: result.note || '',
        correction,
        tighter: distinctTighter,
      };
    }
    if (distinctTighter) {
      return {
        verdict: '通过，骨架和表达都对。下面是一种更紧凑的说法。',
        note: '',
        correction: null,
        tighter: distinctTighter,
      };
    }
    return {
      verdict: '通过，骨架和表达都对，没有需要改的地方。',
      note: '',
      correction: null,
      tighter: null,
    };
  }

  return {
    verdict: '还没通过，目标结构或核心语义需要调整。',
    note: result.note || '',
    correction,
    tighter: distinctTighter,
  };
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
