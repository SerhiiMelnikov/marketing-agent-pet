# Researcher prompt caching (Anthropic) — design

**Date:** 2026-06-17
**Status:** Approved (approach A)
**Branch:** `feat/researcher-prompt-cache`
**Backlog item:** A8 — prompt caching to cut latency/cost.

## Goal

Cache the researcher's stable system + tool-definition prefix on Anthropic so it
is not re-billed at full price on every model step. The researcher runs up to 60
steps per iteration and up to 3 iterations per run, re-sending the same large
prefix each step; Anthropic cache reads cost ~10% of input.

## Scope

In scope: enable an Anthropic cache breakpoint on the researcher's system
instruction, then MEASURE whether it takes effect on the first end-to-end run via
the existing usage log.

Out of scope:
- Synthesizer caching — a single call per run, so a cache write (1.25x) is never
  followed by an in-run read; net loss. Skip.
- Caching the growing conversation history (accumulated fetch content). Recorded
  as a future "floating cache breakpoint" enhancement in backlog A8.
- Capping fetch-markdown size (the larger cost lever B) — separate item.
- Any restructuring fallback — only triggered (as a follow-up) if measurement
  shows zero cache hits.

## Approach (A)

Convert the researcher's `instructions` from a plain string to Mastra's
instruction-object form, adding an Anthropic cache-control breakpoint:

```ts
instructions: {
  role: 'system',
  content: `…the existing researcher prompt, unchanged…`,
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
},
```

This is the syntax shown in the installed Mastra agent reference
(`@mastra/core/dist/docs/references/reference-agents-agent.md`). A breakpoint on
the system block caches the `tools + system` prefix, which is identical on every
step within a run.

Rejected alternatives:
- **B — multiple `{role:'system'}` blocks** to manually position the breakpoint.
  More complex; only warranted if measurement shows one breakpoint isn't holding
  (that becomes the follow-up).
- **C — per-call `providerOptions` in `invoke-researcher.ts`.** Works, but the
  Mastra docs route caching through the instruction level; per-call config spreads
  configuration between the agent and the workflow step.

## Components

### `src/mastra/agents/researcher.ts` (only file changed)

The `instructions` field changes from a string to an object literal:
`{ role: 'system', content: <the current prompt string, verbatim>, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }`.

The prompt text itself does not change. No other agent fields change.

### Measurement (no code change)

`src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts` already logs
`researcher model usage` with `inputTokens`, `cachedInputTokens`, and
`outputTokens` after each researcher invocation. This is the verification
instrument — no new code needed.

## Data flow

Unchanged. Mastra assembles `tools + system(+ working memory) + messages` and
sends to Anthropic; the only difference is the cache-control marker on the system
block, which makes Anthropic store and reuse the prefix.

## Error handling

None added. `providerOptions.anthropic` is provider-namespaced; non-Anthropic
models ignore unknown provider option keys (AI SDK behavior), so changing the
researcher pool to a non-Anthropic model does not break — the caching simply
doesn't apply.

## Invariants / constraints

- **Single-entry researcher pool.** Prompt caching is model-scoped; a round-robin
  pool would split traffic across models and prevent cache reuse. The researcher
  pool is already a single entry (`anthropic/claude-haiku-4-5`); this must stay
  single-entry for caching to work.
- **Anthropic minimum cacheable prefix.** Haiku requires ~2048 tokens for a cache
  to form. The researcher system prompt (~2–2.5k tokens) plus tool schemas is
  comfortably above this; if a future prompt trim drops below it, caching silently
  stops (visible in the log).

## Testing & verification

No unit-test harness (backlog A4); unit tests out of scope. Verification:
- `npx tsc --noEmit` and `npm run build` — both exit 0.
- First end-to-end run: read the `researcher model usage` log lines. **Success =
  `cachedInputTokens` > 0 and growing across the researcher's steps/iterations.**
- If `cachedInputTokens` stays 0 across iterations, the injected working-memory
  document is invalidating the cached prefix → raise a follow-up (approach B:
  split system blocks so the volatile WM sits after the breakpoint). Do not treat
  zero as success.

## Risks

- **Working-memory invalidation.** Mastra's docs don't specify where the
  schema-typed working-memory document is placed relative to the system block. If
  it lands before the breakpoint and changes each step (the researcher writes to
  it via `updateWorkingMemory`), the prefix is invalidated every step and caching
  yields nothing. This is why the design measures rather than assumes; the
  follow-up restructuring is held in reserve.
- **5-minute TTL.** Benefit is intra-run (steps fire rapidly, keeping the cache
  warm); cross-run reuse is usually cold. Acceptable — the intra-run loop is where
  the repeated cost is.
