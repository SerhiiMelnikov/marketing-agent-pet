# Per-vertical source-bias config (A3) — design

**Date:** 2026-06-23
**Status:** Approved
**Branch:** `feat/per-vertical-bias` (off main @ a2773d2)
**Backlog item:** A3 — the researcher's authoritative-domain bias is hardcoded and healthcare-leaning, even though the system already runs finance and build-to-rent. Generalize it to a per-vertical config.

## Goal

Make the researcher's "Strongly prefer" authoritative-domain bias vary by vertical, so a finance or build-to-rent run is steered toward finance/BTR government + trade-press sources instead of the hardcoded healthcare ones — without changing the brief contract, breaking the A8 prompt cache, or touching the generic exclude denylist.

## Problem

The researcher instructions (`src/mastra/agents/researcher.ts`) hardcode a five-category "Source bias" block. Two categories are vertical-specific and currently healthcare-only:
- **Primary government / regulatory** — hhs.gov, cms.gov, healthit.gov, fda.gov, …
- **Trade press** — healthcareitnews.com, fiercehealthcare.com, beckershospitalreview.com, …

The other three are effectively vertical-agnostic and should stay shared:
- **SEC filings & official corporate** — sec.gov, `investor.*` / `ir.*`
- **Analyst firms** — gartner.com, forrester.com, idc.com, everestgrp.com, hfsresearch.com
- **Consulting publications** — deloitte.com, mckinsey.com, bcg.com, bain.com, capgemini.com, accenture.com

On a finance/BTR run the researcher is told to prefer healthcare regulators and trade press, which biases discovery toward the wrong sources.

## Scope

In scope:
- A new `src/modules/verticals/` module (mirroring `src/modules/companies/`) holding one config per vertical plus a shared baseline, and a deterministic resolver.
- Splitting the researcher's static bias block: keep the **rules** in instructions; move the **domain lists** to runtime injection built from the resolved vertical.
- Resolving the vertical once per run in `prepareResearch` and threading the rendered bias into the dynamic iteration prompt.

Out of scope (deliberately):
- **Brief contract change** — the brief stays `{ vertical, companyKey }`; resolution is keyword/alias-based on the existing free-text `vertical`.
- **Exclude denylist** — A2's generic `DEFAULT_EXCLUDE_DOMAINS` is vertical-agnostic and unchanged. A3 is the include/prefer side only.
- **LLM classification** of the vertical (non-deterministic; overkill for a handful of verticals).
- Renaming the `vertical-entry` workflow/files.

## Approach

### Config module — `src/modules/verticals/`

Mirror `companies/`: `types.ts`, one file per vertical (`healthcare.ts`, `finance.ts`, `btr.ts`), `index.ts` with `init()` + the resolver.

```ts
// types.ts
export interface VerticalBias {
  key: string;            // 'healthcare'
  aliases: string[];      // lowercased keywords matched as substrings of the brief's vertical text
  government: string[];   // vertical-specific government / regulatory domains
  tradePress: string[];   // vertical-specific trade-press domains
  analysts?: string[];    // optional vertical-specific analyst firms (merged on top of the shared core)
}
```

A shared baseline lives alongside (`shared.ts`), NOT duplicated per vertical:

```ts
export const SHARED_BIAS = {
  secAndCorporate: ['sec.gov', 'investor.*', 'ir.*'],
  analysts: ['gartner.com', 'forrester.com', 'idc.com', 'everestgrp.com', 'hfsresearch.com'],
  consulting: ['deloitte.com', 'mckinsey.com', 'bcg.com', 'bain.com', 'capgemini.com', 'accenture.com'],
};
```

Starter vertical lists (refinable; finance/BTR mined from the existing sample reports in `docs/results/`):
- **healthcare** — gov: hhs.gov, cms.gov, healthit.gov, fda.gov, federalregister.gov, gao.gov, ftc.gov; trade: healthcareitnews.com, fiercehealthcare.com, beckershospitalreview.com, himss.org, modernhealthcare.com, statnews.com. aliases: healthcare, health, hospital, clinical, hipaa, payer, provider, ehr, hl7, fhir.
- **finance** — gov: federalreserve.gov, occ.gov, fdic.gov, consumerfinance.gov, sec.gov, finra.org, federalregister.gov; trade: americanbanker.com, bankingdive.com, finextra.com, thefinancialbrand.com. aliases: finance, financial, bank, banking, fintech, credit union, payments, lending, wealth.
- **btr** — gov: hud.gov, census.gov, fhfa.gov, federalreserve.gov; trade: housingwire.com, multifamilydive.com, nmhc.org, uli.org, rentcafe.com. aliases: build-to-rent, build to rent, btr, multifamily, rental housing, single-family rental, sfr, housing.

### Resolver (deterministic, pure)

In `src/modules/verticals/index.ts`:

```ts
resolveVerticalBias(verticalText: string): ResolvedBias
```

- Lowercase the input; return the first registered config whose any `alias` is a substring of it.
- On a match: merge `SHARED_BIAS` + the vertical's `government` / `tradePress` / `analysts` into a `ResolvedBias` (the union of authoritative domains, grouped by category for rendering).
- On no match: return `SHARED_BIAS` only and `logger.warn` that no vertical config matched the text (fail-soft — the run still works, just without the vertical-specific gov/trade-press boost).

`ResolvedBias` also exposes a `render(): string` (or a sibling pure `renderSourceBias(bias)`) producing the markdown bias block the prompt injects.

### Researcher prompt split

- Remove the five-category domain list from the static `instructions` template. Keep the rules paragraphs (hard-enforce, authoritative-source requirement). Add a one-line pointer: the vertical-specific authoritative domains appear in the brief below.
- The A8 static-prefix cache breakpoint stays on the (now domain-list-free) instructions — its prefix changes once, then is stable again.

### Threading through the workflow

- `prepareResearch` resolves the bias once (`resolveVerticalBias(inputData.vertical)`), renders the block, and adds it to the iteration state as a new field `sourceBias: string` (added to `iterationStateSchema`).
- `buildIterationPrompt` (in `research-iteration.step.ts`) injects `state.sourceBias` into the dynamic prompt it already builds. Resolved once, reused across iterations.
- The synthesizer is untouched (no web access, no domain bias needed).
- `verticals.init()` is registered at startup alongside `companies.init()` (in `src/mastra/index.ts` or wherever module inits run).

## Data flow

`brief.vertical` → `prepareResearch`: `resolveVerticalBias(vertical)` → rendered bias block in `iterationState.sourceBias` → `buildIterationPrompt` injects it into the researcher's dynamic prompt each iteration → researcher passes the vertical-appropriate domains as `includeDomains` (hard-enforced by A9). Static instructions (rules only) stay cached.

## Error handling

- Unknown vertical → fail-soft to `SHARED_BIAS` + a logged warning (never throws).
- An empty/whitespace vertical string → same generic fallback (no alias will match).
- No new throw paths.

## Invariants / constraints

- Brief contract `{ vertical, companyKey }` unchanged.
- Shared domains defined once (`SHARED_BIAS`), never copied into a vertical file.
- Only the include/prefer bias is per-vertical; the exclude denylist (A2) stays generic.
- A8 static-prefix cache integrity preserved (no per-run content in static instructions).
- Resolver is pure and deterministic — same input, same output.

## Testing & verification

- **Vitest unit tests** (A4 is now in main) for `resolveVerticalBias`: healthcare/finance/btr alias matches, case-insensitivity, substring match within a longer phrase ("healthcare IT outsourcing" → healthcare), unknown → generic + warning, and that a matched result includes both shared and vertical-specific domains.
- `npx tsc --noEmit` + `npm run build`.
- **E2E run on finance/onix** (finance has never been run e2e here): confirm the researcher's searches carry finance government/trade-press domains (americanbanker, federalreserve, …), NOT healthcare ones, and the report stays coherent.

## Risks

- **Starter domain lists are imperfect.** They are data, not structure; refine after the finance/BTR e2e shows what actually surfaces. The design's value is the structure + resolver, not the exact lists.
- **Alias collision** (a vertical string matching two configs). Mitigated by first-match order and keeping aliases specific; if two ever collide, registration order decides and the resolver is easy to make stricter later.
- **Prompt-cache cost shift.** Moving ~30 lines of domains from cached instructions to the uncached user prompt adds a small per-step token cost; negligible versus the research-content payload, and correctness (right vertical) outweighs it.
