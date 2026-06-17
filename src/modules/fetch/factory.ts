import { env } from '../../config/env';
import type { FetchProvider } from './types';
import { HttpReadabilityProvider } from './providers/http-readability.provider';
import { FirecrawlProvider } from './providers/firecrawl.provider';

let chain: FetchProvider[] | null = null;

export function init() {
  if (chain) return;

  // Own HTTP+Readability provider is always first and needs no API key.
  // Firecrawl is an optional fallback, appended only when its key is set.
  const providers: FetchProvider[] = [new HttpReadabilityProvider()];

  if (env.FIRECRAWL_API_KEY) {
    providers.push(new FirecrawlProvider({ apiKey: env.FIRECRAWL_API_KEY }));
  }

  chain = providers;
}

export function getChain() {
  if (!chain) {
    throw new Error('Fetch providers not initialized — call initFetchProviders() at startup');
  }

  return chain;
}
