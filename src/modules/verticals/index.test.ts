import { describe, it, expect } from 'vitest';
import { resolveVerticalBias, renderSourceBias } from './index';

describe('resolveVerticalBias', () => {
  it('matches healthcare from a longer phrase and merges shared + vertical domains', () => {
    const b = resolveVerticalBias('healthcare IT outsourcing');

    expect(b.matchedKey).toBe('healthcare');
    expect(b.government).toContain('cms.gov');
    expect(b.tradePress).toContain('fiercehealthcare.com');
    expect(b.analysts).toContain('gartner.com'); // shared
    expect(b.analysts).toContain('klasresearch.com'); // vertical-specific, merged
    expect(b.secAndCorporate).toContain('sec.gov'); // shared
  });

  it('matches finance', () => {
    const b = resolveVerticalBias('retail banking and fintech');

    expect(b.matchedKey).toBe('finance');
    expect(b.government).toContain('federalreserve.gov');
    expect(b.tradePress).toContain('americanbanker.com');
  });

  it('matches build-to-rent', () => {
    const b = resolveVerticalBias('build-to-rent housing');

    expect(b.matchedKey).toBe('btr');
    expect(b.government).toContain('hud.gov');
  });

  it('is case-insensitive', () => {
    expect(resolveVerticalBias('HEALTHCARE').matchedKey).toBe('healthcare');
  });

  it('falls back to generic shared bias (null key, empty gov/trade) on no match', () => {
    const b = resolveVerticalBias('underwater basket weaving');

    expect(b.matchedKey).toBeNull();
    expect(b.government).toEqual([]);
    expect(b.tradePress).toEqual([]);
    expect(b.analysts).toContain('gartner.com'); // shared still present
    expect(b.consulting).toContain('mckinsey.com');
  });
});

describe('renderSourceBias', () => {
  it('renders matched categories and omits empty ones', () => {
    const out = renderSourceBias(resolveVerticalBias('healthcare IT'));

    expect(out).toContain('## Authoritative source bias');
    expect(out).toContain('cms.gov');
    expect(out).toContain('Trade press');
    expect(out).toContain('fiercehealthcare.com');
  });

  it('omits government and trade-press lines for the generic fallback', () => {
    const out = renderSourceBias(resolveVerticalBias('unknown vertical'));

    expect(out).not.toContain('Primary government');
    expect(out).not.toContain('Trade press');
    expect(out).toContain('Analyst firms'); // shared category still rendered
  });
});
