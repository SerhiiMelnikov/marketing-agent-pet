import { z } from 'zod';
import process from 'node:process';
import { SearchProviderName } from '../src/modules/search/enums/provider.enum';

const envSchema = z.object({
  SEARCH_PROVIDER: z.enum(SearchProviderName).default(SearchProviderName.Tavily),
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().trim().nonempty(),
});

export const env = envSchema.parse(process.env);
