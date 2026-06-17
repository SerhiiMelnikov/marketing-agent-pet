import { env } from '../../config/env';
import type { SearchProvider } from './types';
import { SearchProviderName } from './enums/provider.enum';
import { TavilyProvider } from './providers/tavily.provider';
import { ExaProvider } from './providers/exa.provider';

let providers: Map<SearchProviderName, SearchProvider> | null = null;

export function init() {
  if (providers) return;

  providers = new Map<SearchProviderName, SearchProvider>();

  if (env.TAVILY_API_KEY) {
    providers.set(SearchProviderName.Tavily, new TavilyProvider({ apiKey: env.TAVILY_API_KEY }));
  }

  if (env.EXA_API_KEY) {
    providers.set(SearchProviderName.Exa, new ExaProvider(env.EXA_API_KEY));
  }

  if (!providers.get(env.SEARCH_PROVIDER)) {
    throw new Error(`SEARCH_PROVIDER=${env.SEARCH_PROVIDER} but its API key is not set`);
  }

  return providers;
}

export function get(name?: SearchProviderName): SearchProvider {
  if (!providers) {
    throw new Error('Search providers not initialized — call init() at startup');
  }

  const key = name ?? env.SEARCH_PROVIDER;
  const provider = providers.get(key);

  if (!provider) {
    throw new Error(`Search provider "${key}" is not configured`);
  }

  return provider;
}

export function available() {
  return providers ? [...providers.keys()] : [];
}
