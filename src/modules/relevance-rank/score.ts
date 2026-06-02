import { NUMERIC_SIGNAL } from './constants';

const matchCount = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Score a chunk against a list of hint keywords/phrases. Exact phrase hits
 * weigh 5×; individual content words (longer than 3 chars) weigh 1×.
 * Numeric / CAGR / $ / % mentions add a 2× bonus.
 */
export function scoreChunk(chunk: string, hints: string[]): number {
  const lower = chunk.toLowerCase();
  let score = 0;

  for (const hint of hints) {
    const h = hint.toLowerCase();

    score += matchCount(lower, new RegExp(escapeRegex(h), 'g')) * 5;
    for (const word of h.split(/\s+/).filter((w) => w.length > 3)) {
      score += matchCount(lower, new RegExp(`\\b${escapeRegex(word)}\\b`, 'g'));
    }
  }

  score += matchCount(chunk, NUMERIC_SIGNAL) * 2;

  return score;
}
