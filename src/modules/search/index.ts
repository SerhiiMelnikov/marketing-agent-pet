import { SearchProviderName } from './enums/provider.enum';
import * as Providers from './factory';
import { deprioritizeGated, withDefaultExcludes } from './domain-presets';
import { capResultContent } from './content-cap';
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
  const results = await provider.search(withDefaultExcludes(query));

  return capResultContent(deprioritizeGated(results));
}

export function init() {
  Providers.init();
}
