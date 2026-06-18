# Cap search-content to top-N results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry full page `content` only for the top 5 results of each web search; return the rest snippet-only — cutting the dominant researcher input-token cost.

**Architecture:** A new single-responsibility module (`content-cap.ts`) holds a `CONTENT_RESULT_LIMIT = 5` constant and a pure `capResultContent(results)` helper. The `search()` chokepoint applies it after `deprioritizeGated`, so content slots go to the most-relevant, non-gated results. A one-line researcher-prompt note makes the behavior explicit.

**Tech Stack:** TypeScript (ES2022, strict), Mastra `@mastra/core` tools, Exa search provider.

## Global Constraints

- Node.js `>=22.13.0`; TypeScript ES2022, strict, `noEmit`.
- No unit-test harness (`npm test` is a stub — backlog A4); unit tests are out of scope. Verification per task is `npx tsc --noEmit` + `npm run build`.
- Never hardcode model strings or API keys; not relevant to these files but holds project-wide.
- `N = 5` (the content cap) — exact value, used as `CONTENT_RESULT_LIMIT`.

**Spec:** `docs/superpowers/specs/2026-06-18-cap-search-content-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/modules/search/content-cap.ts` | Content-cap constant + pure result-trimming helper | Create |
| `src/modules/search/index.ts` | Search chokepoint | Modify — apply `capResultContent` after `deprioritizeGated` |
| `src/mastra/agents/researcher.ts` | Researcher prompt | Modify — one line: search returns full text only for the most-relevant few |

No interface/type changes to `SearchProvider`, `SearchQuery`, or `SearchResult`.

---

## Task 1: Add the content-cap module and wire it into `search()`

**Files:**
- Create: `src/modules/search/content-cap.ts`
- Modify: `src/modules/search/index.ts`

**Interfaces:**
- Consumes: `SearchResult` from `./types` (`{ url, title, snippet, content? }`); `deprioritizeGated(results: SearchResult[]): SearchResult[]` from `./domain-presets`.
- Produces: `CONTENT_RESULT_LIMIT: number` and `capResultContent(results: SearchResult[]): SearchResult[]` from `./content-cap`.

- [ ] **Step 1: Create the content-cap module**

Create `src/modules/search/content-cap.ts` with exactly:

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

- [ ] **Step 2: Import the helper in the search chokepoint**

In `src/modules/search/index.ts`, add an import. The file currently has (lines 1-4):

```ts
import { SearchProviderName } from './enums/provider.enum';
import * as Providers from './factory';
import { deprioritizeGated, withDefaultExcludes } from './domain-presets';
import type { SearchQuery, SearchResult } from './types';
```

Add directly below the `domain-presets` import line:

```ts
import { capResultContent } from './content-cap';
```

- [ ] **Step 3: Apply the cap in `search()`**

In `src/modules/search/index.ts`, replace this exact line (inside `search()`):

```ts
  return deprioritizeGated(results);
```

with:

```ts
  return capResultContent(deprioritizeGated(results));
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/content-cap.ts src/modules/search/index.ts
git commit -m "feat(search): carry full content only for the top-N results per search"
```

---

## Task 2: Make the cap explicit in the researcher prompt

**Files:**
- Modify: `src/mastra/agents/researcher.ts`

**Interfaces:** none (prompt text only).

The researcher prompt already routes deeper reads through `fetch-url`. Add one sentence so the agent knows full content comes back only for the most-relevant few results and to fetch when it needs depth on a snippet-only result.

- [ ] **Step 1: Locate the search-tool guidance**

Read `src/mastra/agents/researcher.ts` and find the bullet/line describing the `web-search` tool (it mentions `includeDomains` / `excludeDomains`, around lines 60-62). The new sentence goes immediately after the web-search tool's description, before the `fetch-url` guidance.

- [ ] **Step 2: Insert the clarifying sentence**

Add this sentence (matching the file's existing prose style and template-literal escaping — it contains a backtick-quoted `fetch-url`, escaped as `\`fetch-url\``):

```
Web search returns full page text only for the few most-relevant results;
others come back with title, URL, and snippet only. If you need the full
text of a snippet-only result, fetch it with \`fetch-url\`.
```

Place it as its own line/paragraph adjacent to the web-search tool guidance. Do not alter any other prompt text.

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Verify the prompt reads correctly**

Read the modified section of `src/mastra/agents/researcher.ts` and confirm the new sentence sits beside the web-search guidance, the `\`fetch-url\`` backtick escapes are intact, and no surrounding text changed.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/researcher.ts
git commit -m "docs(researcher): note search returns full content only for top results"
```

---

## Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean build and tree**

Run: `npx tsc --noEmit && npm run build && git status --short`
Expected: both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: Record the behavioral check (no code)**

The runtime confirmation is the next end-to-end run, NOT part of this plan: the
`researcher model usage` `inputTokens` should drop materially versus the
2026-06-17 baseline (~372k), and the trace should show full `content` on at most
5 results per search. Watch that research quality (trend/competitor grounding)
holds; if the agent starves, raise `CONTENT_RESULT_LIMIT` or expect more
`fetch-url` calls.

- [ ] **Step 3: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- Pure helper keeping `content` on top `N = 5`, stripping the rest → Task 1 Step 1. ✓
- New single-responsibility module `content-cap.ts` → Task 1 Step 1. ✓
- Applied in `search()` after `deprioritizeGated` → Task 1 Step 3. ✓
- One clarifying line in researcher prompt → Task 2. ✓
- Out of scope (floating breakpoint, `MAX_CONTENT_CHARS`, `maxResults`, env-config of N) → absent from all tasks. ✓
- Verification = tsc/build + next-run note → Task 1/2 type-check steps + Task 3. ✓

**Placeholder scan:** No TBD/TODO. Task 1 shows complete code; Task 2 gives exact insert text and placement (the prompt is prose, so placement is described against an anchor rather than a byte-exact old-string, since the surrounding lines are long template-literal prose). ✓

**Type consistency:** `capResultContent(results: SearchResult[]): SearchResult[]` and `CONTENT_RESULT_LIMIT` defined in Task 1 Step 1, imported and called with the same names in Task 1 Steps 2-3. `deprioritizeGated` signature matches its existing definition. ✓
