# Cap search-content to top-N results — design

**Date:** 2026-06-18
**Status:** Approved
**Branch:** `feat/cap-search-content`
**Backlog item:** A8 lever B (cost) — sub-project 1 of 2 ("improve caching"). The
floating cache breakpoint is sub-project 2, designed separately afterward.

## Goal

Cut the dominant researcher input-token cost by carrying full page `content` only
for the few most-relevant results per search, instead of for every result (the
content cap, `N`, is set to 5). The
researcher still sees every result's title/url/snippet (cheap), and can pull full
text for any snippet-only result via `fetch-url`.

## Problem (from the 2026-06-17 trace)

The researcher's input is dominated by search `content`, re-sent uncached on every
model step: of ~372k researcher input tokens, ~198.8k were full-price text — the
`content` of all ~10 results across 5 searches, carried forward each step. Capping
*which* results carry content removes those tokens at the source (cheaper and
faster than caching them).

## Scope

In scope:
- A pure post-processing step that keeps `content` on the top `N = 5` results of
  each search and strips it (`content: undefined`) on the rest.
- Apply it in the `search()` chokepoint, after `deprioritizeGated`.
- One clarifying line in the researcher prompt: search returns full text only for
  the most relevant few; use `fetch-url` for depth on a snippet-only result.

Out of scope (deliberately):
- **Floating cache breakpoint** — sub-project 2, separate spec/plan.
- Changing `MAX_CONTENT_CHARS` (8000) or the default `maxResults`. The cap is on
  *how many* results carry content, not on per-result length or result count;
  breadth of discovery (snippets) is preserved.
- Making `N` env-configurable — a named constant is enough; revisit only if a real
  run shows it needs tuning (it is a one-line change).

## Approach

A new single-responsibility module holds the constant and the pure helper; the
search chokepoint applies it last, so the content slots go to the most-relevant,
freely-readable results.

### `src/modules/search/content-cap.ts` (new)

```ts
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
```

### `src/modules/search/index.ts` (modify)

Apply after `deprioritizeGated` so gated/paywalled results (sorted to the bottom)
do not consume a content slot:

```ts
import { capResultContent } from './content-cap';
// ...
  const results = await provider.search(withDefaultExcludes(query));

  return capResultContent(deprioritizeGated(results));
```

### `src/mastra/agents/researcher.ts` (modify)

Add one line near the search-tool guidance making the behavior explicit (the
prompt already routes deeper reads through `fetch-url`):

> Web search returns full page text only for the few most-relevant results;
> others come back with title, URL, and snippet only. If you need the full text of
> a snippet-only result, fetch it with `fetch-url`.

## Data flow

`webSearchTool` → `search(query)` → `withDefaultExcludes` → `provider.search` →
`deprioritizeGated` (gated to bottom) → `capResultContent` (top 5 keep content) →
results to the agent. No workflow or memory change.

## Error handling

None added. `capResultContent` is a pure map over plain objects; fewer than `N`
results means all keep content, and a result whose `content` is already absent is
unchanged.

## Invariants / constraints

- Order is preserved; only the `content` field of results past index `N-1` is
  cleared. Title, URL, and snippet are never touched.
- The cap is applied per search call, so it is per-query top-N.
- Applied after `deprioritizeGated`: content slots go to the most-relevant,
  non-gated results.

## Testing & verification

No unit-test harness (backlog A4); unit tests out of scope.

- `npx tsc --noEmit` and `npm run build` — both exit 0.
- Next end-to-end run: `researcher model usage` `inputTokens` should drop
  materially versus the 2026-06-17 baseline (~372k), and the trace should show
  full `content` on at most 5 results per search. Watch that research quality
  (trend/competitor grounding) holds; if the agent starves, raise `N` or expect
  more `fetch-url` calls (which also exercises the A7 provider).

## Risks

- **Under-feeding the agent:** with content on only 5 results, the agent may need
  more `fetch-url` calls (added latency) or, if it does not fetch, ground fewer
  claims. Mitigation: `N` is a one-line constant; measure on the next run.
- **Quality regression** is the thing to watch — the next run's report must stay
  as well-grounded as the 2026-06-17 baseline. If not, tune `N` upward.
