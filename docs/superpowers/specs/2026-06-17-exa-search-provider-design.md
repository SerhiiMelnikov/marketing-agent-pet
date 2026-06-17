# Exa search provider — design

**Date:** 2026-06-17
**Status:** Approved (approach A)
**Branch:** `feat/exa-search-provider`
**Backlog item:** Search provider — Exa (replaces Tavily); see memory `backlog.md`.

## Goal

Add Exa as the web-search provider so the system can run without a Tavily
account. Exa is implemented behind the existing `SearchProvider` interface and
becomes the default `SEARCH_PROVIDER`; no agent or tool code changes.

Prerequisite for the first end-to-end run: the operator will not register
Tavily, so a working search provider must exist or the search factory throws on
boot.

## Scope

In scope:
- A new `ExaProvider` implementing `SearchProvider`.
- Register it in the search factory; flip the default provider to Exa.
- Env / `.env.example` updates.

Out of scope (tracked separately):
- A7 — own self-hosted fetch provider (replaces Firecrawl).
- A2 — enforcing source-domain bias inside the `web-search` tool.
- A4 — unit-test infrastructure (`npm test` is currently a stub).

## Approach (A)

Add Exa alongside Tavily rather than replacing it. Tavily code and the
`@tavily/core` dependency stay; Tavily is registered only when
`TAVILY_API_KEY` is present. The default `SEARCH_PROVIDER` flips to `exa`. This
preserves the provider abstraction and keeps an escape hatch, with minimal
churn.

Rejected alternatives:
- **B — full replacement of Tavily.** Cleaner but loses optionality and is more
  churn for no benefit; the project deliberately keeps a provider abstraction.
- **C — keep Tavily as default, only add Exa.** Smallest diff, but boots into a
  `TAVILY_API_KEY` failure since the operator won't register Tavily.

## Components

### `src/modules/search/providers/exa.provider.ts` (new)

`ExaProvider implements SearchProvider`.

- Constructor: `new Exa(apiKey)` (from `exa-js` v2.14).
- `name = SearchProviderName.Exa`.
- `search({ query, includeDomains, excludeDomains, maxResults })` calls:

  ```ts
  exa.searchAndContents(query, {
    numResults: maxResults,        // undefined → Exa default (10)
    includeDomains,
    excludeDomains,
    highlights: true,
    text: { maxCharacters: MAX_CONTENT_CHARS }, // 8000
  })
  ```

- `MAX_CONTENT_CHARS = 8000` — module-level constant (not env; YAGNI).

Result mapping (Exa `SearchResult` → domain `SearchResult`):

```
url     = r.url
title   = r.title ?? ''
snippet = r.highlights?.join(' … ') ?? ''
content = r.text || undefined        // already capped to 8000 by Exa
```

Rationale for the content strategy: Exa returns page text in the search
response, so the researcher can ground findings without a separate fetch in
many cases — valuable because the own fetch provider (A7) is not built yet. The
8000-char cap (~2k tokens) keeps the researcher loop's context bounded (the text
is re-sent across up to 60 steps × up to 3 dountil iterations on Haiku); when
more depth is needed the agent can still call `fetch-url`.

### `src/modules/search/enums/provider.enum.ts`

Add `Exa = 'exa'`. (Already applied on this branch.)

### `src/modules/search/factory.ts`

In `init()`:
- Register `ExaProvider` when `env.EXA_API_KEY` is set.
- Register `TavilyProvider` when `env.TAVILY_API_KEY` is set (now conditional —
  it is already, but Tavily is no longer the implied default).
- Existing guard stays: throw if the selected `SEARCH_PROVIDER` has no
  registered provider.

### `src/config/env.ts`

- `SEARCH_PROVIDER` default → `SearchProviderName.Exa`.
- `EXA_API_KEY` already declared (optional) — unchanged.

### `.env.example`

- `SEARCH_PROVIDER=exa`.
- `EXA_API_KEY` documented as required (with signup URL).
- `TAVILY_API_KEY` demoted to optional/alternative.

## Data flow

Unchanged above the provider: `web-search` tool → `search/index.ts` `search()`
→ `factory.get(provider)` → `provider.search()` → `deprioritizeGated()`. Only
the concrete provider instance differs.

## Error handling

`ExaError` propagates out of `search()` unchanged — mirrors the Tavily provider,
which does not catch. Upstream tool-wrapper / agent handles failures. No retry
or fallback logic added in this step.

## Boundaries

- `ExaProvider` knows only `SearchQuery → SearchResult[]`; it has no awareness of
  agents, tools, or working memory.
- `deprioritizeGated` and the `index.search()` orchestration are untouched and
  keep working with Exa results.
- Model routing / round-robin / page cache are not involved.

## Testing & verification

No unit-test infrastructure exists yet (A4). Verification for this change:
- `npx tsc --noEmit` — type-check.
- `npm run build` — production build.
- Functional confirmation deferred to the first end-to-end run (the next backlog
  step after A7), where the `researcher model usage` log also confirms caching.

A dedicated `ExaProvider` unit test is out of scope until A4 establishes test
infra.

## Risks

- **Exa billing.** `highlights` + `text` are billed components; the 8000-char cap
  and the project's low search volume (~5–15 searches/run) keep this small. Free
  tier ($10 signup credit + monthly free requests) covers development.
- **Caching note (unrelated to search):** model round-robin pools break prompt
  caching; keep single-entry pools per role (already the case).
