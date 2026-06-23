import { describe, it, expect } from 'vitest';
import type { ResearchMemory } from '../../schemas/research-memory';
import {
  assessCorroboration,
  corroborationDeficits,
  corroborationFlagBlock,
} from './corroboration';

const mem = (over: Partial<{
  marketTrends: { claim: string; sourceUrl: string }[];
  competitors: { name: string; sources: string[] }[];
  sourcesConsulted: { url: string; classifier: string }[];
}>): ResearchMemory =>
  ({
    marketTrends: over.marketTrends ?? [],
    competitors: over.competitors ?? [],
    sourcesConsulted: over.sourcesConsulted ?? [],
  }) as unknown as ResearchMemory;

describe('assessCorroboration — URL canonicalization', () => {
  it('matches across http/https, www., query and trailing slash', () => {
    const m = mem({
      marketTrends: [
        { claim: 'http vs https', sourceUrl: 'http://gartner.com/r' },
        { claim: 'www + query', sourceUrl: 'https://www.gartner.com/r?utm=x' },
      ],
      competitors: [{ name: 'Slash', sources: ['https://everestgrp.com/x/'] }],
      sourcesConsulted: [
        { url: 'https://gartner.com/r', classifier: 'analyst' },
        { url: 'https://everestgrp.com/x', classifier: 'analyst' },
      ],
    });
    const r = assessCorroboration(m);

    expect(r.trends.map((t) => t.corroborated)).toEqual([true, true]);
    expect(r.competitors[0].corroborated).toBe(true);
  });
});

describe('assessCorroboration — authority rule', () => {
  it('treats vendor/other as non-authoritative and everything else as authoritative', () => {
    const m = mem({
      competitors: [
        { name: 'Vend', sources: ['https://v.example/a'] },
        { name: 'Other', sources: ['https://o.example/a'] },
        { name: 'Gov', sources: ['https://g.example/a'] },
        { name: 'IR', sources: ['https://ir.example/a'] },
      ],
      sourcesConsulted: [
        { url: 'https://v.example/a', classifier: 'vendor' },
        { url: 'https://o.example/a', classifier: 'other' },
        { url: 'https://g.example/a', classifier: 'government' },
        { url: 'https://ir.example/a', classifier: 'company-ir' },
      ],
    });

    expect(assessCorroboration(m).competitors.map((c) => c.corroborated)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('treats a URL absent from sourcesConsulted as non-authoritative and resolves it as unclassified', () => {
    const m = mem({
      competitors: [{ name: 'Ghost', sources: ['https://missing.example/a'] }],
      sourcesConsulted: [],
    });
    const v = assessCorroboration(m).competitors[0];

    expect(v.corroborated).toBe(false);
    expect(v.sources).toEqual([{ url: 'https://missing.example/a', classifier: 'unclassified' }]);
  });

  it('corroborates a competitor when ANY one source is authoritative', () => {
    const m = mem({
      competitors: [{ name: 'Mixed', sources: ['https://v.example/a', 'https://a.example/a'] }],
      sourcesConsulted: [
        { url: 'https://v.example/a', classifier: 'vendor' },
        { url: 'https://a.example/a', classifier: 'analyst' },
      ],
    });

    expect(assessCorroboration(m).competitors[0].corroborated).toBe(true);
  });
});

describe('corroborationDeficits', () => {
  it('names the offending trend source URL and its classifier', () => {
    const m = mem({
      marketTrends: [{ claim: 'Vendor trend', sourceUrl: 'https://v.example/post' }],
      sourcesConsulted: [{ url: 'https://v.example/post', classifier: 'vendor' }],
    });
    const d = corroborationDeficits(m);

    expect(d).toHaveLength(1);
    expect(d[0]).toContain('https://v.example/post');
    expect(d[0]).toContain('"vendor"');
    expect(d[0]).toContain('drop the claim');
  });

  it('lists a competitor\'s sources with classifiers incl. unclassified, and offers removal', () => {
    const m = mem({
      competitors: [{ name: 'JunkCo', sources: ['https://j.example/a', 'https://u.example/x'] }],
      sourcesConsulted: [{ url: 'https://j.example/a', classifier: 'vendor' }],
    });
    const d = corroborationDeficits(m);

    expect(d).toHaveLength(1);
    expect(d[0]).toContain('JunkCo');
    expect(d[0]).toContain('(vendor)');
    expect(d[0]).toContain('(unclassified)');
    expect(d[0]).toContain('remove it');
  });

  it('returns no deficits when everything is corroborated', () => {
    const m = mem({
      competitors: [{ name: 'Good', sources: ['https://a.example/a'] }],
      marketTrends: [{ claim: 'ok', sourceUrl: 'https://a.example/a' }],
      sourcesConsulted: [{ url: 'https://a.example/a', classifier: 'analyst' }],
    });

    expect(corroborationDeficits(m)).toEqual([]);
  });
});

describe('corroborationFlagBlock', () => {
  it('returns null when all findings are corroborated', () => {
    const m = mem({
      competitors: [{ name: 'Good', sources: ['https://a.example/a'] }],
      sourcesConsulted: [{ url: 'https://a.example/a', classifier: 'analyst' }],
    });

    expect(corroborationFlagBlock(m)).toBeNull();
  });

  it('lists uncorroborated competitors and trends under a Confidence & Gaps instruction', () => {
    const m = mem({
      competitors: [{ name: 'VendorOnly', sources: ['https://v.example/a'] }],
      marketTrends: [{ claim: 'Vendor trend', sourceUrl: 'https://v.example/a' }],
      sourcesConsulted: [{ url: 'https://v.example/a', classifier: 'vendor' }],
    });
    const block = corroborationFlagBlock(m);

    expect(block).not.toBeNull();
    expect(block).toContain('Confidence & Gaps');
    expect(block).toContain('competitor: VendorOnly');
    expect(block).toContain('trend: Vendor trend');
  });
});
