import { env } from '../../config/env';
import type { FetchProvider } from './types';
import { FirecrawlProvider } from './providers/firecrawl.provider';

let chain: FetchProvider[] | null = null;

export function init() {
  if (chain) return;

  const providers: FetchProvider[] = [];

  if (env.FIRECRAWL_API_KEY) {
    providers.push(new FirecrawlProvider({ apiKey: env.FIRECRAWL_API_KEY }));
  }

  if (!providers.length) {
    throw new Error('No fetch providers configured');
  }

  chain = providers;
}

export function getChain() {
  if (!chain) {
    throw new Error('Fetch providers not initialized — call initFetchProviders() at startup');
  }

  return chain;
}
