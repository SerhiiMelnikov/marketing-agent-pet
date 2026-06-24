import { describe, it, expect } from 'vitest';
import { orphanCitations, citationFormatIssues } from './citations';

const withSources = (body: string, sources: string) => `${body}\n\n## Sources\n${sources}`;

describe('orphanCitations', () => {
  it('returns [] when every inline [N] is listed in Sources', () => {
    expect(orphanCitations(withSources('Body cites [1] and [2].', '[1] A — x\n[2] B — y'))).toEqual([]);
  });

  it('returns the inline markers missing from Sources', () => {
    expect(orphanCitations(withSources('Body cites [1] and [7].', '[1] A — x'))).toEqual(['[7]']);
  });

  it('does NOT flag a listed-but-uncited source as an orphan', () => {
    expect(orphanCitations(withSources('Body cites [1].', '[1] A — x\n[2] B — y'))).toEqual([]);
  });

  it('treats every inline [N] as orphan when there is no Sources section', () => {
    expect(orphanCitations('Body cites [1] with no sources section.')).toEqual(['[1]']);
  });
});

describe('citationFormatIssues', () => {
  it('returns [] for a clean report with [N] references', () => {
    expect(citationFormatIssues('Clean body with [1] and [2].')).toEqual([]);
  });

  it('flags a raw JSON/serialized citation leak', () => {
    expect(citationFormatIssues('text {"source": "x"} more').length).toBeGreaterThan(0);
  });

  it('flags native fullwidth citation markers', () => {
    expect(citationFormatIssues('text 【1†Source】 more').length).toBeGreaterThan(0);
    expect(citationFormatIssues('text 【2】 more').length).toBeGreaterThan(0);
  });
});
