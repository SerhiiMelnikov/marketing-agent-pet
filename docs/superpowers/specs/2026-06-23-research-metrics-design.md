# Research-quality metrics (A6) — design

**Date:** 2026-06-23
**Status:** Approved
**Branch:** `feat/research-metrics` (off main @ 3a7e300; independent of A5)
**Backlog item:** A6 — research-quality scorers that grade the *findings* (not the final report), deferred in the 2026-06-03 split spec ("source diversity by classifier, triangulation count, finding density … build them only after the split itself is observed working").

## Goal

After the research loop, measure the quality of what the researcher gathered — finding density, source diversity by classifier, triangulation rate, and authoritative-source ratio — and emit them as a structured observability signal, so research quality is visible per run instead of inferred only from the final report.

## Background

The five existing scorers attach to the **synthesizer** and grade its text output (`run.output`) asynchronously for dashboards. They cannot grade the researcher's findings: the researcher's output is tool calls + a completion signal, and the findings live in the typed working-memory (WM) document, not in any agent's text output.

The deterministic deficit gate (`research-iteration.step.ts`) already enforces *minimums* (≥3 trends, ≥3 competitors, ≥2 ICPs, ≥5 sources, quant-trend triangulation) and A9 added a corroboration gate. A6 is **not** another gate — it is richer *observability*: exact metrics computed once from the final WM, surfaced as a log signal. The metrics from the 06-03 list are all deterministic counts over the typed WM, so no LLM judge is needed.

## Scope

In scope:
- A pure `computeResearchMetrics(memory): ResearchMetrics` over the WM document.
- A deterministic workflow step `recordResearchMetrics` inserted between the research loop and synthesis: reads WM, computes the metrics, logs them structured, passes the iteration state through unchanged.
- Vitest tests for the pure metric function.

The metric set (decided):
- **findingDensity** — `{ trends, competitors, icps, sources, openQuestions }` (section counts).
- **sourceDiversityByClassifier** — a count per `classifier` value over `sourcesConsulted` (`{ government, analyst, consulting, 'trade-press', 'sec-filing', 'company-ir', vendor, other }`) plus `distinctClassifiers` (how many classifier types are present).
- **triangulationRate** — fraction of quantitative trends (claim/evidence matching `/\$|\d+(?:\.\d+)?\s*%/`) that are corroborated by another trend citing a different `sourceUrl` AND a different `publisher`. No quantitative trends → `1` (nothing to triangulate).
- **authoritativeRatio** — fraction of `sourcesConsulted` whose `classifier` is not `vendor`/`other`. No sources → `0`.

Out of scope (deliberately):
- **Gating** — the deficit gate already enforces minimums; A6 only measures.
- **LLM-judge research scorers** — the chosen metrics are exact counts.
- **Persisting metrics to Mastra storage / dashboard integration** — v1 is a structured log; persistence can come later.
- **Changing the workflow output** (`reportSchema`) or the researcher/synthesizer agents.
- **Refactoring the deficit gate.** A6 is purely additive (new files + one `.then` insertion); the gate's quantitative-trend predicate is intentionally re-implemented in the metrics module rather than extracted, to avoid touching working gate code. (Extract later if a third consumer appears.)

## Approach

### Pure core — `src/mastra/workflows/vertical-entry/research-metrics.ts`

```ts
interface ResearchMetrics {
  findingDensity: { trends: number; competitors: number; icps: number; sources: number; openQuestions: number };
  sourceDiversityByClassifier: Record<string, number>; // classifier → count (only present classifiers)
  distinctClassifiers: number;
  triangulationRate: number;   // 0..1; 1 when there are no quantitative trends
  authoritativeRatio: number;  // 0..1; 0 when there are no sources
}

function computeResearchMetrics(memory: ResearchMemory): ResearchMetrics
```

- `findingDensity` = the array lengths.
- `sourceDiversityByClassifier` = reduce `sourcesConsulted` into a `classifier → count` map; `distinctClassifiers` = number of keys.
- `triangulationRate` = over trends where `QUANT_CLAIM_REGEX` matches `claim` or `evidence`: the fraction with ≥1 other quantitative trend at a different `sourceUrl` and different `publisher`. Empty quant set → `1`.
- `authoritativeRatio` = `count(classifier ∉ {vendor, other}) / sourcesConsulted.length`; empty → `0`.

Pure, total, no I/O — Vitest-tested.

### Workflow step — `src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts`

A `createStep` with `inputSchema = outputSchema = iterationStateSchema`. Its `execute` reads the WM (`readResearchMemory(runId, 'default')`), computes the metrics, logs them, and returns `inputData` unchanged:

```ts
const metrics = computeResearchMetrics(await readResearchMemory(runId, 'default'));
logger.info({ researchMetrics: metrics }, 'research quality metrics');
return inputData;
```

Wired into the workflow chain in `src/mastra/workflows/vertical-entry/index.ts`:

```
.then(prepareResearch)
.dountil(runResearchIteration, …)
.then(recordResearchMetrics)   // ← new, additive
.then(runSynthesis)
```

The step is pass-through, so `runSynthesis` still receives the same iteration state; no other step/schema changes.

## Data flow

research loop → `recordResearchMetrics` reads the final WM once → `computeResearchMetrics` → structured log line → unchanged state forwarded to `runSynthesis`. Synthesis and the async report scorers are unaffected.

## Error handling

- `computeResearchMetrics` is pure and total over a schema-valid `ResearchMemory` (empty arrays yield zero counts, `triangulationRate = 1`, `authoritativeRatio = 0`). No new throws.
- The step relies on `readResearchMemory`, which already throws if WM is missing/malformed — the same contract the synthesis step depends on; A6 adds no new failure mode.

## Invariants / constraints

- Node `>=22.13.0`; TS ES2022, strict. Pure code is Vitest-tested.
- A6 is additive: new metric module + new step + one `.then` insertion + step registration if needed. No gate refactor, no agent change, no output-schema change.
- Deterministic — same WM, same metrics. No LLM.
- The step is pure pass-through on the iteration state; it only logs.

## Testing & verification

- **Vitest** for `computeResearchMetrics`: empty WM → zero density, `{}` diversity, `distinctClassifiers: 0`, `triangulationRate: 1`, `authoritativeRatio: 0`; a WM with a classifier mix → correct per-classifier counts + `authoritativeRatio` (e.g. 2 of 3 non-vendor → 0.66…); two quant trends with different sourceUrl+publisher → `triangulationRate: 1`; a lone quant trend → `triangulationRate: 0`; a non-quant-only WM → `triangulationRate: 1`.
- `npx tsc --noEmit` + `npm run build`.
- **E2E (optional / deferred to the user's next real run):** confirm the `research quality metrics` log line appears once per run with plausible values. The metric math is fully unit-covered, so e2e is a sanity check, not the proof.

## Risks

- **Metric definitions drift from the gate's** (e.g. triangulation). Because the gate predicate is re-implemented (not shared), a future gate change wouldn't auto-propagate. Accepted for v1 (additive, low-risk); the duplication is ~a few lines and noted for a later extract.
- **Log-only means metrics aren't queryable/aggregated.** Intentional for v1; persistence/dashboard is a deferred follow-up if the signal proves useful.
