# Source corroboration & includeDomains enforcement (A9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unknown vendor-marketing sources from leaking into the report as competitors/trends, via two deterministic levers: hard-enforce the agent's `includeDomains` at search time, and require every competitor/trend to cite ≥1 authoritative source (re-research while attempts remain, then flag survivors for "Confidence & Gaps").

**Architecture:** One pure search-side function (`enforceIncludeDomains`) wired into the `search()` chokepoint; one pure workflow-side module (`corroboration.ts`) reused by both the deficit gate (drives re-research) and the synthesis step (injects a flag block into the synthesizer prompt). No schema change, no WM mutation.

**Tech Stack:** TypeScript (ES2022, strict, `noEmit`), Mastra `@mastra/core` workflows, Zod working-memory schema, Exa search via the provider-abstracted `search` module.

## Global Constraints

- Node.js `>=22.13.0`; TypeScript ES2022, strict, `noEmit`.
- No unit-test harness (`npm test` is a stub — backlog A4). Per-task verification for pure functions is an **esbuild-bundled assertion harness** (no network, `node:assert`), mirroring the A7 validation; wiring tasks verify with `npx tsc --noEmit` + `npm run build`.
- Never hardcode model strings or API keys (not touched here; holds project-wide).
- No schema change; the gate and synthesis step never mutate working memory.
- Authoritative ≡ source `classifier` ∉ `{vendor, other}`. `company-ir` / `sec-filing` count.
- `assessCorroboration` is the single source of truth for both the gate and the flag — never duplicate its logic.
- The researcher instructions are a template literal: **literal backticks inside added prompt text must be escaped as `` \` ``**.
- Harness files are temporary: never `git add` them; `rm` them in the task's commit step.

**Spec:** `docs/superpowers/specs/2026-06-23-source-corroboration-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/modules/search/domain-presets.ts` | Add `enforceIncludeDomains` pure filter | Modify |
| `src/modules/search/index.ts` | Wire enforcement into `search()` | Modify |
| `src/mastra/workflows/vertical-entry/corroboration.ts` | `assessCorroboration` + `corroborationDeficits` + `corroborationFlagBlock` | Create |
| `src/mastra/workflows/vertical-entry/read-memory.ts` | Shared WM read+parse helper (extracted) | Create |
| `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts` | Use shared read; add corroboration deficits to gate | Modify |
| `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts` | Inject flag block into synthesizer prompt | Modify |
| `src/mastra/agents/researcher.ts` | Prompt: includeDomains hard-enforced; sources must be authoritative | Modify |

---

## Task 1: Lever A — hard-enforce `includeDomains` at search time

**Files:**
- Modify: `src/modules/search/domain-presets.ts`
- Modify: `src/modules/search/index.ts`

**Interfaces:**
- Consumes: `SearchResult` (`{ url, title, snippet, content? }`) and the module-private `normalizeHost` from `domain-presets.ts`.
- Produces: `enforceIncludeDomains(results: SearchResult[], includeDomains?: string[]): SearchResult[]`.

- [ ] **Step 1: Write the assertion harness**

Create `_a9-search.ts` in the repo root:

```ts
import assert from 'node:assert';
import { enforceIncludeDomains } from './src/modules/search/domain-presets';

const R = (url: string) => ({ url, title: '', snippet: '' });

// empty / absent list = no-op (open discovery)
assert.equal(enforceIncludeDomains([R('https://x.com/a')], []).length, 1);
assert.equal(enforceIncludeDomains([R('https://x.com/a')], undefined).length, 1);

// keeps exact host and subdomains, drops off-list
const res = enforceIncludeDomains(
  [
    R('https://www.mckinsey.com/insights/x'),
    R('https://insights.mckinsey.com/y'),
    R('https://elevancesystems.com/about'),
  ],
  ['mckinsey.com'],
);
assert.deepEqual(res.map((r) => r.url), [
  'https://www.mckinsey.com/insights/x',
  'https://insights.mckinsey.com/y',
]);

// www. and casing on the include entry are normalized
assert.equal(enforceIncludeDomains([R('https://gartner.com/a')], ['WWW.Gartner.com']).length, 1);

// all off-list => empty (intended; researcher adapts)
assert.equal(enforceIncludeDomains([R('https://elevancesystems.com/a')], ['gartner.com']).length, 0);

// substring trap: foo-mckinsey.com is NOT a subdomain of mckinsey.com
assert.equal(enforceIncludeDomains([R('https://foo-mckinsey.com/a')], ['mckinsey.com']).length, 0);

// unparseable URL => dropped
assert.equal(enforceIncludeDomains([R('not a url')], ['gartner.com']).length, 0);

console.log('ALL PASS');
```

- [ ] **Step 2: Run the harness to verify it fails**

Run:
```bash
node_modules/.bin/esbuild _a9-search.ts --bundle --platform=node --format=esm --packages=external --outfile=_a9-search.mjs && node _a9-search.mjs
```
Expected: FAIL — esbuild errors that `enforceIncludeDomains` is not exported from `domain-presets`.

- [ ] **Step 3: Implement `enforceIncludeDomains`**

In `src/modules/search/domain-presets.ts`, append (the file already defines the module-private `normalizeHost`):

```ts
/**
 * Hard-enforce the agent's includeDomains. Search providers (Exa included)
 * treat includeDomains as a soft ranking hint, so off-list results still come
 * back — this drops them. Subdomain-aware. An empty/absent list is the
 * open-discovery path and is returned unchanged.
 */
export const enforceIncludeDomains = (
  results: SearchResult[],
  includeDomains?: string[],
): SearchResult[] => {
  if (!includeDomains?.length) return results;

  const allow = includeDomains.map(normalizeHost);

  return results.filter((r) => {
    let host: string;
    try {
      host = normalizeHost(new URL(r.url).hostname);
    } catch {
      return false;
    }

    return allow.some((d) => host === d || host.endsWith(`.${d}`));
  });
};
```

- [ ] **Step 4: Run the harness to verify it passes**

Run:
```bash
node_modules/.bin/esbuild _a9-search.ts --bundle --platform=node --format=esm --packages=external --outfile=_a9-search.mjs && node _a9-search.mjs
```
Expected: prints `ALL PASS`, exit 0.

- [ ] **Step 5: Wire enforcement into `search()`**

In `src/modules/search/index.ts`, the import line is currently:

```ts
import { deprioritizeGated, withDefaultExcludes } from './domain-presets';
```

Change it to:

```ts
import { deprioritizeGated, withDefaultExcludes, enforceIncludeDomains } from './domain-presets';
```

The current return line in `search()` is:

```ts
  return capResultContent(deprioritizeGated(results));
```

Change it to:

```ts
  return capResultContent(deprioritizeGated(enforceIncludeDomains(results, query.includeDomains)));
```

(`withDefaultExcludes` only edits `excludeDomains`, so `query.includeDomains` is still the agent's original list.)

- [ ] **Step 6: Type-check, build, clean up**

Run:
```bash
npx tsc --noEmit && npm run build && rm -f _a9-search.ts _a9-search.mjs
```
Expected: both exit 0; harness files removed.

- [ ] **Step 7: Commit**

```bash
git add src/modules/search/domain-presets.ts src/modules/search/index.ts
git commit -m "feat(search): hard-enforce includeDomains in the search chokepoint"
```

---

## Task 2: Corroboration core (`corroboration.ts`)

**Files:**
- Create: `src/mastra/workflows/vertical-entry/corroboration.ts`

**Interfaces:**
- Consumes: `ResearchMemory` (type) from `../../schemas/research-memory`. Relevant shape: `competitors: { name, sources: string[] }[]`, `marketTrends: { claim, sourceUrl }[]`, `sourcesConsulted: { url, classifier }[]`.
- Produces:
  - `assessCorroboration(m: ResearchMemory): CorroborationReport` where `CorroborationReport = { competitors: CorroborationVerdict[]; trends: CorroborationVerdict[] }` and `CorroborationVerdict = { label: string; corroborated: boolean }`.
  - `corroborationDeficits(m: ResearchMemory): string[]` — gate deficit lines.
  - `corroborationFlagBlock(m: ResearchMemory): string | null` — synthesizer prompt block, or `null` when everything is corroborated.

- [ ] **Step 1: Write the assertion harness**

Create `_a9-corro.ts` in the repo root:

```ts
import assert from 'node:assert';
import type { ResearchMemory } from './src/mastra/schemas/research-memory';
import {
  assessCorroboration,
  corroborationDeficits,
  corroborationFlagBlock,
} from './src/mastra/workflows/vertical-entry/corroboration';

// Minimal fixture — only the fields the functions read.
const mem = {
  marketTrends: [
    { claim: 'Trend grounded in analyst', sourceUrl: 'https://gartner.com/r1' },
    { claim: 'Trend on a vendor blog', sourceUrl: 'https://vend.example/post' },
  ],
  competitors: [
    { name: 'RealCo', sources: ['https://elevancesystems.com/about', 'https://everestgrp.com/x'] },
    { name: 'VendorOnly', sources: ['https://elevancesystems.com/about'] },
    { name: 'UnknownSrc', sources: ['https://not-in-sources.example/p'] },
  ],
  sourcesConsulted: [
    { url: 'https://gartner.com/r1', classifier: 'analyst' },
    { url: 'https://everestgrp.com/x', classifier: 'analyst' },
    { url: 'https://elevancesystems.com/about', classifier: 'vendor' },
    { url: 'https://vend.example/post', classifier: 'vendor' },
  ],
} as unknown as ResearchMemory;

const report = assessCorroboration(mem);
assert.deepEqual(
  report.competitors.map((c) => [c.label, c.corroborated]),
  [['RealCo', true], ['VendorOnly', false], ['UnknownSrc', false]],
);
assert.deepEqual(
  report.trends.map((t) => t.corroborated),
  [true, false],
);

const deficits = corroborationDeficits(mem);
assert.equal(deficits.length, 3); // VendorOnly, UnknownSrc, vendor-blog trend
assert.ok(deficits.some((d) => d.includes('VendorOnly') && d.includes('remove it')));
assert.ok(deficits.some((d) => d.startsWith('marketTrend') && d.includes('drop the claim')));

const block = corroborationFlagBlock(mem);
assert.ok(block && block.includes('Confidence & Gaps'));
assert.ok(block.includes('competitor: VendorOnly'));
assert.ok(block.includes('trend: Trend on a vendor blog'));

// All-corroborated => null block, no deficits
const clean = {
  marketTrends: [{ claim: 'ok', sourceUrl: 'https://gartner.com/r1' }],
  competitors: [{ name: 'C', sources: ['https://gartner.com/r1'] }],
  sourcesConsulted: [{ url: 'https://gartner.com/r1', classifier: 'analyst' }],
} as unknown as ResearchMemory;
assert.equal(corroborationFlagBlock(clean), null);
assert.equal(corroborationDeficits(clean).length, 0);

console.log('ALL PASS');
```

- [ ] **Step 2: Run the harness to verify it fails**

Run:
```bash
node_modules/.bin/esbuild _a9-corro.ts --bundle --platform=node --format=esm --packages=external --outfile=_a9-corro.mjs && node _a9-corro.mjs
```
Expected: FAIL — esbuild cannot resolve `./src/mastra/workflows/vertical-entry/corroboration` (file does not exist yet).

- [ ] **Step 3: Implement `corroboration.ts`**

Create `src/mastra/workflows/vertical-entry/corroboration.ts`:

```ts
// src/mastra/workflows/vertical-entry/corroboration.ts

import type { ResearchMemory } from '../../schemas/research-memory';

/**
 * Classifiers that do NOT count as authoritative grounding. `vendor` is
 * self-marketing; `other` is the unclassifiable bucket. A competitor or trend
 * backed only by these is what A9 must not let stand. Everything else
 * (government, analyst, consulting, trade-press, sec-filing, company-ir) counts.
 */
const NON_AUTHORITATIVE = new Set(['vendor', 'other']);

const normalizeUrl = (url: string): string => url.trim().toLowerCase().replace(/\/+$/, '');

const truncate = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export interface CorroborationVerdict {
  label: string;
  corroborated: boolean;
}

export interface CorroborationReport {
  competitors: CorroborationVerdict[];
  trends: CorroborationVerdict[];
}

/**
 * For each competitor and trend, decide whether it cites at least one
 * authoritative source, cross-referencing its URLs against the classifiers the
 * researcher recorded in `sourcesConsulted`. A URL absent from
 * `sourcesConsulted` is unknown → treated as non-authoritative.
 */
export function assessCorroboration(m: ResearchMemory): CorroborationReport {
  const classifierByUrl = new Map<string, string>();
  for (const s of m.sourcesConsulted) {
    classifierByUrl.set(normalizeUrl(s.url), s.classifier);
  }

  const isAuthoritative = (url: string): boolean => {
    const c = classifierByUrl.get(normalizeUrl(url));

    return c !== undefined && !NON_AUTHORITATIVE.has(c);
  };

  return {
    competitors: m.competitors.map((c) => ({
      label: c.name,
      corroborated: c.sources.some(isAuthoritative),
    })),
    trends: m.marketTrends.map((t) => ({
      label: t.claim,
      corroborated: isAuthoritative(t.sourceUrl),
    })),
  };
}

/**
 * Deficit lines for the research gate. Each gives the researcher two outs —
 * find an authoritative source OR remove the unverifiable item — so the loop
 * can converge by cleaning junk, not only by sourcing it.
 */
export function corroborationDeficits(m: ResearchMemory): string[] {
  const report = assessCorroboration(m);
  const deficits: string[] = [];

  for (const c of report.competitors) {
    if (!c.corroborated) {
      deficits.push(
        `competitor "${truncate(c.label)}": only vendor/other-classified sources — add an analyst / trade-press / government / SEC source, OR remove it if unverifiable`,
      );
    }
  }
  for (const t of report.trends) {
    if (!t.corroborated) {
      deficits.push(
        `marketTrend "${truncate(t.label)}": source is vendor/other — ground it in an analyst/government source, OR drop the claim`,
      );
    }
  }

  return deficits;
}

/**
 * Prompt block for the synthesizer: items still uncorroborated after the
 * research loop. Returns null when everything is corroborated.
 */
export function corroborationFlagBlock(m: ResearchMemory): string | null {
  const report = assessCorroboration(m);
  const competitors = report.competitors.filter((c) => !c.corroborated).map((c) => c.label);
  const trends = report.trends.filter((t) => !t.corroborated).map((t) => t.label);

  if (!competitors.length && !trends.length) return null;

  const lines = [
    ...competitors.map((c) => `  - competitor: ${c}`),
    ...trends.map((t) => `  - trend: ${truncate(t)}`),
  ];

  return [
    'The following findings lack an authoritative source (only vendor/self-marketing).',
    'Present them under "Confidence & Gaps" as unverified — NOT as confirmed competitors/trends:',
    ...lines,
  ].join('\n');
}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run:
```bash
node_modules/.bin/esbuild _a9-corro.ts --bundle --platform=node --format=esm --packages=external --outfile=_a9-corro.mjs && node _a9-corro.mjs
```
Expected: prints `ALL PASS`, exit 0.

- [ ] **Step 5: Type-check, build, clean up**

Run:
```bash
npx tsc --noEmit && npm run build && rm -f _a9-corro.ts _a9-corro.mjs
```
Expected: both exit 0; harness files removed.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/workflows/vertical-entry/corroboration.ts
git commit -m "feat(workflow): source-corroboration core for competitors and trends"
```

---

## Task 3: Wire corroboration into the deficit gate

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`

**Interfaces:**
- Consumes: `corroborationDeficits(m: ResearchMemory): string[]` from `../corroboration` (Task 2).
- Produces: no new exports; `collectDeficits` now also returns corroboration deficits.

- [ ] **Step 1: Import the corroboration deficits**

In `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`, after the existing import block (the `invokeResearcher` import on/near line 9 is the last import), add:

```ts
import { corroborationDeficits } from '../corroboration';
```

- [ ] **Step 2: Add corroboration deficits to `collectDeficits`**

In the same file, `collectDeficits` ends with the quantitative-triangulation loop and then `return deficits;`. Immediately **before** that final `return deficits;`, insert:

```ts
  deficits.push(...corroborationDeficits(m));

```

So the tail of `collectDeficits` reads:

```ts
    if (!corroborated) {
      deficits.push(
        `quantitative trend "${trend.claim.slice(0, 60)}…" has no second corroborating source`,
      );
    }
  }

  deficits.push(...corroborationDeficits(m));

  return deficits;
}
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Verify the wiring reads correctly**

Read `collectDeficits` in the file and confirm: `corroborationDeficits(m)` is spread into `deficits` exactly once, before `return deficits;`, after the triangulation loop; the import is present.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts
git commit -m "feat(workflow): gate competitors/trends on authoritative sourcing"
```

---

## Task 4: Shared WM read + synthesis flag block

**Files:**
- Create: `src/mastra/workflows/vertical-entry/read-memory.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`

**Interfaces:**
- Produces: `readResearchMemory(threadId: string, resourceId: string): Promise<ResearchMemory>` from `../read-memory`.
- Consumes: `corroborationFlagBlock(m: ResearchMemory): string | null` from `../corroboration` (Task 2).

- [ ] **Step 1: Create the shared read helper**

Create `src/mastra/workflows/vertical-entry/read-memory.ts` (this is the read+parse logic currently inlined in `research-iteration.step.ts`, extracted verbatim so both the gate and the synthesis step share one source):

```ts
// src/mastra/workflows/vertical-entry/read-memory.ts

import { researchMemory } from '../../memory';
import { researchMemorySchema, type ResearchMemory } from '../../schemas/research-memory';

export async function readResearchMemory(
  threadId: string,
  resourceId: string,
): Promise<ResearchMemory> {
  const raw = await researchMemory.getWorkingMemory({ threadId, resourceId });

  if (!raw) {
    throw new Error(
      'Researcher invoked but produced no working memory. The persistence layer may be failing — halting.',
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(
      `Working memory is not valid JSON. Length: ${raw.length}. Head: ${raw.slice(0, 200)}`,
    );
  }

  const parsed = researchMemorySchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      'Working memory does not match the expected schema: ' + parsed.error.message,
    );
  }

  return parsed.data;
}
```

- [ ] **Step 2: Point the research-iteration step at the shared helper**

In `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`:

(a) The current top imports include:

```ts
import { researchMemory } from '../../../memory';
import {
  researchMemorySchema,
  type ResearchMemory,
} from '../../../schemas/research-memory';
```

Replace those two import statements with:

```ts
import type { ResearchMemory } from '../../../schemas/research-memory';
import { readResearchMemory } from '../read-memory';
```

(b) Delete the local `readMemory` function in this file entirely (the `async function readMemory(threadId, resourceId): Promise<ResearchMemory> { ... }` block).

(c) In `execute`, change the call site:

```ts
    const newMemory = await readMemory(runId, 'default');
```

to:

```ts
    const newMemory = await readResearchMemory(runId, 'default');
```

- [ ] **Step 3: Type-check and build (extraction is behavior-preserving)**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. (If tsc reports `researchMemory`/`researchMemorySchema` unused, confirm step 2(a) replaced both import statements and 2(b) removed the only code that used them.)

- [ ] **Step 4: Inject the flag block into the synthesizer prompt**

In `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`, add two imports after the existing `import { iterationStateSchema } from './prepare-research.step';` line:

```ts
import { readResearchMemory } from '../read-memory';
import { corroborationFlagBlock } from '../corroboration';
```

Inside `execute`, the body currently starts:

```ts
    const agent = mastra.getAgentById(synthesizer.id);

    const prompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company: ${inputData.companyName}
Profile:
${inputData.companyFacts}

Read the working-memory document now and produce the final markdown report.
    `.trim();
```

Replace that with:

```ts
    const agent = mastra.getAgentById(synthesizer.id);

    const memory = await readResearchMemory(runId, 'default');
    const flagBlock = corroborationFlagBlock(memory);

    const prompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company: ${inputData.companyName}
Profile:
${inputData.companyFacts}

Read the working-memory document now and produce the final markdown report.${flagBlock ? `\n\n${flagBlock}` : ''}
    `.trim();
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/workflows/vertical-entry/read-memory.ts src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts src/mastra/workflows/vertical-entry/steps/synthesize.step.ts
git commit -m "feat(workflow): flag uncorroborated findings for the synthesizer"
```

---

## Task 5: Researcher prompt — enforcement + corroboration expectations

**Files:**
- Modify: `src/mastra/agents/researcher.ts`

**Interfaces:** none (prompt copy only). The instructions are a template literal — escape literal backticks as `` \` ``.

- [ ] **Step 1: Add the two expectations to the Source bias block**

In `src/mastra/agents/researcher.ts`, the Source bias block currently ends with this exact paragraph:

```ts
Low-signal sources (SEO market-report vendors, vendor-marketing
"best-of" listicles) are filtered out of every search automatically —
you do not need to list them in \`excludeDomains\`.
```

Directly **after** that paragraph (before the blank line preceding `# Budget`), insert:

```ts

\`includeDomains\` is now **hard-enforced**: results outside the domains you
pass are dropped before you ever see them. A too-narrow list returns few or no
results — widen it, or omit it for open discovery.

Every competitor and every market trend must cite at least one **authoritative**
source — a classifier other than \`vendor\`/\`other\`. Classify each source
honestly in \`sourcesConsulted\`. An item backed only by a vendor / self-marketing
page is sent back for re-research, and if still unsourced it is flagged as
unverified rather than reported as a confirmed finding — so drop a competitor you
cannot ground in an authoritative source.
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. (A build failure here almost certainly means an unescaped backtick broke the template literal — re-check the inserted text uses `` \` ``.)

- [ ] **Step 3: Commit**

```bash
git add src/mastra/agents/researcher.ts
git commit -m "docs(researcher): note includeDomains enforcement + authoritative-source requirement"
```

---

## Task 6: Final verification — clean build + e2e run vs the 2026-06-17 leak baseline

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean build and tree**

Run: `npx tsc --noEmit && npm run build && git status --short`
Expected: both commands exit 0; `git status --short` prints nothing (no stray `_a9-*` harness files).

- [ ] **Step 2: Run the workflow end-to-end**

Build is refreshed by Step 1. Run the bundled workflow headlessly (the project's established run shape — import `.mastra/output/mastra.mjs`, `getWorkflow('verticalEntryWorkflow')`, `createRun()`, `run.start({ inputData: { vertical: 'healthcare IT outsourcing', companyKey: 'onix' } })`, executed with `node --env-file=.env`). This is the same harness used for prior e2e runs; reuse it.

- [ ] **Step 3: Confirm the three acceptance signals (no commit — observation only)**

Against the 2026-06-17 leak baseline (elevancesystems.com / carelonglobal.com / aerance.com / bgbizsolutionsinc.com appearing as competitors), confirm in the run logs and final report:

1. **Lever A:** searches that carried `includeDomains` returned only on-list hosts (no off-list domains in those results).
2. **Gate:** at least one researcher iteration shows a corroboration deficit ("only vendor/other-classified sources …") when a low-authority competitor/trend was present, OR the run is clean on the first pass (no low-authority items recorded).
3. **Flag:** any competitor/trend still uncorroborated after the loop appears under "Confidence & Gaps" in the report, not as a confirmed competitor/trend.

If a signal fails, capture the specifics (which step, which item) for a follow-up; do not patch silently.

- [ ] **Step 4: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- Lever A (hard-enforce includeDomains, subdomain-aware, empty=no-op) → Task 1. ✓
- Shared core `assessCorroboration` (+ deficits + flag block), authoritative ≡ ∉{vendor,other}, absent-URL = non-authoritative → Task 2. ✓
- Gate emits corroboration deficits with the "OR remove" out, reusing the existing dountil → Task 3. ✓
- Flag via synthesizer prompt, no schema change, no WM mutation; single source of truth reused → Task 4. ✓
- Researcher prompt: enforcement + authoritative-source requirement → Task 5. ✓
- Verification: pure-function harnesses (no network) + tsc/build + e2e vs baseline → Tasks 1–2 harness steps, Task 6. ✓
- Out-of-scope items (allowlist/heuristic, ICPs, schema change, scorer/denylist changes) are simply not implemented. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every command shows expected output. ✓

**Type consistency:** `enforceIncludeDomains(results, includeDomains?)`, `assessCorroboration → CorroborationReport`, `corroborationDeficits → string[]`, `corroborationFlagBlock → string | null`, `readResearchMemory(threadId, resourceId) → Promise<ResearchMemory>` — names/signatures identical across the tasks that define and consume them. Import paths match file locations (`../corroboration`, `../read-memory` from `steps/`; `../../schemas/...`, `../../memory` from the vertical-entry root). ✓
