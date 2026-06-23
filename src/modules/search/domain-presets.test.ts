import { describe, it, expect } from 'vitest';
import type { SearchResult } from './types';
import { enforceIncludeDomains, withDefaultExcludes, deprioritizeGated } from './domain-presets';

const R = (url: string): SearchResult => ({ url, title: '', snippet: '' });

describe('enforceIncludeDomains', () => {
  it('is a no-op when the list is empty or absent', () => {
    expect(enforceIncludeDomains([R('https://x.com/a')], [])).toHaveLength(1);
    expect(enforceIncludeDomains([R('https://x.com/a')], undefined)).toHaveLength(1);
  });

  it('keeps the exact host and subdomains, drops off-list hosts', () => {
    const out = enforceIncludeDomains(
      [
        R('https://www.mckinsey.com/insights/x'),
        R('https://insights.mckinsey.com/y'),
        R('https://elevancesystems.com/about'),
      ],
      ['mckinsey.com'],
    );

    expect(out.map((r) => r.url)).toEqual([
      'https://www.mckinsey.com/insights/x',
      'https://insights.mckinsey.com/y',
    ]);
  });

  it('normalizes www./casing on the include entry', () => {
    expect(enforceIncludeDomains([R('https://gartner.com/a')], ['WWW.Gartner.com'])).toHaveLength(1);
  });

  it('returns empty when every result is off-list', () => {
    expect(enforceIncludeDomains([R('https://elevancesystems.com/a')], ['gartner.com'])).toEqual([]);
  });

  it('does not treat foo-mckinsey.com as a subdomain of mckinsey.com', () => {
    expect(enforceIncludeDomains([R('https://foo-mckinsey.com/a')], ['mckinsey.com'])).toEqual([]);
  });

  it('drops unparseable URLs', () => {
    expect(enforceIncludeDomains([R('not a url')], ['gartner.com'])).toEqual([]);
  });
});

describe('withDefaultExcludes', () => {
  it('unions the default denylist into excludeDomains and preserves the agent\'s excludes', () => {
    const out = withDefaultExcludes({ query: 'q', excludeDomains: ['Custom.com'] });

    expect(out.excludeDomains).toContain('imarcgroup.com'); // a known default-denylist entry
    expect(out.excludeDomains).toContain('custom.com'); // agent entry, normalized
  });

  it('normalizes and de-duplicates', () => {
    const out = withDefaultExcludes({ query: 'q', excludeDomains: ['www.imarcgroup.com'] });
    const occurrences = out.excludeDomains!.filter((d) => d === 'imarcgroup.com').length;

    expect(occurrences).toBe(1);
  });

  it('leaves includeDomains and query untouched', () => {
    const out = withDefaultExcludes({ query: 'q', includeDomains: ['gartner.com'] });

    expect(out.includeDomains).toEqual(['gartner.com']);
    expect(out.query).toBe('q');
  });
});

describe('deprioritizeGated', () => {
  it('moves gated URLs to the bottom, keeping non-gated order stable', () => {
    const out = deprioritizeGated([
      R('https://everestgrp.com/report/abc'),
      R('https://healthcareitnews.com/a'),
      R('https://fiercehealthcare.com/b'),
    ]);

    expect(out.map((r) => r.url)).toEqual([
      'https://healthcareitnews.com/a',
      'https://fiercehealthcare.com/b',
      'https://everestgrp.com/report/abc',
    ]);
  });

  it('leaves an all-non-gated list unchanged', () => {
    const urls = ['https://a.com/1', 'https://b.com/2'];
    const out = deprioritizeGated(urls.map(R));

    expect(out.map((r) => r.url)).toEqual(urls);
  });

  it('also sinks the gartner-documents and forrester-report gated patterns', () => {
    const out = deprioritizeGated([
      R('https://gartner.com/en/documents/123'),
      R('https://news.example/a'),
      R('https://forrester.com/report/x'),
    ]);

    expect(out.map((r) => r.url)).toEqual([
      'https://news.example/a',
      'https://gartner.com/en/documents/123',
      'https://forrester.com/report/x',
    ]);
  });

  it('preserves relative order within both the gated and non-gated buckets', () => {
    const out = deprioritizeGated([
      R('https://everestgrp.com/report/1'),
      R('https://a.example/x'),
      R('https://forrester.com/report/2'),
      R('https://b.example/y'),
    ]);

    expect(out.map((r) => r.url)).toEqual([
      'https://a.example/x',
      'https://b.example/y',
      'https://everestgrp.com/report/1',
      'https://forrester.com/report/2',
    ]);
  });
});
