# Research-iteration loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the workflow so `dountil` iterates the research step itself. Each iteration restates the brief + accumulated progress + remaining deficits as one unified prompt. Eliminates the `refine-or-pass` overload — research becomes its own loop body, deficits-check is the condition.

**Architecture:**

```
brief
  ↓
[prepareResearch]  -- resolves profile, mints threadId, seeds iteration state (attempt:0)
  ↓
dountil([runResearchIteration], (out) => out.passed)
        │
        ├─ reads working memory + computes deficits
        ├─ early-exit if deficits=0 and attempt>0  → clearCache, passed:true
        ├─ throw if attempt >= MAX_ATTEMPTS         → clearCache (via outer catch)
        ├─ builds full prompt: brief + progress + deficits
        ├─ invokes researcher (same thread)
        ├─ re-reads memory, re-computes deficits
        └─ returns updated state with attempt+1 and passed flag
  ↓
[runSynthesis]
```

**Why this is better than refineOrPass:**

- Symmetric loop body — every iteration goes through the same code path; no asymmetry between "initial pass" and "refine pass".
- Brief is always in close context. Each iteration's prompt restates `Vertical: …` and the company profile, so the agent never has to recall them from buried thread history.
- Progress is visible to the agent. The prompt names current counts and remaining deficits explicitly, so even a model that lost track of what it wrote gets a fresh statement.
- `refineOrPass` was overloaded (validate + orchestrate + cleanup). The new step has one job: "run one iteration."

**Spec reference:** prior conversation discussion validating this design.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts` | **Create** | `briefSchema → iterationState` (resolves profile, mints threadId, attempt:0) |
| `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts` | **Create** | `iterationState → iterationState` (loop body: read memory, prompt, invoke, re-check) |
| `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts` | **Modify** | Switch input schema from `refineOutputSchema` to `iterationStateSchema` |
| `src/mastra/workflows/vertical-entry/index.ts` | **Modify** | New shape: `.then(prepareResearch).dountil(runResearchIteration, c).then(runSynthesis)` |
| `src/mastra/workflows/vertical-entry/steps/research.step.ts` | **Delete** | Replaced by prepare + iteration split |
| `src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts` | **Delete** | Folded into research-iteration |
| `src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts` | **Keep** | Still used by research-iteration |
| `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts` | **Keep** | Still used by research-iteration |

---

## Task 1: Add prepare-research + research-iteration steps (not wired in yet)

**Files:**
- Create: `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts`
- Create: `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`

This task is purely additive — the new step files compile and pass lint, but the workflow still uses the old `runResearch` + `refineOrPass` flow. Task 2 does the flip.

The two new step files use existing helpers (`invokeResearcher`, `clearCache`) and existing types (`researchMemorySchema`, etc.) — no new dependencies.

- [ ] **Step 1: Create the iteration-state schema and prepare step**

`src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts`:

```ts
// src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { getProfile } from '../../../../modules/companies';
import { env } from '../../../../config/env';

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Key identifying which company profile from src/modules/companies/ to use. Falls back to DEFAULT_COMPANY_KEY env var when omitted.',
    ),
});

/**
 * State shape that flows through the research-iteration loop.
 * dountil requires the step's input and output schemas to match, so this
 * type is reused for both. `passed` is the loop's exit signal; `attempt`
 * is the iteration counter; `completionSignal` carries the latest agent
 * completion message for downstream tracing.
 */
export const iterationStateSchema = z.object({
  threadId: z.string(),
  resourceId: z.string(),
  vertical: z.string(),
  companyName: z.string(),
  companyFacts: z.string(),
  companyVerified: z.string(),
  attempt: z.number().int().nonnegative(),
  completionSignal: z.string(),
  passed: z.boolean(),
});

export const prepareResearch = createStep({
  id: 'prepare-research',
  description:
    'Resolves the company profile from the brief, mints a fresh threadId, and seeds the iteration state with attempt:0 / passed:false. The dountil loop runs after this step.',
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

    return {
      threadId: randomUUID(),
      resourceId: 'default',
      vertical: inputData.vertical,
      companyName: profile.name,
      companyFacts: profile.facts,
      companyVerified: profile.lastVerified,
      attempt: 0,
      completionSignal: '',
      passed: false,
    };
  },
});
```

Notes:
- `iterationStateSchema` is the single shape that loops through `dountil`.
- `prepareResearch` is synchronous — it just resolves the profile and seeds the state. No agent calls here.
- `companyVerified` is now in the state so the iteration prompt can render `Profile (verified X):` consistently.

- [ ] **Step 2: Create the iteration step**

`src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`:

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
const MAX_ATTEMPTS = 3;

export const runResearchIteration = createStep({
  id: 'research-iteration',
  description:
    'One iteration of the research loop. Reads working memory, computes deficits, builds a prompt that restates the brief + accumulated progress + remaining deficits, invokes the researcher on the same thread, and returns updated state with `passed` set to true when thresholds are met.',
  inputSchema: iterationStateSchema,
  outputSchema: iterationStateSchema,
  execute: async ({ inputData, mastra, runId }) => {
    try {
      const memory = await readMemory(inputData.threadId, inputData.resourceId);
      const deficits = collectDeficits(memory);

      // Early exit: nothing missing AND we've already done at least one iteration.
      // The `attempt > 0` guard prevents declaring success before the agent has run.
      if (deficits.length === 0 && inputData.attempt > 0) {
        await clearCache(runId);
        return { ...inputData, passed: true };
      }

      if (inputData.attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `Research insufficient after ${inputData.attempt} attempts:\n  - ` +
            deficits.join('\n  - '),
        );
      }

      const prompt = buildIterationPrompt(inputData, memory, deficits);

      const { completionSignal } = await invokeResearcher({
        mastra,
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
        runId,
        prompt,
      });

      const newMemory = await readMemory(inputData.threadId, inputData.resourceId);
      const newDeficits = collectDeficits(newMemory);
      const passed = newDeficits.length === 0;

      if (passed) {
        await clearCache(runId);
      }

      return {
        ...inputData,
        completionSignal,
        attempt: inputData.attempt + 1,
        passed,
      };
    } catch (err) {
      await clearCache(runId);
      throw err;
    }
  },
});

async function readMemory(threadId: string, resourceId: string): Promise<ResearchMemory> {
  const raw = await researchMemory.getWorkingMemory({ threadId, resourceId });

  if (!raw) {
    // First iteration on a fresh thread — no memory yet. Treat as empty.
    return {
      marketTrends: [],
      competitors: [],
      candidateIcps: [],
      sourcesConsulted: [],
      openQuestions: [],
    };
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
  state: { vertical: string; companyName: string; companyFacts: string; companyVerified: string },
  memory: ResearchMemory,
  deficits: string[],
): string {
  const hasFindings =
    memory.marketTrends.length +
      memory.competitors.length +
      memory.candidateIcps.length +
      memory.sourcesConsulted.length >
    0;

  const progressBlock = hasFindings
    ? `

Your current progress in working memory:
  - marketTrends: ${memory.marketTrends.length}
  - competitors: ${memory.competitors.length}
  - candidateIcps: ${memory.candidateIcps.length}
  - sourcesConsulted: ${memory.sourcesConsulted.length}
  - openQuestions: ${memory.openQuestions.length}`
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

Notes:
- Outer `try/catch` clears the cache on any throw path; success-with-passed clears explicitly before return; success-with-not-passed leaves the cache warm for the next iteration.
- `readMemory` treats null memory as empty (first iteration on a fresh thread is normal, not an error).
- `collectDeficits` is the same logic as the deleted refine-or-pass; verified thresholds (MIN_TRENDS=3, MIN_COMPETITORS=3, MIN_ICPS=2, MIN_SOURCES=5) match.
- `buildIterationPrompt` always restates the brief + conditional progress + conditional deficits. First iteration: just the brief. Subsequent: brief + accumulated state + gaps.

- [ ] **Step 3: Verify build, lint, tsc**

```bash
npm run build && npm run lint && npx tsc --noEmit
```

All three must be clean. The new files are not yet imported by the workflow — they're isolated.

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts \
        src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts
git commit -m "Add prepare-research + research-iteration steps (not yet wired)

Introduce the new loop shape that Task 2 will switch to:

- prepareResearch (briefSchema → iterationStateSchema): resolves the
  company profile, mints a fresh threadId, seeds the iteration counter.
- runResearchIteration (iterationStateSchema → iterationStateSchema):
  one loop iteration. Reads memory, computes deficits, builds a prompt
  that always restates the brief + current progress + remaining gaps,
  invokes the researcher on the same thread, re-checks deficits, and
  returns the updated state with passed:true when thresholds are met.

The workflow still uses the old runResearch + refineOrPass flow; Task 2
swaps the wiring and deletes the old steps in one atomic commit."
```

---

## Task 2: Flip the workflow + delete old steps

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/index.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`
- Delete: `src/mastra/workflows/vertical-entry/steps/research.step.ts`
- Delete: `src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts`

Atomic commit because all four file operations must land together for the workflow to compile.

- [ ] **Step 1: Update synthesize input schema**

`src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`:

Replace `import { refineOutputSchema } from './refine-or-pass.step';` with `import { iterationStateSchema } from './prepare-research.step';`. Replace `inputSchema: refineOutputSchema` with `inputSchema: iterationStateSchema`.

The synthesize step reads `inputData.vertical`, `inputData.companyName`, `inputData.companyFacts`, `inputData.threadId`, `inputData.resourceId` — all present in `iterationStateSchema`. No other changes.

- [ ] **Step 2: Update the workflow**

`src/mastra/workflows/vertical-entry/index.ts`:

```ts
// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, prepareResearch } from './steps/prepare-research.step';
import { runResearchIteration } from './steps/research-iteration.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
})
  .then(prepareResearch)
  .dountil(runResearchIteration, ({ inputData }) => Promise.resolve(inputData.passed))
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
```

`briefSchema` is now exported from `prepare-research.step.ts` (carried over from the old `research.step.ts`).

- [ ] **Step 3: Delete the old steps**

```bash
git rm src/mastra/workflows/vertical-entry/steps/research.step.ts
git rm src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts
```

Confirm with `git status` that the deletions are staged.

- [ ] **Step 4: Verify build, lint, tsc**

```bash
npm run build && npm run lint && npx tsc --noEmit
```

All three must be clean.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/synthesize.step.ts \
        src/mastra/workflows/vertical-entry/index.ts \
        src/mastra/workflows/vertical-entry/steps/research.step.ts \
        src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts
git commit -m "Flip workflow to research-iteration loop; delete refine-or-pass

The dountil loop now iterates the research step itself. Every iteration
restates the brief + accumulated progress + remaining deficits, so the
agent always has full context without relying on conversation-history
recall.

- Workflow: .then(prepareResearch).dountil(runResearchIteration, cond).then(runSynthesis)
- Synthesize input schema switches from refineOutputSchema to
  iterationStateSchema (same fields, just renamed for the new shape).
- research.step.ts and refine-or-pass.step.ts are deleted — their
  responsibilities are split between prepareResearch (state setup) and
  runResearchIteration (loop body)."
```

---

## Manual verification (after Task 2 lands)

- [ ] **Check 1: Success in one iteration.** Run the workflow. Trace shows `prepare-research → research-iteration (attempt:1, passed:true) → synthesize`. Cache cleared at the iteration's success exit.

- [ ] **Check 2: Self-correcting retry.** Construct a brief that the initial pass under-produces (or temporarily lower the model power). Trace shows `prepare-research → research-iteration (attempt:1, passed:false) → research-iteration (attempt:2, passed:true) → synthesize`. The second iteration's prompt visibly contains the full brief, current progress counts, and the specific deficits.

- [ ] **Check 3: Max-attempts throw.** With a deliberately incapable model, the workflow fails after the 3rd iteration with the deficits error. Same error shape as today.

- [ ] **Check 4: Brief in every iteration's prompt.** The researcher's prompt on EVERY iteration starts with `Vertical: …` and the company facts — no implicit reliance on thread history.

- [ ] **Check 5: Cache stays warm across iterations.** Within a single workflow run, the second iteration's page fetches can hit the cache from the first iteration's fetches. Cache only clears at the loop's exit (success, max-attempts, or any throw).

- [ ] **Check 6: First iteration with empty memory.** On attempt:0, `readMemory` returns the empty-shape document (no throw), the prompt restates the brief without a "current progress" block (since `hasFindings` is false), and the agent runs as on a fresh task.

---

## Out of scope

- **Adaptive retry budget.** `MAX_ATTEMPTS = 3` is constant. A future change could scale by deficit type.
- **Per-iteration timeout.** Each iteration inherits `maxSteps: 60`. Retries could be shorter since they only fill gaps.
- **Synthesizer self-retry.** No change to the synthesis side.

---

## Risks worth flagging

- **First-iteration prompt has no "current progress" or "address these gaps" sections** because `hasFindings` is false and deficits aren't listed when there's nothing to compare against. The prompt is the brief alone. The agent runs as today's `runResearch` first call would. No regression.
- **`readMemory` swallows null and returns empty document** rather than throwing. This is intentional for the first iteration. If memory is unexpectedly null mid-loop (corruption?), we'd compute deficits against the empty doc and trigger a research pass, not an error. Trade-off: slightly more forgiving than the old refine-or-pass behavior (which threw on null). If you'd prefer the stricter behavior, change the null-handling to throw and add an explicit "attempt:0" guard before the readMemory call.
- **`dountil` semantics under our condition:** condition checks `inputData.passed`. We return `{...inputData, passed: true}` to exit. The condition is evaluated AFTER the step runs, so we always run at least one iteration. With `attempt:0` seeded by prepareResearch, the first iteration definitely invokes the agent. The early-exit `attempt > 0 && deficits.length === 0` path can only fire on iteration 2+ after a successful invoke that filled all gaps.
