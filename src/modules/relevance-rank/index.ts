import { chunkByHeadings } from './chunk';
import { DEFAULT_BUDGET_CHARS } from './constants';
import { packByScore, packInOrder } from './pack';

export { DEFAULT_BUDGET_CHARS } from './constants';

/**
 * Tier 1 query-aware truncation for fetched markdown. Chunks the page by
 * H1/H2 headings (paragraphs as fallback) and packs sections to a character
 * budget. With hints, sections are ranked by hint-keyword density; without,
 * they are kept in document order. Pages already within budget pass through
 * untouched.
 */
export function relevanceRank(
  markdown: string,
  hints: string[] | undefined,
  budgetChars: number = DEFAULT_BUDGET_CHARS,
): string {
  if (markdown.length <= budgetChars) return markdown;

  const chunks = chunkByHeadings(markdown);
  return hints?.length ? packByScore(chunks, hints, budgetChars) : packInOrder(chunks, budgetChars);
}
