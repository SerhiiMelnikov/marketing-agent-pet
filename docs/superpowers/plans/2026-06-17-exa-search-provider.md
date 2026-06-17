# Exa Search Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Exa as the default web-search provider behind the existing `SearchProvider` interface so the system runs without a Tavily account.

**Architecture:** A new `ExaProvider` implements `SearchProvider` and is registered in the search factory alongside the (now optional) Tavily provider; the default `SEARCH_PROVIDER` flips to `exa`. No agent or tool code changes — the provider abstraction isolates the swap.

**Tech Stack:** TypeScript (ES2022, strict), `exa-js` v2.14, Zod-validated env, Mastra (unaffected).

**Spec:** `docs/superpowers/specs/2026-06-17-exa-search-provider-design.md`

**Testing note:** This repo has no unit-test harness yet (`npm test` is a stub — backlog A4), and the spec puts unit tests out of scope. Verification steps below use `npx tsc --noEmit` and `npm run build` instead of failing unit tests. Functional confirmation happens at the first end-to-end run (a later backlog step).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/modules/search/providers/exa.provider.ts` | `ExaProvider` — maps `SearchQuery` → `SearchResult[]` via Exa `searchAndContents` | Create |
| `src/modules/search/enums/provider.enum.ts` | Provider name enum | Modify (add `Exa`) — already applied on branch |
| `src/modules/search/factory.ts` | Register providers from env keys; resolve selected provider | Modify |
| `src/config/env.ts` | Default `SEARCH_PROVIDER` | Modify |
| `.env.example` | Operator-facing env template | Modify |
| `package.json` / `package-lock.json` | `exa-js` dependency | Already installed on branch |

---

## Task 1: Confirm dependency and enum are in place

**Files:**
- Modify: `src/modules/search/enums/provider.enum.ts`
- Modify: `package.json` (verify only)

- [ ] **Step 1: Verify `exa-js` is a dependency**

Run: `node -e "console.log(require('exa-js/package.json').version)"`
Expected: prints `2.14.0` (or compatible). If it errors, run `npm install exa-js`.

- [ ] **Step 2: Verify the enum has the Exa member**

`src/modules/search/enums/provider.enum.ts` should read exactly:

```ts
export enum SearchProviderName {
  Tavily = 'tavily',
  Exa = 'exa',
}
```

If `Exa = 'exa',` is missing, add it.

- [ ] **Step 3: Commit (only if either file changed in this task)**

```bash
git add src/modules/search/enums/provider.enum.ts package.json package-lock.json
git commit -m "chore: add exa-js dependency and Exa provider enum"
```

If nothing changed (both already in place), skip the commit.

---

## Task 2: Implement `ExaProvider`

**Files:**
- Create: `src/modules/search/providers/exa.provider.ts`

- [ ] **Step 1: Write the provider**

Create `src/modules/search/providers/exa.provider.ts` with exactly:

```ts
import Exa from 'exa-js';
import { SearchProviderName } from '../enums/provider.enum';
import type { SearchProvider, SearchQuery, SearchResult } from '../types';

/**
 * Cap on per-result page text. Exa truncates server-side, so this bounds the
 * tokens the researcher re-sends on every step of its loop. ~8000 chars ≈ 2k
 * tokens — enough for facts/figures; deeper reads go through `fetch-url`.
 */
const MAX_CONTENT_CHARS = 8000;

export class ExaProvider implements SearchProvider {
  readonly name = SearchProviderName.Exa;

  private readonly exa: Exa;

  constructor(apiKey: string) {
    this.exa = new Exa(apiKey);
  }

  async search({
    query,
    includeDomains,
    excludeDomains,
    maxResults,
  }: SearchQuery): Promise<SearchResult[]> {
    const { results } = await this.exa.searchAndContents(query, {
      numResults: maxResults,
      includeDomains,
      excludeDomains,
      highlights: true,
      text: { maxCharacters: MAX_CONTENT_CHARS },
    });

    return results.map((r) => ({
      url: r.url,
      title: r.title ?? '',
      snippet: r.highlights?.join(' … ') ?? '',
      content: r.text || undefined,
    }));
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors referencing `exa.provider.ts`. (The file is not yet imported anywhere, so this only checks the file itself compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/search/providers/exa.provider.ts
git commit -m "feat(search): add Exa provider"
```

---

## Task 3: Register Exa in the search factory

**Files:**
- Modify: `src/modules/search/factory.ts`

- [ ] **Step 1: Add the import**

In `src/modules/search/factory.ts`, below the existing Tavily import add:

```ts
import { ExaProvider } from './providers/exa.provider';
```

So the import block reads:

```ts
import { env } from '../../config/env';
import type { SearchProvider } from './types';
import { SearchProviderName } from './enums/provider.enum';
import { TavilyProvider } from './providers/tavily.provider';
import { ExaProvider } from './providers/exa.provider';
```

- [ ] **Step 2: Register the provider in `init()`**

In `init()`, after the existing Tavily registration block and before the
`if (!providers.get(env.SEARCH_PROVIDER))` guard, add:

```ts
  if (env.EXA_API_KEY) {
    providers.set(SearchProviderName.Exa, new ExaProvider(env.EXA_API_KEY));
  }
```

The resulting `init()` body, in order, is: create the map → Tavily block →
Exa block → the `SEARCH_PROVIDER` guard → `return providers;`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/search/factory.ts
git commit -m "feat(search): register Exa provider in factory"
```

---

## Task 4: Make Exa the default provider and update env template

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Flip the default in `env.ts`**

In `src/config/env.ts`, change the `SEARCH_PROVIDER` line from:

```ts
  SEARCH_PROVIDER: z.enum(SearchProviderName).default(SearchProviderName.Tavily),
```

to:

```ts
  SEARCH_PROVIDER: z.enum(SearchProviderName).default(SearchProviderName.Exa),
```

Leave `EXA_API_KEY: z.string().optional()` and `TAVILY_API_KEY: z.string().optional()` unchanged.

- [ ] **Step 2: Update `.env.example`**

In `.env.example`, replace the `# ------ Tools API ------` search section so Exa
is the documented default and Tavily is the optional alternative. Replace these
lines:

```
# ------ Tools API ------
# Required. Web search (default SEARCH_PROVIDER). https://app.tavily.com
TAVILY_API_KEY=
```

with:

```
# ------ Tools API ------
# Web search provider. Default is Exa.
SEARCH_PROVIDER=exa

# Required when SEARCH_PROVIDER=exa. https://dashboard.exa.ai/api-keys
EXA_API_KEY=

# Optional. Alternative search provider (set SEARCH_PROVIDER=tavily to use).
# https://app.tavily.com
TAVILY_API_KEY=
```

Leave the `FIRECRAWL_API_KEY` line below untouched.

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat(search): default to Exa, document EXA_API_KEY in .env.example"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 2: Confirm the boot guard logic by reading**

Read `src/modules/search/factory.ts` `init()` and confirm: with
`SEARCH_PROVIDER=exa` and `EXA_API_KEY` set, `providers.get(env.SEARCH_PROVIDER)`
returns the Exa provider (guard does not throw). With `EXA_API_KEY` unset, the
guard throws `SEARCH_PROVIDER=exa but its API key is not set` — the intended
fail-fast.

- [ ] **Step 3: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- ExaProvider with content strategy (highlights→snippet, text→content, 8000 cap) → Task 2. ✓
- Enum `Exa` → Task 1. ✓
- Factory registration (Exa when key present; Tavily conditional already) → Task 3. ✓
- Default `SEARCH_PROVIDER` → Exa → Task 4 Step 1. ✓
- `.env.example` (Exa required, Tavily optional) → Task 4 Step 2. ✓
- Error handling (ExaError propagates, no catch) → satisfied by Task 2 code (no try/catch). ✓
- Out-of-scope items (A7/A2/A4) → not present in any task. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete. ✓

**Type consistency:** `ExaProvider` constructor `(apiKey: string)` matches the
factory call `new ExaProvider(env.EXA_API_KEY)` in Task 3. `SearchResult` fields
(`url`, `title`, `snippet`, `content`) match `src/modules/search/types.ts`. ✓
