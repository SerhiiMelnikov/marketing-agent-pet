# Source corroboration & includeDomains enforcement (A9) — design

**Date:** 2026-06-23
**Status:** Approved
**Branch:** `feat/source-corroboration`
**Backlog item:** A9 — denylist completeness / vendor-marketing leakage (the
remaining half of B2). Pairs with A2 (code-enforced exclude denylist, merged).

## Goal

Stop unknown vendor-marketing / "best-of" listicle sources from leaking into the
report as competitors or trends. A static exclude denylist (A2) cannot catch
unknown sites (elevancesystems.com, carelonglobal.com, aerance.com,
bgbizsolutionsinc.com — all observed leaking on the 2026-06-17 trace). Replace
"enumerate bad domains" with two deterministic, source-quality mechanisms that
need no per-site maintenance.

## Problem (from the 2026-06-17 trace)

1. **`includeDomains` is soft.** The researcher passed
   `includeDomains=[gartner, everestgrp, healthcareitnews, fiercehealthcare]`
   yet Exa returned elevancesystems.com, carelonglobal.com, aerance.com,
   bgbizsolutionsinc.com. The provider treats `includeDomains` as a ranking
   hint, not a hard filter.
2. **The gate counts, it does not weigh.** `collectDeficits` requires ≥3 trends,
   ≥3 competitors, ≥2 ICPs, ≥5 sources, plus quantitative-trend triangulation —
   but never inspects source authority. A competitor sourced only from its own
   vendor-marketing page passes. The finance report did exactly this: a
   quantitative trend "triangulated" across two SEO vendors (WiseGuyReports +
   Technavio).

The working-memory schema already carries a per-source `classifier`
(`government | analyst | consulting | trade-press | sec-filing | company-ir |
vendor | other`), self-reported by the researcher in `sourcesConsulted`. It is
currently unused by any gate or scorer. This design puts it to work.

## Scope

In scope — two independent deterministic levers plus one shared core:

- **Lever A — search-time hard-enforce `includeDomains`.** In the `search()`
  chokepoint, when the agent passed `includeDomains`, drop any result whose host
  is not within that list (subdomain-aware). Zero false-positive risk: it is the
  agent's own intent.
- **Lever B — corroboration gate on competitors and trends.** A competitor or
  market trend must cite ≥1 **authoritative** source (classifier ∉
  `{vendor, other}`), cross-referenced through `sourcesConsulted`. Uncorroborated
  items become deficits that drive the existing re-research loop; survivors after
  the attempt cap are flagged (not dropped) so the synthesizer routes them to
  "Confidence & Gaps".
- **Shared core — `assessCorroboration(memory)`.** One pure function, used by
  both the gate (Lever B) and the synthesis flag, so the corroboration verdict
  has a single source of truth.

Out of scope (deliberately):

- **Open-discovery allowlist / heuristic content classifier.** Discovery
  searches stay fully open web; quality is enforced downstream by the
  corroboration gate, not by guessing which results "read like" marketing.
- **Schema change.** No new field on competitor/trend. The flag is computed
  deterministically at synthesis time and passed via the prompt (see Lever B).
- **ICPs.** ICPs are syntheses, not direct sourced facts; corroborating them
  risks blocking legitimate work.
- **Changing A2's exclude denylist, the model router, or scorers.**

## Approach

### Lever A — hard-enforce `includeDomains` (search module)

New pure function in `src/modules/search/domain-presets.ts`:

```
enforceIncludeDomains(results: SearchResult[], includeDomains?: string[]): SearchResult[]
```

- If `includeDomains` is empty/undefined → return `results` unchanged (no-op;
  this is the open-discovery path).
- Otherwise keep only results whose normalized host equals one of the
  (normalized) include domains OR is a subdomain of it (`host === d ||
  host.endsWith('.' + d)`). Reuse the existing `normalizeHost` (lowercases,
  strips `www.`).

Wire into `search()` (`src/modules/search/index.ts`). `withDefaultExcludes`
touches only `excludeDomains`, so `query.includeDomains` is still the agent's
original list:

```
return capResultContent(deprioritizeGated(enforceIncludeDomains(results, query.includeDomains)));
```

### Lever B — corroboration core + gate + flag

**Shared core** — new file
`src/mastra/workflows/vertical-entry/corroboration.ts`:

```
const AUTHORITATIVE_CLASSIFIERS: ReadonlySet<string> // all classifiers except 'vendor' and 'other'

interface CorroborationVerdict { label: string; corroborated: boolean }
interface CorroborationReport { competitors: CorroborationVerdict[]; trends: CorroborationVerdict[]; }

function assessCorroboration(m: ResearchMemory): CorroborationReport
```

Mechanics:

- Build a map `url(normalized) → classifier` from `m.sourcesConsulted`.
- A **competitor** is corroborated when ≥1 URL in `competitor.sources` resolves
  (by normalized-URL match) to a classifier in `AUTHORITATIVE_CLASSIFIERS`.
- A **trend** is corroborated when its single `sourceUrl` resolves to an
  authoritative classifier.
- A URL absent from `sourcesConsulted` → unknown → treated as non-authoritative
  (conservative; also nudges the researcher to classify every source).
- `label` is the competitor name / a truncated trend claim, for messages.
- URL normalization: lowercase, strip trailing slash; reuse/adapt the search
  `normalizeHost` style at the URL level so trivial formatting differences match.

**Gate** — `collectDeficits` in
`src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`. After the
existing count/triangulation checks, call `assessCorroboration(m)` and for each
uncorroborated verdict push a deficit with **two outs** so the researcher can
clear it by fixing OR removing:

```
competitor "Elevance Systems": only vendor/other-classified sources — add an
  analyst / trade-press / government / SEC source, OR remove it if unverifiable
marketTrend "US RCM outsourcing to grow…": source is vendor/other — ground it
  in an analyst/government source, OR drop the claim
```

These deficits already flow into `buildIterationPrompt` ("Address these gaps")
and the `dountil` loop (`MAX_ATTEMPTS = 3`). No workflow/loop change.

**Flag** — synthesis step `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`.
Before invoking the synthesizer, recompute `assessCorroboration(memory)` and, if
any verdict is still uncorroborated, inject a block into the synthesizer prompt:

```
The following findings lack an authoritative source (only vendor/self-marketing).
Present them under "Confidence & Gaps" as unverified — NOT as confirmed competitors/trends:
  - competitor: Elevance Systems
  - trend: US RCM outsourcing to grow…
```

The synthesizer is grounded strictly in working memory; this prompt block is the
deterministic instruction that keeps an uncorroborated survivor out of the
"confirmed" sections without mutating WM or the schema.

**Researcher prompt** — `src/mastra/agents/researcher.ts`, two small additions:

- `includeDomains` is now hard-enforced: passing a too-narrow list yields few/no
  results; drop or widen it for discovery.
- Every competitor and every trend needs ≥1 authoritative (non-vendor) source;
  classify each source honestly in `sourcesConsulted`.

## Data flow

```
researcher → WM
   │
   ├─ search(): enforceIncludeDomains (Lever A) drops off-list hits before they
   │            ever enter the researcher's context
   │
   └─ research-iteration: collectDeficits → assessCorroboration → corroboration
            deficits → buildIterationPrompt → dountil re-research (≤3)
                 │
                 ▼  (deficits cleared OR cap reached)
            synthesize: assessCorroboration again → uncorroborated survivors
                 injected as a "Confidence & Gaps" instruction → synthesizer
```

## Error handling

- All new logic is pure and total over a schema-valid `ResearchMemory` /
  `SearchResult[]`. No new throws.
- `enforceIncludeDomains` returning `[]` (every hit off-list) is valid and
  intended — the researcher adapts (widen / drop includeDomains).
- Malformed/absent competitor source URLs are simply non-authoritative, never a
  crash.

## Invariants / constraints

- Authoritative ≡ classifier ∉ `{vendor, other}`. `company-ir` / `sec-filing`
  of the competitor itself counts (official source).
- Lever A only ever filters; never reorders within the kept set (that stays with
  `deprioritizeGated`) and never touches `excludeDomains`.
- `assessCorroboration` is the single source of truth for both the gate and the
  flag — never duplicated.
- No schema change; WM is never mutated by the gate or the synthesis step.
- Researcher-only + workflow-step changes; synthesizer gets prompt input only.

## Testing & verification

No unit-test harness (backlog A4). Verification:

1. **Pure-function assertion harness** (esbuild-bundled, no network, as used for
   A7): `enforceIncludeDomains` — subdomain match, `www.` normalization, empty
   list = no-op, all-off-list = `[]`; `assessCorroboration` — vendor-only → not
   corroborated, ≥1 analyst → corroborated, competitor URL absent from
   `sourcesConsulted` → not corroborated, trend authoritative/unauthoritative.
2. `npx tsc --noEmit` + `npm run build`.
3. **E2E run** (healthcare/onix) against the 2026-06-17 leak baseline: confirm
   (a) includeDomains-bearing searches return only on-list hosts, (b)
   uncorroborated competitors receive re-research deficits, (c) any survivors
   appear under "Confidence & Gaps", not as confirmed competitors/trends.

## Risks

- **More iterations → more cost.** Corroboration deficits can push runs from 1 to
  2–3 researcher iterations. Mitigated by the "OR remove it" out (clearing junk
  is cheaper than sourcing it) and the existing `MAX_ATTEMPTS = 3` cap.
- **Self-classification trust.** The gate trusts the researcher's `classifier`.
  A mislabel (vendor page tagged `analyst`) would pass. Acceptable for now;
  a future research-quality scorer (backlog A6) could audit classification.
- **Over-narrow includeDomains starving a search.** Real but self-correcting —
  the researcher sees empty results and adapts; called out in its prompt.
