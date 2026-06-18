# Floating cache breakpoint (researcher) — design

**Date:** 2026-06-18
**Status:** Approved
**Branch:** `feat/floating-cache-breakpoint`
**Backlog item:** A8 lever B (cost) — sub-project 2 of 2. Sub-project 1 (B1,
cap search-content to top-N) is merged (PR #7). This is the floating cache
breakpoint deferred from the B1 spec.

## Goal

Make the researcher's growing conversation prefix (accumulated search/tool
content, re-sent every model step) read from Anthropic prompt cache instead of
being full-price text on every step — deterministically, under our control.

## Problem (from the trace diagnosis, 2026-06-17 vs 2026-06-18)

The researcher re-sends the whole conversation each step. The dominant input
cost is the accumulated tool content carried forward uncached.

The 2026-06-17 run *accidentally* cached this content: per-step `cacheWrite`
grew (4253 → 1080 → 1080 → 55 952 → 35 063) and `cacheRead` reached 61 720 on
the final step — a signature only a **moving (floating) cache breakpoint** can
produce; a fixed system-prefix breakpoint writes its ~4k prefix once and then 0.
The 2026-06-18 run (post-B1) lost it: only the static ~4k system breakpoint
remained (`cacheRead` constant at 4185), so ~397.8k of researcher input was
full-price text.

Source reading settled the mechanism question:

- `CacheControlValidator.getCacheControl`
  (`node_modules/@mastra/core/dist/chunk-OHYWXD5N.js`) never injects a
  breakpoint — it returns `undefined` when `providerOptions` carries no
  `cacheControl`, and only counts breakpoints against the Anthropic limit (4).
- The Anthropic converter places a breakpoint **only where
  `providerOptions.cacheControl` is already present** — on system blocks, on
  `part.providerOptions`, and as a fallback for a message's last part from
  `message.providerOptions`.
- There is **no Mastra auto-mark-last-message behavior and no config switch**
  for a floating breakpoint.

So the 2026-06-17 caching was non-deterministic (most likely our static
instruction `cacheControl` transiently persisted onto a remembered message via
memory persistence — the memory schema has a `providerOptions` field). We do not
rely on it. We place the floating breakpoint explicitly.

A8's static system-prefix breakpoint (on the researcher `instructions`) stays;
this design adds exactly one moving breakpoint, for a total of two (≤ 4). ✓

## Scope

In scope:
- A new input processor with `processInputStep` that, on every step, marks the
  **last content part of the last non-system message** with Anthropic ephemeral
  `cacheControl`, after clearing any marker a prior step left on the conversation
  — keeping exactly one floating breakpoint live at a time.
- Register it on the researcher agent (`inputProcessors`).

Out of scope (deliberately):
- **Synthesizer caching** — one model call per run, nothing accumulates to
  cache; its `cacheRead`/`cacheWrite` are 0 in both traces. Untouched.
- Changing A8 (the static system breakpoint), `maxSteps`, working-memory
  config, or B1's content-cap.
- Reordering the working-memory system block. The trace shows the researcher's
  WM system block stays stable (`null`) across its steps — updates flow through
  the tool, not via mid-run re-injection — so the prefix after the instructions
  is already cacheable. No reorder needed.

## Approach

A single-responsibility processor implementing `Processor.processInputStep`
(runs before each LLM call in the agentic loop). It mutates the conversation so
that exactly one moving Anthropic breakpoint sits on the tail.

### Mechanics (per step)

1. From the step's non-system messages (`processInputStep` excludes system
   messages), clear any `anthropic.cacheControl` previously set on any content
   part — markers persist via memory, so this keeps the count from growing past
   the Anthropic limit over many steps.
2. Set `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` on the
   **last content part of the last message**. The Anthropic converter reads
   `part.providerOptions` directly, so Anthropic caches the whole prefix up to
   that part. As the conversation grows, the breakpoint moves with the tail —
   producing the growing-`cacheRead` pattern the 2026-06-17 run showed, but now
   deterministically.
3. Mutate in place and return the same `messages` reference (Mastra treats this
   as an in-place edit).

Clear-then-set each step is idempotent: at any moment exactly one floating
breakpoint exists; with A8's static system breakpoint that is 2 of the allowed
4.

### Registration

Add the processor to the researcher's `inputProcessors`
(`src/mastra/agents/researcher.ts`). Existing `outputProcessors`
(`ToolCallLeakRecoveryProcessor`) and A8's `instructions` cacheControl are
unchanged.

### Files

| File | Responsibility | Change |
| --- | --- | --- |
| `src/mastra/processors/floating-cache-breakpoint.processor.ts` | The `processInputStep` processor | Create |
| `src/mastra/agents/researcher.ts` | Researcher agent wiring | Modify — add to `inputProcessors` |

## Key uncertainty → first implementation step (a spike)

The one thing not provable from static source: whether a `cacheControl` set on a
**MastraDBMessage content part** in `processInputStep` round-trips through the
DB→core conversion to the Anthropic converter's `part.providerOptions`. The
trace shows tool/assistant parts already carry `providerOptions`
(`anthropic`, `mastra`) end-to-end, so it should — but the implementation's
**first task is to confirm it on a real step** (mark a part, observe
`cacheRead` climb on the next step's `researcher model usage` log) before
building the full clear/set logic.

Fallbacks if part-level does not round-trip:
- Set it at message level instead of part level (converter uses
  `message.providerOptions` as the last-part fallback).
- If neither round-trips, mutate via `messageList` (the canonical core-format
  mutation surface) rather than the `messages` array.

`processInputStep`'s `{ providerOptions }` return value is **not** a fallback —
it changes request-level options, which cannot place a *moving per-message*
breakpoint.

## Data flow

Each researcher step: agent loop → `processInputStep` (clear stale marker → set
ephemeral `cacheControl` on the last part of the last message) → Mastra DB→core
conversion → Anthropic converter honors the marker → request carries 2
breakpoints (static system + floating tail) → Anthropic serves the cached
prefix. No workflow, memory-schema, or tool change.

## Error handling

None added. The processor is a pure in-place mutation over the message array;
an empty conversation (no non-system messages) is a no-op. It never aborts.

## Invariants / constraints

- At most one floating breakpoint live at any step (clear-then-set); with A8 ≤ 2
  total, within Anthropic's limit of 4.
- Only `providerOptions.anthropic.cacheControl` is touched; message text,
  parts, order, tool results, and working memory are never modified.
- Researcher only; synthesizer untouched.
- The static system breakpoint (A8) is independent and unchanged.

## Testing & verification

No unit-test harness (backlog A4); unit tests out of scope. Verification per
task is `npx tsc --noEmit` + `npm run build`.

Runtime confirmation is the next end-to-end run (not part of the plan's
commits): in `researcher model usage`, per-step `cachedInputTokens` should grow
across steps (mirroring the 2026-06-17 ~62k read), and the researcher's
full-price `text` should drop materially from the B1 run's ~397.8k toward ~200k
or lower. If `cachedInputTokens` stays flat at the ~4k static-prefix level, the
part-level marker did not round-trip — apply the message-level / `messageList`
fallback from the spike.

## Risks

- **Marker does not round-trip** to the Anthropic converter. Mitigated by the
  first-step spike and the message-level / `messageList` fallbacks above.
- **Prefix instability breaks cache hits.** Anthropic needs a byte-stable
  prefix for a hit. The trace shows the researcher's WM system block stays
  stable across steps, so the prefix before the moving breakpoint is stable; if
  a future change makes WM re-inject mid-run, hits would degrade (revisit then).
- **5-minute cache TTL.** A full researcher run is ~70s with steps seconds
  apart, well inside the TTL — fine. Cross-run reuse is not a goal.
- **Persistence side effect.** The ephemeral marker persists into stored message
  `providerOptions`; harmless, and re-normalized (clear/set) on the next step.
