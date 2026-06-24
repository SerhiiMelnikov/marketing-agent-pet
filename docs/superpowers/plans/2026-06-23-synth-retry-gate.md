# Synthesizer structural retry-gate (A5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the synthesizer's report has a fixable structural citation defect (orphan `[N]` or a raw JSON/serialized citation leak), re-run the synthesizer with concrete feedback (up to 2 retries), then accept the last draft and warn — never throw.

**Architecture:** Extract the citation-format and orphan-citation checks into shared pure predicates (DRY across the two scorers and the new gate); add a pure `gradeReportStructure` grader; wrap `runSynthesis`'s single `agent.stream` call in a retry loop that grades after `normalizeCitations` and re-prompts on failure.

**Tech Stack:** TypeScript (ES2022, strict, `moduleResolution: bundler`), Vitest, Mastra agents/workflows, Node `>=22.13.0`.

## Global Constraints

- Node `>=22.13.0`; TS ES2022, strict. New pure code is Vitest-tested (`*.test.ts`, co-located, `import { describe, it, expect } from 'vitest'`).
- The retry loop lives INSIDE `runSynthesis.execute` — no `dountil`/workflow change.
- Gate ONLY on fixable structural defects: citation-format leaks OR orphan `[N]`. Unused-but-listed sources do NOT gate. `sourceDiversity` and the LLM-judge scorers do NOT gate.
- `MAX_SYNTH_ATTEMPTS = 3` (1 initial + 2 retries). On exhaustion: return the last draft + `logger.warn`; never throw.
- Grade runs AFTER `normalizeCitations(draft)` so `【N】` markers (already cleaned by B3) never trigger a retry.
- The scorer refactor must be BEHAVIOR-PRESERVING — `citationFormatScorer` / `citationIntegrityScorer` score identically after extraction.

**Spec:** `docs/superpowers/specs/2026-06-23-synth-retry-gate-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/mastra/scorers/utils/citations.ts` | Shared pure citation predicates: `splitBodyAndSources`, `extractRefs`, `orphanCitations`, `citationFormatIssues` | Create |
| `src/mastra/scorers/utils/citations.test.ts` | Tests for the predicates | Create |
| `src/mastra/scorers/utils/index.ts` | Re-export the new predicates | Modify |
| `src/mastra/scorers/citation-format.scorer.ts` | Use `citationFormatIssues` | Modify |
| `src/mastra/scorers/citation-integrity.scorer.ts` | Use shared split/extract/orphan | Modify |
| `src/mastra/workflows/vertical-entry/grade-report.ts` | `gradeReportStructure` + `renderRetryFeedback` | Create |
| `src/mastra/workflows/vertical-entry/grade-report.test.ts` | Tests for grader + feedback | Create |
| `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts` | Retry loop | Modify |

---

## Task 1: Shared citation predicates + scorer refactor

**Files:**
- Create: `src/mastra/scorers/utils/citations.ts`, `src/mastra/scorers/utils/citations.test.ts`
- Modify: `src/mastra/scorers/utils/index.ts`, `src/mastra/scorers/citation-format.scorer.ts`, `src/mastra/scorers/citation-integrity.scorer.ts`

**Interfaces:**
- Produces: `splitBodyAndSources(report: string): { body: string; sources: string }`; `extractRefs(text: string): Set<string>`; `orphanCitations(report: string): string[]`; `citationFormatIssues(text: string): string[]`.
- Consumes: `SOURCES_HEADING` from `../constants`.

- [ ] **Step 1: Write the failing tests**

Create `src/mastra/scorers/utils/citations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orphanCitations, citationFormatIssues } from './citations';

const withSources = (body: string, sources: string) => `${body}\n\n## Sources\n${sources}`;

describe('orphanCitations', () => {
  it('returns [] when every inline [N] is listed in Sources', () => {
    expect(orphanCitations(withSources('Body cites [1] and [2].', '[1] A — x\n[2] B — y'))).toEqual([]);
  });

  it('returns the inline markers missing from Sources', () => {
    expect(orphanCitations(withSources('Body cites [1] and [7].', '[1] A — x'))).toEqual(['[7]']);
  });

  it('does NOT flag a listed-but-uncited source as an orphan', () => {
    expect(orphanCitations(withSources('Body cites [1].', '[1] A — x\n[2] B — y'))).toEqual([]);
  });

  it('treats every inline [N] as orphan when there is no Sources section', () => {
    expect(orphanCitations('Body cites [1] with no sources section.')).toEqual(['[1]']);
  });
});

describe('citationFormatIssues', () => {
  it('returns [] for a clean report with [N] references', () => {
    expect(citationFormatIssues('Clean body with [1] and [2].')).toEqual([]);
  });

  it('flags a raw JSON/serialized citation leak', () => {
    expect(citationFormatIssues('text {"source": "x"} more').length).toBeGreaterThan(0);
  });

  it('flags native fullwidth citation markers', () => {
    expect(citationFormatIssues('text 【1†Source】 more').length).toBeGreaterThan(0);
    expect(citationFormatIssues('text 【2】 more').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mastra/scorers/utils/citations.test.ts`
Expected: FAIL — cannot resolve `./citations`.

- [ ] **Step 3: Create `citations.ts`**

```ts
// src/mastra/scorers/utils/citations.ts

import { SOURCES_HEADING } from '../constants';

const REF_MARKER = /\[\d+\]/g;

/** Split a report into the body (before the Sources heading) and the Sources
 *  section (from the heading on). No heading → all body. */
export function splitBodyAndSources(report: string): { body: string; sources: string } {
  const match = report.match(SOURCES_HEADING);

  return !match || match.index === undefined
    ? { body: report, sources: '' }
    : { body: report.slice(0, match.index), sources: report.slice(match.index) };
}

export function extractRefs(text: string): Set<string> {
  return new Set(text.match(REF_MARKER) ?? []);
}

/** Inline [N] markers in the body that have no matching [N] in the Sources
 *  section (a report with no Sources section makes every inline [N] an orphan). */
export function orphanCitations(report: string): string[] {
  const { body, sources } = splitBodyAndSources(report);
  const inline = extractRefs(body);
  const inSources = extractRefs(sources);

  return [...inline].filter((r) => !inSources.has(r));
}

/** Distinct citation-format defects in the report text. Empty = clean.
 *  Mirrors the citation-format scorer's checks so both share one definition. */
export function citationFormatIssues(text: string): string[] {
  const issues: string[] = [];

  if (/【?\{?["']?source["']?\s*:/.test(text) || /【.*\{.*\}.*】/.test(text)) {
    issues.push('raw JSON/serialized citation object');
  }
  if (/[【】]/.test(text)) {
    issues.push('native 【…】 citation markers');
  }

  return issues;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/mastra/scorers/utils/citations.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-export from `utils/index.ts`**

In `src/mastra/scorers/utils/index.ts`, add at the end:

```ts
export {
  splitBodyAndSources,
  extractRefs,
  orphanCitations,
  citationFormatIssues,
} from './citations';
```

- [ ] **Step 6: Refactor `citation-format.scorer.ts` (behavior-preserving)**

In `src/mastra/scorers/citation-format.scorer.ts`, change the `preprocessRun` import line to also pull the predicate:

```ts
import { preprocessRun, citationFormatIssues } from './utils';
```

Replace the `generateScore` body's three inline regex consts + return with:

```ts
  .generateScore(({ results }) => {
    const { text, isComplete } = results.preprocessStepResult;

    if (!isComplete) return 0;

    return +!citationFormatIssues(text).length;
  })
```

Leave `generateReason` unchanged. (Identical scoring: the scorer returned `+!(jsonLeak || rawBracketObjects || nativeMarker)`; `citationFormatIssues` is non-empty iff one of those holds.)

- [ ] **Step 7: Refactor `citation-integrity.scorer.ts` (behavior-preserving)**

In `src/mastra/scorers/citation-integrity.scorer.ts`:

(a) Delete the local `const REF_MARKER`, `function splitBodyAndSources`, and `function extractRefs` definitions.

(b) Change the imports to pull them from utils. The current imports are:

```ts
import { createScorer } from '@mastra/core/evals';
import { INCOMPLETE_MSG, SOURCES_HEADING } from './constants';
import { preprocessRun } from './utils';
```

Replace with (SOURCES_HEADING is no longer used directly here — it moved into `citations.ts`):

```ts
import { createScorer } from '@mastra/core/evals';
import { INCOMPLETE_MSG } from './constants';
import { preprocessRun, splitBodyAndSources, extractRefs, orphanCitations } from './utils';
```

(c) In the `.preprocess` body, the orphan computation currently is:

```ts
    const { body, sources } = splitBodyAndSources(base.text);

    const inlineRefs = extractRefs(body);
    const sourceRefs = extractRefs(sources);

    const orphanCitations = [...inlineRefs].filter((r) => !sourceRefs.has(r));
    const unusedSources = [...sourceRefs].filter((r) => !inlineRefs.has(r));
```

Change the `orphanCitations` line to use the shared predicate (keep `unusedSources` local):

```ts
    const { body, sources } = splitBodyAndSources(base.text);

    const inlineRefs = extractRefs(body);
    const sourceRefs = extractRefs(sources);

    const orphanCitations = orphanCitations(base.text);
    const unusedSources = [...sourceRefs].filter((r) => !inlineRefs.has(r));
```

Wait — `orphanCitations` is both the imported function name and the local const, which collides. Rename the local const to `orphans` and update the returned object key accordingly:

```ts
    const { body, sources } = splitBodyAndSources(base.text);

    const inlineRefs = extractRefs(body);
    const sourceRefs = extractRefs(sources);

    const orphans = orphanCitations(base.text);
    const unusedSources = [...sourceRefs].filter((r) => !inlineRefs.has(r));

    return {
      isComplete: true,
      inlineCount: inlineRefs.size,
      sourceCount: sourceRefs.size,
      orphanCitations: orphans,
      unusedSources,
      hasSourcesSection: sources.length > 0,
    };
```

The rest of the `.preprocess` return and the `generateScore`/`generateReason` (which read `p.orphanCitations`) are unchanged.

- [ ] **Step 8: Type-check, build, run the scorer-adjacent suite**

Run: `npx tsc --noEmit && npm run build && npx vitest run src/mastra/scorers/`
Expected: all exit 0; the existing scorer-utils tests plus the new `citations.test.ts` pass.

- [ ] **Step 9: Commit**

```bash
git add src/mastra/scorers/utils/citations.ts src/mastra/scorers/utils/citations.test.ts src/mastra/scorers/utils/index.ts src/mastra/scorers/citation-format.scorer.ts src/mastra/scorers/citation-integrity.scorer.ts
git commit -m "refactor(scorers): extract shared citation predicates for reuse by the synth gate"
```

---

## Task 2: The report grader

**Files:**
- Create: `src/mastra/workflows/vertical-entry/grade-report.ts`, `src/mastra/workflows/vertical-entry/grade-report.test.ts`

**Interfaces:**
- Consumes: `citationFormatIssues`, `orphanCitations` from `../../scorers/utils/citations` (Task 1).
- Produces: `interface ReportGrade { passed: boolean; issues: string[] }`; `gradeReportStructure(report: string): ReportGrade`; `renderRetryFeedback(issues: string[]): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/mastra/workflows/vertical-entry/grade-report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gradeReportStructure, renderRetryFeedback } from './grade-report';

const withSources = (body: string, sources: string) => `${body}\n\n## Sources\n${sources}`;

describe('gradeReportStructure', () => {
  it('passes a clean report with matching [N]/Sources', () => {
    const g = gradeReportStructure(withSources('Body cites [1] and [2].', '[1] A — x\n[2] B — y'));

    expect(g.passed).toBe(true);
    expect(g.issues).toEqual([]);
  });

  it('fails on an orphan citation and names the marker', () => {
    const g = gradeReportStructure(withSources('Body cites [1] and [7].', '[1] A — x'));

    expect(g.passed).toBe(false);
    expect(g.issues.join(' ')).toContain('[7]');
  });

  it('fails on a raw JSON citation leak', () => {
    const g = gradeReportStructure(withSources('Body {"source": "x"} cites [1].', '[1] A — x'));

    expect(g.passed).toBe(false);
  });

  it('passes when a listed source is merely uncited (unused does not gate)', () => {
    const g = gradeReportStructure(withSources('Body cites [1].', '[1] A — x\n[2] B — y'));

    expect(g.passed).toBe(true);
  });
});

describe('renderRetryFeedback', () => {
  it('renders the issues and the corrective instruction', () => {
    const out = renderRetryFeedback(['Inline citations [7] are not listed in the Sources section.']);

    expect(out).toContain('[7]');
    expect(out).toContain('Sources section');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mastra/workflows/vertical-entry/grade-report.test.ts`
Expected: FAIL — cannot resolve `./grade-report`.

- [ ] **Step 3: Create `grade-report.ts`**

```ts
// src/mastra/workflows/vertical-entry/grade-report.ts

import { citationFormatIssues, orphanCitations } from '../../scorers/utils/citations';

export interface ReportGrade {
  passed: boolean;
  issues: string[];
}

/**
 * Structural quality gate for the synthesizer's report. Fails on fixable
 * citation defects — raw JSON/serialized citation leaks or orphan [N] markers
 * (inline citations missing from the Sources section). A listed-but-uncited
 * source is intentionally NOT a failure.
 */
export function gradeReportStructure(report: string): ReportGrade {
  const issues: string[] = [];

  const format = citationFormatIssues(report);
  if (format.length) {
    issues.push(`The report contains ${format.join(' and ')} instead of clean [N] references.`);
  }

  const orphans = orphanCitations(report);
  if (orphans.length) {
    issues.push(`Inline citations ${orphans.join(', ')} are not listed in the Sources section.`);
  }

  return { passed: issues.length === 0, issues };
}

/** Feedback block appended to the synthesizer prompt on a retry. */
export function renderRetryFeedback(issues: string[]): string {
  return [
    'Your previous draft had these citation problems — fix them and reproduce the FULL report:',
    ...issues.map((i) => `  - ${i}`),
    'Every inline [N] must have a matching numbered entry in the Sources section, and never emit raw JSON or 【…】 markers.',
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/mastra/workflows/vertical-entry/grade-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/workflows/vertical-entry/grade-report.ts src/mastra/workflows/vertical-entry/grade-report.test.ts
git commit -m "feat(workflow): structural report grader + retry feedback"
```

---

## Task 3: Retry loop in the synthesis step

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`

**Interfaces:**
- Consumes: `gradeReportStructure`, `renderRetryFeedback` from `../grade-report` (Task 2); `logger` from `../../../../utils/logger`.

- [ ] **Step 1: Add imports**

In `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`, after the existing `import { normalizeCitations } from '../normalize-citations';` line, add:

```ts
import { gradeReportStructure, renderRetryFeedback } from '../grade-report';
import { logger } from '../../../../utils/logger';
```

- [ ] **Step 2: Add the attempt cap constant**

Immediately above `export const runSynthesis = createStep({`, add:

```ts
const MAX_SYNTH_ATTEMPTS = 3; // 1 initial + 2 retries on structural citation defects
```

- [ ] **Step 3: Replace the single-shot synthesis with the retry loop**

The current `execute` body (after `const flagBlock = corroborationFlagBlock(memory);`) builds one prompt, streams once, and returns. Replace from the `const prompt = ` line through the `return { threadId: runId, report: normalizeCitations(report) };` line with:

```ts
    const basePrompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company: ${inputData.companyName}
Profile:
${inputData.companyFacts}

Read the working-memory document now and produce the final markdown report.${flagBlock ? `\n\n${flagBlock}` : ''}
    `.trim();

    let report = '';
    let feedback = '';

    for (let attempt = 1; attempt <= MAX_SYNTH_ATTEMPTS; attempt++) {
      const prompt = feedback ? `${basePrompt}\n\n${feedback}` : basePrompt;

      const response = await agent.stream([{ role: 'user', content: prompt }], {
        memory: {
          thread: runId,
          resource: 'default',
          options: { readOnly: true },
        },
        maxSteps: 1,
      });

      let draft = '';
      for await (const chunk of response.textStream) {
        process.stdout.write(chunk);
        draft += chunk;
      }
      report = normalizeCitations(draft);

      const grade = gradeReportStructure(report);
      if (grade.passed) break;

      if (attempt === MAX_SYNTH_ATTEMPTS) {
        logger.warn(
          `Synthesis structural defects persisted after ${attempt} attempt(s): ${grade.issues.join(' ')}`,
        );
        break;
      }

      feedback = renderRetryFeedback(grade.issues);
    }

    return { threadId: runId, report };
```

(The `const agent`, `const memory`, and `const flagBlock` lines above stay unchanged.)

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/synthesize.step.ts
git commit -m "feat(synthesis): retry on structural citation defects, fail-soft after 2 retries"
```

---

## Task 4: Final verification + e2e

**Files:** none (verification only)

- [ ] **Step 1: Whole suite + type-check + build + clean tree**

Run: `npm test && npx tsc --noEmit && npm run build && git status --short`
Expected: all Vitest suites pass (including the new `citations` and `grade-report` suites); both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: E2E sanity run**

Build is refreshed by Step 1. Run the workflow headlessly with `{ vertical: 'healthcare IT outsourcing', companyKey: 'onix' }` (the project's established headless harness — import `.mastra/output/mastra.mjs`, `getWorkflow('verticalEntryWorkflow')`, `createRun()`, `run.start({ inputData })`, with `node --env-file=.env`), capturing output to a log.

- [ ] **Step 3: Confirm gate behavior (no commit — observation)**

In the log, confirm:
1. The workflow reached `success` and produced a coherent report.
2. A clean report passed on the FIRST synthesis attempt — i.e. NO `renderRetryFeedback` block ("Your previous draft had these citation problems") appears in the synthesizer's input, and NO `Synthesis structural defects persisted` warning fired.
3. (If a retry did fire) the feedback named concrete `[N]` markers and the workflow still completed.

The retry path itself is covered deterministically by the Task 2 unit tests (forcing a live model to emit an orphan on demand is unreliable); this e2e confirms the gate does not spuriously retry a clean report.

- [ ] **Step 4: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- Shared pure predicates (`citationFormatIssues`, `orphanCitations`, + `splitBodyAndSources`/`extractRefs`) extracted; both scorers refactored behavior-preserving → Task 1. ✓
- `gradeReportStructure` gating on format leaks OR orphans, unused does NOT gate → Task 2 (+ test). ✓
- Retry loop inside `runSynthesis`, grade after `normalizeCitations`, `MAX_SYNTH_ATTEMPTS = 3`, fail-soft warn on exhaustion, feedback re-prompt → Task 3. ✓
- LLM-judge / sourceDiversity / async scoring / workflow untouched → not modified in any task; stated in Global Constraints. ✓
- Vitest for predicates + grader + feedback; tsc/build; e2e no-spurious-retry → Task 1/2 tests + Task 4. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The Task 1 Step 7 naming-collision (imported `orphanCitations` vs local const) is called out explicitly and resolved by renaming the local to `orphans`.

**Type consistency:** `gradeReportStructure(report): ReportGrade {passed, issues}`, `renderRetryFeedback(issues): string`, `citationFormatIssues`/`orphanCitations`/`splitBodyAndSources`/`extractRefs` signatures, and `MAX_SYNTH_ATTEMPTS` are used identically across tasks. Import paths: `../../scorers/utils/citations` from `vertical-entry/` (grade-report), `../grade-report` and `../../../../utils/logger` from `steps/` (synthesize), `./utils` / `./citations` within `scorers/` — all match the existing directory depths.
