# Vitest unit tests for pure logic (A4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Vitest and unit-test the project's deterministic pure functions (source-quality, search, citation, fetch-block logic) so they have a permanent regression net instead of throwaway esbuild harnesses.

**Architecture:** Add Vitest (esbuild-based, native ESM+TS), co-locate `*.test.ts` beside each module, and write pure input→output assertions with no mocks/network. `npm test` runs `vitest run`.

**Tech Stack:** Vitest, TypeScript (ES2022, strict, `moduleResolution: bundler`), Node `>=22.13.0`.

## Global Constraints

- Node `>=22.13.0`; TypeScript ES2022, strict. Tests are TypeScript, type-checked by the existing `tsconfig`.
- **No production source changes.** This wave only adds Vitest config, the `vitest` devDep, and `*.test.ts` files. Tests assert the CURRENT behavior of existing functions.
- **If a test fails because the code is actually wrong, STOP and surface it as a finding** (status DONE_WITH_CONCERNS) — do NOT edit the source to make a test pass, and do NOT assert a bug as correct.
- Tests import `{ describe, it, expect }` explicitly (no Vitest globals).
- Test files are co-located: `src/.../<name>.test.ts` beside `<name>.ts`.
- No mocks, no network, no filesystem — every target is a pure function. Build minimal literal fixtures; cast domain types with `as unknown as T` to carry only the fields under test.

**Spec:** `docs/superpowers/specs/2026-06-23-vitest-unit-tests-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `vitest.config.ts` | Vitest config (node env, `src/**/*.test.ts`) | Create |
| `package.json` | `vitest` devDep + `test`/`test:watch` scripts | Modify |
| `src/mastra/workflows/vertical-entry/normalize-citations.test.ts` | Tests for `normalizeCitations` | Create |
| `src/modules/search/content-cap.test.ts` | Tests for `capResultContent` | Create |
| `src/mastra/workflows/vertical-entry/corroboration.test.ts` | Tests for `assessCorroboration`/`corroborationDeficits`/`corroborationFlagBlock` | Create |
| `src/modules/search/domain-presets.test.ts` | Tests for `enforceIncludeDomains`/`withDefaultExcludes`/`deprioritizeGated` | Create |
| `src/modules/fetch/detect-block.test.ts` | Tests for `detectBlock` | Create |
| `src/mastra/scorers/utils/urls.test.ts` | Tests for `extractUrls`/`extractDomains` | Create |
| `src/mastra/scorers/utils/extract-report-text.test.ts` | Tests for `isFinalReport`/`hasLeakedToolCall` | Create |

Note on the TDD cycle: the code under test **already exists**, so each suite is "write the test → run it → expect PASS". There is no implement-to-green step. A failing test means a wrong expectation or a real bug (see Global Constraints).

---

## Task 1: Vitest setup + first two suites (smoke)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `src/mastra/workflows/vertical-entry/normalize-citations.test.ts`
- Create: `src/modules/search/content-cap.test.ts`

**Interfaces:**
- Consumes: `normalizeCitations(text: string): string`; `capResultContent(results: SearchResult[]): SearchResult[]` with `CONTENT_RESULT_LIMIT = 5`; `SearchResult = { url: string; title: string; snippet: string; content?: string }`.

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`
Expected: completes, `vitest` appears in `package.json` devDependencies.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Wire `package.json` scripts**

Replace the stub `"test": "echo \"Error: no test specified\" && exit 1",` with:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Write `normalize-citations.test.ts`**

Create `src/mastra/workflows/vertical-entry/normalize-citations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeCitations } from './normalize-citations';

describe('normalizeCitations', () => {
  it('converts a daggered native marker to [N]', () => {
    expect(normalizeCitations('foo 【1†Source title】 bar')).toBe('foo [1] bar');
  });

  it('converts a double-dagger variant to [N]', () => {
    expect(normalizeCitations('【10‡Other】')).toBe('[10]');
  });

  it('converts a bare CJK-bracket marker to [N]', () => {
    expect(normalizeCitations('x 【2】 y')).toBe('x [2] y');
  });

  it('handles adjacent markers', () => {
    expect(normalizeCitations('a 【1】【2】 b')).toBe('a [1][2] b');
  });

  it('strips stray fullwidth brackets', () => {
    expect(normalizeCitations('stray 【 and 】 brackets')).toBe('stray  and  brackets');
  });

  it('leaves existing [N] citations untouched', () => {
    expect(normalizeCitations('clean [3] already')).toBe('clean [3] already');
  });
});
```

- [ ] **Step 5: Write `content-cap.test.ts`**

Create `src/modules/search/content-cap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SearchResult } from './types';
import { capResultContent, CONTENT_RESULT_LIMIT } from './content-cap';

const make = (n: number): SearchResult[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `https://x.com/${i}`,
    title: `t${i}`,
    snippet: `s${i}`,
    content: `c${i}`,
  }));

describe('capResultContent', () => {
  it('keeps content on the first CONTENT_RESULT_LIMIT results', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT + 2));

    for (let i = 0; i < CONTENT_RESULT_LIMIT; i++) {
      expect(out[i].content).toBe(`c${i}`);
    }
  });

  it('strips content from results past the limit', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT + 2));

    expect(out[CONTENT_RESULT_LIMIT].content).toBeUndefined();
    expect(out[CONTENT_RESULT_LIMIT + 1].content).toBeUndefined();
  });

  it('preserves order and every non-content field', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT + 1));
    const last = out[CONTENT_RESULT_LIMIT];

    expect(out.map((r) => r.url)).toEqual(make(CONTENT_RESULT_LIMIT + 1).map((r) => r.url));
    expect(last.title).toBe(`t${CONTENT_RESULT_LIMIT}`);
    expect(last.snippet).toBe(`s${CONTENT_RESULT_LIMIT}`);
  });

  it('returns an empty array unchanged', () => {
    expect(capResultContent([])).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the suites**

Run: `npm test`
Expected: PASS — both suites green (10 tests), no stray warnings.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/mastra/workflows/vertical-entry/normalize-citations.test.ts src/modules/search/content-cap.test.ts
git commit -m "test: add Vitest + suites for normalize-citations and content-cap"
```

---

## Task 2: corroboration.test.ts

**Files:**
- Create: `src/mastra/workflows/vertical-entry/corroboration.test.ts`

**Interfaces:**
- Consumes: `assessCorroboration(m): { competitors: V[]; trends: V[] }` where `V = { label: string; corroborated: boolean; sources: { url: string; classifier: string }[] }`; `corroborationDeficits(m): string[]`; `corroborationFlagBlock(m): string | null`. `m` is `ResearchMemory`; relevant fields `competitors: {name, sources: string[]}[]`, `marketTrends: {claim, sourceUrl}[]`, `sourcesConsulted: {url, classifier}[]`. Authoritative ≡ classifier ∉ {vendor, other}; URL absent from `sourcesConsulted` → non-authoritative.

- [ ] **Step 1: Write the test file**

Create `src/mastra/workflows/vertical-entry/corroboration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ResearchMemory } from '../../schemas/research-memory';
import {
  assessCorroboration,
  corroborationDeficits,
  corroborationFlagBlock,
} from './corroboration';

const mem = (over: Partial<{
  marketTrends: { claim: string; sourceUrl: string }[];
  competitors: { name: string; sources: string[] }[];
  sourcesConsulted: { url: string; classifier: string }[];
}>): ResearchMemory =>
  ({
    marketTrends: over.marketTrends ?? [],
    competitors: over.competitors ?? [],
    sourcesConsulted: over.sourcesConsulted ?? [],
  }) as unknown as ResearchMemory;

describe('assessCorroboration — URL canonicalization', () => {
  it('matches across http/https, www., query and trailing slash', () => {
    const m = mem({
      marketTrends: [
        { claim: 'http vs https', sourceUrl: 'http://gartner.com/r' },
        { claim: 'www + query', sourceUrl: 'https://www.gartner.com/r?utm=x' },
      ],
      competitors: [{ name: 'Slash', sources: ['https://everestgrp.com/x/'] }],
      sourcesConsulted: [
        { url: 'https://gartner.com/r', classifier: 'analyst' },
        { url: 'https://everestgrp.com/x', classifier: 'analyst' },
      ],
    });
    const r = assessCorroboration(m);

    expect(r.trends.map((t) => t.corroborated)).toEqual([true, true]);
    expect(r.competitors[0].corroborated).toBe(true);
  });
});

describe('assessCorroboration — authority rule', () => {
  it('treats vendor/other as non-authoritative and everything else as authoritative', () => {
    const m = mem({
      competitors: [
        { name: 'Vend', sources: ['https://v.example/a'] },
        { name: 'Other', sources: ['https://o.example/a'] },
        { name: 'Gov', sources: ['https://g.example/a'] },
        { name: 'IR', sources: ['https://ir.example/a'] },
      ],
      sourcesConsulted: [
        { url: 'https://v.example/a', classifier: 'vendor' },
        { url: 'https://o.example/a', classifier: 'other' },
        { url: 'https://g.example/a', classifier: 'government' },
        { url: 'https://ir.example/a', classifier: 'company-ir' },
      ],
    });

    expect(assessCorroboration(m).competitors.map((c) => c.corroborated)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('treats a URL absent from sourcesConsulted as non-authoritative and resolves it as unclassified', () => {
    const m = mem({
      competitors: [{ name: 'Ghost', sources: ['https://missing.example/a'] }],
      sourcesConsulted: [],
    });
    const v = assessCorroboration(m).competitors[0];

    expect(v.corroborated).toBe(false);
    expect(v.sources).toEqual([{ url: 'https://missing.example/a', classifier: 'unclassified' }]);
  });

  it('corroborates a competitor when ANY one source is authoritative', () => {
    const m = mem({
      competitors: [{ name: 'Mixed', sources: ['https://v.example/a', 'https://a.example/a'] }],
      sourcesConsulted: [
        { url: 'https://v.example/a', classifier: 'vendor' },
        { url: 'https://a.example/a', classifier: 'analyst' },
      ],
    });

    expect(assessCorroboration(m).competitors[0].corroborated).toBe(true);
  });
});

describe('corroborationDeficits', () => {
  it('names the offending trend source URL and its classifier', () => {
    const m = mem({
      marketTrends: [{ claim: 'Vendor trend', sourceUrl: 'https://v.example/post' }],
      sourcesConsulted: [{ url: 'https://v.example/post', classifier: 'vendor' }],
    });
    const d = corroborationDeficits(m);

    expect(d).toHaveLength(1);
    expect(d[0]).toContain('https://v.example/post');
    expect(d[0]).toContain('"vendor"');
    expect(d[0]).toContain('drop the claim');
  });

  it('lists a competitor’s sources with classifiers incl. unclassified, and offers removal', () => {
    const m = mem({
      competitors: [{ name: 'JunkCo', sources: ['https://j.example/a', 'https://u.example/x'] }],
      sourcesConsulted: [{ url: 'https://j.example/a', classifier: 'vendor' }],
    });
    const d = corroborationDeficits(m);

    expect(d).toHaveLength(1);
    expect(d[0]).toContain('JunkCo');
    expect(d[0]).toContain('(vendor)');
    expect(d[0]).toContain('(unclassified)');
    expect(d[0]).toContain('remove it');
  });

  it('returns no deficits when everything is corroborated', () => {
    const m = mem({
      competitors: [{ name: 'Good', sources: ['https://a.example/a'] }],
      marketTrends: [{ claim: 'ok', sourceUrl: 'https://a.example/a' }],
      sourcesConsulted: [{ url: 'https://a.example/a', classifier: 'analyst' }],
    });

    expect(corroborationDeficits(m)).toEqual([]);
  });
});

describe('corroborationFlagBlock', () => {
  it('returns null when all findings are corroborated', () => {
    const m = mem({
      competitors: [{ name: 'Good', sources: ['https://a.example/a'] }],
      sourcesConsulted: [{ url: 'https://a.example/a', classifier: 'analyst' }],
    });

    expect(corroborationFlagBlock(m)).toBeNull();
  });

  it('lists uncorroborated competitors and trends under a Confidence & Gaps instruction', () => {
    const m = mem({
      competitors: [{ name: 'VendorOnly', sources: ['https://v.example/a'] }],
      marketTrends: [{ claim: 'Vendor trend', sourceUrl: 'https://v.example/a' }],
      sourcesConsulted: [{ url: 'https://v.example/a', classifier: 'vendor' }],
    });
    const block = corroborationFlagBlock(m);

    expect(block).not.toBeNull();
    expect(block).toContain('Confidence & Gaps');
    expect(block).toContain('competitor: VendorOnly');
    expect(block).toContain('trend: Vendor trend');
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run src/mastra/workflows/vertical-entry/corroboration.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/corroboration.test.ts
git commit -m "test: cover source corroboration logic"
```

---

## Task 3: domain-presets.test.ts

**Files:**
- Create: `src/modules/search/domain-presets.test.ts`

**Interfaces:**
- Consumes: `enforceIncludeDomains(results: SearchResult[], includeDomains?: string[]): SearchResult[]`; `withDefaultExcludes(query: SearchQuery): SearchQuery` (unions `DEFAULT_EXCLUDE_DOMAINS` into `excludeDomains`, normalizes, de-dupes, leaves `includeDomains` untouched); `deprioritizeGated(results: SearchResult[]): SearchResult[]` (gated URLs — `everestgrp.com/report/`, `gartner.com/.../documents/`, `forrester.com/report/` — sorted to the bottom, stable within buckets). `SearchQuery = { query: string; includeDomains?: string[]; excludeDomains?: string[]; maxResults?: number }`.

- [ ] **Step 1: Write the test file**

Create `src/modules/search/domain-presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SearchResult } from './types';
import { enforceIncludeDomains, withDefaultExcludes, deprioritizeGated } from './domain-presets';

const R = (url: string): SearchResult => ({ url, title: '', snippet: '' });

describe('enforceIncludeDomains', () => {
  it('is a no-op when the list is empty or absent', () => {
    expect(enforceIncludeDomains([R('https://x.com/a')], [])).toHaveLength(1);
    expect(enforceIncludeDomains([R('https://x.com/a')], undefined)).toHaveLength(1);
  });

  it('keeps the exact host and subdomains, drops off-list hosts', () => {
    const out = enforceIncludeDomains(
      [
        R('https://www.mckinsey.com/insights/x'),
        R('https://insights.mckinsey.com/y'),
        R('https://elevancesystems.com/about'),
      ],
      ['mckinsey.com'],
    );

    expect(out.map((r) => r.url)).toEqual([
      'https://www.mckinsey.com/insights/x',
      'https://insights.mckinsey.com/y',
    ]);
  });

  it('normalizes www./casing on the include entry', () => {
    expect(enforceIncludeDomains([R('https://gartner.com/a')], ['WWW.Gartner.com'])).toHaveLength(1);
  });

  it('returns empty when every result is off-list', () => {
    expect(enforceIncludeDomains([R('https://elevancesystems.com/a')], ['gartner.com'])).toEqual([]);
  });

  it('does not treat foo-mckinsey.com as a subdomain of mckinsey.com', () => {
    expect(enforceIncludeDomains([R('https://foo-mckinsey.com/a')], ['mckinsey.com'])).toEqual([]);
  });

  it('drops unparseable URLs', () => {
    expect(enforceIncludeDomains([R('not a url')], ['gartner.com'])).toEqual([]);
  });
});

describe('withDefaultExcludes', () => {
  it('unions the default denylist into excludeDomains and preserves the agent’s excludes', () => {
    const out = withDefaultExcludes({ query: 'q', excludeDomains: ['Custom.com'] });

    expect(out.excludeDomains).toContain('imarcgroup.com'); // a known default-denylist entry
    expect(out.excludeDomains).toContain('custom.com'); // agent entry, normalized
  });

  it('normalizes and de-duplicates', () => {
    const out = withDefaultExcludes({ query: 'q', excludeDomains: ['www.imarcgroup.com'] });
    const occurrences = out.excludeDomains!.filter((d) => d === 'imarcgroup.com').length;

    expect(occurrences).toBe(1);
  });

  it('leaves includeDomains and query untouched', () => {
    const out = withDefaultExcludes({ query: 'q', includeDomains: ['gartner.com'] });

    expect(out.includeDomains).toEqual(['gartner.com']);
    expect(out.query).toBe('q');
  });
});

describe('deprioritizeGated', () => {
  it('moves gated URLs to the bottom, keeping non-gated order stable', () => {
    const out = deprioritizeGated([
      R('https://everestgrp.com/report/abc'),
      R('https://healthcareitnews.com/a'),
      R('https://fiercehealthcare.com/b'),
    ]);

    expect(out.map((r) => r.url)).toEqual([
      'https://healthcareitnews.com/a',
      'https://fiercehealthcare.com/b',
      'https://everestgrp.com/report/abc',
    ]);
  });

  it('leaves an all-non-gated list unchanged', () => {
    const urls = ['https://a.com/1', 'https://b.com/2'];
    const out = deprioritizeGated(urls.map(R));

    expect(out.map((r) => r.url)).toEqual(urls);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run src/modules/search/domain-presets.test.ts`
Expected: PASS.

Note: the `imarcgroup.com` assertion depends on it being present in `DEFAULT_EXCLUDE_DOMAINS`. If that entry was renamed, read the current list in `domain-presets.ts` and substitute another real default-denylist domain — do not change the source.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/search/domain-presets.test.ts
git commit -m "test: cover includeDomains enforcement, default excludes, gated sort"
```

---

## Task 4: detect-block + scorer utils

**Files:**
- Create: `src/modules/fetch/detect-block.test.ts`
- Create: `src/mastra/scorers/utils/urls.test.ts`
- Create: `src/mastra/scorers/utils/extract-report-text.test.ts`

**Interfaces:**
- Consumes: `detectBlock(title: string | undefined, markdown: string): { reason: string; signal: string } | undefined` — title match returns immediately; a body match counts only when `markdown.length < MIN_REAL_CONTENT * 3` (i.e. `< 1200`); clean → `undefined`. `extractUrls(text): string[]` (strips trailing `.,;`), `extractDomains(text): string[]` (hostname, `www.` stripped, de-duped). `isFinalReport(text): boolean` (length `> 800`, no garbage markers like `<tool_call>`, `≥ 3` section-heading hits among Executive Summary / Market Trends / Competitor / ICPs / Fit Analysis / Positioning / Confidence / Sources). `hasLeakedToolCall(text): boolean` (true on `<tool_call>` / `<function=` etc. in prose; false inside fenced code; false on empty).

- [ ] **Step 1: Write `detect-block.test.ts`**

Create `src/modules/fetch/detect-block.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectBlock } from './detect-block';
import { BlockReason } from './enums/block-reason.enum';

describe('detectBlock', () => {
  it('flags a login wall in the title', () => {
    const b = detectBlock('Sign in to continue', 'short body');

    expect(b?.reason).toBe(BlockReason.LoginWall);
    expect(b?.signal).toContain('title:');
  });

  it('flags a captcha signal in a short body', () => {
    const b = detectBlock('Some page', 'Please verify you are human to proceed.');

    expect(b?.reason).toBe(BlockReason.Captcha);
  });

  it('flags a paywall signal in a short body', () => {
    const b = detectBlock('Article', 'Subscribe to read the rest of this story.');

    expect(b?.reason).toBe(BlockReason.PayWall);
  });

  it('does NOT flag a body signal inside a long article (length gate)', () => {
    const longBody = 'word '.repeat(400) + ' please sign in for our newsletter'; // > 1200 chars
    expect(longBody.length).toBeGreaterThan(1200);
    expect(detectBlock('A real healthcare article', longBody)).toBeUndefined();
  });

  it('returns undefined for a clean page', () => {
    expect(detectBlock('Healthcare IT trends', 'A normal article body with real content.')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write `urls.test.ts`**

Create `src/mastra/scorers/utils/urls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractUrls, extractDomains } from './urls';

describe('extractUrls', () => {
  it('extracts URLs and strips wrapping punctuation / trailing dots', () => {
    expect(extractUrls('see (https://x.com/a) and https://y.com.')).toEqual([
      'https://x.com/a',
      'https://y.com',
    ]);
  });

  it('returns an empty array when there are no URLs', () => {
    expect(extractUrls('no links here')).toEqual([]);
  });
});

describe('extractDomains', () => {
  it('returns de-duplicated, www-stripped hostnames', () => {
    expect(
      extractDomains('https://www.x.com/a https://x.com/b https://y.org/c'),
    ).toEqual(['x.com', 'y.org']);
  });
});
```

- [ ] **Step 3: Write `extract-report-text.test.ts`**

Create `src/mastra/scorers/utils/extract-report-text.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isFinalReport, hasLeakedToolCall } from './extract-report-text';

const fullReport = `
## Executive Summary
${'Lorem ipsum dolor sit amet. '.repeat(40)}

## Market Trends
Trend one with evidence.

## Competitor Landscape
Competitor profiles here.

## Sources
[1] Example — https://example.com
`;

describe('isFinalReport', () => {
  it('accepts a long report that hits enough section headings', () => {
    expect(fullReport.length).toBeGreaterThan(800);
    expect(isFinalReport(fullReport)).toBe(true);
  });

  it('rejects text below the minimum length', () => {
    expect(isFinalReport('too short')).toBe(false);
  });

  it('rejects a long report with too few sections', () => {
    const thin = '## Executive Summary\n' + 'filler text. '.repeat(80);
    expect(thin.length).toBeGreaterThan(800);
    expect(isFinalReport(thin)).toBe(false);
  });

  it('rejects text containing a leaked tool-call marker (garbage)', () => {
    expect(isFinalReport(fullReport + '\n<tool_call>{}</tool_call>')).toBe(false);
  });
});

describe('hasLeakedToolCall', () => {
  it('detects a leaked tool-call marker in prose', () => {
    expect(hasLeakedToolCall('here is <tool_call> leaking')).toBe(true);
  });

  it('detects a leaked function-call marker', () => {
    expect(hasLeakedToolCall('text <function= foo>')).toBe(true);
  });

  it('ignores tool-call markup inside fenced code', () => {
    expect(hasLeakedToolCall('```\n<tool_call>\n```')).toBe(false);
  });

  it('is false for empty text', () => {
    expect(hasLeakedToolCall('')).toBe(false);
  });
});
```

- [ ] **Step 4: Run the three suites**

Run: `npx vitest run src/modules/fetch/detect-block.test.ts src/mastra/scorers/utils/urls.test.ts src/mastra/scorers/utils/extract-report-text.test.ts`
Expected: PASS.

If `isFinalReport(fullReport)` is false, the heading patterns in `src/mastra/scorers/constants.ts` differ from this fixture's headings — read the current `EXPECTED_SECTION_PATTERNS` and adjust the fixture's heading lines so it hits `MIN_SECTION_HITS` (do not change the source).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/fetch/detect-block.test.ts src/mastra/scorers/utils/urls.test.ts src/mastra/scorers/utils/extract-report-text.test.ts
git commit -m "test: cover fetch block-detection and scorer text utils"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Whole suite green**

Run: `npm test`
Expected: all suites pass (8 test files), output pristine (no warnings/noise).

- [ ] **Step 2: Type-check + build unaffected**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 3: Clean tree**

Run: `git status --short`
Expected: nothing uncommitted.

- [ ] **Step 4: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- Vitest tooling (devDep, config, `npm test`→`vitest run`, `test:watch`, node env, `src/**/*.test.ts`, explicit imports) → Task 1. ✓
- corroboration (URL canon, authority rule, absent-URL, multi-source, resolved sources, deficits name url+classifier + remove/drop out, empty/null when clean, flag block) → Task 2. ✓
- domain-presets (enforceIncludeDomains subdomain/www/empty/all-off/substring/unparseable; withDefaultExcludes union/normalize/dedupe/untouched-include; deprioritizeGated bottom+stable) → Task 3. ✓
- content-cap (top-N keep, strip rest, order, boundary, empty) → Task 1. ✓
- normalize-citations (daggered/bare/double-dagger/adjacency/stray/untouched) → Task 1. ✓
- detect-block (login/captcha/paywall, length gate, clean→undefined) → Task 4. ✓
- scorers/utils urls (extractUrls/extractDomains) + predicates (isFinalReport/hasLeakedToolCall) → Task 4. ✓
- Out-of-scope items (coverage gate, CI, extractReportText/preprocessRun, I/O, agents, steps, processors) — not implemented. ✓
- Verification = `npm test` + tsc + build → Task 5 + per-task. ✓

**Placeholder scan:** No TBD/TODO. Every test step shows the full test code; the two "if a fixture mismatches the source, adjust the fixture (not the source)" notes are concrete fallbacks, not placeholders.

**Type consistency:** `normalizeCitations`, `capResultContent`/`CONTENT_RESULT_LIMIT`, `assessCorroboration`/`corroborationDeficits`/`corroborationFlagBlock` (verdict `sources` field), `enforceIncludeDomains`/`withDefaultExcludes`/`deprioritizeGated`, `detectBlock`/`BlockReason`, `extractUrls`/`extractDomains`, `isFinalReport`/`hasLeakedToolCall` — all names/signatures match the current source read during planning. Import paths match each test's co-located directory.
