/**
 * Tier 1 query-aware truncation for fetched markdown. Splits the page into
 * sections (H1/H2 headings, or paragraphs as fallback), scores each section
 * against a list of hint keywords/phrases, and packs the highest-scoring
 * sections in document order up to a character budget. Without hints it
 * falls back to section-aware head-truncation so the budget is still
 * respected — the agent just gets the lead sections instead of the
 * relevance-ranked ones.
 */

export const DEFAULT_BUDGET_CHARS = 40_000;

export function relevanceRank(
  markdown: string,
  hints: string[] | undefined,
  budgetChars: number = DEFAULT_BUDGET_CHARS,
): string {
  if (markdown.length <= budgetChars) return markdown;

  const chunks = chunkByHeadings(markdown);
  return hints?.length
    ? packByScore(chunks, hints, budgetChars)
    : packInOrder(chunks, budgetChars);
}

function chunkByHeadings(md: string): string[] {
  // Split on H1/H2 boundaries with a lookahead so the heading stays at the
  // top of each chunk. If no H1/H2 headings exist, fall back to paragraph
  // splits — better than returning one giant chunk.
  const sections = md
    .split(/(?=^#{1,2}\s)/m)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sections.length > 1) return sections;
  return md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function packInOrder(chunks: string[], budgetChars: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const chunk of chunks) {
    if (used + chunk.length > budgetChars) break;
    kept.push(chunk);
    used += chunk.length;
  }
  if (kept.length === 0 && chunks.length > 0) {
    // A single huge chunk over budget — slice the head so the agent gets something.
    kept.push(chunks[0].slice(0, budgetChars));
  }
  return kept.join('\n\n');
}

function packByScore(chunks: string[], hints: string[], budgetChars: number): string {
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
  if (kept.length === 0 && ranked.length > 0) {
    // No section fits whole — slice the head of the top-scored one.
    kept.push({ chunk: ranked[0].chunk.slice(0, budgetChars), i: ranked[0].i });
  }

  return kept
    .sort((a, b) => a.i - b.i)
    .map((r) => r.chunk)
    .join('\n\n');
}

function scoreChunk(chunk: string, hints: string[]): number {
  const lower = chunk.toLowerCase();
  let score = 0;

  for (const hint of hints) {
    const h = hint.toLowerCase();
    // Exact phrase hits weight 5×; individual content words weight 1×.
    score += matchCount(lower, new RegExp(escapeRegex(h), 'g')) * 5;
    for (const word of h.split(/\s+/).filter((w) => w.length > 3)) {
      score += matchCount(lower, new RegExp(`\\b${escapeRegex(word)}\\b`, 'g'));
    }
  }

  // Numeric / market-size signal — sections with dollar amounts, percentages,
  // CAGR/YoY mentions are usually what research is hunting for.
  score += matchCount(chunk, NUMERIC_SIGNAL) * 2;
  return score;
}

const NUMERIC_SIGNAL = /\$[\d,.]+\s*(?:bn|billion|m|million|trillion|tn)?\b|\d+(?:\.\d+)?\s*%|\b(?:CAGR|YoY)\b/gi;

function matchCount(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
