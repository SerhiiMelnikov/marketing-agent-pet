import { z } from 'zod';
import process from 'node:process';
import { SearchProviderName } from '../modules/search/enums/provider.enum';
import { mastraModelIdPoolSchema } from '../modules/model/mastra-model-id';
import { ONIX } from '../modules/companies/onix';

const envSchema = z.object({
  SEARCH_PROVIDER: z.enum(SearchProviderName).default(SearchProviderName.Exa),
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  // Model provider keys. Mastra's model router reads these directly from
  // process.env by name; we declare them here only for fail-fast validation.
  // The active routing uses Anthropic (synthesizer) + Google (researcher,
  // cheap judge) directly — no OpenRouter gateway. OPENROUTER_API_KEY stays
  // optional so an openrouter/* pool entry still works if reintroduced.
  ANTHROPIC_API_KEY: z.string().min(1),
  GOOGLE_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().trim().min(1).optional(),
  // Comma-separated pool. The router round-robins between entries so
  // traffic is roughly even across providers. A single-entry pool acts
  // as a hard override ("always use exactly this model").
  MODEL_RESEARCHER_POOL: mastraModelIdPoolSchema,
  MODEL_SYNTHESIZER_POOL: mastraModelIdPoolSchema,
  MODEL_CHEAP_POOL: mastraModelIdPoolSchema,
  APP_URL: z.url().optional(),
  DEFAULT_COMPANY_KEY: z.string().min(1).default(ONIX.key),
});

export const env = envSchema.parse(process.env);
