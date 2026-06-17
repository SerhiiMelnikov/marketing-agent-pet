# Code-enforced source-bias (exclude) — design

**Date:** 2026-06-17
**Status:** Approved
**Branch:** `feat/code-enforced-source-bias`
**Backlog item:** A2 — enforce source-bias in the web-search tool (closes B2); includes the `everestgrp.com` domain fix.

## Goal

Make the researcher's "always exclude" source-bias an **invariant enforced in
code**, not advice in the prompt that the agent can forget. Every web search must
drop known SEO market-report vendors and vendor-marketing domains, regardless of
what (if anything) the agent passes in `excludeDomains`.

## Problem (from the 2026-06-17 trace)

- `includeDomains` / `excludeDomains` are already forwarded to Exa and honored as
  hard filters (`src/modules/search/providers/exa.provider.ts`). The plumbing is
  fine.
- But both lists are **optional and agent-controlled**. The researcher prompt says
  "pass `excludeDomains` on every search"; nothing enforces it. On a broad
  competitor-discovery search the agent omitted it, and SEO/vendor-marketing pages
  came back — reproducing B2.
- Separately, the prompt lists `everestgroup.com` as an analyst firm. That is a
  1996-era India staffing site; the real analyst firm is `everestgrp.com` (used
  correctly elsewhere in the same file). One-line bug.

## Scope

In scope:
- A code-level `DEFAULT_EXCLUDE_DOMAINS` constant, always merged into every
  search's `excludeDomains` (union with whatever the agent passed).
- Fix `everestgroup.com` → `everestgrp.com` in the researcher prompt.
- Remove the now-redundant "Always exclude … pass in `excludeDomains` on every
  search" section from the researcher prompt (the behavior is now automatic).

Out of scope (deliberately):
- **Enforcing `includeDomains`.** A global allowlist would break competitor
  discovery (you cannot allowlist competitors whose domains you do not yet know).
  `includeDomains` stays an agent, per-query judgement; the "Strongly prefer"
  prompt section is kept.
- **Post-hoc hostname filtering of results.** Exa already treats `excludeDomains`
  as a hard filter, so merging into the param is sufficient. Add a post-filter
  only when a provider with soft filtering is introduced.
- **Expanding the denylist** to cover the specific vendors that leaked this run
  (elevancesystems.com, medixteam.com, healthscopeservices.com, snapscale.com).
  The list is transferred 1:1 from the prompt so the next run gives a clean signal
  on enforcement alone. Denylist *completeness* is an inherent, ongoing problem
  and a separate backlog candidate — this change will NOT stop the
  elevancesystems-class leak (those appeared on a no-`includeDomains` discovery
  search and are not in the list).

## Approach

Centralize the default exclude list and the merge in the search module, where a
single chokepoint (`search()`) already runs on every tool call.

### `src/modules/search/domain-presets.ts` (modify)

Add:

```ts
/**
 * Domains always excluded from web search, regardless of what the agent passes.
 * SEO market-report vendors and vendor-marketing / "best-of" listicle sites whose
 * content is low-signal for grounded market research. Enforced in code (not just
 * the researcher prompt) so a search that omits `excludeDomains` is still filtered.
 * Transferred 1:1 from the researcher prompt's former "Always exclude" section.
 */
export const DEFAULT_EXCLUDE_DOMAINS = [
  // SEO market-report vendors
  'imarcgroup.com', 'market.us', 'sphericalinsights.com', 'snsinsider.com',
  'grandviewresearch.com', 'mordorintelligence.com', 'marketsandmarkets.com',
  'precedenceresearch.com', 'fortunebusinessinsights.com',
  // Vendor-marketing pages and "best-of" listicles
  'sumatosoft.com', 'belitsoft.com', 'dashtech.io', 'softwareexpertsindia.com',
  'clutch.co', 'goodfirms.co', 'designrush.com', 'techbehemoths.com',
] as const;

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/^www\./, '');

/**
 * Returns a copy of the query whose `excludeDomains` is the union of the agent's
 * excludes and DEFAULT_EXCLUDE_DOMAINS, normalized (lowercased, `www.` stripped)
 * and de-duplicated. `includeDomains` and all other fields are untouched.
 */
export const withDefaultExcludes = (query: SearchQuery): SearchQuery => {
  const merged = [
    ...(query.excludeDomains ?? []),
    ...DEFAULT_EXCLUDE_DOMAINS,
  ].map(normalizeHost);

  return { ...query, excludeDomains: [...new Set(merged)] };
};
```

`SearchQuery` is already imported in this file's sibling modules; add the
`import type { SearchQuery, SearchResult } from './types';` line (the file
currently imports only `SearchResult`).

### `src/modules/search/index.ts` (modify)

Apply the merge before dispatching to the provider:

```ts
import { deprioritizeGated, withDefaultExcludes } from './domain-presets';
// ...
export async function search(query: SearchQuery, options: SearchOptions = {}): Promise<SearchResult[]> {
  const provider = Providers.get(options.provider);
  const results = await provider.search(withDefaultExcludes(query));
  return deprioritizeGated(results);
}
```

### `src/mastra/agents/researcher.ts` (modify)

1. Line ~116: `everestgroup.com` → `everestgrp.com`.
2. Remove the "**Always exclude** (pass in `excludeDomains` on every search):"
   heading and its two bullet lists (the SEO-vendor list and the
   vendor-marketing list). The "**Strongly prefer** … `includeDomains`" section
   stays. Optionally add one sentence noting low-signal vendors are filtered
   automatically, so the agent need not list them.

## Data flow

`webSearchTool` → `search(query)` → `withDefaultExcludes(query)` →
`provider.search()` → `deprioritizeGated()`. Exa receives the unioned
`excludeDomains` as a hard filter. No agent or workflow change.

## Error handling

None added. `withDefaultExcludes` is a pure function over plain arrays; an absent
`excludeDomains` yields just the defaults. Normalization is defensive only.

## Invariants / constraints

- `includeDomains` is never modified — discovery searches keep working.
- The merge is a **union**, never a replacement: an agent-supplied exclude is
  additive, not overridden.
- The constant is the single source of truth for the default denylist; the prompt
  no longer restates it (avoids drift between prompt and code).

## Testing & verification

No unit-test harness (backlog A4); unit tests out of scope.

- `npx tsc --noEmit` and `npm run build` — both exit 0.
- Next end-to-end run: SEO market-report vendors / vendor-marketing domains from
  `DEFAULT_EXCLUDE_DOMAINS` must not appear in results even on searches where the
  agent passed no `excludeDomains`. (The elevancesystems-class leak is explicitly
  NOT expected to be fixed by this change — see Scope.)

## Risks

- **Denylist incompleteness** (accepted, out of scope): unknown vendor-marketing
  sites still leak. Tracked separately.
- **Over-exclusion**: a default domain could in principle host a legitimate
  source. The transferred list is all SEO-vendor / listicle genres with no
  primary-research value, so the risk is negligible; revisit per-domain if a real
  run shows a wrongly-dropped source.
