// src/modules/verticals/index.ts

import type { VerticalBias, ResolvedBias } from './types';
import { SHARED_SEC_AND_CORPORATE, SHARED_ANALYSTS, SHARED_CONSULTING } from './shared';
import { HEALTHCARE } from './healthcare';
import { FINANCE } from './finance';
import { BTR } from './btr';

export type { VerticalBias, ResolvedBias } from './types';

/** First-match wins; keep aliases specific to avoid collisions. */
const VERTICALS: VerticalBias[] = [HEALTHCARE, FINANCE, BTR];

/**
 * Resolve the brief's free-text vertical to an authoritative-domain bias.
 * Pure: on no match it returns the shared baseline with `matchedKey: null`;
 * the caller decides whether to warn.
 */
export function resolveVerticalBias(verticalText: string): ResolvedBias {
  const text = verticalText.toLowerCase();
  const match = VERTICALS.find((v) => v.aliases.some((a) => text.includes(a)));

  return {
    matchedKey: match?.key ?? null,
    government: match?.government ?? [],
    secAndCorporate: SHARED_SEC_AND_CORPORATE,
    analysts: [...SHARED_ANALYSTS, ...(match?.analysts ?? [])],
    consulting: SHARED_CONSULTING,
    tradePress: match?.tradePress ?? [],
  };
}

/** Render the resolved bias as the markdown block injected into the researcher's
 *  dynamic prompt. Empty categories (e.g. gov/trade on the generic fallback) are
 *  omitted. */
export function renderSourceBias(bias: ResolvedBias): string {
  const line = (label: string, domains: string[]) =>
    domains.length ? `  - **${label}**: ${domains.join(', ')}` : null;

  const categories = [
    line('Primary government / regulatory', bias.government),
    line('SEC filings & official corporate', bias.secAndCorporate),
    line('Analyst firms', bias.analysts),
    line('Consulting publications', bias.consulting),
    line('Trade press', bias.tradePress),
  ].filter((l): l is string => l !== null);

  return [
    '## Authoritative source bias',
    '',
    '**Strongly prefer** these domains — pass the relevant subset as `includeDomains` per query (government first, then analyst / consulting / trade press). `includeDomains` is hard-enforced, so a too-narrow list returns few results; widen or omit for open discovery. For consulting, use insights/research articles only — not /services/ or /solutions/ pages.',
    '',
    ...categories,
  ].join('\n');
}
