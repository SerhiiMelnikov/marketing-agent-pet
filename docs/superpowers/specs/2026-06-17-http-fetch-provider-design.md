# Own HTTP + Readability fetch provider — design

**Date:** 2026-06-17
**Status:** Approved (approach A)
**Branch:** `feat/http-fetch-provider`
**Backlog item:** A7 — own self-hosted fetch provider (replaces Firecrawl).

## Goal

Add an own fetch provider so the system can fetch and clean pages without a
Firecrawl account. It implements the existing `FetchProvider` interface, is
placed first in the provider chain, and needs no API key. Firecrawl stays in the
code as an optional fallback.

Prerequisite for the first end-to-end run: the operator will not register
Firecrawl, and `src/modules/fetch/factory.ts` currently throws when no provider
is configured (and `FIRECRAWL_API_KEY` is currently a required env var).

## Scope

In scope: an HTML-only fetch provider (HTTP → main-content extraction →
markdown), its registration as the default chain entry, and the env changes that
let the app boot without Firecrawl.

Out of scope (recorded in backlog A7, measure-first — do not build now):
- **PDF parsing** — SEC/gov sources include PDFs; add a PDF path only if a real
  run shows many important PDFs are missed.
- **JS rendering** (Playwright/Puppeteer fallback) — add only if a real run shows
  too many target sources need JS. Until then, JS-heavy pages yield short or
  blocked results and are recorded as gaps, not fabricated.
- **A2** — enforcing source-domain bias inside the `web-search` tool.

## Approach (A)

Node 22's global `fetch` retrieves HTML; `linkedom` parses it into a lightweight
DOM; `@mozilla/readability` extracts the main article; `turndown` converts the
extracted HTML to markdown. Each layer is swappable behind the provider.

Rejected alternatives:
- **B — `jsdom` instead of `linkedom`.** More robust on messy HTML and officially
  used by Readability, but `jsdom` is heavy (many transitive deps, slower start).
  If `linkedom` proves unreliable on real pages, swapping to `jsdom` is isolated
  to this provider (same Readability/turndown wiring).
- **C — `@extractus/article-extractor` (combined fetch+extract).** Fewer wires,
  but it owns the HTTP layer (timeouts/redirects/User-Agent) we want to control
  via `FetchRequest`, is more opinionated, and duplicates the HTTP layer.

Firecrawl coexistence mirrors the Exa decision: keep the Firecrawl provider in
code, register it in the chain only when `FIRECRAWL_API_KEY` is set, with the own
provider always first. With no Firecrawl key the chain is `[own]`.

## Components

### `src/modules/fetch/providers/http-readability.provider.ts` (new)

`HttpReadabilityProvider implements FetchProvider`.

- `name = FetchProviderName.HttpReadability`.
- `canHandle(request)`: true for `http:`/`https:` URLs (mirrors Firecrawl's
  protocol check); false on URL parse failure.
- `fetch(request)`:
  1. `fetch(request.url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })`.
  2. If `!response.ok` → throw `FetchError` (status in message).
  3. If the `Content-Type` header does not include `text/html` (or xhtml) → throw
     `FetchError` (non-HTML such as PDF is out of scope; the chain records it as a
     gap). A missing Content-Type is treated as HTML (best effort).
  4. Read the body as text, capped at `MAX_HTML_BYTES`; if the response exceeds
     the cap, use the truncated text (don't fail).
  5. `parseHTML(html)` (linkedom) → `document`.
  6. `new Readability(document).parse()` → `article | null`.
  7. If `article` is null or `article.content` is empty/whitespace → throw
     `FetchError` (mirrors Firecrawl throwing on empty markdown).
  8. `turndown.turndown(article.content)` → `markdown`. If markdown is
     empty/whitespace → throw `FetchError`.
  9. Return `FetchResult`:
     - `url = request.url`
     - `finalUrl = response.url || request.url`
     - `title = article.title || undefined`
     - `markdown`
     - `source = this.name`
     - `fetchedAt = new Date().toISOString()`

The provider does no caching, block detection, or short-content fallback — those
live above it in `index.ts` and operate on the returned `markdown`/`title`.

`requiresJs` is not used by this provider (no JS rendering); it fetches
best-effort regardless.

### `src/modules/fetch/constants.ts`

Add:
- `USER_AGENT` — a realistic desktop browser UA string (some sites reject empty
  or bot UAs).
- `MAX_HTML_BYTES` — raw-HTML read cap (e.g. 5 MB) to bound memory on huge pages.

`DEFAULT_TIMEOUT_MS` (already present) is reused for the request timeout.

### `src/modules/fetch/enums/provider-name.enum.ts`

Add `HttpReadability = 'http-readability'`.

### `src/modules/fetch/factory.ts`

`init()` builds the chain as: own provider first, Firecrawl appended only when
`env.FIRECRAWL_API_KEY` is set:

```ts
const providers: FetchProvider[] = [new HttpReadabilityProvider()];
if (env.FIRECRAWL_API_KEY) {
  providers.push(new FirecrawlProvider({ apiKey: env.FIRECRAWL_API_KEY }));
}
chain = providers;
```

The "No fetch providers configured" throw becomes unreachable (own provider is
always present); it may be left as a defensive guard.

### `src/config/env.ts`

`FIRECRAWL_API_KEY` changes from required (`z.string().trim().nonempty()`) to
optional (`z.string().trim().min(1).optional()`), so the app boots without it.

### `.env.example`

Demote Firecrawl to an optional fallback; note that the default HTTP+Readability
fetch needs no key.

### `package.json`

Add dependencies: `@mozilla/readability`, `linkedom`, `turndown`, and
`@types/turndown` (dev).

## Data flow

Unchanged above the provider: `fetch-url` tool → `index.ts` `fetchUrl()` → cache
check → chain iteration (`canHandle` → `fetch` → `detectBlock` → short-content
fallback → cache set). Only the concrete first provider differs. Login/paywall/
captcha walls in the returned markdown are caught by the existing `detectBlock`.

## Error handling

All failure modes (`!ok`, non-HTML, empty extraction, empty markdown, network/
timeout) throw the existing `FetchError` with `url` and `provider` set. The chain
collects these and, if every provider fails, throws the aggregate
"All fetch providers failed" error — surfaced to the agent as a gap. No retry or
JS fallback is added here.

## Boundaries

- `HttpReadabilityProvider` knows only `FetchRequest → FetchResult`; no awareness
  of agents, tools, cache, or block detection.
- `detectBlock`, the per-run cache, and the chain orchestration in `index.ts` are
  untouched and keep working with the new provider's output.

## Testing & verification

No unit-test harness exists yet (backlog A4); unit tests are out of scope.
Verification:
- `npx tsc --noEmit` and `npm run build` — both exit 0.
- A one-off manual smoke during implementation: a throwaway Node script fetching
  ~2 stable URLs (one normal article, one login-walled page) to confirm markdown
  extraction and that the walled page is flagged by `detectBlock`. The script is
  NOT committed.
- Full functional confirmation at the first end-to-end run (the next backlog
  step).

## Risks

- **`linkedom` parsing edge cases.** Some malformed pages may extract poorly;
  mitigation is the isolated swap to `jsdom` (approach B) if a real run shows
  it. No code outside this provider is affected.
- **Bot blocking.** Sites that block non-browser clients will return walls or
  errors; these become gaps (correct behavior — not fabricated). A future JS/
  Playwright fallback (deferred) would address the worst cases.
- **No content cap.** Full extracted markdown is returned (parity with
  Firecrawl); the researcher fetches deliberately for depth, and the per-run
  cache already stores full markdown.
