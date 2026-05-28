import { z } from 'zod';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OpenRouterModel } from './openrouter-model';
import { ENDPOINT, FETCH_TIMEOUT_MS, STATE_FILE, REFRESH_INTERVAL_MS } from './constants';

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

export const getDailyModel = () => currentDailyModel;

export async function refreshDailyModel() {
  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    const parsed = responseSchema.parse(json);
    const top = parsed.models[0];
    const rawId = top.id.replace(/^openrouter\//, '');
    const fullId = `openrouter/${rawId}` as OpenRouterModel;

    await mkdir(dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify({ id: rawId, name: top.name, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    await rename(tmp, STATE_FILE);

    currentDailyModel = fullId;

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
      const rawId = persisted.id.replace(/^openrouter\//, '');
      currentDailyModel = `openrouter/${rawId}` as OpenRouterModel;
      console.info(`Loaded persisted daily model: openrouter/${rawId}`);
    } else {
      console.info('No persisted daily model — will fetch on first opportunity');
    }

    const ageMs = persisted
      ? Date.now() - new Date(persisted.updatedAt).getTime()
      : Number.POSITIVE_INFINITY;

    if (ageMs > REFRESH_INTERVAL_MS) {
      void refreshDailyModel();
    }

    setInterval(() => void refreshDailyModel(), REFRESH_INTERVAL_MS);
  })();
}
