import { env } from '../../config/env';
import { getDailyModel } from './daily-model';
import type { OpenRouterModel } from './openrouter-model';
import { ModelRole } from './model-role.enum';

type RoleModelMap = Record<ModelRole, OpenRouterModel>;

const DEFAULT_MODELS: RoleModelMap = {
  researcher: 'openrouter/anthropic/claude-sonnet-4.5',
  synthesizer: 'openrouter/anthropic/claude-opus-4.7',
  cheap: 'openrouter/google/gemini-2.5-flash',
};

const OVERRIDES: Partial<RoleModelMap> = {
  researcher: env.MODEL_RESEARCHER,
  synthesizer: env.MODEL_SYNTHESIZER,
  cheap: env.MODEL_CHEAP,
};

export function model(role: ModelRole): () => OpenRouterModel {
  return () => getDailyModel() ?? OVERRIDES[role] ?? DEFAULT_MODELS[role];
}

export const describeModels = () => {
  const daily = getDailyModel();

  return {
    researcher: daily ?? OVERRIDES.researcher ?? DEFAULT_MODELS.researcher,
    synthesizer: daily ?? OVERRIDES.synthesizer ?? DEFAULT_MODELS.synthesizer,
    cheap: daily ?? OVERRIDES.cheap ?? DEFAULT_MODELS.cheap,
  };
};
