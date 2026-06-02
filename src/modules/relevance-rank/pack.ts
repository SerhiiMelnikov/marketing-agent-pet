import { scoreChunk } from './score';

/**
 * Pack chunks in document order until the budget is hit. Used when no hints
 * are provided — the agent gets the lead sections.
 */
export function packInOrder(chunks: string[], budgetChars: number): string {
  const kept: string[] = [];
  let used = 0;

  for (const chunk of chunks) {
    if (used + chunk.length > budgetChars) break;
    kept.push(chunk);
    used += chunk.length;
  }
  if (!kept.length && chunks.length) {
    // A single huge chunk over budget — slice the head so the agent gets something.
    kept.push(chunks[0].slice(0, budgetChars));
  }

  return kept.join('\n\n');
}

/**
 * Score each chunk against hints, pack the highest-scoring ones within
 * budget, then return them in document order for readability.
 */
export function packByScore(chunks: string[], hints: string[], budgetChars: number): string {
  const ranked = chunks
    .map((chunk, i) => ({ chunk, i, score: scoreChunk(chunk, hints) }))
    .sort((a, b) => b.score - a.score);

  const kept: { chunk: string; i: number }[] = [];
  let used = 0;

  for (const item of ranked) {
    if (used + item.chunk.length > budgetChars) continue;
    kept.push({ chunk: item.chunk, i: item.i });
    used += item.chunk.length;
  }
  if (!kept.length && ranked.length) {
    // No section fits whole — slice the head of the top-scored one.
    kept.push({ chunk: ranked[0].chunk.slice(0, budgetChars), i: ranked[0].i });
  }

  return kept
    .sort((a, b) => a.i - b.i)
    .map((r) => r.chunk)
    .join('\n\n');
}
