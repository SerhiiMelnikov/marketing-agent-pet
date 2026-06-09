# Section-aware fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fetch tool's flat `markdown` output with a structured `sections` array (`{ heading, level, content, contentChars, truncated }[]`) plus page-level size metadata. Drop the relevance-rank truncation and `extractHints` input — sections give the agent native browsability; relevance-rank's job is obsolete. Truncate individual sections only if pathologically huge (> 30k chars) with a per-section `truncated` flag. Cache still stores raw markdown; sections derive from it on each call.

**Architecture:**
- New module `src/modules/extract-sections/` wraps `remark-parse` to produce `Section[]` from markdown using position-based slicing (lossless, code-block aware via the AST).
- Fetch tool calls `extractSections(result.markdown)` and returns the array. Per-section content is truncated at `MAX_SECTION_CHARS = 30_000`; page-level `pageChars` field exposes total size.
- `relevance-rank` module is deleted (no remaining callers after this change).
- `extractHints` input is removed from the fetch tool — dead parameter under the new design.
- `find-in-page` continues to read from the cached full markdown for precision lookups.
- Researcher prompt teaches the new shape: scan headings, read relevant section contents, use `find-in-page` for specific phrase recovery.

**Tech Stack:** `unified` + `remark-parse` (markdown → mdast), `@types/mdast` for typing. All small, well-maintained npm packages.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | **Modify** | Add `unified`, `remark-parse`, `@types/mdast` deps |
| `src/modules/extract-sections/index.ts` | **Create** | `extractSections(md): Section[]` + `Section` type |
| `src/modules/extract-sections/constants.ts` | **Create** | `MAX_SECTION_CHARS` |
| `src/mastra/tools/fetch.tool.ts` | **Modify** | Output schema: drop `markdown`, add `sections` + `pageChars`; input: drop `extractHints`; remove relevance-rank import + truncation step |
| `src/mastra/agents/researcher.ts` | **Modify** | Prompt: drop `extractHints` guidance from step 4, teach the sections shape, teach when to use `find-in-page` for specific phrase lookups |
| `src/modules/relevance-rank/` | **Delete** | Entire module — no callers remain |

---

## Task 1: Section extraction module

**Files:**
- Modify: `package.json`
- Create: `src/modules/extract-sections/index.ts`
- Create: `src/modules/extract-sections/constants.ts`

- [ ] **Step 1: Add deps**

```bash
npm install unified remark-parse
npm install --save-dev @types/mdast
```

Verify with `cat package.json | grep -E "unified|remark|mdast"` after.

- [ ] **Step 2: Constants**

`src/modules/extract-sections/constants.ts`:

```ts
/**
 * Maximum chars allowed in a single section's content. Sections larger than
 * this are sliced and marked `truncated: true`. 30k chars (~7.5k tokens) is
 * the threshold: any single section that big is almost certainly a
 * poorly-structured page where the real content is buried in one prose dump.
 * The agent can recover the rest via `find-in-page` on the cached full page.
 */
export const MAX_SECTION_CHARS = 30_000;
```

- [ ] **Step 3: Section extractor**

`src/modules/extract-sections/index.ts`:

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Heading } from 'mdast';
import { MAX_SECTION_CHARS } from './constants';

export interface Section {
  /** Heading text without leading `#`s. `null` for content before the first heading. */
  heading: string | null;
  /** Heading depth 1-6, or 0 for preamble (content before first heading). */
  level: number;
  /** Body markdown for this section, excluding the heading line. */
  content: string;
  /** Character count of `content`. */
  contentChars: number;
  /** True when `content` was capped at MAX_SECTION_CHARS — full text is in the cache. */
  truncated: boolean;
}

export { MAX_SECTION_CHARS } from './constants';

/**
 * Split markdown into sections using a proper markdown AST (remark-parse)
 * rather than regex on heading lines. Two reasons to use the AST:
 *   1. Code blocks containing `#` characters (shell prompts, Python comments)
 *      are NOT mistakenly split as headings.
 *   2. Position info on every node lets us slice the original markdown
 *      losslessly, preserving whitespace, formatting, and inline markup.
 *
 * Sections are flat (no nesting). The `level` field tells the agent the
 * heading depth so it can reason about hierarchy. Content before the first
 * heading becomes a single preamble section with `heading: null, level: 0`.
 */
export function extractSections(markdown: string): Section[] {
  if (!markdown.trim()) return [];

  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const headings: Array<{ node: Heading; startOffset: number; endOffset: number }> = [];

  for (const node of tree.children) {
    if (node.type === 'heading' && node.position) {
      headings.push({
        node,
        startOffset: node.position.start.offset ?? 0,
        endOffset: node.position.end.offset ?? 0,
      });
    }
  }

  const sections: Section[] = [];

  // Preamble: anything before the first heading
  const firstHeadingStart = headings[0]?.startOffset ?? markdown.length;
  const preamble = markdown.slice(0, firstHeadingStart).trim();
  if (preamble) {
    sections.push(buildSection(null, 0, preamble));
  }

  // One section per heading: heading line + body until next heading
  for (let i = 0; i < headings.length; i++) {
    const { node, endOffset } = headings[i];
    const nextStart = headings[i + 1]?.startOffset ?? markdown.length;
    const bodyText = markdown.slice(endOffset, nextStart).trim();
    sections.push(buildSection(headingText(node), node.depth, bodyText));
  }

  return sections;
}

function buildSection(heading: string | null, level: number, content: string): Section {
  if (content.length > MAX_SECTION_CHARS) {
    return {
      heading,
      level,
      content: content.slice(0, MAX_SECTION_CHARS),
      contentChars: MAX_SECTION_CHARS,
      truncated: true,
    };
  }
  return {
    heading,
    level,
    content,
    contentChars: content.length,
    truncated: false,
  };
}

function headingText(node: Heading): string {
  return node.children
    .map((child) => (child.type === 'text' ? child.value : ''))
    .join('')
    .trim();
}
```

- [ ] **Step 4: Verify build, lint, tsc**

```bash
npm run build && npm run lint && npx tsc --noEmit
```

Expect clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/modules/extract-sections/
git commit -m "Add extract-sections module (AST-based markdown chunker)

Wraps remark-parse to split markdown into a flat Section[] using
position-based slicing. Code blocks containing # characters are not
mistakenly split as headings; whitespace and inline markup are
preserved losslessly. Content before the first heading becomes a
preamble section (heading: null, level: 0). Sections over 30k chars
are sliced and marked truncated: true — the full content is still
recoverable via the page cache."
```

---

## Task 2: Fetch tool returns sections; relevance-rank and extractHints removed from the tool

**Files:**
- Modify: `src/mastra/tools/fetch.tool.ts`
- Modify: `src/mastra/agents/researcher.ts`

This task is one commit because the tool's output schema change and the prompt updates teaching the new shape must land together.

- [ ] **Step 1: Update the fetch tool**

Rewrite `src/mastra/tools/fetch.tool.ts` to:

- Drop `extractHints` from `descriptions.input` and the input schema.
- Drop the `relevanceRank` and `DEFAULT_BUDGET_CHARS` imports.
- Drop the truncation block in `execute`.
- Drop the `markdown` field from the output schema. Add:
  - `sections: z.array(sectionSchema)` (always present, possibly empty).
  - `pageChars: z.number().int()` (total chars of the source markdown — gives the agent visibility into total page size).
- Update the tool description to describe the new shape and the relationship to `find-in-page`.

```ts
import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { fetchUrl } from '../../modules/fetch';
import { BlockReason } from '../../modules/fetch';
import { extractSections } from '../../modules/extract-sections';

const descriptions = {
  tool:
    'Fetch a single web page and return its main content as a list of sections (heading + content). Use this after `web-search` when you need the full text of a result rather than just the snippet, or when an agent already has a known URL (e.g. a competitor homepage, a 10-K, an analyst report). Providers are tried in order — cheap HTTP+readability first, then Firecrawl for JS-heavy pages — so calls are best-effort and may return empty/short content for paywalls, bot walls, or dynamic apps. Scan section headings first; read the content of sections you care about. For very large pages, sections give you a structured view without loading the whole document. To search for a specific phrase inside a page you have already fetched, use `find-in-page` instead of re-fetching.',
  input: {
    url: 'Absolute URL of the page to fetch. Must be a fully qualified http(s) URL.',
    requiresJs:
      'Hint that the page is JS-heavy (an SPA, dashboard, or paywalled article) and cheap providers will likely fail. Set true to skip straight to the JS-capable provider; leave omitted to let the chain decide.',
  },
  output: {
    url: 'The URL that was requested.',
    finalUrl: 'The resolved URL after any redirects. May differ from `url`.',
    title: 'Page title, when the provider could extract one.',
    sections:
      'Array of `{ heading, level, content, contentChars, truncated }` parsed from the page markdown. Headings preserve the markdown depth (1-6). Content before the first heading is a preamble section with `heading: null, level: 0`. Sections over 30k chars are truncated; the truncated flag is set on those. The full original markdown is in the cache — use `find-in-page` to search within a previously fetched URL.',
    pageChars: 'Total chars of the source markdown — useful to gauge page size before scanning every section.',
    source: 'Name of the provider that produced this result (e.g. "firecrawl", "cache"). Useful for logs.',
    fetchedAt: 'ISO 8601 timestamp of when the fetch completed.',
    blocked:
      'Set when the page was reachable but its content was gated (login-wall, paywall, captcha, or cookie-wall). When this is present, the `sections` array is unreliable — do NOT quote from it. Use the search snippet for this URL instead, or move on to another source.',
    blockedReason: 'Which gate was detected.',
    blockedSignal: 'What triggered detection (regex source or "title:..." marker), for debugging.',
  },
} as const;

const sectionSchema = z.object({
  heading: z.string().nullable(),
  level: z.number().int().min(0).max(6),
  content: z.string(),
  contentChars: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const fetchTool = createTool({
  id: 'fetch-url',
  description: descriptions.tool,
  inputSchema: z.object({
    url: z.url().describe(descriptions.input.url),
    requiresJs: z.boolean().optional().describe(descriptions.input.requiresJs),
  }),
  outputSchema: z.object({
    url: z.url().describe(descriptions.output.url),
    finalUrl: z.url().describe(descriptions.output.finalUrl),
    title: z.string().optional().describe(descriptions.output.title),
    sections: z.array(sectionSchema).describe(descriptions.output.sections),
    pageChars: z.number().int().nonnegative().describe(descriptions.output.pageChars),
    source: z.string().describe(descriptions.output.source),
    fetchedAt: z.iso.datetime().describe(descriptions.output.fetchedAt),
    blocked: z
      .object({
        reason: z.enum(BlockReason).describe(descriptions.output.blockedReason),
        signal: z.string().describe(descriptions.output.blockedSignal),
      })
      .optional()
      .describe(descriptions.output.blocked),
  }),
  execute: async ({ url, requiresJs }, { requestContext }) => {
    const runIdValue = requestContext?.get('runId');
    if (!runIdValue || typeof runIdValue !== 'string') {
      throw new Error('runId missing from requestContext — workflow misconfigured');
    }
    const result = await fetchUrl({ url, runId: runIdValue, requiresJs });
    const sections = result.blocked ? [] : extractSections(result.markdown);
    return {
      url: result.url,
      finalUrl: result.finalUrl,
      title: result.title,
      sections,
      pageChars: result.markdown.length,
      source: result.source,
      fetchedAt: result.fetchedAt,
      blocked: result.blocked,
    };
  },
});
```

Notes:
- `result.markdown` from `fetchUrl` is still the underlying module's return — we just don't expose it to the agent. The cache continues to store it.
- Blocked responses return `sections: []` and the agent should NOT quote from them (existing convention preserved).
- The `logger` import previously used for the truncation log line is no longer needed; remove if it has no other uses.

- [ ] **Step 2: Update the researcher prompt**

In `src/mastra/agents/researcher.ts`:

**Change A**: in research-loop step 4 (the "Otherwise, fetch" step), drop the `extractHints` guidance entirely. The current paragraph reads:

> **Otherwise, fetch.** Call `fetch-url` to get the full page content. Snippets are not enough when you need narrative, quotes longer than a line, or context — they may be truncated or pulled from the wrong section. **Pass `extractHints` with 2-4 short keywords or phrases for what you're hunting on that page** (e.g. `["healthcare IT spend 2024", "CAGR", "Cognizant"]`). Long pages get character-budget truncation; hints make the truncator keep the highest-signal sections instead of just the lead. Without hints you may lose the section that contained the figure you wanted.

Replace with:

> **Otherwise, fetch.** Call `fetch-url` to get the page content. The tool returns a `sections` array (each with `heading`, `level`, `content`, `contentChars`, `truncated`) plus a `pageChars` field for the total page size. Scan headings first; read the `content` of sections that look relevant. For very large pages, you don't have to read every section — pick the ones that match your sub-topic. If a section is `truncated: true`, the full text is still searchable via `find-in-page`.

**Change B**: the "Already fetched this page with a successful (non-blocked) response?" sub-bullet stays as-is (still relevant).

**Change C**: no other prompt changes. The `# Tool calling` section already lists `find-in-page` and `fetch-url`; no edits needed there.

- [ ] **Step 3: Verify build, lint, tsc**

```bash
npm run build && npm run lint && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/mastra/tools/fetch.tool.ts src/mastra/agents/researcher.ts
git commit -m "Fetch tool returns sections, drops markdown + extractHints

Output shape changes:
- markdown removed; replaced by sections: { heading, level, content,
  contentChars, truncated }[]. The cache still stores the full
  markdown for find-in-page; the tool no longer returns it.
- New pageChars field gives the agent visibility into total page size
  before deciding how much to read.
- Sections over 30k chars are sliced with truncated: true. The full
  text is recoverable via find-in-page on the cached page.

Input shape changes:
- extractHints removed. It informed relevance-rank truncation, which
  is gone — sections give the agent native browsability, so per-call
  hints are no longer needed.

Researcher prompt updated: step 4 teaches the sections shape and points
at find-in-page as the precision tool for specific phrase lookups."
```

---

## Task 3: Delete the relevance-rank module

**Files:**
- Delete: `src/modules/relevance-rank/` (entire folder)

After Task 2, the relevance-rank module has no callers. Delete it.

- [ ] **Step 1: Verify no remaining callers**

```bash
grep -rn "relevance-rank\|relevanceRank\|DEFAULT_BUDGET_CHARS" src/
```

Expect empty output. If anything still references it, fix before deleting.

- [ ] **Step 2: Delete the folder**

```bash
git rm -r src/modules/relevance-rank/
```

- [ ] **Step 3: Verify build, lint, tsc**

```bash
npm run build && npm run lint && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git commit -m "Delete relevance-rank module (no remaining callers)

Section-aware fetch made the relevance-rank truncator obsolete: the
agent now navigates by heading instead of relying on a pre-truncation
heuristic. With the only caller (fetch tool) migrated to sections, the
module is dead code."
```

---

## Manual verification (after Task 3 lands)

- [ ] **Check 1: Fetch returns sections.** Run the workflow on the financial-services brief. In Studio, inspect a `fetch-url` tool result — confirm it has `sections: [...]` with reasonable heading text, NO `markdown` field, NO `extractHints` field on input.

- [ ] **Check 2: Code-block-aware splitting.** Fetch a page that contains a fenced code block with `#` lines (e.g. a tutorial page with shell commands). Confirm the `#` lines do NOT produce spurious section breaks.

- [ ] **Check 3: Preamble preserved.** Fetch a page with lead text before the first heading. Confirm the first section has `heading: null, level: 0` and the content includes the lead text.

- [ ] **Check 4: Pathological section truncation.** Fetch a page known to have one giant un-headed section (or construct one). Confirm `contentChars` matches the truncation cap and `truncated: true` is set on that section. `find-in-page` on the same URL still returns matches from the truncated tail.

- [ ] **Check 5: Eval harness still runs.** Run scorers on a completed report. No scorer code touched markdown vs sections; expected to pass without changes.

---

## Out of scope

- **Lazy section caching.** The current implementation re-extracts sections from cached markdown on every fetch tool call. remark-parse is fast (~ms for typical pages) so this is fine. A per-process memo keyed on `(runId, url)` is a future optimization if profiling shows it matters.
- **Section-level relevance ranking.** No automatic prioritization of sections. The agent decides which sections to read. If we ever observe the agent reading every section of every page despite the new shape, we can add a hint mechanism back — but the structure-as-affordance approach gets a fair trial first.
- **Summarization.** Deferred (not in this plan).
