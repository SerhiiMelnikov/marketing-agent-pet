# Research-quality metrics (A6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the research loop, compute four deterministic research-quality metrics from working memory (finding density, source diversity by classifier, triangulation rate, authoritative ratio) and emit them as a structured log line.

**Architecture:** A pure `computeResearchMetrics(memory)` over the typed WM, invoked by a new pass-through workflow step `recordResearchMetrics` inserted between the research loop and synthesis. Additive only — no gate/agent/output-schema change.

**Tech Stack:** TypeScript (ES2022, strict, `moduleResolution: bundler`), Vitest, Mastra workflows, Node `>=22.13.0`.

## Global Constraints

- Node `>=22.13.0`; TS ES2022, strict. Pure code is Vitest-tested (`*.test.ts`, co-located, `import { describe, it, expect } from 'vitest'`).
- A6 is ADDITIVE: a new metric module, a new pass-through step, one `.then` insertion. No deficit-gate refactor, no agent change, no change to `reportSchema` / workflow output.
- Deterministic, no LLM. `computeResearchMetrics` is pure and total over a schema-valid `ResearchMemory`.
- The step is pure pass-through on the iteration state (`inputSchema = outputSchema = iterationStateSchema`); it only reads WM and logs.
- Metric definitions: `findingDensity` = section counts; `sourceDiversityByClassifier` = classifier→count map (+ `distinctClassifiers`); `triangulationRate` = fraction of quantitative trends (`/\$|\d+(?:\.\d+)?\s*%/` on claim/evidence) corroborated by another quantitative trend at a different `sourceUrl` AND `publisher` (empty quant set → 1); `authoritativeRatio` = fraction of sources whose `classifier` ∉ {vendor, other} (empty → 0).

**Spec:** `docs/superpowers/specs/2026-06-23-research-metrics-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/mastra/workflows/vertical-entry/research-metrics.ts` | `computeResearchMetrics` + `ResearchMetrics` type | Create |
| `src/mastra/workflows/vertical-entry/research-metrics.test.ts` | Tests for the metric function | Create |
| `src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts` | Pass-through step: read WM, compute, log | Create |
| `src/mastra/workflows/vertical-entry/index.ts` | Insert `.then(recordResearchMetrics)` | Modify |

---

## Task 1: The pure metric function

**Files:**
- Create: `src/mastra/workflows/vertical-entry/research-metrics.ts`, `src/mastra/workflows/vertical-entry/research-metrics.test.ts`

**Interfaces:**
- Consumes: `ResearchMemory` (type) from `../../schemas/research-memory`. Relevant fields: `marketTrends: {claim, evidence, sourceUrl, publisher}[]`, `competitors[]`, `candidateIcps[]`, `sourcesConsulted: {url, classifier}[]`, `openQuestions[]`.
- Produces: `interface ResearchMetrics { findingDensity: {trends,competitors,icps,sources,openQuestions: number}; sourceDiversityByClassifier: Record<string, number>; distinctClassifiers: number; triangulationRate: number; authoritativeRatio: number }`; `computeResearchMetrics(memory: ResearchMemory): ResearchMetrics`.

- [ ] **Step 1: Write the failing tests**

Create `src/mastra/workflows/vertical-entry/research-metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ResearchMemory } from '../../schemas/research-memory';
import { computeResearchMetrics } from './research-metrics';

const mem = (o: Partial<{
  marketTrends: { claim: string; evidence: string; sourceUrl: string; publisher: string }[];
  competitors: unknown[];
  candidateIcps: unknown[];
  sourcesConsulted: { url: string; classifier: string }[];
  openQuestions: unknown[];
}>): ResearchMemory =>
  ({
    marketTrends: o.marketTrends ?? [],
    competitors: o.competitors ?? [],
    candidateIcps: o.candidateIcps ?? [],
    sourcesConsulted: o.sourcesConsulted ?? [],
    openQuestions: o.openQuestions ?? [],
  }) as unknown as ResearchMemory;

describe('computeResearchMetrics', () => {
  it('returns zeroed metrics for an empty working memory', () => {
    const m = computeResearchMetrics(mem({}));

    expect(m.findingDensity).toEqual({ trends: 0, competitors: 0, icps: 0, sources: 0, openQuestions: 0 });
    expect(m.sourceDiversityByClassifier).toEqual({});
    expect(m.distinctClassifiers).toBe(0);
    expect(m.triangulationRate).toBe(1);
    expect(m.authoritativeRatio).toBe(0);
  });

  it('counts sources by classifier and computes the authoritative ratio', () => {
    const m = computeResearchMetrics(
      mem({
        sourcesConsulted: [
          { url: 'https://a/1', classifier: 'analyst' },
          { url: 'https://v/1', classifier: 'vendor' },
          { url: 'https://g/1', classifier: 'government' },
        ],
      }),
    );

    expect(m.sourceDiversityByClassifier).toEqual({ analyst: 1, vendor: 1, government: 1 });
    expect(m.distinctClassifiers).toBe(3);
    expect(m.authoritativeRatio).toBeCloseTo(2 / 3);
  });

  it('triangulationRate is 1 when two quant trends differ in source and publisher', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [
          { claim: 'market is $5B', evidence: 'e1', sourceUrl: 'https://a', publisher: 'Gartner' },
          { claim: 'grows 12%', evidence: 'e2', sourceUrl: 'https://b', publisher: 'IDC' },
        ],
      }),
    );

    expect(m.triangulationRate).toBe(1);
  });

  it('triangulationRate is 0 for a lone quant trend', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [{ claim: 'market is $5B', evidence: 'e', sourceUrl: 'https://a', publisher: 'Gartner' }],
      }),
    );

    expect(m.triangulationRate).toBe(0);
  });

  it('triangulationRate is 1 when there are no quantitative trends', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [{ claim: 'qualitative shift', evidence: 'no figures', sourceUrl: 'https://a', publisher: 'X' }],
      }),
    );

    expect(m.triangulationRate).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mastra/workflows/vertical-entry/research-metrics.test.ts`
Expected: FAIL — cannot resolve `./research-metrics`.

- [ ] **Step 3: Create `research-metrics.ts`**

```ts
// src/mastra/workflows/vertical-entry/research-metrics.ts

import type { ResearchMemory } from '../../schemas/research-memory';

const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%/;
const NON_AUTHORITATIVE = new Set(['vendor', 'other']);

export interface ResearchMetrics {
  findingDensity: {
    trends: number;
    competitors: number;
    icps: number;
    sources: number;
    openQuestions: number;
  };
  /** classifier value → number of sourcesConsulted with it (only present classifiers). */
  sourceDiversityByClassifier: Record<string, number>;
  distinctClassifiers: number;
  /** Fraction of quantitative trends corroborated by another quantitative trend
   *  at a different sourceUrl AND publisher. 1 when there are no quant trends. */
  triangulationRate: number;
  /** Fraction of sourcesConsulted whose classifier is not vendor/other. 0 when no sources. */
  authoritativeRatio: number;
}

export function computeResearchMetrics(memory: ResearchMemory): ResearchMetrics {
  const findingDensity = {
    trends: memory.marketTrends.length,
    competitors: memory.competitors.length,
    icps: memory.candidateIcps.length,
    sources: memory.sourcesConsulted.length,
    openQuestions: memory.openQuestions.length,
  };

  const sourceDiversityByClassifier: Record<string, number> = {};
  for (const s of memory.sourcesConsulted) {
    sourceDiversityByClassifier[s.classifier] = (sourceDiversityByClassifier[s.classifier] ?? 0) + 1;
  }
  const distinctClassifiers = Object.keys(sourceDiversityByClassifier).length;

  const authoritativeCount = memory.sourcesConsulted.filter(
    (s) => !NON_AUTHORITATIVE.has(s.classifier),
  ).length;
  const authoritativeRatio = memory.sourcesConsulted.length
    ? authoritativeCount / memory.sourcesConsulted.length
    : 0;

  const isQuant = (t: { claim: string; evidence: string }) =>
    QUANT_CLAIM_REGEX.test(t.claim) || QUANT_CLAIM_REGEX.test(t.evidence);
  const quantTrends = memory.marketTrends.filter(isQuant);
  const triangulated = quantTrends.filter((t) =>
    quantTrends.some(
      (other) => other !== t && other.sourceUrl !== t.sourceUrl && other.publisher !== t.publisher,
    ),
  ).length;
  const triangulationRate = quantTrends.length ? triangulated / quantTrends.length : 1;

  return {
    findingDensity,
    sourceDiversityByClassifier,
    distinctClassifiers,
    triangulationRate,
    authoritativeRatio,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/mastra/workflows/vertical-entry/research-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/workflows/vertical-entry/research-metrics.ts src/mastra/workflows/vertical-entry/research-metrics.test.ts
git commit -m "feat(workflow): pure research-quality metrics over working memory"
```

---

## Task 2: The metrics step + workflow wiring

**Files:**
- Create: `src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/index.ts`

**Interfaces:**
- Consumes: `computeResearchMetrics` from `../research-metrics` (Task 1); `readResearchMemory` from `../read-memory`; `iterationStateSchema` from `./prepare-research.step`; `logger` from `../../../../utils/logger`; `createStep` from `@mastra/core/workflows`.
- Produces: `recordResearchMetrics` (a `createStep` with `inputSchema = outputSchema = iterationStateSchema`).

- [ ] **Step 1: Create the step**

Create `src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts`:

```ts
// src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts

import { createStep } from '@mastra/core/workflows';
import { iterationStateSchema } from './prepare-research.step';
import { readResearchMemory } from '../read-memory';
import { computeResearchMetrics } from '../research-metrics';
import { logger } from '../../../../utils/logger';

const log = logger.child({ module: 'research-metrics' });

/**
 * Pass-through observability step: after the research loop, read the final
 * working memory once, compute the deterministic research-quality metrics, and
 * log them. Returns the iteration state unchanged so synthesis is unaffected.
 */
export const recordResearchMetrics = createStep({
  id: 'record-research-metrics',
  description:
    'Computes research-quality metrics (finding density, source diversity by classifier, triangulation rate, authoritative ratio) from working memory and logs them. Pass-through.',
  inputSchema: iterationStateSchema,
  outputSchema: iterationStateSchema,
  execute: async ({ inputData, runId }) => {
    const memory = await readResearchMemory(runId, 'default');
    const metrics = computeResearchMetrics(memory);

    log.info('research quality metrics', { researchMetrics: metrics });

    return inputData;
  },
});
```

- [ ] **Step 2: Wire the step into the workflow**

In `src/mastra/workflows/vertical-entry/index.ts`, add the import after the existing `import { reportSchema, runSynthesis } from './steps/synthesize.step';` line:

```ts
import { recordResearchMetrics } from './steps/record-research-metrics.step';
```

The workflow chain currently ends:

```ts
    return Promise.resolve(false);
  })
  .then(runSynthesis);
```

Insert the new step between the `dountil` and `runSynthesis`:

```ts
    return Promise.resolve(false);
  })
  .then(recordResearchMetrics)
  .then(runSynthesis);
```

(`recordResearchMetrics` is pass-through over `iterationStateSchema`, so `runSynthesis`'s input is unchanged.)

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts src/mastra/workflows/vertical-entry/index.ts
git commit -m "feat(workflow): record research-quality metrics after the research loop"
```

---

## Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Whole suite + type-check + build + clean tree**

Run: `npm test && npx tsc --noEmit && npm run build && git status --short`
Expected: all Vitest suites pass (including the new `research-metrics` suite); both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: Confirm the wiring reads correctly**

Read the workflow chain in `src/mastra/workflows/vertical-entry/index.ts` and confirm `.then(recordResearchMetrics)` sits between the `.dountil(...)` and `.then(runSynthesis)`, and that `recordResearchMetrics`'s `inputSchema`/`outputSchema` are both `iterationStateSchema` (so the chain's types line up — `tsc` exit 0 already confirms this).

- [ ] **Step 3: No commit** (nothing changed)

> **E2E note:** a live run would show one `research quality metrics` log line per run with plausible values, but the metric math is fully unit-covered and the step is pure pass-through, so an e2e run is an optional sanity check (and is currently blocked on the disabled Anthropic key) — not required to land A6.

---

## Self-Review

**Spec coverage:**
- `computeResearchMetrics` with the four metrics (findingDensity, sourceDiversityByClassifier + distinctClassifiers, triangulationRate, authoritativeRatio) and the exact empty-WM behaviors → Task 1 (+ tests). ✓
- Deterministic pass-through step reading WM, logging structured, forwarding state → Task 2. ✓
- Inserted between `dountil` and `runSynthesis`; no gate/agent/output-schema change → Task 2 + Global Constraints. ✓
- Additive only; gate quant-predicate re-implemented (not extracted) → `QUANT_CLAIM_REGEX` local to `research-metrics.ts`, gate untouched. ✓
- Vitest for the metric function; tsc/build; e2e optional/deferred → Task 1 tests + Task 3. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; the workflow edit gives exact before/after anchors.

**Type consistency:** `ResearchMetrics` shape and `computeResearchMetrics(memory): ResearchMetrics` are identical across Task 1 (definition) and Task 2 (consumption). `recordResearchMetrics` uses `iterationStateSchema` for both schemas, matching the `dountil`→`runSynthesis` contract. Import paths (`../../schemas/research-memory`, `../research-metrics`, `../read-memory`, `./prepare-research.step`, `../../../../utils/logger`) match the directory depths already used by sibling files (`corroboration.ts`, `synthesize.step.ts`).
