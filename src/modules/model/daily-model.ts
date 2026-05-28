import { z } from 'zod';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type OpenRouterModel, toOpenRouterId } from './openrouter-model';
import {
  ENDPOINT,
  MODEL_EXPR,
  FETCH_TIMEOUT_MS,
  REFRESH_INTERVAL_MS,
  STATE_FILE,
  FILE_ENCODING,
} from './constants';
import { getErrMsg } from '../../utils/errors';

const responseSchema = z.object({
  models: z
    .array(
      z.object({
        id: z.string().regex(MODEL_EXPR),
        name: z.string(),
      }),
    )
    .min(1),
});

const persistedSchema = z.object({
  id: z.string().regex(MODEL_EXPR),
  name: z.string(),
  updatedAt: z.iso.datetime(),
});

type Model = {
  id: OpenRouterModel;
  name: string;
};

let currentDailyModel: OpenRouterModel | null = null;

export const getDailyModel = () => currentDailyModel;

async function fetchModel(): Promise<Model> {
  const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json: unknown = await res.json();
  const { models: [top] } = responseSchema.parse(json);
  
  return {
    id: toOpenRouterId(top.id),
    name: top.name,
  };
}

async function persist(model: Model) {
  const tmp = `${STATE_FILE}.tmp`;
  
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(
    tmp,
    JSON.stringify({ ...model, updatedAt: new Date().toISOString() }, null, 2),
    FILE_ENCODING,
  );
  await rename(tmp, STATE_FILE);
}

async function loadPersisted(): Promise<z.infer<typeof persistedSchema> | null> {
  try {
    const raw = await readFile(STATE_FILE, FILE_ENCODING);
    const json: unknown = JSON.parse(raw);

    return persistedSchema.parse(json);
  } catch {
    return null;
  }
}

export async function refreshDailyModel(): Promise<void> {
  try {
    const model = await fetchModel();

    await persist(model);
    currentDailyModel = model.id;
    console.info(`Daily model refreshed: ${model.name} (${model.id})`);
  } catch (err) {
    console.warn(`Failed to refresh daily model: ${getErrMsg(err)} — keeping current value`);
  }
}

export function startDailyModelScheduler() {
  void (async () => {
    const persisted = await loadPersisted();

    if (persisted) {
      currentDailyModel = toOpenRouterId(persisted.id);
      console.info(`Loaded persisted daily model: ${currentDailyModel}`);
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
