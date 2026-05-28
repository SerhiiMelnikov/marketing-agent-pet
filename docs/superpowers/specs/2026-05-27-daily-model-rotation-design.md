# Daily Model Rotation — Design Spec

**Date:** 2026-05-27
**Status:** Approved (pending implementation plan)

## Goal

Once per day, fetch the top model ID from `https://shir-man.com/api/free-llm/top-models` and use it as the OpenRouter model for every agent role (`researcher`, `synthesizer`, `cheap`). If the endpoint is unreachable or returns malformed data, keep the last known good value. Survive process restarts without re-fetching.

## Non-goals

- No test framework added in this change (project has none today).
- No new npm dependencies — uses Node built-ins only (Zod is already a dep).
- No multi-region/secondary endpoint failover. If the endpoint is down for >24h we keep using the stale model.
- No CLI command for manual refresh. The function is callable from a one-liner if needed.

## Architecture

Three changes:

1. **New module `src/lib/model/daily-model.ts`** owns rotation logic and in-memory state.
2. **New persisted file `data/daily-model.json`** carries the last-known-good model across restarts. Gitignored.
3. **`src/lib/model/model-router.ts`** changes `model(role)` to return a **function** `() => OpenRouterModel` instead of a string. Mastra's `model` field already accepts function form; agent invocations pick up the latest daily model without a process restart.

### Module: `src/lib/model/daily-model.ts`

**Exports:**

| Function                     | Purpose                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `startDailyModelScheduler()` | Called once from `src/mastra/index.ts` at boot. Loads persisted state, fetches if stale, schedules `setInterval` every 24h. |
| `getDailyModel()`            | Returns the current in-memory `OpenRouterModel \| null`. Synchronous, no I/O.                                               |
| `refreshDailyModel()`        | Performs one fetch + validate + persist cycle. Exported for testability / manual triggering.                                |

**Internal state:** a single module-level `let currentDailyModel: OpenRouterModel | null = null`.

### Persisted state: `data/daily-model.json`

Shape:

```json
{
  "id": "google/gemini-flash-1.5",
  "name": "Gemini Flash 1.5",
  "updatedAt": "2026-05-27T16:30:00.000Z"
}
```

- `id` is the **raw** value from `models[0].id` (the OpenRouter native ID, without the `openrouter/` prefix).
- When the daily model is used, we prefix at lookup time: `` `openrouter/${id}` `` → satisfies the `OpenRouterModel` template-literal type.

### Wire-up in `src/mastra/index.ts`

```ts
import { startDailyModelScheduler } from '../lib/model/daily-model';

searchInit();
fetchInit();
startDailyModelScheduler();
```

### Changes to `src/lib/model/model-router.ts`

The return type of `model(role)` changes from `OpenRouterModel` to `() => OpenRouterModel`:

```ts
export function model(role: ModelRole): () => OpenRouterModel {
  return () => {
    const daily = getDailyModel();
    if (daily) return daily;
    return OVERRIDES[role] ?? DEFAULT_MODELS[role];
  };
}
```

Call sites (`researcher.ts`, future `synthesizer.ts`, etc.) need no change — they still write `model: model('researcher')`. The value Mastra receives is now a function, which Mastra calls on each invocation.

`describeModels()` keeps returning strings for log/inspection purposes — unchanged.

## Fetch behavior

### Endpoint contract

Validated by Zod:

```ts
const responseSchema = z.object({
  models: z
    .array(
      z.object({
        id: z.string().regex(/^[^/]+\/.+$/),
        name: z.string(),
      }),
    )
    .min(1),
});
```

Unknown fields on `models[i]` are ignored.

### `refreshDailyModel()` algorithm

1. `fetch(endpoint, { signal: AbortSignal.timeout(15_000) })`.
2. If non-2xx → treat as failure (see below).
3. `await res.json()`, validate with `responseSchema`.
4. Take `models[0]`. Compute `fullId = \`openrouter/${models[0].id}\``.
5. Update `currentDailyModel = fullId`.
6. Write `data/daily-model.json` with `{ id: models[0].id, name: models[0].name, updatedAt: new Date().toISOString() }`. Use atomic write (write to `.tmp` then `rename`) so a crash mid-write doesn't corrupt the file.
7. Log `info`: `"Daily model refreshed: ${name} (openrouter/${id})"`.

### Failure handling

On any error — network, timeout, non-2xx, JSON parse error, schema mismatch, or disk-write error:

- Log `warn`: `"Failed to refresh daily model: ${err.message} — keeping current value"`.
- **Do not** touch `currentDailyModel`.
- **Do not** touch `data/daily-model.json`.
- Do not throw — the scheduler keeps running.

### Startup behavior (`startDailyModelScheduler`)

1. Try to read `data/daily-model.json`:
   - If present and parses: set `currentDailyModel = \`openrouter/${parsed.id}\``.
   - If missing, unreadable, or malformed: leave `currentDailyModel = null`. (Log `info`, not `warn` — first-boot is normal.)
2. Compute `ageMs = Date.now() - new Date(parsed.updatedAt).getTime()` (treat missing file as Infinity).
3. If `ageMs > 24h` → fire `refreshDailyModel()` in the background (`void refreshDailyModel()` — non-blocking so Mastra boot isn't delayed by a slow endpoint).
4. `setInterval(refreshDailyModel, 24 * 60 * 60 * 1000)`.

The `setInterval` handle is kept module-local; we don't need to expose a `stop()` since this runs for process lifetime.

### Fresh-first-boot scenario

No persisted file, no in-memory value, the background fetch is still in flight — `getDailyModel()` returns `null` → `model(role)` falls through to `OVERRIDES[role] ?? DEFAULT_MODELS[role]`. No crash. Once the fetch completes, subsequent agent invocations pick up the daily model.

## File changes summary

| File                            | Change                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/model/daily-model.ts`  | **New.** Scheduler, fetcher, in-memory state, persistence.             |
| `src/lib/model/model-router.ts` | `model(role)` return type changes to `() => OpenRouterModel`.          |
| `src/mastra/index.ts`           | Add `startDailyModelScheduler()` after `searchInit()` / `fetchInit()`. |
| `.gitignore`                    | Add `data/` so per-machine state doesn't leak.                         |
| `data/daily-model.json`         | **New** at runtime; not committed.                                     |

## Environment

User must set `OPENROUTER_API_KEY` in `.env`. Key is generated at https://openrouter.ai/settings/keys. Already validated by `src/config/env.ts` — missing key fails fast on boot.

## Open questions

None at design time. Edge cases captured in failure handling above.
