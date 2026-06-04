# Fetched-pages cache + findInPage tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-run cache for fetched page content (keyed by workflow `runId`) so the research agent can re-read fetched pages without re-issuing HTTP requests. Add a `findInPage` tool that searches inside cached markdown for a substring, returning matches with surrounding context. Clear the cache after the researcher step completes.

**Architecture:** Cache lives behind a small Mastra-style `PageCache` interface (get / set / list / clear) with a SQLite/libsql-backed implementation reusing the existing `@mastra/libsql` dep. The fetch entry point checks the cache before invoking providers, writes to it after successful fetches. A new `find-in-page` tool reads from the same cache (no fallback to fetch on miss). The researcher's prompt teaches the agent to pass `runId` to both tools and explains when to prefer `find-in-page` over `fetch-url`. After the workflow's research step completes (success or failure), the cache for that `runId` is cleared.

**Tech Stack:** TypeScript + Mastra + `@mastra/libsql` (already a transitive dep via `MastraCompositeStore`). Zod schemas for tool inputs/outputs. Existing logger via `utils/logger`.

**Spec reference:** `docs/tasks/fetched-pages-cache.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/modules/page-cache/types.ts` | **Create** | `PageCacheEntry`, `PageCache` interface |
| `src/modules/page-cache/libsql.ts` | **Create** | `LibSqlPageCache` — provider implementation |
| `src/modules/page-cache/constants.ts` | **Create** | `MAX_ENTRY_BYTES`, `TTL_MS`, table name |
| `src/modules/page-cache/index.ts` | **Create** | Module API + `init()` (creates the singleton) + `getCache()` |
| `src/modules/fetch/types.ts` | **Modify** | Add `runId: string` (required) to `FetchRequest`; add `fromCache?: boolean` to `FetchResult` |
| `src/modules/fetch/index.ts` | **Modify** | Wire cache check before provider chain; write to cache after success |
| `src/mastra/tools/fetch.tool.ts` | **Modify** | Add `runId` (uuid) to input schema, pass through to module |
| `src/mastra/tools/find-in-page.tool.ts` | **Create** | New tool: cache lookup + substring search + context windows |
| `src/mastra/agents/researcher.ts` | **Modify** | Register `findInPageTool`; prompt teaches `runId` passing + when to use which tool |
| `src/mastra/workflows/vertical-entry/steps/research.step.ts` | **Modify** | Pass workflow `runId` into the prompt; clear cache in finally block |
| `src/mastra/index.ts` | **Modify** | Add `pageCacheInit()` to startup; register `findInPageTool` |

---

## Task 1: Cache module — types, constants, libsql implementation

**Files:**
- Create: `src/modules/page-cache/types.ts`
- Create: `src/modules/page-cache/constants.ts`
- Create: `src/modules/page-cache/libsql.ts`
- Create: `src/modules/page-cache/index.ts`

- [ ] **Step 1: Define the cache interface and types**

`src/modules/page-cache/types.ts`:

```ts
export interface PageCacheEntry {
  runId: string;
  url: string;
  finalUrl: string;
  markdown: string;
  title?: string;
  fetchedAt: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface PageCache {
  get(runId: string, url: string): Promise<PageCacheEntry | null>;
  set(entry: PageCacheEntry): Promise<void>;
  list(runId: string): Promise<PageCacheEntry[]>;
  clear(runId: string): Promise<void>;
}
```

- [ ] **Step 2: Define constants**

`src/modules/page-cache/constants.ts`:

```ts
export const MAX_ENTRY_BYTES = 500 * 1024; // 500KB cap per cached page (~120k tokens)
export const TTL_MS = 24 * 60 * 60 * 1000; // 24h safety-net expiry on top of explicit clear
export const TABLE_NAME = 'page_cache';
export const DB_FILE = 'file:./mastra-cache.db';
```

- [ ] **Step 3: Implement the libsql-backed cache**

`src/modules/page-cache/libsql.ts`:

```ts
import { createClient, type Client } from '@libsql/client';
import { MAX_ENTRY_BYTES, TABLE_NAME, TTL_MS } from './constants';
import type { PageCache, PageCacheEntry } from './types';

export class LibSqlPageCache implements PageCache {
  constructor(private readonly client: Client) {}

  static async create(url: string): Promise<LibSqlPageCache> {
    const client = createClient({ url });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        run_id     TEXT NOT NULL,
        url        TEXT NOT NULL,
        final_url  TEXT NOT NULL,
        markdown   TEXT NOT NULL,
        title      TEXT,
        fetched_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        truncated  INTEGER NOT NULL,
        PRIMARY KEY (run_id, url)
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_run_id ON ${TABLE_NAME}(run_id)`,
    );
    return new LibSqlPageCache(client);
  }

  async get(runId: string, url: string): Promise<PageCacheEntry | null> {
    const res = await this.client.execute({
      sql: `SELECT * FROM ${TABLE_NAME} WHERE run_id = ? AND url = ?`,
      args: [runId, url],
    });
    const row = res.rows[0];
    if (!row) return null;

    const fetchedAt = String(row.fetched_at);
    if (Date.now() - new Date(fetchedAt).getTime() > TTL_MS) return null;

    return {
      runId: String(row.run_id),
      url: String(row.url),
      finalUrl: String(row.final_url),
      markdown: String(row.markdown),
      title: row.title == null ? undefined : String(row.title),
      fetchedAt,
      sizeBytes: Number(row.size_bytes),
      truncated: Number(row.truncated) === 1,
    };
  }

  async set(entry: PageCacheEntry): Promise<void> {
    const truncated = entry.sizeBytes > MAX_ENTRY_BYTES;
    const markdown = truncated ? entry.markdown.slice(0, MAX_ENTRY_BYTES) : entry.markdown;
    const sizeBytes = truncated ? MAX_ENTRY_BYTES : entry.sizeBytes;

    await this.client.execute({
      sql: `INSERT OR REPLACE INTO ${TABLE_NAME}
            (run_id, url, final_url, markdown, title, fetched_at, size_bytes, truncated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.runId,
        entry.url,
        entry.finalUrl,
        markdown,
        entry.title ?? null,
        entry.fetchedAt,
        sizeBytes,
        truncated ? 1 : 0,
      ],
    });
  }

  async list(runId: string): Promise<PageCacheEntry[]> {
    const res = await this.client.execute({
      sql: `SELECT * FROM ${TABLE_NAME} WHERE run_id = ?`,
      args: [runId],
    });
    return res.rows.map((row) => ({
      runId: String(row.run_id),
      url: String(row.url),
      finalUrl: String(row.final_url),
      markdown: String(row.markdown),
      title: row.title == null ? undefined : String(row.title),
      fetchedAt: String(row.fetched_at),
      sizeBytes: Number(row.size_bytes),
      truncated: Number(row.truncated) === 1,
    }));
  }

  async clear(runId: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM ${TABLE_NAME} WHERE run_id = ?`,
      args: [runId],
    });
  }
}
```

- [ ] **Step 4: Public module API + init**

`src/modules/page-cache/index.ts`:

```ts
import { DB_FILE } from './constants';
import { LibSqlPageCache } from './libsql';
import type { PageCache } from './types';

export type { PageCache, PageCacheEntry } from './types';
export { MAX_ENTRY_BYTES, TTL_MS } from './constants';

let cache: PageCache | null = null;

export async function init(): Promise<void> {
  if (cache) return;
  cache = await LibSqlPageCache.create(DB_FILE);
}

export function getCache(): PageCache {
  if (!cache) {
    throw new Error('Page cache not initialized — call init() at startup');
  }
  return cache;
}
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint` → expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/page-cache/
git commit -m "Add per-run page cache module (libsql-backed)

PageCache interface (get/set/list/clear scoped by runId) with a
LibSqlPageCache implementation backed by a dedicated mastra-cache.db.
500KB cap per entry with truncation flag; 24h TTL as a safety net on
top of the explicit clear path. Reuses @mastra/libsql — no new
external dependency."
```

---

## Task 2: Wire cache into the fetch flow + tool

**Files:**
- Modify: `src/modules/fetch/types.ts`
- Modify: `src/modules/fetch/index.ts`
- Modify: `src/mastra/tools/fetch.tool.ts`

- [ ] **Step 1: Extend FetchRequest and FetchResult**

`src/modules/fetch/types.ts` — add `runId` to `FetchRequest` (required) and `fromCache?: boolean` to `FetchResult`:

```ts
export interface FetchRequest {
  url: string;
  runId: string;
  requiresJs?: boolean;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  title?: string;
  markdown: string;
  source: string;
  fetchedAt: string;
  blocked?: BlockedInfo;
  /** True when the result came from the per-run cache, not a provider. */
  fromCache?: boolean;
}
```

- [ ] **Step 2: Cache-aware fetchUrl**

`src/modules/fetch/index.ts` — check cache first, write to cache on success, never re-enter the provider chain on a cache hit:

```ts
import { SUSPICIOUSLY_SHORT_THRESHOLD } from './constants';
import { detectBlock } from './detect-block';
import { FetchError } from './error';
import * as Factory from './factory';
import type { FetchRequest, FetchResult } from './types';
import { getCache } from '../page-cache';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'fetch' });

export { BlockReason } from './enums/block-reason.enum';
export type { FetchRequest, FetchResult, FetchProvider, BlockedInfo } from './types';

export async function fetchUrl(request: FetchRequest): Promise<FetchResult> {
  const cache = getCache();
  const hit = await cache.get(request.runId, request.url);
  if (hit) {
    log.info(`cache hit: ${request.url} (run ${request.runId})`);
    return {
      url: hit.url,
      finalUrl: hit.finalUrl,
      title: hit.title,
      markdown: hit.markdown,
      source: 'cache',
      fetchedAt: hit.fetchedAt,
      fromCache: true,
    };
  }

  const chain = Factory.getChain();
  const errors: FetchError[] = [];

  for (const provider of chain) {
    if (!provider.canHandle(request)) continue;

    try {
      const result = await provider.fetch(request);
      const isLast = provider === chain[chain.length - 1];
      const blocked = detectBlock(result.title, result.markdown);

      if (blocked) {
        result.blocked = blocked;
        return result;
      }
      if (!isLast && result.markdown.length < SUSPICIOUSLY_SHORT_THRESHOLD) {
        continue;
      }

      await cache.set({
        runId: request.runId,
        url: request.url,
        finalUrl: result.finalUrl,
        markdown: result.markdown,
        title: result.title,
        fetchedAt: result.fetchedAt,
        sizeBytes: Buffer.byteLength(result.markdown, 'utf8'),
        truncated: false, // libsql layer enforces truncation if needed
      });

      return result;
    } catch (err) {
      if (err instanceof FetchError) {
        errors.push(err);
        continue;
      }
      throw err;
    }
  }

  throw new FetchError(
    `All fetch providers failed for ${request.url}: ` +
      errors.map((e) => `[${e.provider}] ${e.message}`).join('; '),
    request.url,
    'chain',
  );
}

export function init() {
  Factory.init();
}
```

Notes:
- Blocked pages are NOT cached (the markdown is unreliable; the spec only requires caching successful results — caching a blocked page would mask a transient block on the next fetch).
- `sizeBytes` is computed from the original markdown length; the cache layer enforces the 500KB cap and sets `truncated`.

- [ ] **Step 3: Update the fetch tool to require runId**

`src/mastra/tools/fetch.tool.ts`:

- Add `runId: z.string().uuid()` (required) to the input schema.
- Update the tool description to mention `findInPage` (added in Task 3).
- Pass `runId` through to `fetchUrl`.

Specifically, the input schema becomes:

```ts
inputSchema: z.object({
  url: z.url().describe(descriptions.input.url),
  runId: z.string().uuid().describe(descriptions.input.runId),
  requiresJs: z.boolean().optional().describe(descriptions.input.requiresJs),
  extractHints: z.array(z.string()).optional().describe(descriptions.input.extractHints),
}),
```

Add `runId` description:

```ts
runId: 'The current research session\'s runId — required so the page can be retrieved by `find-in-page` later in the same run without re-fetching. Use the runId given to you in the initial brief.',
```

Extend the tool description with: *"After fetching a page, you can later search within it without re-fetching by calling `find-in-page` with the same URL and your current runId."*

Update `execute`:

```ts
execute: async ({ url, runId, requiresJs, extractHints }) => {
  const result = await fetchUrl({ url, runId, requiresJs });
  if (!result.blocked && result.markdown.length > DEFAULT_BUDGET_CHARS) {
    const original = result.markdown.length;
    result.markdown = relevanceRank(result.markdown, extractHints);
    log.info(
      `Truncated ${url}: ${original} → ${result.markdown.length} chars` +
        (extractHints?.length ? ` (hints: ${extractHints.join(', ')})` : ' (no hints, head cap)'),
    );
  }
  return result;
},
```

Note: the cache stores the FULL markdown (before relevance-rank truncation). Truncation happens at the tool boundary so the agent sees a budget-friendly response but the cache retains the complete page for later `findInPage` queries.

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint` → expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fetch/types.ts src/modules/fetch/index.ts src/mastra/tools/fetch.tool.ts
git commit -m "Cache successful fetches per runId, mark cache hits

fetchUrl now checks the per-run cache before the provider chain and
writes successful results to the cache. Blocked / paywalled responses
are NOT cached (unreliable content). Cache hits return source:'cache'
and skip retries/fallbacks. The fetch tool's input schema requires
runId so the agent's call sites scope cache reads/writes consistently.
The relevance-rank truncator continues to operate at the tool boundary,
so the agent sees a budget-friendly response while the cache retains
the full page for find-in-page lookups."
```

---

## Task 3: Add the findInPage tool

**Files:**
- Create: `src/mastra/tools/find-in-page.tool.ts`

- [ ] **Step 1: Write the tool**

`src/mastra/tools/find-in-page.tool.ts`:

```ts
import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { getCache } from '../../modules/page-cache';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'find-in-page' });

const descriptions = {
  tool:
    'Search for a specific phrase or quote within a page you have already fetched in this research run. Use this instead of re-fetching the page or running a new web search when you remember that a fetched page contains a specific fact, quote, or number, and you need to locate it precisely or verify its surrounding context. You MUST have already fetched this URL in the current run. The tool will not fetch new pages. Typical use: after fetching a long page, use find-in-page with the specific phrase you need to extract for evidence. For finding multiple distinct phrases, call the tool once per phrase.',
  input: {
    runId: 'The current research session\'s runId. Must match the runId used for the original fetch.',
    url: 'The URL to search within. Must be a URL you have already fetched in this run.',
    query:
      'Plain-text phrase to search for. Case-insensitive substring match. For finding multiple distinct phrases, call the tool once per phrase.',
    contextChars:
      'Characters of surrounding context to return with each match (50-2000, default 300). Half before the match, half after.',
    maxMatches: 'Maximum number of matches to return (1-20, default 5).',
  },
  output: {
    found: 'True when at least one match was found in the cached page.',
    matches: 'Array of matches, each with the surrounding text snippet and the offset of the match in the cached markdown.',
    pageMetadata: 'Metadata about the cached page (title, finalUrl, fetchedAt, truncated). Present when the URL was found in the cache.',
    error:
      'Set when the URL was not previously fetched in this run (URL not in cache for this run). Returned as a structured response, not thrown.',
  },
} as const;

const matchSchema = z.object({
  snippet: z.string().describe('The matched phrase with surrounding context'),
  matchOffset: z.number().int().describe('Character offset of the match start in the cached markdown'),
});

const pageMetadataSchema = z.object({
  title: z.string().optional(),
  finalUrl: z.url(),
  fetchedAt: z.iso.datetime(),
  truncated: z.boolean(),
});

export const findInPageTool = createTool({
  id: 'find-in-page',
  description: descriptions.tool,
  inputSchema: z.object({
    runId: z.string().uuid().describe(descriptions.input.runId),
    url: z.url().describe(descriptions.input.url),
    query: z.string().min(1).describe(descriptions.input.query),
    contextChars: z.number().int().min(50).max(2000).default(300).describe(descriptions.input.contextChars),
    maxMatches: z.number().int().min(1).max(20).default(5).describe(descriptions.input.maxMatches),
  }),
  outputSchema: z.object({
    found: z.boolean().describe(descriptions.output.found),
    matches: z.array(matchSchema).describe(descriptions.output.matches),
    pageMetadata: pageMetadataSchema.optional().describe(descriptions.output.pageMetadata),
    error: z.string().optional().describe(descriptions.output.error),
  }),
  execute: async ({ runId, url, query, contextChars, maxMatches }) => {
    const cache = getCache();
    const entry = await cache.get(runId, url);

    if (!entry) {
      log.info(`miss: ${url} (run ${runId})`);
      return {
        found: false,
        matches: [],
        error: 'URL not previously fetched in this run. Use the fetch tool first.',
      };
    }

    const matches: { snippet: string; matchOffset: number }[] = [];
    const lowerMarkdown = entry.markdown.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const half = Math.floor(contextChars / 2);

    let cursor = 0;
    while (matches.length < maxMatches) {
      const idx = lowerMarkdown.indexOf(lowerQuery, cursor);
      if (idx === -1) break;
      const from = Math.max(0, idx - half);
      const to = Math.min(entry.markdown.length, idx + lowerQuery.length + half);
      matches.push({ snippet: entry.markdown.slice(from, to), matchOffset: idx });
      cursor = idx + lowerQuery.length;
    }

    log.info(`${url} (run ${runId}): "${query}" → ${matches.length} match(es)`);

    return {
      found: matches.length > 0,
      matches,
      pageMetadata: {
        title: entry.title,
        finalUrl: entry.finalUrl,
        fetchedAt: entry.fetchedAt,
        truncated: entry.truncated,
      },
    };
  },
});
```

Notes:
- Case-insensitive via dual lowercase copies (one for searching offsets, one for returning original-cased snippets).
- Cache miss is a structured response, not a throw — the agent sees a clear `error` field and learns to fetch first.
- Empty matches with valid `pageMetadata` is a distinct meaningful result ("phrase isn't there" vs "you need to fetch first").

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`.

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/find-in-page.tool.ts
git commit -m "Add find-in-page tool: substring search in cached pages

New tool reads from the per-run page cache and performs case-insensitive
substring matching with configurable context windows. Cache miss is a
structured error in the response, not a throw — and never falls through
to a real fetch (would mask agent mistakes and burn credits). The tool
is not yet registered on the agent (next commit)."
```

---

## Task 4: Register the tool, update agent + workflow, wire startup

**Files:**
- Modify: `src/mastra/index.ts`
- Modify: `src/mastra/agents/researcher.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/research.step.ts`

- [ ] **Step 1: Initialize the cache at Mastra startup, register the tool**

`src/mastra/index.ts`:

- Add: `import { init as pageCacheInit } from '../modules/page-cache';`
- Add: `import { findInPageTool } from './tools/find-in-page.tool';`
- Add `await pageCacheInit();` in the startup sequence (next to `searchInit()` / `fetchInit()` / `companiesInit()`). Note: `pageCacheInit` is async — verify the existing file allows top-level await (project uses `"type": "module"`).
- Add `findInPageTool` to the Mastra `tools` registration block.

- [ ] **Step 2: Attach the tool to the researcher and update the prompt**

`src/mastra/agents/researcher.ts`:

- Import: `import { findInPageTool } from '../tools/find-in-page.tool';`
- Add to `tools: { webSearchTool, fetchTool, findInPageTool }`.
- Insert a `# runId` section right after the `# Critical contract` block, explaining the per-run identifier and that it must be passed to `fetch-url` and `find-in-page` on every call.
- Extend the `# Research loop` section's fetch step (step 4) to add a sub-bullet:
  > **Already fetched this page?** Use `find-in-page` with the URL + your exact phrase to locate it in the previously fetched content. Do NOT call `fetch-url` on a URL you've already fetched in this run — the cache will serve it, but `find-in-page` is the more precise way to locate a specific quote inside a page you know you have.

Concrete prompt patch — add this block right after the Critical contract:

```
# runId

You will be given a research-session \`runId\` in the initial brief. Pass
that runId on every call to \`fetch-url\` and \`find-in-page\`. The cache
is scoped to this runId; without it the runtime cannot find pages you've
already fetched.
```

- [ ] **Step 3: Pass runId into the agent's brief and clear cache after research**

`src/mastra/workflows/vertical-entry/steps/research.step.ts`:

- Destructure `runId` from the workflow step's execute arg: `execute: async ({ inputData, mastra, runId }) => { ... }`.
- Include the runId in the initial prompt: add `Your runId for this research session is: ${runId}` immediately under the company-profile block, before the "Populate working memory…" line.
- Wrap the agent.stream call in a `try { ... } finally { await getCache().clear(runId); }` so the cache is released on both success and failure.

Concrete change:

```ts
import { getCache } from '../../../../modules/page-cache';
// ...

execute: async ({ inputData, mastra, runId }) => {
  if (!inputData) throw new Error('Brief not provided');

  const companyKey = inputData.companyKey ?? env.DEFAULT_COMPANY_KEY;
  if (!companyKey) throw new Error('No companyKey provided and DEFAULT_COMPANY_KEY env var is not set');
  const profile = getProfile(companyKey);
  if (!profile) throw new Error(`Unknown companyKey: "${companyKey}"`);

  const agent = mastra.getAgentById(researcher.id);
  const threadId = randomUUID();
  const resourceId = 'default';

  const prompt = `
Vertical: ${inputData.vertical}
Company: ${profile.name}
Profile (verified ${profile.lastVerified}):
${profile.facts}

Your runId for this research session is: ${runId}

Populate working memory with structured findings, then emit your completion signal.
  `.trim();

  try {
    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: { thread: threadId, resource: resourceId },
      maxSteps: 60,
    });

    let completionSignal = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      completionSignal += chunk;
    }

    return {
      threadId,
      vertical: inputData.vertical,
      companyName: profile.name,
      companyFacts: profile.facts,
      completionSignal,
    };
  } finally {
    await getCache().clear(runId);
  }
},
```

The `finally` block runs on both successful return and thrown errors, satisfying the spec's requirement that the cache be cleared "on workflow completion as the normal path" AND "if the workflow errors."

- [ ] **Step 4: Add `mastra-cache.db*` to .gitignore (if not already covered)**

Check `.gitignore` for `*.db` or specifically `mastra-cache.db`. If missing, add:

```
mastra-cache.db
mastra-cache.db-journal
mastra-cache.db-wal
mastra-cache.db-shm
```

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/index.ts \
        src/mastra/agents/researcher.ts \
        src/mastra/workflows/vertical-entry/steps/research.step.ts \
        .gitignore
git commit -m "Register find-in-page, plumb runId to researcher, clear cache after research

- Mastra startup initializes the page cache (await pageCacheInit()).
- find-in-page is registered as a Mastra tool and added to the
  researcher's toolset (not the synthesizer's — read-only on memory).
- Researcher prompt gets a # runId section explaining the per-run
  identifier and a sub-bullet in the fetch step pointing at find-in-page
  when the URL has already been fetched this run.
- research.step.ts receives the workflow runId from the step execute
  context, embeds it in the brief, and clears the cache for that runId
  in a finally block (covers success and error paths).
- mastra-cache.db* added to .gitignore."
```

---

## Manual verification (not commits)

- [ ] **Check 1: Cache hit on repeat fetch within one run.** Start `npm run dev`. Run the workflow; observe (in the researcher's tool-call log) that the same URL fetched twice produces one `fetch` provider call and one `cache hit: <url>` log line on the second call.

- [ ] **Check 2: findInPage on a fetched URL.** Confirm in a Studio trace that calling `find-in-page` with a phrase known to be in a previously-fetched page returns `found: true` with a sensible snippet and `matchOffset`.

- [ ] **Check 3: findInPage on an unfetched URL.** Construct or observe a call where the agent calls `find-in-page` for a URL it hasn't fetched. Confirm the response is `{ found: false, error: "URL not previously fetched..." }` — not an exception, not a silent fetch.

- [ ] **Check 4: Cache cleared after research step.** After a workflow run completes, query `mastra-cache.db` directly: `sqlite3 mastra-cache.db "SELECT COUNT(*) FROM page_cache WHERE run_id = '<runId>'"`. Expect 0 rows.

- [ ] **Check 5: Cache cleared on research-step error.** Manually break the research step (e.g., delete the company profile temporarily) so the step throws. After the workflow errors, query the cache for that runId — should be 0 rows.

---

## Out of scope for this plan

- **Synthesizer access to the cache.** The synthesizer reads from working memory only; it gets neither the cache nor `find-in-page`. Per spec.
- **Vector / semantic search.** Substring only.
- **Cross-run cache.** Strictly per-runId.
- **Eviction policy beyond TTL + explicit clear.** No LRU, no size-based eviction across the table — runs are short enough that the explicit clear handles it.

---

## Risks and open notes

- **Cache `.db` file growth.** Even with per-run clear, transient state could grow if many workflows run concurrently. Acceptable for the current single-tenant operator pattern; revisit if multi-tenant.
- **Top-level await in `src/mastra/index.ts`.** The existing file already uses top-level `await new DuckDBStore()...` in `storage.ts`, so the project's tooling supports it. Confirm during Task 4 step 1 that adding `await pageCacheInit()` doesn't break the bundler. If it does, fall back to invoking `pageCacheInit()` synchronously by creating the libsql client lazily on first `getCache()` call.
- **runId in tool input vs. requestContext.** This plan puts runId in the tool input schema per the spec. If the model frequently forgets to pass it, a follow-up could plumb `runId` via `requestContext` in `agent.stream(..., { requestContext: { runId } })` and have the tools fall back to `ctx.requestContext.runId`. Defer until we observe model behavior.
