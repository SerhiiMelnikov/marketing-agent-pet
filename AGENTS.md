# AGENTS.md

You are a TypeScript developer experienced with the Mastra framework. You are building a **multi-agent system for vertical market-entry research and marketing strategy**. You follow strict TypeScript practices and always consult up-to-date Mastra documentation before making changes.

## CRITICAL: Load `mastra` skill

**BEFORE doing ANYTHING with Mastra, load the `mastra` skill FIRST.** Never rely on cached knowledge — Mastra's APIs change frequently between versions. The skill is embedded at `.agents/skills/mastra/`; read the matching installed-version docs in `node_modules/@mastra/*/dist/docs/` and verify model IDs with:

```bash
node .agents/skills/mastra/scripts/provider-registry.mjs --provider <name>
```

In particular verify current syntax for:

- Workflow composition — `createWorkflow`, `createStep`, `.then`, `.dountil`, `options.onFinish`
- Agent memory configuration — schema-typed working memory
- Tool definitions with Zod input/output schemas
- The model-router string format (`provider/model`)

## Project Overview

This is a **Mastra** project written in TypeScript. Node.js runtime is `>=22.13.0`. Models are selected per role via env-var pools through Mastra's model router, so we can swap models without code changes (cheap models for bulk research, a stronger model for final synthesis).

### What this system does

An outsourcing company wants to evaluate and enter new industry verticals. Given a brief (`{ vertical, companyKey }`) the system produces a structured vertical-entry report: market trends, competitor landscape, candidate ICPs, fit analysis, and a positioning recommendation — every claim grounded in researched sources. Company profiles live in `src/modules/companies/` (e.g. `onix`); verticals run so far include healthcare, finance, and build-to-rent (sample outputs in `docs/results/`).

### Architecture

This is a **deterministic Mastra workflow**, not an LLM supervisor. Two specialist agents are coordinated by the `vertical-entry` workflow:

| Agent         | Responsibility                                                                                                          | Model role    | Tools                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------- |
| `researcher`  | Search/fetch/mine evidence and POPULATE the schema-typed working-memory document (trends, competitors, ICPs, sources, open questions). Does **not** write the report. | `researcher`  | `web-search`, `fetch-url`, `find-in-page`, `read-working-memory`, `updateWorkingMemory` |
| `synthesizer` | Read working memory + the brief and write the final markdown report. **No web access** — grounded strictly in what the researcher recorded. | `synthesizer` | (none)                                                          |

Workflow shape (`src/mastra/workflows/vertical-entry/index.ts`):
`prepareResearch` → `dountil(runResearchIteration)` → `runSynthesis`.

- The `dountil` loop re-invokes the researcher on the same thread (the workflow `runId`) until a **deterministic gate** (`collectDeficits`) passes — min 3 trends, 3 competitors, 2 ICPs, 5 sources, plus triangulation for quantitative claims — capped at 3 attempts.
- **Working memory is the typed contract** between the two agents (`src/mastra/schemas/research-memory.ts`). If a finding isn't in working memory, it doesn't exist downstream.
- `options.onFinish` clears the per-run page cache on every terminal status except `suspended`.

Five scorers (`src/mastra/scorers/`) evaluate the synthesizer's output: `citationFormat`, `citationIntegrity`, `sourceDiversity`, `companyFit`, `claimGrounding`.

## Commands

```bash
npm run dev        # Start Mastra Studio at localhost:4111 (long-running, separate terminal)
npm run build      # Build a production-ready server
npx tsc --noEmit   # Type-check
npm run lint
```

## Project Structure

| Folder                                  | Description                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/mastra`                            | Mastra entry point and configuration (`index.ts` registers agents, tools, workflows, scorers, storage, observability) |
| `src/mastra/agents`                     | `researcher`, `synthesizer` (one file per agent)                                             |
| `src/mastra/workflows/vertical-entry`   | The vertical-entry workflow and its steps                                                    |
| `src/mastra/tools`                      | `web-search`, `fetch`, `find-in-page`, `read-working-memory` — thin `createTool` wrappers over `src/modules/*` |
| `src/mastra/schemas`                    | Zod schema for the working-memory document                                                   |
| `src/mastra/scorers`                    | Output-quality evals (the 5 listed above)                                                    |
| `src/mastra/processors`                 | Output processors (e.g. tool-call-leak recovery)                                             |
| `src/modules`                           | Provider-abstracted services: `search`, `fetch`, `model`, `companies`, `page-cache`, `extract-sections` |
| `src/config`                            | `env.ts` — Zod-validated environment                                                         |

### Top-level files

| File                  | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `src/mastra/index.ts` | Central entry point — register all agents, tools, workflows, scorers         |
| `.env.example`        | Template for env vars (model-provider keys + tool keys)                      |
| `package.json`        | Project metadata, dependencies, npm scripts                                  |
| `tsconfig.json`       | TypeScript options (ES2022, strict, `noEmit`)                                |

## Tools & services — design notes

Agents call Mastra **tools** (`src/mastra/tools/`); the tools delegate to **provider-abstracted modules** (`src/modules/`). Agents never reference a vendor (Tavily/Firecrawl/etc.) directly — a provider can be swapped by implementing its interface and registering it in the module's factory, with no agent change.

- **`web-search`** — backed by a `SearchProvider` (`src/modules/search/`), currently Tavily. Inputs `{ query, includeDomains?, excludeDomains?, maxResults? }`; returns ranked results with a snippet and (when available) extracted page content. The agent passes domain bias per call.
- **`fetch-url`** — backed by a `FetchProvider` chain (`src/modules/fetch/`), currently Firecrawl. Returns a structured `sections[]` array + `pageChars`. Results are cached per `runId`; blocked pages are flagged, not cached.
- **`find-in-page`** — substring search within a page already fetched this run (per-run cache); relocates a quote without re-fetching.
- **`read-working-memory`** — reads the current working-memory document so the agent can check counts and avoid duplicates.
- **`updateWorkingMemory`** (Mastra built-in) — the researcher's primary output; writes findings into the schema-typed document.

**Grounding contract:** the synthesizer has no tools and may use only working memory + the brief. If it cannot ground a claim, it flags the gap rather than fabricating.

### Source quality bias

The researcher biases toward authoritative sources via `includeDomains`/`excludeDomains` (analyst firms, consulting, government/regulatory, trade press, SEC filings) and excludes SEO market-report vendors and vendor-marketing pages. This bias currently lives in the researcher's instructions and is healthcare-leaning; enforcing it in the search tool and generalizing it per-vertical is on the backlog.

## Model routing

Models are selected per role in `src/modules/model/`, via comma-separated env pools (round-robin; a single entry is a hard override):

- `MODEL_RESEARCHER_POOL` — researcher (bulk reading/summarization)
- `MODEL_SYNTHESIZER_POOL` — synthesizer (final report; quality matters most here)
- `MODEL_CHEAP_POOL` — scorer judges

Routing is **direct provider** (no gateway): researcher + judges on Google Gemini, synthesizer on Anthropic Claude. Mastra reads `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` from the environment. Verify model IDs with the provider-registry script. Never hardcode keys or model strings in agents.

## Output contract

The deliverable is a markdown report: executive summary, market trends (≥3, each with sourced evidence), competitor profiles (3–5, weight-classed), candidate ICPs (2), fit analysis, positioning recommendation, confidence & gaps, and a numbered sources section. Every factual claim carries an inline attribution plus a numbered reference. If a claim can't be grounded in working memory, it must be surfaced under "Confidence & Gaps" rather than fabricated.

## Boundaries

### Always do

- Load the `mastra` skill before any Mastra-related work
- Register new agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use Zod schemas for tool inputs/outputs, working memory, and the final report
- Select models via env-var pools (the model router) — never hardcode model strings
- Force every factual claim in the report to trace to a finding in working memory
- Verify changes compile (`npx tsc --noEmit`, then `npm run build`)

### Never do

- Never commit `.env` files or secrets
- Never modify `node_modules` or Mastra's database files directly
- Never hardcode API keys or model strings
- Never let an agent produce unsourced factual claims about the vertical — if there's no finding to back it, flag the gap, don't fill it from training data
- Never expand the agent roster before the current version produces output that a domain expert would call useful

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt) — embedded at `.agents/skills/mastra/`
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- Provider/model registry: `node .agents/skills/mastra/scripts/provider-registry.mjs --list`
