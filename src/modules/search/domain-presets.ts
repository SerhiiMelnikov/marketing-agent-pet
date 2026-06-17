import type { SearchQuery, SearchResult } from './types';

/**
 * URL shapes that are typically behind a paywall or login wall, even though
 * the search snippet often contains usable information. We don't drop these
 * — the snippet may still carry the figure or quote we need — but we sort
 * them to the bottom so freely-fetchable results get fetched first.
 */
const GATED_URL_PATTERNS = [
  /everestgrp\.com\/report\//i,
  /gartner\.com\/.*\/documents\//i,
  /forrester\.com\/report\//i,
];

const isGated = (url: string) => GATED_URL_PATTERNS.some((p) => p.test(url));

/**
 * Stable sort that moves gated URLs to the bottom while preserving the
 * provider's original order within each bucket.
 */
export const deprioritizeGated = (results: SearchResult[]) =>
  [...results].sort((a, b) => +isGated(a.url) - +isGated(b.url));

/**
 * Domains always excluded from web search, regardless of what the agent passes.
 * SEO market-report vendors and vendor-marketing / "best-of" listicle sites whose
 * content is low-signal for grounded market research. Enforced in code (not just
 * the researcher prompt) so a search that omits `excludeDomains` is still filtered.
 * Transferred 1:1 from the researcher prompt's former "Always exclude" section.
 */
export const DEFAULT_EXCLUDE_DOMAINS = [
  // SEO market-report vendors
  'imarcgroup.com',
  'market.us',
  'sphericalinsights.com',
  'snsinsider.com',
  'grandviewresearch.com',
  'mordorintelligence.com',
  'marketsandmarkets.com',
  'precedenceresearch.com',
  'fortunebusinessinsights.com',
  // Vendor-marketing pages and "best-of" listicles
  'sumatosoft.com',
  'belitsoft.com',
  'dashtech.io',
  'softwareexpertsindia.com',
  'clutch.co',
  'goodfirms.co',
  'designrush.com',
  'techbehemoths.com',
] as const;

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/^www\./, '');

/**
 * Returns a copy of the query whose `excludeDomains` is the union of the agent's
 * excludes and DEFAULT_EXCLUDE_DOMAINS — normalized (lowercased, `www.` stripped)
 * and de-duplicated. `includeDomains` and all other fields are untouched.
 */
export const withDefaultExcludes = (query: SearchQuery): SearchQuery => {
  const merged = [...(query.excludeDomains ?? []), ...DEFAULT_EXCLUDE_DOMAINS].map(normalizeHost);

  return { ...query, excludeDomains: [...new Set(merged)] };
};
