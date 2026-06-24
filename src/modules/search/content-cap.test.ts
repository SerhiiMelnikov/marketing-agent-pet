import { describe, it, expect } from 'vitest';
import type { SearchResult } from './types';
import { capResultContent, CONTENT_RESULT_LIMIT } from './content-cap';

const make = (n: number): SearchResult[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `https://x.com/${i}`,
    title: `t${i}`,
    snippet: `s${i}`,
    content: `c${i}`,
  }));

describe('capResultContent', () => {
  it('keeps content on the first CONTENT_RESULT_LIMIT results', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT + 2));

    for (let i = 0; i < CONTENT_RESULT_LIMIT; i++) {
      expect(out[i].content).toBe(`c${i}`);
    }
  });

  it('strips content from results past the limit', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT + 2));

    expect(out[CONTENT_RESULT_LIMIT].content).toBeUndefined();
    expect(out[CONTENT_RESULT_LIMIT + 1].content).toBeUndefined();
  });

  it('preserves order and every non-content field', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT + 1));
    const last = out[CONTENT_RESULT_LIMIT];

    expect(out.map((r) => r.url)).toEqual(make(CONTENT_RESULT_LIMIT + 1).map((r) => r.url));
    expect(last.title).toBe(`t${CONTENT_RESULT_LIMIT}`);
    expect(last.snippet).toBe(`s${CONTENT_RESULT_LIMIT}`);
  });

  it('keeps content on every result at exactly the limit', () => {
    const out = capResultContent(make(CONTENT_RESULT_LIMIT));

    expect(out.every((r) => r.content !== undefined)).toBe(true);
  });

  it('returns an empty array unchanged', () => {
    expect(capResultContent([])).toEqual([]);
  });
});
