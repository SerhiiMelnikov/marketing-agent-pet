# Per-vertical source-bias config (A3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the researcher's authoritative-domain bias vary by vertical (healthcare / finance / build-to-rent), resolved deterministically from the brief's free-text `vertical` and injected into the dynamic prompt, so non-healthcare runs are steered to the right sources.

**Architecture:** A new pure `src/modules/verticals/` module (mirroring `companies/`) holds per-vertical domain configs + a shared baseline + a `resolveVerticalBias` resolver and a `renderSourceBias` renderer. The researcher's static instructions keep the rules but lose the hardcoded domain lists; `prepareResearch` resolves the bias once and threads the rendered block through the iteration state into the researcher's dynamic prompt.

**Tech Stack:** TypeScript (ES2022, strict, `moduleResolution: bundler`), Vitest, Mastra workflows, Node `>=22.13.0`.

## Global Constraints

- Node `>=22.13.0`; TypeScript ES2022, strict. Tests are Vitest (`*.test.ts`, co-located, `import { describe, it, expect } from 'vitest'`).
- Brief contract `{ vertical, companyKey }` is UNCHANGED. Resolution is keyword/alias substring matching on the free-text `vertical`.
- Shared domains (`SEC` / analysts / consulting) are defined ONCE in `shared.ts` and never copied into a vertical file.
- Only the include/prefer bias is per-vertical; the A2 exclude denylist stays generic and untouched.
- The A8 static-prefix cache breakpoint on the researcher `instructions` must stay intact — no per-run content goes into the static instructions; the vertical bias goes into the DYNAMIC iteration prompt.
- `resolveVerticalBias` and `renderSourceBias` are PURE (no logging, no I/O) so they are unit-testable; the fallback warning is logged by the caller (`prepareResearch`).
- The researcher instructions are a template literal — any literal backtick in edited prompt text stays escaped as `` \` ``.

**Spec:** `docs/superpowers/specs/2026-06-23-per-vertical-bias-design.md`

> **Spec deviation (deliberate):** the spec mentioned a `verticals.init()` registered at startup like `companies.init()`. This plan uses a module-level `const VERTICALS = [...]` registry instead — the configs are static, so no init/lifecycle is needed and the resolver stays pure and testable without setup. No `mastra/index.ts` init wiring is required.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/modules/verticals/types.ts` | `VerticalBias`, `ResolvedBias` interfaces | Create |
| `src/modules/verticals/shared.ts` | Shared SEC / analyst / consulting domain constants | Create |
| `src/modules/verticals/healthcare.ts` | Healthcare `VerticalBias` | Create |
| `src/modules/verticals/finance.ts` | Finance `VerticalBias` | Create |
| `src/modules/verticals/btr.ts` | Build-to-rent `VerticalBias` | Create |
| `src/modules/verticals/index.ts` | `resolveVerticalBias` + `renderSourceBias` over a module-level registry | Create |
| `src/modules/verticals/index.test.ts` | Unit tests for resolver + renderer | Create |
| `src/mastra/agents/researcher.ts` | Drop hardcoded domain lists, add a pointer to the injected block | Modify |
| `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts` | `sourceBias` state field; resolve+render bias; warn on fallback | Modify |
| `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts` | Inject `state.sourceBias` into the iteration prompt | Modify |

---

## Task 1: The `verticals` module (config + resolver + renderer + tests)

**Files:**
- Create: `src/modules/verticals/types.ts`, `shared.ts`, `healthcare.ts`, `finance.ts`, `btr.ts`, `index.ts`, `index.test.ts`

**Interfaces:**
- Produces:
  - `interface VerticalBias { key: string; aliases: string[]; government: string[]; tradePress: string[]; analysts?: string[] }`
  - `interface ResolvedBias { matchedKey: string | null; government: string[]; secAndCorporate: string[]; analysts: string[]; consulting: string[]; tradePress: string[] }`
  - `resolveVerticalBias(verticalText: string): ResolvedBias`
  - `renderSourceBias(bias: ResolvedBias): string`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/verticals/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveVerticalBias, renderSourceBias } from './index';

describe('resolveVerticalBias', () => {
  it('matches healthcare from a longer phrase and merges shared + vertical domains', () => {
    const b = resolveVerticalBias('healthcare IT outsourcing');

    expect(b.matchedKey).toBe('healthcare');
    expect(b.government).toContain('cms.gov');
    expect(b.tradePress).toContain('fiercehealthcare.com');
    expect(b.analysts).toContain('gartner.com'); // shared
    expect(b.analysts).toContain('klasresearch.com'); // vertical-specific, merged
    expect(b.secAndCorporate).toContain('sec.gov'); // shared
  });

  it('matches finance', () => {
    const b = resolveVerticalBias('retail banking and fintech');

    expect(b.matchedKey).toBe('finance');
    expect(b.government).toContain('federalreserve.gov');
    expect(b.tradePress).toContain('americanbanker.com');
  });

  it('matches build-to-rent', () => {
    const b = resolveVerticalBias('build-to-rent housing');

    expect(b.matchedKey).toBe('btr');
    expect(b.government).toContain('hud.gov');
  });

  it('is case-insensitive', () => {
    expect(resolveVerticalBias('HEALTHCARE').matchedKey).toBe('healthcare');
  });

  it('falls back to generic shared bias (null key, empty gov/trade) on no match', () => {
    const b = resolveVerticalBias('underwater basket weaving');

    expect(b.matchedKey).toBeNull();
    expect(b.government).toEqual([]);
    expect(b.tradePress).toEqual([]);
    expect(b.analysts).toContain('gartner.com'); // shared still present
    expect(b.consulting).toContain('mckinsey.com');
  });
});

describe('renderSourceBias', () => {
  it('renders matched categories and omits empty ones', () => {
    const out = renderSourceBias(resolveVerticalBias('healthcare IT'));

    expect(out).toContain('## Authoritative source bias');
    expect(out).toContain('cms.gov');
    expect(out).toContain('Trade press');
    expect(out).toContain('fiercehealthcare.com');
  });

  it('omits government and trade-press lines for the generic fallback', () => {
    const out = renderSourceBias(resolveVerticalBias('unknown vertical'));

    expect(out).not.toContain('Primary government');
    expect(out).not.toContain('Trade press');
    expect(out).toContain('Analyst firms'); // shared category still rendered
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/verticals/index.test.ts`
Expected: FAIL — cannot resolve `./index` (module not created yet).

- [ ] **Step 3: Create `types.ts`**

```ts
// src/modules/verticals/types.ts

export interface VerticalBias {
  key: string;
  /** Lowercased keywords matched as substrings of the brief's free-text vertical. */
  aliases: string[];
  government: string[];
  tradePress: string[];
  /** Optional vertical-specific analyst firms, merged on top of the shared core. */
  analysts?: string[];
}

export interface ResolvedBias {
  /** The matched vertical key, or null when no config matched (generic fallback). */
  matchedKey: string | null;
  government: string[];
  secAndCorporate: string[];
  analysts: string[];
  consulting: string[];
  tradePress: string[];
}
```

- [ ] **Step 4: Create `shared.ts`**

```ts
// src/modules/verticals/shared.ts

/** Vertical-agnostic authoritative domains, shared by every resolved bias. */
export const SHARED_SEC_AND_CORPORATE = ['sec.gov', 'investor.*', 'ir.*'];
export const SHARED_ANALYSTS = [
  'gartner.com',
  'forrester.com',
  'idc.com',
  'everestgrp.com',
  'hfsresearch.com',
];
export const SHARED_CONSULTING = [
  'deloitte.com',
  'mckinsey.com',
  'bcg.com',
  'bain.com',
  'capgemini.com',
  'accenture.com',
];
```

- [ ] **Step 5: Create the three vertical configs**

`src/modules/verticals/healthcare.ts`:

```ts
import type { VerticalBias } from './types';

export const HEALTHCARE: VerticalBias = {
  key: 'healthcare',
  aliases: ['healthcare', 'health', 'hospital', 'clinical', 'hipaa', 'payer', 'provider', 'ehr', 'hl7', 'fhir'],
  government: ['hhs.gov', 'cms.gov', 'healthit.gov', 'fda.gov', 'federalregister.gov', 'gao.gov', 'ftc.gov'],
  tradePress: ['healthcareitnews.com', 'fiercehealthcare.com', 'beckershospitalreview.com', 'himss.org', 'modernhealthcare.com', 'statnews.com'],
  analysts: ['klasresearch.com'],
};
```

`src/modules/verticals/finance.ts`:

```ts
import type { VerticalBias } from './types';

export const FINANCE: VerticalBias = {
  key: 'finance',
  aliases: ['finance', 'financial', 'bank', 'banking', 'fintech', 'credit union', 'payments', 'lending', 'wealth'],
  government: ['federalreserve.gov', 'occ.gov', 'fdic.gov', 'consumerfinance.gov', 'sec.gov', 'finra.org', 'federalregister.gov'],
  tradePress: ['americanbanker.com', 'bankingdive.com', 'finextra.com', 'thefinancialbrand.com'],
};
```

`src/modules/verticals/btr.ts`:

```ts
import type { VerticalBias } from './types';

export const BTR: VerticalBias = {
  key: 'btr',
  aliases: ['build-to-rent', 'build to rent', 'btr', 'multifamily', 'rental housing', 'single-family rental', 'sfr', 'housing'],
  government: ['hud.gov', 'census.gov', 'fhfa.gov', 'federalreserve.gov'],
  tradePress: ['housingwire.com', 'multifamilydive.com', 'nmhc.org', 'uli.org', 'rentcafe.com'],
};
```

- [ ] **Step 6: Create `index.ts`**

```ts
// src/modules/verticals/index.ts

import type { VerticalBias, ResolvedBias } from './types';
import { SHARED_SEC_AND_CORPORATE, SHARED_ANALYSTS, SHARED_CONSULTING } from './shared';
import { HEALTHCARE } from './healthcare';
import { FINANCE } from './finance';
import { BTR } from './btr';

export type { VerticalBias, ResolvedBias } from './types';

/** First-match wins; keep aliases specific to avoid collisions. */
const VERTICALS: VerticalBias[] = [HEALTHCARE, FINANCE, BTR];

/**
 * Resolve the brief's free-text vertical to an authoritative-domain bias.
 * Pure: on no match it returns the shared baseline with `matchedKey: null`;
 * the caller decides whether to warn.
 */
export function resolveVerticalBias(verticalText: string): ResolvedBias {
  const text = verticalText.toLowerCase();
  const match = VERTICALS.find((v) => v.aliases.some((a) => text.includes(a)));

  return {
    matchedKey: match?.key ?? null,
    government: match?.government ?? [],
    secAndCorporate: SHARED_SEC_AND_CORPORATE,
    analysts: [...SHARED_ANALYSTS, ...(match?.analysts ?? [])],
    consulting: SHARED_CONSULTING,
    tradePress: match?.tradePress ?? [],
  };
}

/** Render the resolved bias as the markdown block injected into the researcher's
 *  dynamic prompt. Empty categories (e.g. gov/trade on the generic fallback) are
 *  omitted. */
export function renderSourceBias(bias: ResolvedBias): string {
  const line = (label: string, domains: string[]) =>
    domains.length ? `  - **${label}**: ${domains.join(', ')}` : null;

  const categories = [
    line('Primary government / regulatory', bias.government),
    line('SEC filings & official corporate', bias.secAndCorporate),
    line('Analyst firms', bias.analysts),
    line('Consulting publications', bias.consulting),
    line('Trade press', bias.tradePress),
  ].filter((l): l is string => l !== null);

  return [
    '## Authoritative source bias',
    '',
    '**Strongly prefer** these domains — pass the relevant subset as `includeDomains` per query (government first, then analyst / consulting / trade press). `includeDomains` is hard-enforced, so a too-narrow list returns few results; widen or omit for open discovery. For consulting, use insights/research articles only — not /services/ or /solutions/ pages.',
    '',
    ...categories,
  ].join('\n');
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/modules/verticals/index.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/modules/verticals/
git commit -m "feat(verticals): per-vertical source-bias config + resolver"
```

---

## Task 2: Drop hardcoded domain lists from the researcher instructions

**Files:**
- Modify: `src/mastra/agents/researcher.ts`

**Interfaces:** none (prompt copy only). The instructions are a template literal — keep literal backticks escaped as `` \` ``.

- [ ] **Step 1: Replace the domain catalog with a pointer**

In `src/mastra/agents/researcher.ts`, the `### Source bias` block currently opens with the `**Strongly prefer**` intro followed by five domain-category bullets, ending at the `**Trade press**: …statnews.com` line. Replace that whole span — from `**Strongly prefer** (pass these in` through the trade-press bullet ending `…statnews.com` — with this pointer (leave the `### Source bias` heading line and everything from the `Low-signal sources …` paragraph onward unchanged):

```
A vertical-specific list of authoritative domains to **strongly prefer** is
provided in the brief below under "Authoritative source bias". Pass the relevant
subset as \`includeDomains\` per query (government first, then analyst /
consulting / trade press).
```

After the edit, the block reads:

```
### Source bias

A vertical-specific list of authoritative domains to **strongly prefer** is
provided in the brief below under "Authoritative source bias". Pass the relevant
subset as \`includeDomains\` per query (government first, then analyst /
consulting / trade press).

Low-signal sources (SEO market-report vendors, vendor-marketing
"best-of" listicles) are filtered out of every search automatically —
you do not need to list them in \`excludeDomains\`.

\`includeDomains\` is now **hard-enforced**: results outside the domains you
pass are dropped before you ever see them. A too-narrow list returns few or no
results — widen it, or omit it for open discovery.
... (the authoritative-source-requirement paragraph stays unchanged) ...
```

Do not change any other part of the instructions, the `providerOptions` cacheControl, or the agent config.

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. (A build failure almost certainly means an unescaped backtick — re-check the escapes.)

- [ ] **Step 3: Commit**

```bash
git add src/mastra/agents/researcher.ts
git commit -m "refactor(researcher): move domain bias out of static instructions to a per-vertical injected block"
```

---

## Task 3: Thread the resolved bias through the workflow

**Files:**
- Modify: `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`

**Interfaces:**
- Consumes: `resolveVerticalBias`, `renderSourceBias` from `../../../../modules/verticals` (Task 1).
- Produces: `iterationStateSchema` gains `sourceBias: z.string()`; the researcher's iteration prompt carries the bias block.

- [ ] **Step 1: Add `sourceBias` to the iteration state and seed it in `prepareResearch`**

In `src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts`:

(a) Add imports below the existing `env` import:

```ts
import { resolveVerticalBias, renderSourceBias } from '../../../../modules/verticals';
import { logger } from '../../../../utils/logger';
```

(b) In `iterationStateSchema`, add this field immediately after `companyVerified: z.string(),`:

```ts
  sourceBias: z.string(),
```

(c) In `prepareResearch`'s `execute`, after the `profile` is resolved (right before the `return Promise.resolve({`), insert:

```ts
    const bias = resolveVerticalBias(inputData.vertical);
    if (!bias.matchedKey) {
      logger.warn(
        `No vertical config matched "${inputData.vertical}" — using generic shared source bias only.`,
      );
    }
```

(d) In the returned object, add this field immediately after `companyVerified: profile.lastVerified,`:

```ts
      sourceBias: renderSourceBias(bias),
```

- [ ] **Step 2: Inject `sourceBias` into the iteration prompt**

In `src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts`, in `buildIterationPrompt`:

(a) Add `sourceBias: string;` to the `state` parameter's inline type, immediately after `companyVerified: string;`:

```ts
  state: {
    vertical: string;
    companyName: string;
    companyFacts: string;
    companyVerified: string;
    sourceBias: string;
  },
```

(b) In the returned template literal, insert the bias block between the `${progressBlock}${deficitsBlock}` line and the `Populate working memory…` line. The current tail is:

```ts
${progressBlock}${deficitsBlock}

Populate working memory with structured findings.${findingsNote} When done, emit your completion signal in exactly this shape:
```

Change it to:

```ts
${progressBlock}${deficitsBlock}

${state.sourceBias}

Populate working memory with structured findings.${findingsNote} When done, emit your completion signal in exactly this shape:
```

The call site `buildIterationPrompt(inputData, inputData.deficits, inputData.memoryCounts)` needs no change — `inputData` already carries `sourceBias` (it flows through the iteration state).

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. (If tsc complains `sourceBias` is missing on the prepareResearch return, confirm Step 1(d); the dountil requires input/output schemas to match, and `research-iteration` spreads `...inputData`, so no other return needs editing.)

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts
git commit -m "feat(workflow): resolve per-vertical bias and inject it into the researcher prompt"
```

---

## Task 4: Final verification + finance e2e

**Files:** none (verification only)

- [ ] **Step 1: Whole suite + type-check + build + clean tree**

Run: `npm test && npx tsc --noEmit && npm run build && git status --short`
Expected: all Vitest suites pass (including the new `verticals` suite); both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: Finance e2e run (the real proof — finance has never run e2e here)**

Build is refreshed by Step 1. Run the workflow headlessly with `{ vertical: 'retail banking and fintech', companyKey: 'onix' }` (the project's established headless harness — import `.mastra/output/mastra.mjs`, `getWorkflow('verticalEntryWorkflow')`, `createRun()`, `run.start({ inputData })`, executed with `node --env-file=.env`), capturing output to a log file.

- [ ] **Step 3: Confirm the bias switched verticals (no commit — observation)**

In the run log / final report, confirm:
1. The researcher's searches and cited sources skew **finance** (americanbanker.com, federalreserve.gov, bankingdive.com, …) and contain **no healthcare** regulators/trade press (cms.gov, fiercehealthcare.com).
2. No `No vertical config matched` warning fired (the finance aliases matched).
3. The report is coherent finance research and the workflow reached `success`.

If healthcare domains still appear or the warning fired, capture specifics for a follow-up (likely an alias gap or the bias not reaching the prompt) — do not patch silently.

- [ ] **Step 4: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- New `verticals/` module mirroring `companies/` (types, shared baseline, 3 configs, resolver) → Task 1. ✓
- Shared domains defined once, never duplicated → `shared.ts` + merge in `resolveVerticalBias` (Task 1). ✓
- Deterministic keyword/alias substring resolution, first-match, fallback to shared with a null key → Task 1 resolver + tests. ✓
- Fail-soft + warning on no match → resolver returns `matchedKey: null` (pure); `prepareResearch` logs the warning (Task 3 Step 1c). ✓
- Researcher instructions: rules kept, domain lists removed, pointer added; A8 cache intact → Task 2. ✓
- Resolve once in `prepareResearch`, thread via `sourceBias` state field into the dynamic iteration prompt; synthesizer untouched → Task 3. ✓
- Brief contract unchanged; excludes untouched; no LLM → Global Constraints + scope (no brief/exclude edits in any task). ✓
- Vitest tests for the resolver + renderer; tsc/build; finance e2e → Task 1 tests + Task 4. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; the prompt edit gives exact before/after text. Starter domain lists are concrete (refinable data, per the spec).

**Type consistency:** `VerticalBias`/`ResolvedBias` fields, `resolveVerticalBias(verticalText): ResolvedBias`, `renderSourceBias(bias): string`, the `sourceBias` state field, and the `buildIterationPrompt` `state.sourceBias` injection all use identical names across Tasks 1→3. Import paths: `../../../../modules/verticals` and `../../../../utils/logger` match the depth already used by `prepare-research.step.ts`'s existing `../../../../modules/companies` import.
