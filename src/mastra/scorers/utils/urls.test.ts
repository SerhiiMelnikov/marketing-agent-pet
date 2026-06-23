import { describe, it, expect } from 'vitest';
import { extractUrls, extractDomains } from './urls';

describe('extractUrls', () => {
  it('extracts URLs and strips wrapping punctuation / trailing dots', () => {
    expect(extractUrls('see (https://x.com/a) and https://y.com.')).toEqual([
      'https://x.com/a',
      'https://y.com',
    ]);
  });

  it('returns an empty array when there are no URLs', () => {
    expect(extractUrls('no links here')).toEqual([]);
  });
});

describe('extractDomains', () => {
  it('returns de-duplicated, www-stripped hostnames', () => {
    expect(
      extractDomains('https://www.x.com/a https://x.com/b https://y.org/c'),
    ).toEqual(['x.com', 'y.org']);
  });
});
