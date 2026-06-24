import { env } from '../../config/env';
import { ModelRole } from './model-role.enum';
import type { MastraModelId } from './types';

export { ModelRole } from './model-role.enum';
export type { MastraModelId } from './types';
export { mastraModelIdSchema, mastraModelIdPoolSchema } from './mastra-model-id';

const DEFAULT_MODELS: Record<ModelRole, MastraModelId> = {
  researcher: 'anthropic/claude-haiku-4-5',
  synthesizer: 'anthropic/claude-sonnet-4-6',
  cheap: 'google/gemma-4-31b-it',
};

const POOLS: Partial<Record<ModelRole, readonly MastraModelId[]>> = {
  researcher: env.MODEL_RESEARCHER_POOL,
  synthesizer: env.MODEL_SYNTHESIZER_POOL,
  cheap: env.MODEL_CHEAP_POOL,
};

/**
 * Per-role round-robin counters. Each `model(role)()` call advances the
 * counter for its role and returns the next pool entry, so traffic is
 * distributed roughly equally across the configured providers.
 *
 * In-memory only — resets on process restart. That's fine: the goal is
 * to spread load across providers within a single agent run, not to
 * persist exact-ratio scheduling across deployments.
 */
const counters: Record<ModelRole, number> = {
  researcher: 0,
  synthesizer: 0,
  cheap: 0,
};

function pickFromPool(role: ModelRole): MastraModelId | null {
  const pool = POOLS[role];

  if (!pool?.length) return null;

  const idx = counters[role] % pool.length;
  counters[role] += 1;

  return pool[idx];
}

/**
 * Resolution order on each call:
 *   1. Pool round-robin (MODEL_<ROLE>_POOL) — even distribution.
 *      A single-entry pool acts as a hard override.
 *   2. Hardcoded default (DEFAULT_MODELS).
 */
export const model = (role: ModelRole) => (): MastraModelId =>
  pickFromPool(role) ?? DEFAULT_MODELS[role];

const describe = (role: ModelRole) => {
  const pool = POOLS[role];

  return pool?.length ? `pool: [${pool.join(', ')}]` : DEFAULT_MODELS[role];
};

/**
 * Human-readable view of what's configured for each role. Pools are
 * rendered as their full member list; daily / default show as a single id.
 */
export const describeModels = () => ({
  researcher: describe(ModelRole.Researcher),
  synthesizer: describe(ModelRole.Synthesizer),
  cheap: describe(ModelRole.Cheap),
});
