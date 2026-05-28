import { SearchProviderName } from './enums/provider.enum';
import * as Providers from './factory';
import { deprioritizeGated } from './domain-presets';
import type { SearchQuery, SearchResult } from './types';

export type { SearchQuery, SearchResult, SearchProvider } from './types';

export interface SearchOptions {
  provider?: SearchProviderName;
}

export async function search(
  query: SearchQuery,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const provider = Providers.get(options.provider);
  const results = await provider.search(query);

  return deprioritizeGated(results);
}

export function init() {
  Providers.init();
}
