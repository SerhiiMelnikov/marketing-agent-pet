# marketing-agent

Multi-agent **vertical market-entry research** system built on [Mastra](https://mastra.ai/). Given a target industry vertical and a company profile, it researches the market and produces a sourced markdown report — market trends, competitor landscape, candidate ICPs, fit analysis, and a positioning recommendation.

## How it works

A **deterministic Mastra workflow** (`vertical-entry`) coordinates two agents:

- **researcher** — searches and fetches the web, writing findings into a schema-typed working-memory document. It re-runs until a deterministic quality gate is met (minimum trends / competitors / ICPs / sources, plus triangulation of quantitative claims), capped at 3 attempts.
- **synthesizer** — reads **only** working memory + the brief and writes the final report. It has no web access, so it cannot fabricate. Five scorers grade the output (citation format/integrity, source diversity, company fit, claim grounding).

See [AGENTS.md](AGENTS.md) for the full architecture.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in the required keys:
   - `ANTHROPIC_API_KEY` — synthesizer ([console.anthropic.com](https://console.anthropic.com/settings/keys))
   - `GOOGLE_API_KEY` — researcher + scorer judges ([aistudio.google.com](https://aistudio.google.com/apikey))
   - search + fetch provider keys — see `.env.example`
3. `npm run dev`, then open [http://localhost:4111](http://localhost:4111) (Mastra Studio) and run the `vertical-entry` workflow.

Storage is local SQLite — no database server required.

## Commands

```bash
npm run dev        # Mastra Studio (localhost:4111)
npm run build      # production server
npx tsc --noEmit   # type-check
npm run lint
```

## Structure & samples

Folder layout is documented in [AGENTS.md](AGENTS.md). Real generated reports live in [`docs/results/`](docs/results/); design specs and implementation plans in [`docs/superpowers/`](docs/superpowers/).
