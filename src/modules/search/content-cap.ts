import type { SearchResult } from './types';

/**
 * How many results per search keep their full page `content`. The rest are
 * returned snippet-only (title/url/snippet preserved). The researcher re-sends
 * search results on every model step, so carrying full content for every result
 * is the dominant input-token cost; the most-relevant few are enough to ground
 * findings, and deeper reads go through `fetch-url`.
 */
export const CONTENT_RESULT_LIMIT = 5;

/**
 * Keeps `content` on the first CONTENT_RESULT_LIMIT results and drops it from the
 * rest, preserving order and every other field. Pure; callers pass results in
 * priority order (most relevant first).
 */
export const capResultContent = (results: SearchResult[]): SearchResult[] =>
  results.map((result, index) =>
    index < CONTENT_RESULT_LIMIT ? result : { ...result, content: undefined },
  );
