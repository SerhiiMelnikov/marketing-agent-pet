/**
 * Matches http(s) URLs found in a report. Excludes whitespace and common
 * surrounding punctuation (parens, brackets, CJK brackets, quotes, angle
 * brackets) so a citation like `(https://x.com)` parses to `https://x.com`
 * cleanly.
 */
const URL_REGEX = /https?:\/\/[^\s)\]】"'<>]+/g;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  return matches.map((u) => u.replace(/[.,;]+$/, ''));
}

export function extractDomains(text: string): string[] {
  const domains = extractUrls(text)
    .map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  return [...new Set(domains)];
}
