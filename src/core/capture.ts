function expandContractions(value: string): string {
  return value
    .replace(/\bcan't\b/giu, 'cannot')
    .replace(/\bwon't\b/giu, 'will not')
    .replace(/\b(\p{L}+)'re\b/giu, '$1 are')
    .replace(/\b(\p{L}+)'ve\b/giu, '$1 have')
    .replace(/\b(\p{L}+)'ll\b/giu, '$1 will')
    .replace(/\b(\p{L}+)'d\b/giu, '$1 would')
    .replace(/\b(\p{L}+)'m\b/giu, '$1 am')
    .replace(/\b(\p{L}+)'t\b/giu, '$1 not');
}

function canonicalWord(value: string): string {
  const word = value.toLocaleLowerCase('en-US');
  if (/^(am|is|are|was|were|been|being)$/u.test(word)) return 'be';
  if (/^(has|had|having)$/u.test(word)) return 'have';
  if (/^(does|did|doing)$/u.test(word)) return 'do';
  if (word.length > 5 && word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    return stem.length > 3 && stem[stem.length - 1] === stem[stem.length - 2]
      ? stem.slice(0, -1)
      : stem;
  }
  if (word.length > 4 && word.endsWith('ied')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function normalizedWords(value: string): string[] {
  return expandContractions(String(value || '').normalize('NFKC'))
    .match(/[\p{L}\p{N}]+/gu)
    ?.map(canonicalWord)
    ?? [];
}

function skeletonSegments(skeleton: string): string[][] {
  const tokens = normalizedWords(
    String(skeleton || '').replace(/\[[^\]]*\b[XYZ]\b[^\]]*\]/giu, ' X '),
  );
  const segments: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (/^[xyz]$/u.test(token)) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

export function fixedSkeletonWords(skeleton: string): string[] {
  return skeletonSegments(skeleton).flat();
}

function segmentIndex(
  words: string[],
  segment: string[],
  start: number,
): number {
  const lastStart = words.length - segment.length;
  for (let index = start; index <= lastStart; index += 1) {
    if (segment.every((word, offset) => words[index + offset] === word)) {
      return index;
    }
  }
  return -1;
}

export function skeletonAnchoredInExpression(
  skeleton: string,
  expression: string,
): boolean {
  const segments = skeletonSegments(skeleton);
  const fixed = segments.flat();
  const words = normalizedWords(expression);
  if (fixed.length < 2 || !words.length) return false;

  let position = 0;
  for (const segment of segments) {
    const index = segmentIndex(words, segment, position);
    if (index < 0) return false;
    position = index + segment.length;
  }
  return true;
}
