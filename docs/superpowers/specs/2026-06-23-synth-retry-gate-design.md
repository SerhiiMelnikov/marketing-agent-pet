# Synthesizer structural retry-gate (A5) — design

**Date:** 2026-06-23
**Status:** Approved
**Branch:** `feat/synth-retry-gate` (off main @ 3a7e300)
**Backlog item:** A5 — synthesizer retry on scorer failure, deferred in the 2026-06-03 split spec ("If the synthesizer's output fails one of the existing scorers (e.g. orphan `[N]` references), no automatic retry … A retry policy can come later").

## Goal

When the synthesizer produces a report with a fixable structural citation defect (orphan `[N]` references or a raw JSON/serialized citation leak), automatically re-run the synthesizer with concrete feedback instead of shipping the broken report. Up to 2 retries, then accept the last draft and log a warning (fail-soft — never throw away a finished report over a citation defect).

## Background / why this is non-trivial

The five scorers run **fire-and-forget, asynchronously, post-hoc** (`executeHook('onScorerRun', …)` → `setImmediate`), purely for observability. They are NOT in the critical path — `runSynthesis` returns the report before any scorer runs. So "retry on scorer failure" cannot read scorer results inline; it needs a synchronous grade computed in the synthesis step itself.

Only the **deterministic structural** scorers gate the retry (decided): `citationFormat` and `citationIntegrity`. They are pure functions over the report text — cheap to run inline, and they catch defects the synthesizer can actually fix on a retry. Excluded:
- `sourceDiversity` — bounded by the input (working memory); a retry can't add domains the researcher never found.
- `companyFit` / `claimGrounding` — LLM-judge (Gemini) scorers; running them synchronously per synthesis adds cost + latency. They stay async evals, unchanged.

## Scope

In scope:
- A pure grader `gradeReportStructure(report)` returning pass/fail + concrete issue strings, gating on **format leaks OR orphan citations** (unused-but-listed sources do NOT gate).
- A retry loop inside `runSynthesis.execute`: synthesize → `normalizeCitations` → grade → on failure with retries left, re-prompt with feedback → repeat; on exhaustion accept the last draft + `logger.warn`.
- DRY refactor: extract the citation-format leak check and the orphan-citation check into shared pure predicates in `src/mastra/scorers/utils/`, and rewrite `citationFormatScorer` / `citationIntegrityScorer` to consume them, so the gate and the scorers share one definition.

Out of scope (deliberately):
- The async fire-and-forget scoring for dashboards — unchanged.
- LLM-judge and `sourceDiversity` scorers as gates.
- Any workflow/`dountil` change — the loop lives inside the synthesis step.
- Changing `normalizeCitations` (B3) or the corroboration flag (A9).

## Approach

### Shared pure predicates (DRY refactor)

The leak/orphan logic currently lives inline in the two scorers. Extract into `src/mastra/scorers/utils/`:

```ts
// returns one issue string per distinct citation-format problem found ([] when clean)
citationFormatIssues(text: string): string[]

// returns the inline [N] markers that have no matching entry in the Sources section ([] when clean)
orphanCitations(text: string): string[]
```

`citationFormatIssues` wraps the existing regexes (`/【?\{?["']?source["']?\s*:/`, `/【.*\{.*\}.*】/`, `/[【】]/`). `orphanCitations` reuses the existing `SOURCES_HEADING` split + `[\d+]` extraction. Then:
- `citationFormatScorer.generateScore` becomes `+!citationFormatIssues(text).length`.
- `citationIntegrityScorer`'s orphan computation calls `orphanCitations(text)` (its unused-source penalty stays as-is).

This keeps the scorers' external behavior identical while giving the gate a shared, unit-testable source of truth.

### The grader

```ts
// src/mastra/workflows/vertical-entry/grade-report.ts
interface ReportGrade { passed: boolean; issues: string[] }
function gradeReportStructure(report: string): ReportGrade
```

- `issues = [...formatIssues, ...orphanIssues]` where `orphanIssues` renders the orphan markers as a human sentence (e.g. `Inline citations [5], [7] are not listed in the Sources section.`).
- `passed = issues.length === 0`.
- Unused-but-listed sources are intentionally NOT an issue.

### Retry loop in `runSynthesis`

```
MAX_SYNTH_ATTEMPTS = 3   // 1 initial + 2 retries
feedback = ''
for attempt in 1..MAX:
    report = normalizeCitations( stream(prompt + feedback) )
    grade = gradeReportStructure(report)
    if grade.passed: return report
    if attempt == MAX: logger.warn('structural defects persisted after N attempts: ' + issues); return report
    feedback = renderRetryFeedback(grade.issues)   // appended to the next prompt
```

- Grade runs **after** `normalizeCitations`, so `【N】` markers (which B3 already cleans) never trigger a retry; a surviving format issue is a genuine JSON leak.
- `renderRetryFeedback` builds a block like:
  ```
  Your previous draft had these citation problems — fix them and reproduce the FULL report:
    - Inline citations [5], [7] are not listed in the Sources section.
  Every inline [N] must have a matching numbered entry in the Sources section, and never emit raw JSON or 【…】 markers.
  ```
- The synthesizer is re-invoked the same way (same `agent.stream`, readOnly memory) with the augmented prompt.

## Data flow

`runSynthesis` builds the base prompt (existing) → loop: `agent.stream` → `normalizeCitations` → `gradeReportStructure` → passed? return : (retries left? append feedback & loop : warn & return). Async scorers still fire post-hoc on whatever output is returned. No workflow, memory, or scorer-registration change.

## Error handling

- Fail-soft: the loop never throws on a grade failure; after `MAX_SYNTH_ATTEMPTS` it returns the last draft and logs a warning with the residual issues.
- `gradeReportStructure` is pure and total over any string (empty report → orphan/format checks simply find nothing or the report fails `isFinalReport` elsewhere; not this gate's concern).

## Invariants / constraints

- Node `>=22.13.0`; TS ES2022, strict. New pure code is Vitest-tested.
- The two refactored scorers keep identical external scoring behavior (the extraction is behavior-preserving).
- Gate only on fixable structural defects (format leaks + orphan citations); never on input-bounded or LLM-judge dimensions.
- The retry loop is contained in `runSynthesis`; no `dountil`/workflow change.
- Each retry is a full re-synthesis (≈ one extra Sonnet call); capped at 2.

## Testing & verification

- **Vitest** for `gradeReportStructure`: a clean multi-section report with matching `[N]`/Sources → `passed: true`; a report with an inline `[7]` absent from Sources → `passed: false` + an orphan issue naming `[7]`; a report with a raw `{"source": …}` leak → `passed: false`; a report with an unused-but-listed source only → `passed: true` (does not gate). Plus tests for the extracted `citationFormatIssues` / `orphanCitations` predicates, and a behavior-preserving check that the refactored scorers still score the same on representative inputs.
- `npx tsc --noEmit` + `npm run build`.
- **E2E**: one normal run (healthcare or finance / onix) confirming a clean report passes the gate on the first attempt with no spurious retries (watch the log for the absence of retry-feedback). Deliberately corrupting a draft to force the retry path is hard to do deterministically against a live model, so retry-path correctness is covered by the unit tests on the grader + feedback renderer, not e2e.

## Risks

- **A real but unfixable defect loops to the cap every run** (e.g. the synthesizer keeps emitting an orphan it cannot reconcile), adding 2 wasted Sonnet calls. Mitigated by the cap (max +2) and the warning; if it recurs in practice, lower the cap or sharpen the feedback.
- **Behavior drift in the scorer refactor.** Mitigated by the behavior-preserving unit test on the refactored scorers.
- **Feedback that's too vague to act on.** Mitigated by naming the exact offending `[N]` markers in the issue string.
