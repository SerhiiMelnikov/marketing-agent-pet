import { z } from 'zod';
import process from 'node:process';
import { SearchProviderName } from '../modules/search/enums/provider.enum';
import { mastraModelIdPoolSchema } from '../modules/model/mastra-model-id';
import { ONIX } from '../modules/companies/onix';

const envSchema = z.object({
  SEARCH_PROVIDER: z.enum(SearchProviderName).default(SearchProviderName.Tavily),
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().trim().nonempty(),
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
