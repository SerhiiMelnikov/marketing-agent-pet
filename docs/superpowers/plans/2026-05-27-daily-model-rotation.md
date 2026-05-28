# Daily Model Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily-rotated OpenRouter model fed by `https://shir-man.com/api/free-llm/top-models`, consumed transparently by every agent role, with persistent state so process restarts don't trigger redundant fetches.

**Architecture:** A new in-memory module (`src/lib/model/daily-model.ts`) owns the current daily model. It loads from a persisted JSON file at boot, refreshes via `fetch` if stale, and re-fetches every 24h via `setInterval`. `model(role)` in `model-router.ts` becomes a thunk `() => OpenRouterModel` that prefers `getDailyModel()` and falls through to existing overrides/defaults. Mastra's `model` field already accepts function form, so no agent file changes are needed.

**Tech Stack:** TypeScript, Node 22+ built-in `fetch`/`fs.promises`/`setInterval`, Zod 4 (already a dep). No new packages, no test framework added (per the design spec).

**Spec:** `docs/superpowers/specs/2026-05-27-daily-model-rotation-design.md`

---

## File Structure

| File                            | Change                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `.gitignore`                    | Modify — add `data/`                                                            |
| `src/lib/model/daily-model.ts`  | Create — scheduler + fetcher + persistence                                      |
| `src/lib/model/model-router.ts` | Modify — `model(role)` returns a thunk; consult `getDailyModel()` first         |
| `src/mastra/index.ts`           | Modify — call `startDailyModelScheduler()` after `searchInit()` / `fetchInit()` |

No test files (project has no test framework today). Verification is via `tsc --noEmit`, `npm run build`, and a manual `node -e` smoke check.

---

### Task 1: Ignore the runtime state directory

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Add `data/` to .gitignore**

Append `data/` after the existing `.env` line. The full file should read:

```
output.txt
node_modules
dist
.mastra
.env.development
.env
data/
*.db
*.db-*
.netlify
.vercel
```

- [ ] **Step 2: Verify**

Run: `git check-ignore -v data/anything.json`
Expected: prints `.gitignore:7:data/	data/anything.json` (line number may vary)

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
Ignore data/ runtime state directory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create the daily-model module

**Files:**

- Create: `src/lib/model/daily-model.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/model/daily-model.ts` with this exact content:

```ts
import { z } from 'zod';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OpenRouterModel } from './openrouter-model';

const ENDPOINT = 'https://shir-man.com/api/free-llm/top-models';
const FETCH_TIMEOUT_MS = 15_000;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = join(process.cwd(), 'data', 'daily-model.json');

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

const persistedSchema = z.object({
  id: z.string().regex(/^[^/]+\/.+$/),
  name: z.string(),
  updatedAt: z.iso.datetime(),
});

let currentDailyModel: OpenRouterModel | null = null;

export function getDailyModel(): OpenRouterModel | null {
  return currentDailyModel;
}

export async function refreshDailyModel(): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    const parsed = responseSchema.parse(json);
    const top = parsed.models[0];
    const fullId = `openrouter/${top.id}` as OpenRouterModel;

    currentDailyModel = fullId;

    await mkdir(dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify({ id: top.id, name: top.name, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    await rename(tmp, STATE_FILE);

    console.info(`Daily model refreshed: ${top.name} (${fullId})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to refresh daily model: ${msg} — keeping current value`);
  }
}

async function loadPersisted(): Promise<z.infer<typeof persistedSchema> | null> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return persistedSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function startDailyModelScheduler(): void {
  void (async () => {
    const persisted = await loadPersisted();
    if (persisted) {
      currentDailyModel = `openrouter/${persisted.id}` as OpenRouterModel;
      console.info(`Loaded persisted daily model: openrouter/${persisted.id}`);
    } else {
      console.info('No persisted daily model — will fetch on first opportunity');
    }

    const ageMs = persisted
      ? Date.now() - new Date(persisted.updatedAt).getTime()
      : Number.POSITIVE_INFINITY;

    if (ageMs > REFRESH_INTERVAL_MS) {
      void refreshDailyModel();
    }

    setInterval(refreshDailyModel, REFRESH_INTERVAL_MS);
  })();
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean). The module is currently unused, so it's checked but not yet wired.

- [ ] **Step 3: Smoke-test the fetch + persist path**

Run:

```bash
node --experimental-strip-types -e "import('./src/lib/model/daily-model.ts').then(async (m) => { await m.refreshDailyModel(); console.log('current:', m.getDailyModel()); })"
```

Expected output (one of):

- Success path: `Daily model refreshed: <name> (openrouter/<id>)` followed by `current: openrouter/<id>`, and `data/daily-model.json` exists.
- Failure path (no internet, endpoint down): `Failed to refresh daily model: <reason> — keeping current value` followed by `current: null`. No `data/daily-model.json` written.

Both outcomes prove the module is wired correctly; only the success path proves the endpoint.

If Node rejects `--experimental-strip-types`, run `node --import tsx -e "..."` or skip this step and rely on the build verification in Task 4.

- [ ] **Step 4: Format**

Run: `npm run format -- src/lib/model/daily-model.ts`
Expected: file listed without `(unchanged)` (Prettier may reformat) or with `(unchanged)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/model/daily-model.ts
git commit -m "$(cat <<'EOF'
Add daily-model module with in-process scheduler

Fetches https://shir-man.com/api/free-llm/top-models once a day,
persists the result to data/daily-model.json, and exposes
getDailyModel() for the model router to consult. On any fetch
failure the in-memory value and persisted file are left untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Make `model(role)` return a thunk that consults the daily model

**Files:**

- Modify: `src/lib/model/model-router.ts`

- [ ] **Step 1: Read the file**

Run: `cat src/lib/model/model-router.ts`
Note the current `model(role)` signature: `(role: ModelRole): OpenRouterModel`.

- [ ] **Step 2: Edit the import block**

Locate the existing import line:

```ts
import { env } from '../../config/env';
```

Replace it with:

```ts
import { env } from '../../config/env';
import { getDailyModel } from './daily-model';
```

- [ ] **Step 3: Change the `model()` function**

Locate the existing function (exact text):

```ts
export function model(role: ModelRole): OpenRouterModel {
  return OVERRIDES[role] ?? DEFAULT_MODELS[role];
}
```

Replace with:

```ts
export function model(role: ModelRole): () => OpenRouterModel {
  return () => getDailyModel() ?? OVERRIDES[role] ?? DEFAULT_MODELS[role];
}
```

Leave `describeModels()` and everything else unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output. Mastra's `model` field accepts function form, so existing agent call sites (e.g. `model: model('synthesizer')` in `src/mastra/agents/researcher.ts`) still type-check.

If `tsc` complains in an agent file about the function form, the fix is to update that single agent file to accept the new shape — but no change is expected.

- [ ] **Step 5: Format**

Run: `npm run format -- src/lib/model/model-router.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/model/model-router.ts
git commit -m "$(cat <<'EOF'
Make model(role) a thunk that consults the daily model

Returns () => OpenRouterModel instead of a string so each agent
invocation picks up the latest daily model without restart.
Falls through to the existing env override and hardcoded defaults
when getDailyModel() returns null (first boot, fetch in flight,
or fetch never succeeded).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Start the scheduler in the Mastra entry

**Files:**

- Modify: `src/mastra/index.ts`

- [ ] **Step 1: Read the file**

Run: `cat src/mastra/index.ts`
Verify the existing `searchInit()` and `fetchInit()` calls are present.

- [ ] **Step 2: Add the import**

Locate the existing import lines for searchInit/fetchInit. They look like:

```ts
import { init as searchInit } from '../modules/search';
import { init as fetchInit } from '../modules/fetch';
```

Add this line immediately after them:

```ts
import { startDailyModelScheduler } from '../lib/model/daily-model';
```

- [ ] **Step 3: Call the scheduler**

Locate:

```ts
searchInit();
fetchInit();
```

Change to:

```ts
searchInit();
fetchInit();
startDailyModelScheduler();
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Build**

Run: `rm -rf .mastra/output && npm run build`
Expected: ends with `Build successful, you can now deploy the .mastra/output directory to your target platform.` No `Package not found` errors.

- [ ] **Step 6: Verify scheduler appears in the bundle**

Run: `grep -E "Loaded persisted daily model|will fetch on first opportunity|Daily model refreshed|startDailyModelScheduler" .mastra/output/mastra.mjs`
Expected: at least one match — confirms the scheduler code was bundled rather than externalized.

- [ ] **Step 7: Format**

Run: `npm run format -- src/mastra/index.ts`

- [ ] **Step 8: Commit**

```bash
git add src/mastra/index.ts
git commit -m "$(cat <<'EOF'
Start the daily model scheduler on Mastra boot

Called after searchInit() / fetchInit() so the in-memory daily
model is loaded from the persisted state file (and refreshed if
stale) before any agent invocation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: End-to-end smoke check

**Files:** none (verification only)

- [ ] **Step 1: Ensure OPENROUTER_API_KEY is set**

Confirm `.env` contains a real `OPENROUTER_API_KEY=sk-or-...` (generated at https://openrouter.ai/settings/keys). If not set, the env schema in `src/config/env.ts` will fail boot with a clear ZodError. Also ensure `FIRECRAWL_API_KEY` is set if you want a clean boot.

- [ ] **Step 2: Boot the Mastra dev server**

Run: `npm run dev`

Watch the console. Within ~15 seconds of startup you should see one of:

- `No persisted daily model — will fetch on first opportunity` followed shortly by `Daily model refreshed: <name> (openrouter/<id>)` — first-boot success path.
- `Loaded persisted daily model: openrouter/<id>` — subsequent-boot path (only after a prior successful fetch).
- `Failed to refresh daily model: <reason> — keeping current value` — endpoint or network failure; expected to fall back to hardcoded defaults.

- [ ] **Step 3: Confirm the state file**

In another terminal:

```bash
cat data/daily-model.json
```

Expected (after a successful refresh): JSON with `id`, `name`, and `updatedAt` fields. Example:

```json
{
  "id": "google/gemini-flash-1.5",
  "name": "Gemini Flash 1.5",
  "updatedAt": "2026-05-27T17:00:00.000Z"
}
```

- [ ] **Step 4: Confirm an agent uses the daily model**

In Mastra Studio at `http://localhost:4111`, open the `researcher` agent and send a one-line message ("ping"). In the trace, the model name shown for the call should be `openrouter/<id>` matching the value in `data/daily-model.json`. (If the trace shows the hardcoded default `openrouter/anthropic/claude-sonnet-4.5`, either the fetch failed or `getDailyModel()` returned null — re-check Step 2 logs.)

- [ ] **Step 5: Stop the server**

`Ctrl+C` in the `npm run dev` terminal.

No commit — verification only.

---

## Self-review notes

- All spec requirements have task coverage: rotation (Task 2 + 4), thunk-form router (Task 3), persistence + fallback (Task 2), `.gitignore` (Task 1), env key requirement called out in Task 5.
- No placeholders or "TBD" markers. Every code step shows the full code.
- Method names are stable across tasks: `getDailyModel`, `refreshDailyModel`, `startDailyModelScheduler`, `loadPersisted`.
- No new dependencies; only Node built-ins and the existing Zod.
- No test framework added — verification is via `tsc`, `npm run build`, and the Studio smoke check in Task 5.
