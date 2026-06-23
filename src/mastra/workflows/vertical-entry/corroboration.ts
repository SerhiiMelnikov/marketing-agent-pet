// src/mastra/workflows/vertical-entry/corroboration.ts

import type { ResearchMemory } from '../../schemas/research-memory';

/**
 * Classifiers that do NOT count as authoritative grounding. `vendor` is
 * self-marketing; `other` is the unclassifiable bucket. A competitor or trend
 * backed only by these is what A9 must not let stand. Everything else
 * (government, analyst, consulting, trade-press, sec-filing, company-ir) counts.
 */
const NON_AUTHORITATIVE = new Set(['vendor', 'other']);

/**
 * Canonical key for matching a competitor/trend source URL against a
 * `sourcesConsulted` entry. Ignores protocol (http vs https), a leading
 * `www.`, the query string, the fragment, and a trailing slash — the URL
 * variations an LLM routinely introduces when it re-types the same source
 * into two schema fields. Falls back to a lower-cased trim for inputs that
 * are not parseable URLs.
 */
const normalizeUrl = (url: string): string => {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');

    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
};

const truncate = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export interface CorroborationVerdict {
  label: string;
  corroborated: boolean;
}

export interface CorroborationReport {
  competitors: CorroborationVerdict[];
  trends: CorroborationVerdict[];
}

/**
 * For each competitor and trend, decide whether it cites at least one
 * authoritative source, cross-referencing its URLs against the classifiers the
 * researcher recorded in `sourcesConsulted`. A URL absent from
 * `sourcesConsulted` is unknown → treated as non-authoritative.
 */
export function assessCorroboration(m: ResearchMemory): CorroborationReport {
  const classifierByUrl = new Map<string, string>();
  for (const s of m.sourcesConsulted) {
    classifierByUrl.set(normalizeUrl(s.url), s.classifier);
  }

  const isAuthoritative = (url: string): boolean => {
    const c = classifierByUrl.get(normalizeUrl(url));

    return c !== undefined && !NON_AUTHORITATIVE.has(c);
  };

  return {
    competitors: m.competitors.map((c) => ({
      label: c.name,
      corroborated: c.sources.some(isAuthoritative),
    })),
    trends: m.marketTrends.map((t) => ({
      label: t.claim,
      corroborated: isAuthoritative(t.sourceUrl),
    })),
  };
}

/**
 * Deficit lines for the research gate. Each gives the researcher two outs —
 * find an authoritative source OR remove the unverifiable item — so the loop
 * can converge by cleaning junk, not only by sourcing it.
 */
export function corroborationDeficits(m: ResearchMemory): string[] {
  const report = assessCorroboration(m);
  const deficits: string[] = [];

  for (const c of report.competitors) {
    if (!c.corroborated) {
      deficits.push(
        `competitor "${truncate(c.label)}": only vendor/other-classified sources — add an analyst / trade-press / government / SEC source, OR remove it if unverifiable`,
      );
    }
  }
  for (const t of report.trends) {
    if (!t.corroborated) {
      deficits.push(
        `marketTrend "${truncate(t.label)}": source is vendor/other — ground it in an analyst/government source, OR drop the claim`,
      );
    }
  }

  return deficits;
}

/**
 * Prompt block for the synthesizer: items still uncorroborated after the
 * research loop. Returns null when everything is corroborated.
 */
export function corroborationFlagBlock(m: ResearchMemory): string | null {
  const report = assessCorroboration(m);
  const competitors = report.competitors.filter((c) => !c.corroborated).map((c) => c.label);
  const trends = report.trends.filter((t) => !t.corroborated).map((t) => t.label);

  if (!competitors.length && !trends.length) return null;

  const lines = [
    ...competitors.map((c) => `  - competitor: ${c}`),
    ...trends.map((t) => `  - trend: ${truncate(t)}`),
  ];

  return [
    'The following findings lack an authoritative source (only vendor/self-marketing).',
    'Present them under "Confidence & Gaps" as unverified — NOT as confirmed competitors/trends:',
    ...lines,
  ].join('\n');
}
