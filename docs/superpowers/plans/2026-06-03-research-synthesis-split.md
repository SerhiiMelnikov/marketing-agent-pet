# Research / Synthesis Agent Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single researcher agent with two specialized agents (researcher + synthesizer) coordinated by a three-step workflow with a deterministic validation gate.

**Architecture:** Researcher populates a typed working-memory document (Zod schema). A validation step reads memory and fails fast if minimum thresholds aren't met. Synthesizer then reads the validated memory and writes the final report. Both agents share one Mastra thread; the working-memory document is the typed contract between them.

**Tech Stack:** Mastra `Memory` with schema-mode working memory, Zod for the contract, Mastra `createStep` / `createWorkflow` for orchestration.

**Spec reference:** `docs/superpowers/specs/2026-06-03-research-synthesis-split-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/mastra/schemas/research-memory.ts` | **Create** | Zod schema + inferred type for the research findings document |
| `src/mastra/agents/synthesizer.ts` | **Create** | New synthesizer agent: strong model, no tools, all 5 scorers attached |
| `src/mastra/workflows/vertical-entry/steps/research.step.ts` | **Create** | Step 1: invoke researcher, return threadId |
| `src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts` | **Create** | Step 2: read working memory, assert thresholds, parse against schema |
| `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts` | **Create** | Step 3: invoke synthesizer on same thread, return final report |
| `src/mastra/memory.ts` | **Modify** | Attach `researchMemorySchema` to `workingMemory` (schema mode replaces template) |
| `src/mastra/agents/researcher.ts` | **Modify** | Strip Phase 2 from instructions, remove scorers, swap to `ModelRole.Researcher`, add cosmetic completion-signal contract |
| `src/mastra/workflows/vertical-entry/index.ts` | **Modify** | Chain three steps with `.then(...).then(...).then(...)` |
| `src/mastra/workflows/vertical-entry/steps/researcher.step.ts` | **Delete** | Replaced by `research.step.ts` (also covers validate + synthesize) |
| `src/mastra/index.ts` | **Modify** | Register the synthesizer agent |

---

## Task 1: Add the working-memory Zod schema

**Files:**
- Create: `src/mastra/schemas/research-memory.ts`

- [ ] **Step 1: Write the schema**

```ts
// src/mastra/schemas/research-memory.ts

import { z } from 'zod';

const confidenceLevel = z.enum(['high', 'medium', 'low']);

const marketTrendSchema = z.object({
  claim: z.string(),
  evidence: z.string(),
  sourceUrl: z.url(),
  publisher: z.string(),
  year: z.number().int().optional(),
  confidence: confidenceLevel,
});

const competitorSchema = z.object({
  name: z.string(),
  description: z.string(),
  weightClass: z.enum(['enterprise', 'mid-market', 'boutique']),
  sources: z.array(z.url()).min(1),
});

const icpSchema = z.object({
  persona: z.string(),
  pains: z.array(z.string()).min(2),
  buyingSignals: z.array(z.string()).min(1),
});

const sourceConsultedSchema = z.object({
  url: z.url(),
  classifier: z.enum([
    'government',
    'analyst',
    'consulting',
    'trade-press',
    'sec-filing',
    'company-ir',
    'vendor',
    'other',
  ]),
});

export const researchMemorySchema = z.object({
  marketTrends: z.array(marketTrendSchema),
  competitors: z.array(competitorSchema),
  candidateIcps: z.array(icpSchema),
  sourcesConsulted: z.array(sourceConsultedSchema),
  openQuestions: z.array(z.string()),
});

export type ResearchMemory = z.infer<typeof researchMemorySchema>;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build successful, no TypeScript errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/mastra/schemas/research-memory.ts
git commit -m "Add Zod schema for research working memory

Typed contract between the researcher (populates) and synthesizer (reads)
agents — replaces the free-form markdown template used until now."
```

---

## Task 2: Create the synthesizer agent

**Files:**
- Create: `src/mastra/agents/synthesizer.ts`
- Modify: `src/mastra/index.ts`

- [ ] **Step 1: Write the synthesizer agent**

Create `src/mastra/agents/synthesizer.ts` with this content. The system prompt absorbs Phase 2 from the current researcher; tools are empty; all five existing scorers attach here.

```ts
// src/mastra/agents/synthesizer.ts

import { Agent } from '@mastra/core/agent';
import { model } from '../../modules/model';
import { ModelRole } from '../../modules/model/model-role.enum';
import { researchMemory } from '../memory';
import { citationFormatScorer } from '../scorers/citation-format.scorer';
import { sourceDiversityScorer } from '../scorers/source-diversity.scorer';
import { citationIntegrityScorer } from '../scorers/citation-integrity.scorer';
import { companyFitScorer } from '../scorers/company-fit.scorer';
import { claimGroundingScorer } from '../scorers/claim-grounding.scorer';

export const synthesizer = new Agent({
  id: 'vertical-synthesizer',
  name: 'Vertical Synthesizer',
  description: `
Reads the structured research findings populated in working memory by the
researcher agent, plus the user's original brief, and writes the final
vertical-entry markdown report. Has no web access — synthesis is grounded
strictly in what the researcher recorded.
  `.trim(),
  instructions: `
You are a market research analyst and marketing strategist. Read the
structured findings in working memory and write a vertical-entry research
report for an outsourcing company entering a new industry.

# Inputs you have

- The original user brief (vertical name + company description) in the
  conversation history.
- A populated working-memory document containing: \`marketTrends\`,
  \`competitors\`, \`candidateIcps\`, \`sourcesConsulted\`, \`openQuestions\`.

You may use ONLY what is in working memory and the original brief. Do NOT
introduce facts from training data. If working memory lacks evidence for a
claim you want to make, drop the claim or surface it under "Confidence &
Gaps". You have no web-search or fetch tools — you cannot look anything up.

# Output: a single markdown report

Structure the report in this order:

1. **Executive Summary** (3-5 sentences synthesizing the key findings)
2. **Market Trends** — expand each working-memory trend into a short
   paragraph that quotes its \`evidence\` and attributes it to its source.
3. **Competitor Landscape**
   - Distinguish realistic competitors (matched to the company's weight
     class) from "adjacent enterprise players" the company won't compete
     with for the same deals. A 250-person nearshore shop does NOT compete
     with TCS, Wipro, Cognizant, or Accenture for enterprise contracts;
     group those separately if working memory includes them. Use the
     \`weightClass\` field in competitor entries to guide this grouping.
4. **Candidate ICPs** — expand each ICP in working memory: persona +
   pains + buying signals.
5. **Fit Analysis** — given THIS company's stated size, tech stack, domain
   history, and gaps, what specific advantages and disadvantages does it
   have entering this vertical? Be concrete about what it LACKS and how it
   should address those gaps. If this section is interchangeable with any
   other outsourcer's report, you haven't done your job.
6. **Positioning Recommendation** (1-2 paragraphs — your synthesis,
   building on the Fit Analysis above)
7. **Confidence & Gaps** — pull entries from working memory's
   \`openQuestions\` plus anything you couldn't ground in available
   findings. Be explicit about what isn't verified.
8. **Sources** — deduplicated, numbered list of URLs

# Citation format

Every claim must carry an inline attribution AND a numbered reference into
the Sources section:

- Inline: \`(Source: Publisher, Year) [N]\` — Publisher and Year come from
  the working-memory \`marketTrend\` or \`competitor\` entry. Use the
  publication year recorded, NOT today's year.
- When triangulating a quantitative claim, cite both sources inline:
  \`Market size was $X-$Y in 2024 (Source: Publisher A, 2024 [1]; Publisher B, 2025 [2])\`.
  Both sources must appear in the Sources section.
- Sources section: each entry is \`[N] Publisher — Article title — URL\`.
- Use the URLs from working memory's \`sourcesConsulted\` or from finding
  \`sourceUrl\` fields. Do NOT invent URLs.
- Section 5 (Positioning Recommendation) is judgment — it doesn't need a
  numbered citation but must follow logically from cited sections above.

# Do NOT

- Search the web or fetch URLs (you have no tools).
- Introduce facts not in working memory.
- Drop the \`[N]\` markers or use a different citation format.
- Dump raw JSON or working-memory entries verbatim in the report.
  `.trim(),

  model: model(ModelRole.Synthesizer),
  tools: {},
  memory: researchMemory,
  scorers: {
    citationFormat: {
      scorer: citationFormatScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    sourceDiversity: {
      scorer: sourceDiversityScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    citationIntegrity: {
      scorer: citationIntegrityScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    companyFit: {
      scorer: companyFitScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    claimGrounding: {
      scorer: claimGroundingScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
  defaultOptions: {
    maxSteps: 1,
    modelSettings: {
      maxRetries: 6,
    },
  },
});
```

`maxSteps: 1` because the synthesizer has no tools — one model call produces the report. The five scorers are the same instances the researcher had; this is a *relocation*, not a re-implementation.

- [ ] **Step 2: Register the synthesizer in Mastra**

Edit `src/mastra/index.ts`:

```ts
// Add import alongside the researcher import
import { synthesizer } from './agents/synthesizer';

// In the `new Mastra({ ... })` call, update agents:
agents: { researcher, synthesizer },
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build successful.

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/synthesizer.ts src/mastra/index.ts
git commit -m "Add synthesizer agent (no tools, all 5 scorers attached)

Reads validated working memory and writes the final markdown report.
Strong-model role, single-step (no tools), inherits all scorers that
previously lived on the researcher — they evaluate the final report,
which is now this agent's output. Not wired into the workflow yet."
```

The synthesizer is registered but the workflow doesn't call it yet — the next task flips the pipeline.

---

## Task 3: Flip the pipeline to two agents

This task is intentionally one commit because the changes must land together — memory schema, researcher rewrite, and workflow update form one atomic transition. Between any two of the three sub-changes, the build still passes but the workflow either over-produces (researcher writes a report AND synthesizer rewrites it) or under-produces (schema rejects researcher writes that don't match the new shape). One commit, one switch.

**Files:**
- Modify: `src/mastra/memory.ts`
- Modify: `src/mastra/agents/researcher.ts`
- Create: `src/mastra/workflows/vertical-entry/steps/research.step.ts`
- Create: `src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts`
- Create: `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/index.ts`
- Delete: `src/mastra/workflows/vertical-entry/steps/researcher.step.ts`

- [ ] **Step 1: Attach the Zod schema to working memory**

Replace `src/mastra/memory.ts` with:

```ts
// src/mastra/memory.ts

import { Memory } from '@mastra/memory';
import { storage } from './storage';
import { researchMemorySchema } from './schemas/research-memory';

export const researchMemory = new Memory({
  storage,
  options: {
    workingMemory: {
      enabled: true,
      scope: 'thread',
      schema: researchMemorySchema,
    },
  },
});
```

The free-form template is gone; Mastra now validates writes against the schema.

- [ ] **Step 2: Rewrite the researcher agent**

Replace the body of `src/mastra/agents/researcher.ts` (everything inside `new Agent({...})`) with this. Keep imports, but drop the scorer imports — they move to the synthesizer.

```ts
// src/mastra/agents/researcher.ts

import { Agent } from '@mastra/core/agent';
import { model } from '../../modules/model';
import { ModelRole } from '../../modules/model/model-role.enum';
import { researchMemory } from '../memory';
import { webSearchTool } from '../tools/web-search.tool';
import { fetchTool } from '../tools/fetch.tool';
import { ToolCallLeakRecoveryProcessor } from '../processors/tool-call-leak-recovery.processor';

export const researcher = new Agent({
  id: 'vertical-researcher',
  name: 'Vertical Researcher',
  description: `
Researches a target industry vertical and POPULATES THE WORKING-MEMORY
DOCUMENT with findings — market trends, competitors, candidate ICPs,
sources consulted, and open questions. Does not write the final report;
that is the synthesizer's job.
  `.trim(),
  instructions: `
You are a market research analyst. Your job is to populate the
working-memory document with structured findings about the target vertical.

# Critical contract

The final report will be written by ANOTHER AGENT reading ONLY working
memory. If a finding is not in working memory when you finish, it does not
exist. Treat memory writes as your primary output.

Working memory is a typed document with these sections (Zod schema enforced):

  - \`marketTrends\`: array of { claim, evidence (quoted snippet), sourceUrl, publisher, year?, confidence: high|medium|low }
  - \`competitors\`: array of { name, description, weightClass: enterprise|mid-market|boutique, sources[] }
  - \`candidateIcps\`: array of { persona, pains[], buyingSignals[] }
  - \`sourcesConsulted\`: array of { url, classifier: government|analyst|consulting|trade-press|sec-filing|company-ir|vendor|other }
  - \`openQuestions\`: array of strings (gaps you couldn't fill)

# Research loop

For each sub-topic, repeat:

  1. Call \`web-search\` with a specific query. ALWAYS pass:
       - \`includeDomains\`: bias toward authoritative sources (see "Source bias" below).
       - \`excludeDomains\`: filter out known low-signal vendors.
  2. From the results, pick the 2-3 most promising URLs. Results are
     pre-sorted to push gated/paywalled URLs to the bottom — prefer the
     open ones.
  3. **Mine the snippet first.** If the search snippet already contains
     the specific figure or quote you need, cite it directly and skip the
     fetch.
  4. **Otherwise, fetch.** Call \`fetch-url\` to get the full page.
     **Pass \`extractHints\` with 2-4 short keywords or phrases for what
     you're hunting on that page** (e.g.
     \`["healthcare IT spend 2024", "CAGR", "Cognizant"]\`). Long pages
     get character-budget truncation; hints make the truncator keep the
     highest-signal sections instead of just the lead.
  5. **If the fetch returns a \`blocked\` field**, do NOT quote from its
     markdown. Search again for the specific claim from the analyst's
     press release or blog (everestgrp.com/blog/, gartner.com/en/newsroom/)
     or reputable secondary coverage. If still blocked, record the gap in
     \`openQuestions\` rather than dropping it silently.
  6. Write findings to working memory. Quote the evidence verbatim into
     the \`evidence\` field; the synthesizer will use it.

### Triangulation (critical for quantitative claims)

For any market-size, growth-rate, dollar figure, percentage, or other
quantitative claim, find at least two independent sources. If they
disagree, record BOTH as separate \`marketTrend\` entries with the range
visible across them. A single analyst's market sizing is an estimate, not
a fact.

### Source bias

**Strongly prefer** (pass these in \`includeDomains\` per query, picking
the relevant subset — primary government first, then analyst / consulting
/ trade press):

  - **Primary government / regulatory**: hhs.gov, cms.gov, healthit.gov
    (ONC), fda.gov, federalregister.gov, gao.gov, ftc.gov
  - **SEC filings & official corporate**: sec.gov, investor.* / ir.*
    subdomains of named incumbents, official company press releases
  - **Analyst firms**: gartner.com, forrester.com, idc.com,
    everestgroup.com, hfsresearch.com
  - **Consulting publications**: deloitte.com, mckinsey.com, bcg.com,
    bain.com, capgemini.com, accenture.com (insights / research articles
    only — NOT /services/ or /solutions/ marketing pages)
  - **Trade press**: healthcareitnews.com, fiercehealthcare.com,
    beckershospitalreview.com, himss.org, modernhealthcare.com, statnews.com

**Always exclude** (pass in \`excludeDomains\` on every search):

  - SEO market-report vendors: imarcgroup.com, market.us, sphericalinsights.com,
    snsinsider.com, grandviewresearch.com, mordorintelligence.com,
    marketsandmarkets.com, precedenceresearch.com, fortunebusinessinsights.com
  - Vendor-marketing pages and "best-of" listicles: sumatosoft.com,
    belitsoft.com, dashtech.io, softwareexpertsindia.com, clutch.co,
    goodfirms.co, designrush.com, techbehemoths.com

# Budget

Roughly 1 search + 2 fetches per sub-topic. With 5 sub-topics that's ~15
tool calls. Don't keep searching once you've grounded a finding — record
it and move on.

# Confidence levels

  - \`high\`: multiple independent analyst sources agree
  - \`medium\`: one credible source (analyst firm, established trade publication)
  - \`low\`: single vendor blog, your own inference, or contested claim

# When you're done

After your last working-memory write, emit a single short message in
exactly this shape:

\`Recorded N trends, M competitors, K ICPs, S sources, Q open questions.\`

Substitute the actual counts. Nothing else. Do NOT summarize findings, do
NOT write a report — the workflow reads memory directly and another agent
writes the report.
  `.trim(),
  model: model(ModelRole.Researcher),
  tools: { webSearchTool, fetchTool },
  memory: researchMemory,
  outputProcessors: [new ToolCallLeakRecoveryProcessor()],
  defaultOptions: {
    maxSteps: 25,
    modelSettings: {
      maxRetries: 6,
    },
  },
});
```

Key changes from the previous researcher:
- `model` swaps from `ModelRole.Synthesizer` to `ModelRole.Researcher` (synthesis lives elsewhere now).
- `scorers` block removed entirely — they move to the synthesizer.
- All Phase 2 instructions (report structure, citation format, fit analysis framing) removed — synthesizer's job.
- Final-message contract added: a fixed cosmetic completion-signal string, not a summary.
- All Phase 1 instructions preserved (source bias, triangulation, recovery protocol, snippet mining, extractHints).

- [ ] **Step 3: Create the research step**

Create `src/mastra/workflows/vertical-entry/steps/research.step.ts`:

```ts
// src/mastra/workflows/vertical-entry/steps/research.step.ts

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { researcher } from '../../../agents/researcher';

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyDescription: z
    .string()
    .min(10)
    .describe('Brief description of the outsourcing company entering the vertical'),
});

export const researchOutputSchema = z.object({
  threadId: z.string(),
  vertical: z.string(),
  companyDescription: z.string(),
  completionSignal: z.string(),
});

export const runResearch = createStep({
  id: 'run-research',
  description:
    'Invokes the researcher agent on a fresh thread to populate working memory with structured findings',
  inputSchema: briefSchema,
  outputSchema: researchOutputSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) throw new Error('Brief not provided');

    const agent = mastra.getAgentById(researcher.id);
    const threadId = randomUUID();
    const resourceId = 'default';

    const prompt = `
Vertical: ${inputData.vertical}
Company description: ${inputData.companyDescription}

Populate working memory with structured findings, then emit your completion signal.
    `.trim();

    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: { thread: threadId, resource: resourceId },
      maxSteps: 25,
    });

    let completionSignal = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      completionSignal += chunk;
    }

    return {
      threadId,
      vertical: inputData.vertical,
      companyDescription: inputData.companyDescription,
      completionSignal,
    };
  },
});
```

- [ ] **Step 4: Create the validate-memory step**

Create `src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts`. This step reads working memory, parses it against the schema, and enforces minimum thresholds (per the design's gate).

```ts
// src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { researchMemory } from '../../../memory';
import {
  researchMemorySchema,
  type ResearchMemory,
} from '../../../schemas/research-memory';
import { researchOutputSchema } from './research.step';

export const validateOutputSchema = researchOutputSchema.extend({
  memory: z.unknown(),
});

const MIN_TRENDS = 3;
const MIN_COMPETITORS = 3;
const MIN_ICPS = 2;
const MIN_SOURCES = 5;
const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%|\b(19|20)\d{2}\b/;

export const validateMemory = createStep({
  id: 'validate-memory',
  description:
    'Reads working memory, parses against the schema, and fails fast if minimum thresholds for a synthesizable report are not met',
  inputSchema: researchOutputSchema,
  outputSchema: validateOutputSchema,
  execute: async ({ inputData }) => {
    const raw = await researchMemory.getWorkingMemory({
      threadId: inputData.threadId,
      resourceId: 'default',
    });

    if (!raw) {
      throw new Error(
        'Researcher produced no working memory. The synthesizer has no input — halting.',
      );
    }

    // Working memory in schema mode is stored as JSON-stringified content.
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

    const m = parsed.data;
    const deficits = collectDeficits(m);
    if (deficits.length) {
      throw new Error(
        'Research insufficient for synthesis:\n  - ' + deficits.join('\n  - '),
      );
    }

    return { ...inputData, memory: m };
  },
});

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

  // Triangulation: every quantitative trend needs corroboration from another
  // trend citing the same claim from a different sourceUrl OR from the
  // sourcesConsulted log sharing the publisher.
  for (const trend of m.marketTrends) {
    const looksQuantitative =
      QUANT_CLAIM_REGEX.test(trend.claim) || QUANT_CLAIM_REGEX.test(trend.evidence);
    if (!looksQuantitative) continue;

    const corroborated = m.marketTrends.some(
      (other) =>
        other !== trend &&
        other.sourceUrl !== trend.sourceUrl &&
        (other.publisher === trend.publisher ||
          QUANT_CLAIM_REGEX.test(other.claim)),
    );
    if (!corroborated) {
      deficits.push(
        `quantitative trend "${trend.claim.slice(0, 60)}…" has no second corroborating source`,
      );
    }
  }

  return deficits;
}
```

If `getWorkingMemory`'s exact return shape differs from expected (e.g. the SDK has been updated to return the parsed object directly rather than a JSON string in schema mode), adjust the `JSON.parse` step accordingly. Verify against `node_modules/@mastra/memory/dist/index.d.ts` before adapting.

- [ ] **Step 5: Create the synthesize step**

Create `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`:

```ts
// src/mastra/workflows/vertical-entry/steps/synthesize.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { synthesizer } from '../../../agents/synthesizer';
import { validateOutputSchema } from './validate-memory.step';

export const reportSchema = z.object({
  threadId: z.string(),
  report: z.string(),
});

export const runSynthesis = createStep({
  id: 'run-synthesis',
  description:
    'Invokes the synthesizer agent on the same thread to read working memory and write the final report',
  inputSchema: validateOutputSchema,
  outputSchema: reportSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgentById(synthesizer.id);

    const prompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company description: ${inputData.companyDescription}

Read the working-memory document now and produce the final markdown report.
    `.trim();

    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: { thread: inputData.threadId, resource: 'default' },
      maxSteps: 1,
    });

    let report = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      report += chunk;
    }

    return { threadId: inputData.threadId, report };
  },
});
```

- [ ] **Step 6: Wire the three steps into the workflow**

Replace `src/mastra/workflows/vertical-entry/index.ts` with:

```ts
// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, runResearch } from './steps/research.step';
import { validateMemory } from './steps/validate-memory.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
})
  .then(runResearch)
  .then(validateMemory)
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
```

- [ ] **Step 7: Delete the old single-step researcher.step.ts**

Run: `git rm src/mastra/workflows/vertical-entry/steps/researcher.step.ts`

It's been superseded by `research.step.ts` + `validate-memory.step.ts` + `synthesize.step.ts`.

- [ ] **Step 8: Verify build passes**

Run: `npm run build`
Expected: build successful, no TypeScript errors.

If a type error surfaces from `getWorkingMemory`'s return shape (e.g. it returns `object | null` instead of `string | null` in your Mastra version), adjust the validate step accordingly — read the live signature in `node_modules/@mastra/memory/dist/index.d.ts` and use whatever API the installed version provides.

- [ ] **Step 9: Verify lint passes**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/mastra/memory.ts \
        src/mastra/agents/researcher.ts \
        src/mastra/workflows/vertical-entry/steps/research.step.ts \
        src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts \
        src/mastra/workflows/vertical-entry/steps/synthesize.step.ts \
        src/mastra/workflows/vertical-entry/index.ts \
        src/mastra/workflows/vertical-entry/steps/researcher.step.ts
git commit -m "Flip vertical-entry workflow to research + synthesize agents

- Working memory switches to schema mode (researchMemorySchema).
- Researcher loses Phase 2 + scorers; emits a fixed completion signal
  after populating memory; uses ModelRole.Researcher.
- Synthesizer (added in the prior commit) takes over report writing on
  the same thread; gets all 5 scorers.
- Workflow splits into research -> validate-memory -> synthesize, with
  the validation gate halting on insufficient findings or unparseable
  memory."
```

---

## Manual verification (after Task 3 lands)

These are not commits — they're sanity checks to run before declaring the change shipped.

- [ ] **Check 1: A full workflow run on a known-easy brief produces a report**

Start `npm run dev`, open Studio, run the workflow with a small healthcare brief. Expect:
- Research step streams the researcher's tool calls and completion signal.
- Validate-memory step succeeds.
- Synthesize step streams the final report.
- Workflow output is the report.

- [ ] **Check 2: Validation gate halts on a deliberately bad run**

Manually edit the researcher's prompt to record only 1 trend, run the workflow again. Expect the validate-memory step to throw with `marketTrends: got 1, need >= 3`. The workflow halts; the synthesizer is not invoked.

- [ ] **Check 3: Scorers fire on the synthesizer's output, not the researcher's**

In Studio, after a successful run, check the scorer panel. All five scorers should show non-zero scores (assuming a good report). The researcher should have no scorer rows.

- [ ] **Check 4: Memory remains accessible across the agent boundary**

Open the workflow trace in Studio. The synthesizer's prompt should reference the working memory contents from the researcher's writes. The synthesizer should NOT have access to the researcher's tool-call history beyond what working memory captures.

---

## Out of scope for this plan

- Research-quality scorers (memory-aware: triangulation count, source classifier diversity, finding density). Defer until the split is observed working.
- Synthesizer automatic retry on scorer failures. Manual operator inspection for now.
- Cross-run memory sharing. Each workflow run uses a fresh thread.
- Update to the memory file `project_researcher_role.md` (which says the researcher uses `Synthesizer` role intentionally). After this lands, that memory is outdated — update it then to reflect "researcher uses `Researcher` role since the split".
