# Move Cache Cleanup to Workflow `onFinish` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three local `clearCache(runId)` call sites (dountil callback's two terminal branches + research-iteration step's catch block) with a single workflow-level `options.onFinish` lifecycle hook that clears the per-run page cache on every workflow termination except `suspended`.

**Architecture:** Mastra's `createWorkflow({ options: { onFinish } })` fires once per run on terminal states `'success' | 'failed' | 'suspended' | 'tripwire'`. We gate on `status !== 'suspended'` (suspend is a pause; the cache must stay warm for resume — even though this workflow doesn't currently suspend, the guard protects against silent breakage if we add it later). Throws inside the callback are caught and logged by Mastra, matching `clearCache`'s own swallow-and-log property. With cleanup centralized, the dountil callback becomes a pure exit-condition function, and `runResearchIteration` drops its try/catch around `invokeResearcher` entirely — any throw propagates up and the workflow's failed-status triggers `onFinish`.

**Tech Stack:** TypeScript, Mastra workflows (`createWorkflow`, `options.onFinish`, `dountil`), libsql page-cache module.

**Verified Mastra semantics (`@mastra/core` installed version, `reference-workflows-workflow.md` + `docs-workflows-error-handling.md`):**
- `createWorkflow({ ..., options: { onFinish: async (result) => { ... } } })` is the documented shape — `options` is a top-level key of `createWorkflow`'s argument object.
- `onFinish` fires on `status: 'success' | 'failed' | 'suspended' | 'tripwire'`. We must status-gate to skip suspend.
- The callback's single argument exposes `runId`, `status`, `error`, `steps`, `mastra`, `logger`, `state`, `requestContext`, `workflowId`, `resourceId`, `getInitData`, etc. — `runId` is destructurable directly.
- "Errors thrown in this callback are caught and logged, not propagated" — safe for our use case; `clearCache` already has the same property internally.

---

## File Structure

| File | Change |
|---|---|
| `src/mastra/workflows/vertical-entry/index.ts` | Add `options.onFinish` to `createWorkflow` config that calls `clearCache(runId)` when `status !== 'suspended'`. Strip the two `await clearCache(runId)` calls from inside the dountil condition callback (it becomes a pure exit-condition function — no awaits, no async). |
| `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts` | Drop the try/catch around `invokeResearcher`; let throws propagate. Remove the now-unused `clearCache` import. |
| `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts` | Update JSDoc — sole caller is now the workflow's `onFinish` lifecycle hook. |

No test files exist in this project — verification is via `npm run build`.

---

## Task 1: Replace per-site cache cleanup with a workflow-level `onFinish` hook

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/index.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts`

This is a single coordinated change. All three files must land in one commit because the intermediate states would either double-clear the cache or leak it on certain paths.

- [ ] **Step 1: Update the workflow definition**

Replace the contents of `src/mastra/workflows/vertical-entry/index.ts` with:

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
  options: {
    onFinish: async ({ runId, status }) => {
      // Skip on 'suspended' — that's a pause, not an end; the cache must
      // stay warm for resume. This workflow doesn't currently suspend,
      // but the guard protects against silent breakage if we add it.
      if (status === 'suspended') return;
      await clearCache(runId);
    },
  },
})
  .then(prepareResearch)
  .dountil(runResearchIteration, ({ inputData, iterationCount }) => {
    if (inputData.deficits.length === 0) return Promise.resolve(true);
    if (iterationCount >= MAX_ATTEMPTS) {
      throw new Error(
        `Research insufficient after ${iterationCount} attempts:\n  - ` +
          inputData.deficits.join('\n  - '),
      );
    }
    return Promise.resolve(false);
  })
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
```

Notes on the changes:
- Added `options.onFinish` to the `createWorkflow` config.
- Dountil callback is no longer `async` — both `clearCache` awaits are gone, so the function has no awaits. The project lints with `@typescript-eslint/require-await`, which would reject `async` here. Use `Promise.resolve(true)` / `Promise.resolve(false)` for non-throw returns. (Synchronous throws are caught by Mastra's `await condition(...)` the same way as rejected promises.)
- `runId` is no longer destructured from the dountil callback (it's not used inside it anymore).

- [ ] **Step 2: Strip the try/catch from `runResearchIteration`**

Open `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`. Find the `execute` function body. Replace ONLY this section:

```ts
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
```

with:

```ts
  execute: async ({ inputData, mastra, runId }) => {
    const prompt = buildIterationPrompt(
      inputData,
      inputData.deficits,
      inputData.memoryCounts,
    );

    const { completionSignal } = await invokeResearcher({
      mastra,
      threadId: inputData.threadId,
      resourceId: inputData.resourceId,
      runId,
      prompt,
    });

    const newMemory = await readMemory(inputData.threadId, inputData.resourceId);

    return {
      ...inputData,
      completionSignal,
      deficits: collectDeficits(newMemory),
      memoryCounts: countsFromMemory(newMemory),
    };
  },
```

Then remove the `clearCache` import from the top of the same file. The line:

```ts
import { clearCache } from './cache-cleanup';
```

should be deleted. (Verify no other references to `clearCache` exist in this file before deleting — `grep -n clearCache src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts` should show only the import line after this change.)

- [ ] **Step 3: Update `cache-cleanup.ts` JSDoc**

Open `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts`. Replace ONLY the JSDoc block above `export async function clearCache(...)` with:

```ts
/**
 * Clear the per-run page cache, swallowing failures so a cleanup error
 * never masks the actual workflow result. The sole caller is the
 * vertical-entry workflow's `options.onFinish` lifecycle hook, which
 * fires on every terminal status except `'suspended'`. The TTL on
 * cached entries is the safety net for any path Mastra's onFinish
 * doesn't cover (e.g. process crash, future framework changes).
 */
```

Do NOT modify the function body or signature.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: clean — no errors, no new warnings. The `onFinish` callback typechecks against Mastra's `WorkflowFinishCallbackResult`, the dountil callback typechecks as `(params: ExecuteParams & { iterationCount: number }) => Promise<boolean>`, and the research-iteration step no longer imports `clearCache`.

- [ ] **Step 5: Sanity-grep for cache cleanup call sites**

Run from repo root:
```
grep -rn "clearCache(" src/mastra/workflows/vertical-entry/
```

Expected: exactly two matches —
- `src/mastra/workflows/vertical-entry/index.ts` (the `onFinish` body)
- `src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts` (the function definition, if grep matches the declaration)

Actually the function declaration is `export async function clearCache(` (no parens immediately after `clearCache` followed by a value), so the grep above with `clearCache(` should hit:
- `index.ts` — `await clearCache(runId);` (the actual call site)
- maybe `cache-cleanup.ts` itself depending on grep behavior

Confirm there are **zero** `clearCache(` calls in `research-iteration.step.ts` and any other file under `vertical-entry/`.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/workflows/vertical-entry/index.ts src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts
git commit -m "refactor(vertical-entry): move cache cleanup to workflow onFinish hook"
```

---

## Self-Review of this plan

**Spec coverage:**
- Cache cleanup moves from 3 sites to 1: Task 1, Steps 1-3. ✓
- `status === 'suspended'` is the gate, so suspend won't nuke the cache: Task 1, Step 1. ✓
- Dountil callback simplifies and is no longer `async`: Task 1, Step 1 (`Promise.resolve` pattern + sync throw). ✓
- Research-iteration step's try/catch goes away: Task 1, Step 2. ✓
- `clearCache` import removed from research-iteration step: Task 1, Step 2. ✓
- JSDoc updated: Task 1, Step 3. ✓
- Build verification: Task 1, Step 4. ✓
- Verification grep for stray callers: Task 1, Step 5. ✓

**Placeholder scan:** No "TBD" / "add appropriate" / "etc." — every step shows the actual code.

**Type consistency:**
- `Promise.resolve(true)` and `Promise.resolve(false)` return `Promise<boolean>`, matching dountil's expected condition signature.
- The thrown `Error` is caught by Mastra's `await condition(...)` regardless of whether the callback is async or sync — `await` unwraps both rejected promises and synchronous throws into the same exception channel.
- `onFinish` callback typed as `async ({ runId, status }) => { ... }` matches Mastra's `(result: WorkflowFinishCallbackResult) => Promise<void>` — both `runId` and `status` are documented fields on the result object.
- `MAX_ATTEMPTS` stays in `index.ts` (already there from the prior refactor).
