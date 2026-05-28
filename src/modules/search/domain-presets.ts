import type { SearchResult } from './types';

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
