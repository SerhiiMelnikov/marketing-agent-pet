import { describe, it, expect } from 'vitest';
import { isFinalReport, hasLeakedToolCall } from './extract-report-text';

const fullReport = `
## Executive Summary
${'Lorem ipsum dolor sit amet. '.repeat(40)}

## Market Trends
Trend one with evidence.

## Competitor Landscape
Competitor profiles here.

## Sources
[1] Example — https://example.com
`;

describe('isFinalReport', () => {
  it('accepts a long report that hits enough section headings', () => {
    expect(fullReport.length).toBeGreaterThan(800);
    expect(isFinalReport(fullReport)).toBe(true);
  });

  it('rejects text below the minimum length', () => {
    expect(isFinalReport('too short')).toBe(false);
  });

  it('rejects a long report with too few sections', () => {
    const thin = '## Executive Summary\n' + 'filler text. '.repeat(80);
    expect(thin.length).toBeGreaterThan(800);
    expect(isFinalReport(thin)).toBe(false);
  });

  it('rejects text containing a leaked tool-call marker (garbage)', () => {
    expect(isFinalReport(fullReport + '\n<tool_call>{}</tool_call>')).toBe(false);
  });
});

describe('hasLeakedToolCall', () => {
  it('detects a leaked tool-call marker in prose', () => {
    expect(hasLeakedToolCall('here is <tool_call> leaking')).toBe(true);
  });

  it('detects a leaked function-call marker', () => {
    expect(hasLeakedToolCall('text <function= foo>')).toBe(true);
  });

  it('ignores tool-call markup inside fenced code', () => {
    expect(hasLeakedToolCall('```\n<tool_call>\n```')).toBe(false);
  });

  it('is false for empty text', () => {
    expect(hasLeakedToolCall('')).toBe(false);
  });
});
