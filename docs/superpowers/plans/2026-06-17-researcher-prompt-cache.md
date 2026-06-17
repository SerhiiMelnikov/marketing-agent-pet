# Researcher Prompt Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Anthropic cache-control breakpoint to the researcher's system instruction so its stable `tools + system` prefix is cached across the research loop's many model steps.

**Architecture:** Convert the researcher agent's `instructions` from a plain string to Mastra's instruction-object form (`{ role, content, providerOptions }`), attaching `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }`. The prompt text is preserved verbatim. Effectiveness is then measured via the existing `researcher model usage` log on the first end-to-end run.

**Tech Stack:** TypeScript (ES2022, strict), Mastra `@mastra/core` Agent, Anthropic provider (AI SDK), `anthropic/claude-haiku-4-5`.

**Spec:** `docs/superpowers/specs/2026-06-17-researcher-prompt-cache-design.md`

**Testing note:** No unit-test harness (`npm test` is a stub — backlog A4); unit tests are out of scope per spec. Verification is `npx tsc --noEmit` + `npm run build`, then reading the `researcher model usage` log on the first end-to-end run (a later step, not part of this plan's commits).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/mastra/agents/researcher.ts` | Researcher agent definition | Modify — wrap `instructions` string in an object with `cacheControl` |

No other files change. The verification log already exists in `src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts`.

---

## Task 1: Wrap researcher instructions with an Anthropic cache breakpoint

**Files:**
- Modify: `src/mastra/agents/researcher.ts`

The current code has (line ~22) `  instructions: ` followed by a backtick-delimited template literal, and ends (lines ~154-155) with `  \`.trim(),` then `  model: model(ModelRole.Researcher),`. Wrap the existing template literal in an instruction object — **do not change the prompt text inside the template literal.** Two precise edits:

- [ ] **Step 1: Edit the opening of the `instructions` field**

Replace this exact line:

```ts
  instructions: `
```

with:

```ts
  instructions: {
    role: 'system',
    content: `
```

(There is only one `instructions: \`` in the file; `description:` uses a different prefix.)

- [ ] **Step 2: Edit the closing of the `instructions` field**

Replace this exact two-line block:

```ts
  `.trim(),
  model: model(ModelRole.Researcher),
```

with:

```ts
  `.trim(),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  },
  model: model(ModelRole.Researcher),
```

(Anchoring on the `model:` line makes this unique — the `description` field also ends in `\`.trim(),` but is not followed by `model:`.)

- [ ] **Step 3: Sanity-check the resulting shape**

Read `src/mastra/agents/researcher.ts` and confirm the field now reads, structurally:

```ts
  instructions: {
    role: 'system',
    content: `
You are a market research analyst. …            // ← unchanged prompt text
…
  `.trim(),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  },
  model: model(ModelRole.Researcher),
  tools: { webSearchTool, fetchTool, findInPageTool, readWorkingMemoryTool },
```

The prompt body between the backticks must be byte-for-byte unchanged from before.

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. (If `tsc` reports that the instruction-object shape is invalid, STOP and report — it would mean the installed Mastra version's `instructions` type differs from the documented object form.)

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/researcher.ts
git commit -m "feat(researcher): enable Anthropic prompt caching on system instruction"
```

---

## Task 2: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean build and tree**

Run: `npx tsc --noEmit && npm run build && git status --short`
Expected: both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: Record the measurement procedure (no code)**

Confirm (by reading `src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts`)
that it logs `researcher model usage` with `cachedInputTokens`. The runtime check
happens on the first end-to-end run, NOT in this plan: success is
`cachedInputTokens > 0` and growing across the researcher's steps/iterations. If it
stays 0, working-memory injection is invalidating the prefix → raise a follow-up
(split system blocks so working memory sits after the breakpoint). Do not treat
zero as success.

- [ ] **Step 3: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- Wrap `instructions` in object form with `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`, prompt text unchanged → Task 1. ✓
- Only `researcher.ts` changes; measurement uses the existing log → Task 1 file scope + Task 2. ✓
- Provider-namespaced option (safe for non-Anthropic models) → inherent to the `providerOptions.anthropic` key; no extra code. ✓
- Single-entry pool invariant → already true in `src/modules/model`, not changed here (noted in spec). ✓
- Verification = tsc/build + first-run log; success criterion explicit; zero ≠ success → Task 1 Step 4, Task 2 Step 2. ✓
- Out of scope (synthesizer caching, history/floating breakpoint, fetch cap, restructuring fallback) → absent from all tasks. ✓

**Placeholder scan:** No TBD/TODO; both edits show exact old/new code; prompt body explicitly preserved verbatim. ✓

**Type consistency:** The instruction-object literal uses `role`, `content`, `providerOptions` exactly as in the installed Mastra agent reference. `model`, `tools` lines are untouched. ✓
