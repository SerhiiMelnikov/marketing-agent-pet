# Vitest unit tests for pure logic (A4) — design

**Date:** 2026-06-23
**Status:** Approved
**Branch:** `feat/vitest-unit-tests` (off main @ 5ad4ff7, which already includes the A9 follow-ups via PR #10)
**Backlog item:** A4 — `npm test` is a stub; the project has accumulated pure, bug-prone logic (the I1 URL-matching bug and the B2 no-op both lived in such functions) verified only by throwaway esbuild harnesses.

## Goal

Stand up a real test runner and cover the project's deterministic pure functions with unit tests, so the source-quality / search / citation logic has a permanent regression net instead of one-shot harnesses.

## Scope

In scope — a first wave covering **all the pure, deterministic logic functions** (no I/O, no LLM, no Mastra runtime):

| Module | Functions under test |
| --- | --- |
| `src/mastra/workflows/vertical-entry/corroboration.ts` | `assessCorroboration`, `corroborationDeficits`, `corroborationFlagBlock` (and `normalizeUrl` exercised through them) |
| `src/modules/search/domain-presets.ts` | `enforceIncludeDomains`, `withDefaultExcludes`, `deprioritizeGated` |
| `src/modules/search/content-cap.ts` | `capResultContent` |
| `src/mastra/workflows/vertical-entry/normalize-citations.ts` | `normalizeCitations` |
| `src/modules/fetch/detect-block.ts` | `detectBlock` |
| `src/mastra/scorers/utils/urls.ts` | `extractUrls`, `extractDomains` |
| `src/mastra/scorers/utils/extract-report-text.ts` | `isFinalReport`, `hasLeakedToolCall` (pure text predicates) |

Out of scope (deliberately):
- **Coverage threshold / gate** — plain `vitest run`, no `--coverage` minimum (user choice).
- **CI workflow file** — separate concern; this wires `npm test` only.
- **`extractReportText` / `preprocessRun`** — they consume `MastraDBMessage[]`; fixture-building is heavier and these are thin adapters. Deferred to a later integration-leaning wave.
- **I/O chokepoints** (`search()`, `fetchUrl()`), **factories/wiring**, **agents**, **workflow steps**, **Mastra processors** — integration territory, a later wave.

## Approach

### Tooling

- Add **`vitest`** as a dev dependency. No other runtime deps.
- `vitest.config.ts` at repo root: `test.environment = 'node'`, `test.include = ['src/**/*.test.ts']`, globals off (tests import `{ describe, it, expect }` explicitly). Vitest resolves the project's ESM + TypeScript + `moduleResolution: bundler` natively through esbuild — no loader, no `.js` import-extension juggling.
- `package.json` scripts: `test` → `vitest run` (one-shot, CI-friendly, replaces the stub); add `test:watch` → `vitest`.

### Conventions

- Test files **co-located** beside the module as `<name>.test.ts` (the codebase already co-locates related files). Example: `src/modules/search/content-cap.test.ts`.
- Pure unit tests only: construct plain inputs, assert outputs. **No mocks, no network, no filesystem** — every target is already a pure function. Where a function takes a domain type (`SearchResult`, `ResearchMemory`), build a minimal literal and cast (`as unknown as T`) exactly as the esbuild harnesses did, so a fixture carries only the fields under test.
- One `describe` per function; `it` per behavior. Test names state the behavior ("drops off-list results, keeps subdomains").

### Representative cases per module

These are the behaviors each suite must cover (the plan will turn them into exact `it` blocks):

- **corroboration**: URL canonicalization equivalence (http/https, `www.`, query, fragment, trailing slash) and unparseable fallback; authoritative = classifier ∉ {vendor, other}; URL absent from `sourcesConsulted` → non-authoritative; competitor corroborated if ≥1 source authoritative; verdict `sources` resolves classifiers incl. `unclassified`; deficits name the offending URL + classifier and offer the "OR remove/drop" out; deficits empty and flag block `null` when everything is corroborated; flag block truncates long labels.
- **domain-presets**: `enforceIncludeDomains` subdomain match, `www.`/case normalization, empty/absent list = no-op, all-off-list = `[]`, substring trap (`foo-mckinsey.com` ∉ `mckinsey.com`), unparseable URL dropped; `withDefaultExcludes` unions the denylist into `excludeDomains`, normalizes + de-dupes, leaves `includeDomains` and other fields untouched; `deprioritizeGated` moves gated URLs to the bottom with stable order within buckets.
- **content-cap**: `capResultContent` keeps `content` on the first `CONTENT_RESULT_LIMIT` results, strips it from the rest, preserves order and all other fields; boundary at the limit.
- **normalize-citations**: `【N†…】` and `【N】` → `[N]`, double-dagger variant, stray `【`/`】` stripped, existing `[N]` untouched, adjacency `【1】【2】`.
- **detect-block**: login-wall / captcha / paywall signals each detected with the right `reason`; the short-content threshold (a block signal in a long article does NOT trip); a clean page returns `undefined`.
- **scorers/utils urls**: `extractUrls` / `extractDomains` pull the right values from mixed text and de-dupe/normalize per their implementation.
- **scorers/utils predicates**: `isFinalReport` and `hasLeakedToolCall` on positive and negative text samples.

## Data flow

`npm test` → `vitest run` → discovers `src/**/*.test.ts` → each suite imports the target module directly and asserts on pure outputs. No process beyond the test runner; no external services.

## Error handling

None added — tests assert existing behavior. Functions with try/catch fallbacks (`normalizeUrl`) are tested on both the parseable and unparseable paths.

## Invariants / constraints

- Node `>=22.13.0`; TypeScript ES2022, strict. Tests are TypeScript, type-checked by the same `tsconfig`.
- Tests assert real behavior, never mock the unit under test.
- No production source changes — this wave only adds tests, config, and the `vitest` devDep. If a test surfaces a real bug, that is a separate finding to raise, not a silent source edit.

## Testing & verification

- `npm test` (i.e. `vitest run`) is green.
- `npx tsc --noEmit` passes (test files type-check).
- `npm run build` is unaffected (vitest config and `*.test.ts` are outside the Mastra build).

## Risks

- **Vitest + `moduleResolution: bundler`**: vitest's esbuild-based resolution handles extensionless TS imports natively, so the project's import style needs no change. Low risk; confirmed by the same esbuild path the harnesses used.
- **A test encodes a wrong expectation** (asserting a bug as correct). Mitigated by deriving cases from the documented intent in each module's JSDoc and the A9/A2/B1/B3 specs, not from current output alone.
- **Scope creep into integration tests.** Held off by the explicit out-of-scope list; `extractReportText`/`preprocessRun`/steps/processors are a deliberate later wave.
