# Floating cache breakpoint (researcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place exactly one moving Anthropic prompt-cache breakpoint on the tail of the researcher's conversation each step, so accumulated search/tool content is read from cache instead of re-sent as full-price text.

**Architecture:** A new input processor (`processInputStep`) clears any breakpoint a prior step left on the conversation, then marks the last part of the last message with ephemeral `cacheControl`. Registered on the researcher's `inputProcessors`; the static system-prefix breakpoint (A8) stays — two breakpoints total, within Anthropic's limit of four.

**Tech Stack:** TypeScript (ES2022, strict), Mastra `@mastra/core` processors, Anthropic (Claude Haiku) via the model router.

## Global Constraints

- Node.js `>=22.13.0`; TypeScript ES2022, strict, `noEmit`.
- No unit-test harness (`npm test` is a stub — backlog A4); unit tests are out of scope. Verification per task is `npx tsc --noEmit` + `npm run build`.
- Never hardcode model strings or API keys (not relevant to these files, holds project-wide).
- Researcher only. Do not touch the synthesizer, A8's `instructions` cacheControl, `maxSteps`, working-memory config, or B1's content-cap.
- At most one floating breakpoint live at a time (clear-then-set); with A8 ≤ 2 total ≤ Anthropic's 4.

**Spec:** `docs/superpowers/specs/2026-06-18-floating-cache-breakpoint-design.md`

**Field note (verified against installed types):** At the `MastraDBMessage` layer the per-part field is `providerMetadata` (`MastraProviderMetadata = AIV5 ProviderMetadata = Record<string, Record<string, JSONValue>>`), NOT `providerOptions`. Mastra maps `providerMetadata` → the core prompt's `part.providerOptions`, which the Anthropic converter reads to emit `cache_control`. That mapping is the spec's one runtime unknown, verified post-build (Task 3).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/mastra/processors/floating-cache-breakpoint.processor.ts` | The `processInputStep` floating-breakpoint processor | Create |
| `src/mastra/agents/researcher.ts` | Researcher agent wiring | Modify — add to `inputProcessors` |

No interface/type changes. No new dependencies.

---

## Task 1: Create the floating-cache-breakpoint processor

**Files:**
- Create: `src/mastra/processors/floating-cache-breakpoint.processor.ts`

**Interfaces:**
- Consumes: `Processor`, `ProcessInputStepArgs` from `@mastra/core/processors`. `ProcessInputStepArgs.messages` is `MastraDBMessage[]`; each message has `content.parts: MastraMessagePart[]`; each part has optional `providerMetadata: MastraProviderMetadata`.
- Produces: `FloatingCacheBreakpointProcessor` (a `Processor`), default-exported as a named class.

- [ ] **Step 1: Write the processor**

Create `src/mastra/processors/floating-cache-breakpoint.processor.ts` with exactly:

```ts
// src/mastra/processors/floating-cache-breakpoint.processor.ts

import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';

const ID = 'floating-cache-breakpoint';

/**
 * Places exactly one moving Anthropic prompt-cache breakpoint on the tail of the
 * researcher's conversation, so the accumulated tool/search content is read from
 * cache instead of re-sent as full-price text on every step.
 *
 * Each step it first clears any breakpoint a prior step left on the conversation
 * (markers persist via memory, so leaving them would blow past Anthropic's
 * 4-breakpoint limit), then marks the last part of the last message with
 * ephemeral `cacheControl`. With the agent's static system-prefix breakpoint
 * that is two breakpoints total.
 *
 * Field note: at the MastraDBMessage layer the field is `providerMetadata`;
 * Mastra maps it to the core prompt's `part.providerOptions`, which the Anthropic
 * message converter reads to emit `cache_control`.
 */
export class FloatingCacheBreakpointProcessor implements Processor<typeof ID> {
  readonly id = ID;
  readonly name = 'Floating Cache Breakpoint';

  processInputStep({ messages }: ProcessInputStepArgs): ProcessInputStepArgs['messages'] {
    // 1. Clear any breakpoint a prior step left behind.
    for (const message of messages) {
      for (const part of message.content.parts) {
        const anthropic = part.providerMetadata?.anthropic;
        if (anthropic && 'cacheControl' in anthropic) {
          delete anthropic.cacheControl;
        }
      }
    }

    // 2. Place one moving breakpoint on the last part of the last message.
    const lastPart = messages.at(-1)?.content.parts.at(-1);
    if (lastPart) {
      lastPart.providerMetadata = {
        ...lastPart.providerMetadata,
        anthropic: {
          ...lastPart.providerMetadata?.anthropic,
          cacheControl: { type: 'ephemeral' },
        },
      };
    }

    return messages;
  }
}
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

If `tsc` complains that `cacheControl: { type: 'ephemeral' }` is not assignable, it means `MastraProviderMetadata` is stricter than the resolved `Record<string, Record<string, JSONValue>>` — re-read `node_modules/@mastra/core/dist/agent/message-list/state/types.d.ts` and match the exact value type. Do NOT loosen with `any`.

- [ ] **Step 3: Commit**

```bash
git add src/mastra/processors/floating-cache-breakpoint.processor.ts
git commit -m "feat(researcher): floating Anthropic cache breakpoint processor"
```

---

## Task 2: Register the processor on the researcher

**Files:**
- Modify: `src/mastra/agents/researcher.ts`

**Interfaces:** none (wiring only). The Agent option is `inputProcessors?: InputProcessorOrWorkflow[]` (verified in `node_modules/@mastra/core/dist/agent/types.d.ts`).

- [ ] **Step 1: Import the processor**

In `src/mastra/agents/researcher.ts`, the existing processor import is (line 11):

```ts
import { ToolCallLeakRecoveryProcessor } from '../processors/tool-call-leak-recovery.processor';
```

Add directly below it:

```ts
import { FloatingCacheBreakpointProcessor } from '../processors/floating-cache-breakpoint.processor';
```

- [ ] **Step 2: Add `inputProcessors` to the agent config**

In the same file, the agent config currently has this exact line (line 159):

```ts
  outputProcessors: [new ToolCallLeakRecoveryProcessor()],
```

Insert a new line directly **above** it:

```ts
  inputProcessors: [new FloatingCacheBreakpointProcessor()],
```

Result (the two adjacent lines):

```ts
  inputProcessors: [new FloatingCacheBreakpointProcessor()],
  outputProcessors: [new ToolCallLeakRecoveryProcessor()],
```

Do not change any other agent option (`instructions`, `model`, `tools`, `memory`, `defaultOptions`).

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Verify the wiring reads correctly**

Read the agent config block in `src/mastra/agents/researcher.ts` and confirm: the import is present, `inputProcessors` holds exactly one `new FloatingCacheBreakpointProcessor()`, `outputProcessors` still holds the leak-recovery processor, and A8's `instructions.providerOptions.anthropic.cacheControl` is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/researcher.ts
git commit -m "feat(researcher): register floating cache breakpoint as input processor"
```

---

## Task 3: Final verification + runtime spike note

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean build and tree**

Run: `npx tsc --noEmit && npm run build && git status --short`
Expected: both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: Record the runtime check (no code — confirms the spec's one unknown)**

The runtime confirmation is the next end-to-end run, NOT part of this plan's commits. In the `researcher model usage` log, per-iteration `cachedInputTokens` should grow across steps (mirroring the 2026-06-17 ~62k read), and the researcher's full-price input should drop materially from the B1 run's ~397.8k toward ~200k or lower.

**If `cachedInputTokens` stays flat at the ~4k static-prefix level**, the part-level `providerMetadata` did not round-trip to the converter. Apply the spec's predefined fallback, in order:
1. Set the marker at message-content level (`message.content.providerMetadata`) instead of the part.
2. If still flat, mutate via the `messageList` core-format API instead of the `messages` array.
Do NOT use `processInputStep`'s `{ providerOptions }` return — it is request-level and cannot place a moving per-message breakpoint.

- [ ] **Step 3: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- Single-responsibility `processInputStep` processor, clear-then-set, last part of last message → Task 1 Step 1. ✓
- Exactly one floating breakpoint + A8 static = 2 ≤ 4 → enforced by clear-then-set in Task 1 Step 1; constraint stated. ✓
- Register on researcher `inputProcessors`; synthesizer/A8/B1/WM untouched → Task 2 + Global Constraints. ✓
- The one runtime unknown (per-part `providerMetadata` → core `providerOptions` round-trip) verified post-build with predefined fallbacks → Task 3 Step 2. ✓
- Verification = tsc/build + next-run note → Task 1/2 type-check steps + Task 3. ✓

**Placeholder scan:** No TBD/TODO. Task 1 shows complete code; Task 2 gives exact import text and the exact anchor line with placement. ✓

**Type consistency:** `FloatingCacheBreakpointProcessor` defined in Task 1 Step 1, imported and instantiated with the same name in Task 2. `processInputStep` signature matches `Processor.processInputStep` (returns `MastraDBMessage[]`, a permitted return). `inputProcessors` matches the Agent option name. `providerMetadata` field/type matches `MastraMessagePart` / `MastraProviderMetadata`. ✓
