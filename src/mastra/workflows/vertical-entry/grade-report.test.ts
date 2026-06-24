import { describe, it, expect } from 'vitest';
import { gradeReportStructure, renderRetryFeedback } from './grade-report';

const withSources = (body: string, sources: string) => `${body}\n\n## Sources\n${sources}`;

describe('gradeReportStructure', () => {
  it('passes a clean report with matching [N]/Sources', () => {
    const g = gradeReportStructure(withSources('Body cites [1] and [2].', '[1] A — x\n[2] B — y'));

    expect(g.passed).toBe(true);
    expect(g.issues).toEqual([]);
  });

  it('fails on an orphan citation and names the marker', () => {
    const g = gradeReportStructure(withSources('Body cites [1] and [7].', '[1] A — x'));

    expect(g.passed).toBe(false);
    expect(g.issues.join(' ')).toContain('[7]');
  });

  it('fails on a raw JSON citation leak', () => {
    const g = gradeReportStructure(withSources('Body {"source": "x"} cites [1].', '[1] A — x'));

    expect(g.passed).toBe(false);
    expect(g.issues.join(' ')).toMatch(/JSON/i);
  });

  it('passes when a listed source is merely uncited (unused does not gate)', () => {
    const g = gradeReportStructure(withSources('Body cites [1].', '[1] A — x\n[2] B — y'));

    expect(g.passed).toBe(true);
  });
});

describe('renderRetryFeedback', () => {
  it('renders the issues and the corrective instruction', () => {
    const out = renderRetryFeedback(['Inline citations [7] are not listed in the Sources section.']);

    expect(out).toContain('[7]');
    expect(out).toContain('Sources section');
  });
});
