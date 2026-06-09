# Extract Research Validation to `dountil` Callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move deficit-validation, max-attempts enforcement, and cache-cleanup-on-success out of `runResearchIteration` and into the `dountil` condition callback, so the step does one thing (do research, report state) and the callback does one thing (decide loop exit).

**Architecture:** The step becomes iteration-blind: it reads its corrective-prompt inputs from `inputData.deficits` and `inputData.memoryCounts`, invokes the researcher, reads working memory once after invocation, computes new deficits + counts, and outputs them. The `dountil` callback uses `iterationCount` (Mastra-provided, 1-indexed) to enforce `MAX_ATTEMPTS`, returns `true` when `deficits` is empty, and handles cache cleanup on both terminal paths (success and max-attempts throw). The state schema swaps `attempt` + `passed` for `deficits` + `memoryCounts`. One memory read per iteration instead of two.

**Tech Stack:** TypeScript, Zod v4, Mastra workflows (`createStep`, `createWorkflow`, `dountil`), libsql working memory.

**Verified Mastra semantics (`@mastra/core` installed version):**
- `dountil` condition signature: `(params: ExecuteParams & { iterationCount: number }) => Promise<boolean>` — `iterationCount` starts at **1** after the step has run once.
- Condition's `ExecuteParams` carries `runId`, `mastra`, `inputData`, `state`, etc. — same surface as a step's `execute` plus `iterationCount`. `runId` is directly available in the callback; no need to thread it through state.
- Throws from the condition propagate cleanly — this is the canonical max-iter pattern in Mastra's own control-flow docs.
- Step `execute` does NOT receive `iterationCount`. The step must remain iteration-blind.

---

## File Structure

| File | Change |
|---|---|
| `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts` | Modify `iterationStateSchema`: drop `attempt`, `passed`; add `deficits`, `memoryCounts`. Modify `prepareResearch.execute` to seed the new fields. |
| `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts` | Refactor `execute` to drop pre-invoke memory read, drop max-attempts gate, drop `passed` output. Keep post-invoke read + deficit/count calculation. Keep try/catch for `clearCache` on `invokeResearcher` throw. Update `buildIterationPrompt` to consume `(deficits, counts)` instead of `(memory, deficits)`. Add `countsFromMemory` helper. |
| `src/mastra/workflows/vertical-entry/index.ts` | Replace the trivial `dountil` callback with a full validation callback: deficit check, `MAX_ATTEMPTS` gate, cache cleanup on terminal paths. |
| `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts` | Update JSDoc — cleanup callers are now the dountil callback (success + max-attempts) and the step's catch (invocation error). |
| `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts` | No code changes required (it reads only `threadId`, `resourceId`, `vertical`, `companyName`, `companyFacts`, `companyVerified` from `iterationStateSchema` — none of those fields move). Verify after build. |

---

## Task 1: Update state schema and `prepareResearch` seed

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts`

**Goal:** Make `iterationStateSchema` carry forward the data the loop body needs without an `attempt` counter or a `passed` flag — the dountil callback will derive both from `deficits.length` and `iterationCount`.

- [ ] **Step 1: Modify `iterationStateSchema`**

Replace the schema definition. Drop `attempt` and `passed`. Add `deficits` and `memoryCounts`. Update the JSDoc above the schema.

```ts
/**
 * State shape that flows through the research-iteration loop.
 * dountil requires the step's input and output schemas to match, so this
 * type is reused for both. `deficits` is the list of unmet thresholds
 * after the most recent invocation — empty means the loop should exit.
 * `memoryCounts` is a snapshot of the working-memory counts after the
 * most recent invocation, used by the next iteration's progress block.
 * `completionSignal` carries the latest agent completion message for
 * downstream tracing.
 */
export const iterationStateSchema = z.object({
  threadId: z.string(),
  resourceId: z.string(),
  vertical: z.string(),
  companyName: z.string(),
  companyFacts: z.string(),
  companyVerified: z.string(),
  completionSignal: z.string(),
  deficits: z.array(z.string()),
  memoryCounts: z.object({
    trends: z.number().int().nonnegative(),
    competitors: z.number().int().nonnegative(),
    icps: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
    openQuestions: z.number().int().nonnegative(),
  }),
});
```

- [ ] **Step 2: Update `prepareResearch.execute` to seed new fields**

Replace the `attempt: 0, completionSignal: '', passed: false` triple with `completionSignal: '', deficits: [], memoryCounts: { ...all zeros... }`. Also update the step's `description` to drop the "attempt:0 / passed:false" wording.

```ts
export const prepareResearch = createStep({
  id: 'prepare-research',
  description:
    'Resolves the company profile from the brief, mints a fresh threadId, and seeds the iteration state with empty deficits and zero memory counts. The dountil loop runs after this step.',
  inputSchema: briefSchema,
  outputSchema: iterationStateSchema,
  execute: ({ inputData }) => {
    if (!inputData) throw new Error('Brief not provided');

    const companyKey = inputData.companyKey ?? env.DEFAULT_COMPANY_KEY;
    if (!companyKey) {
      throw new Error(
        'No companyKey in workflow input and DEFAULT_COMPANY_KEY env var is not set',
      );
    }
    const profile = getProfile(companyKey);
    if (!profile) {
      throw new Error(`Unknown companyKey: "${companyKey}"`);
    }

    return Promise.resolve({
      threadId: randomUUID(),
      resourceId: 'default',
      vertical: inputData.vertical,
      companyName: profile.name,
      companyFacts: profile.facts,
      companyVerified: profile.lastVerified,
      completionSignal: '',
      deficits: [],
      memoryCounts: {
        trends: 0,
        competitors: 0,
        icps: 0,
        sources: 0,
        openQuestions: 0,
      },
    });
  },
});
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: TypeScript will complain about `research-iteration.step.ts` and `index.ts` still referencing the dropped fields. That's expected — those files are updated in subsequent tasks. Do NOT attempt to fix those errors in this task. The build will fail at this checkpoint; this is intentional. Move on to Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts
git commit -m "refactor(vertical-entry): swap iteration state attempt/passed for deficits/memoryCounts"
```

---

## Task 2: Refactor `runResearchIteration` to be iteration-blind

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`

**Goal:** Strip out the pre-invoke memory read, the max-attempts gate, the `passed` flag, and the cache-cleanup-on-success path. Keep the post-invoke memory read (it's how state moves forward), the deficit + counts computation, and the cache-cleanup-on-invocation-throw. Update `buildIterationPrompt` to read from `(deficits, counts)` instead of `(memory, deficits)`. Add a `countsFromMemory` helper.

- [ ] **Step 1: Rewrite the file**

Replace the entire file body. The new shape:

```ts
// src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts

import { createStep } from '@mastra/core/workflows';
import { researchMemory } from '../../../memory';
import {
  researchMemorySchema,
  type ResearchMemory,
} from '../../../schemas/research-memory';
import { iterationStateSchema } from './prepare-research.step';
import { invokeResearcher } from './invoke-researcher';
import { clearCache } from './cache-cleanup';

const MIN_TRENDS = 3;
const MIN_COMPETITORS = 3;
const MIN_ICPS = 2;
const MIN_SOURCES = 5;
const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%/;

interface MemoryCounts {
  trends: number;
  competitors: number;
  icps: number;
  sources: number;
  openQuestions: number;
}

export const runResearchIteration = createStep({
  id: 'research-iteration',
  description:
    'One iteration of the research loop. Builds a prompt that restates the brief plus the current progress counts and remaining deficits, invokes the researcher on the same thread, reads working memory once after the invocation, and outputs the new deficits + counts. Loop exit, max-attempts enforcement, and success-path cache cleanup live in the dountil callback.',
  inputSchema: iterationStateSchema,
  outputSchema: iterationStateSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const prompt = buildIterationPrompt(
      inputData,
      inputData.deficits,
      inputData.memoryCounts,
    );

    let completionSignal: string;
    try {
      const result = await invokeResearcher({
        mastra,
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
        runId,
        prompt,
      });
      completionSignal = result.completionSignal;
    } catch (err) {
      await clearCache(runId);
      throw err;
    }

    const newMemory = await readMemory(inputData.threadId, inputData.resourceId);

    return {
      ...inputData,
      completionSignal,
      deficits: collectDeficits(newMemory),
      memoryCounts: countsFromMemory(newMemory),
    };
  },
});

async function readMemory(threadId: string, resourceId: string): Promise<ResearchMemory> {
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

function countsFromMemory(m: ResearchMemory): MemoryCounts {
  return {
    trends: m.marketTrends.length,
    competitors: m.competitors.length,
    icps: m.candidateIcps.length,
    sources: m.sourcesConsulted.length,
    openQuestions: m.openQuestions.length,
  };
}

function collectDeficits(m: ResearchMemory): string[] {
  const deficits: string[] = [];

  if (m.marketTrends.length < MIN_TRENDS) {
    deficits.push(
      `marketTrends: got ${m.marketTrends.length}, need >= ${MIN_TRENDS}`,
    );
  }
  if (m.competitors.length < MIN_COMPETITORS) {
    deficits.push(
      `competitors: got ${m.competitors.length}, need >= ${MIN_COMPETITORS}`,
    );
  }
  if (m.candidateIcps.length < MIN_ICPS) {
    deficits.push(
      `candidateIcps: got ${m.candidateIcps.length}, need >= ${MIN_ICPS}`,
    );
  }
  if (m.sourcesConsulted.length < MIN_SOURCES) {
    deficits.push(
      `sourcesConsulted: got ${m.sourcesConsulted.length}, need >= ${MIN_SOURCES}`,
    );
  }

  // Triangulation: every quantitative trend needs corroboration from
  // another trend citing a different sourceUrl AND a different publisher.
  for (const trend of m.marketTrends) {
    const looksQuantitative =
      QUANT_CLAIM_REGEX.test(trend.claim) || QUANT_CLAIM_REGEX.test(trend.evidence);
    if (!looksQuantitative) continue;

    const corroborated = m.marketTrends.some(
      (other) =>
        other !== trend &&
        other.sourceUrl !== trend.sourceUrl &&
        other.publisher !== trend.publisher &&
        (QUANT_CLAIM_REGEX.test(other.claim) || QUANT_CLAIM_REGEX.test(other.evidence)),
    );
    if (!corroborated) {
      deficits.push(
        `quantitative trend "${trend.claim.slice(0, 60)}…" has no second corroborating source`,
      );
    }
  }

  return deficits;
}

function buildIterationPrompt(
  state: {
    vertical: string;
    companyName: string;
    companyFacts: string;
    companyVerified: string;
  },
  deficits: string[],
  counts: MemoryCounts,
): string {
  const hasFindings =
    counts.trends + counts.competitors + counts.icps + counts.sources > 0;

  const progressBlock = hasFindings
    ? `

Your current progress in working memory:
  - marketTrends: ${counts.trends}
  - competitors: ${counts.competitors}
  - candidateIcps: ${counts.icps}
  - sourcesConsulted: ${counts.sources}
  - openQuestions: ${counts.openQuestions}`
    : '';

  const deficitsBlock = deficits.length
    ? `

Address these gaps:
${deficits.map((d) => `  - ${d}`).join('\n')}`
    : '';

  const findingsNote = hasFindings
    ? ' Your existing findings persist in working memory — only fill in the gaps above.'
    : '';

  return `
Vertical: ${state.vertical}
Company: ${state.companyName}
Profile (verified ${state.companyVerified}):
${state.companyFacts}
${progressBlock}${deficitsBlock}

Populate working memory with structured findings.${findingsNote} When done, emit your completion signal in exactly this shape:
\`Recorded N trends, M competitors, K ICPs, S sources, Q open questions.\`
  `.trim();
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: TypeScript will still complain about `src/mastra/workflows/vertical-entry/index.ts` (the `dountil` callback still references `inputData.passed`). That's intentional — fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts
git commit -m "refactor(vertical-entry): make research-iteration step iteration-blind"
```

---

## Task 3: Move validation into the `dountil` callback

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/index.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts` (JSDoc only)

**Goal:** Implement the loop-control logic in the `dountil` condition: empty deficits → clear cache, return true; iteration cap reached → clear cache, throw with diagnostic; otherwise return false. Update `cache-cleanup.ts`'s JSDoc to reflect the new callers.

- [ ] **Step 1: Rewrite the workflow's `dountil` callback**

Replace the trivial passed-flag check with a full validation callback. Add a `MAX_ATTEMPTS` constant.

```ts
// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, prepareResearch } from './steps/prepare-research.step';
import { runResearchIteration } from './steps/research-iteration.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';
import { clearCache } from './steps/cache-cleanup';

const MAX_ATTEMPTS = 3;

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
})
  .then(prepareResearch)
  .dountil(runResearchIteration, async ({ inputData, runId, iterationCount }) => {
    if (inputData.deficits.length === 0) {
      await clearCache(runId);
      return true;
    }
    if (iterationCount >= MAX_ATTEMPTS) {
      await clearCache(runId);
      throw new Error(
        `Research insufficient after ${iterationCount} attempts:\n  - ` +
          inputData.deficits.join('\n  - '),
      );
    }
    return false;
  })
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
```

- [ ] **Step 2: Update `cache-cleanup.ts` JSDoc**

The cache-cleanup callers are now: (a) the dountil callback on its two terminal paths — `deficits.length === 0` and the max-attempts throw — and (b) the research-iteration step's catch block when `invokeResearcher` itself throws. Update the JSDoc accordingly.

Replace the existing comment block (`/** ... step on its final-exit paths ... retry path intentionally leaves the cache warm ... */`) with:

```ts
/**
 * Clear the per-run page cache, swallowing failures so a cleanup error
 * never masks the actual workflow result. Called from the dountil
 * callback on both terminal paths (deficits cleared → loop exits;
 * iteration cap reached → throw) and from the research-iteration step's
 * catch block when the researcher invocation itself throws. The
 * mid-loop retry path intentionally leaves the cache warm so the next
 * iteration can hit it.
 */
```

- [ ] **Step 3: Verify build, lint, type-check**

Run: `npm run build`
Expected: clean — no errors. The workflow type-checks, `iterationStateSchema` round-trips through `dountil`, and `synthesize.step.ts` consumes the new schema unchanged (it never touched `attempt` or `passed`).

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/index.ts src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts
git commit -m "refactor(vertical-entry): move deficit validation and max-attempts to dountil callback"
```

---

## Final cross-task review

After all three tasks land, verify:

- [ ] The whole workflow still type-checks: `npm run build` is clean.
- [ ] The whole workflow still lints: `npm run lint` (if such a script exists; otherwise rely on the build).
- [ ] `synthesize.step.ts` did NOT need code changes — confirm by reading it; it should only access the shared brief fields from `iterationStateSchema`.
- [ ] No file references the dropped fields `attempt` or `passed` (`rg "\.passed\b|\.attempt\b" src/mastra/workflows/vertical-entry`).
- [ ] The step body of `runResearchIteration` is materially shorter than before — pre-invoke read, max-attempts gate, and the success-path `clearCache` are all gone.
- [ ] The mid-loop retry path leaves the cache warm: the dountil callback's `return false` branch does NOT call `clearCache`, and the step body only clears on `invokeResearcher` throw — not on the normal path.

If any of these fail, dispatch a fix subagent with the specific gap.

---

## Self-Review of this plan

**Spec coverage:**
- State schema swap: Task 1, steps 1-2. ✓
- Step becomes iteration-blind: Task 2, step 1. ✓
- Callback owns validation + max-attempts + cleanup: Task 3, step 1. ✓
- Cache lifecycle preserved (warm during retries, cleared on terminal paths): Task 3, step 1 (callback) + Task 2, step 1 (catch block). ✓
- `synthesize.step.ts` unchanged but verified: final cross-task review. ✓
- JSDoc on cache-cleanup updated: Task 3, step 2. ✓

**Placeholder scan:** No "TBD" / "add appropriate" / "similar to" — every code step shows the actual code.

**Type consistency:**
- `iterationStateSchema` shape is defined once in Task 1 step 1; Tasks 2 and 3 read from it.
- `MemoryCounts` interface declared in Task 2 step 1; matches the Zod shape in Task 1 step 1.
- `buildIterationPrompt` signature `(state, deficits, counts)` is consistent between definition and call site (both in Task 2 step 1).
- `MAX_ATTEMPTS` constant lives in `index.ts` now (it's loop-control, not step-internal). The old definition in `research-iteration.step.ts` is removed in Task 2's rewrite.
- `dountil` callback async — confirmed against Mastra's compiled source: condition function may be async, and `clearCache` is async.
