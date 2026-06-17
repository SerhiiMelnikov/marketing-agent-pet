import Exa from 'exa-js';
import { SearchProviderName } from '../enums/provider.enum';
import type { SearchProvider, SearchQuery, SearchResult } from '../types';

/**
 * Cap on per-result page text. Exa truncates server-side, so this bounds the
 * tokens the researcher re-sends on every step of its loop. ~8000 chars ≈ 2k
 * tokens — enough for facts/figures; deeper reads go through `fetch-url`.
 */
const MAX_CONTENT_CHARS = 8000;

export class ExaProvider implements SearchProvider {
  readonly name = SearchProviderName.Exa;

  private readonly exa: Exa;

  constructor(apiKey: string) {
    this.exa = new Exa(apiKey);
  }

  async search({
    query,
    includeDomains,
    excludeDomains,
    maxResults,
  }: SearchQuery): Promise<SearchResult[]> {
    const { results } = await this.exa.searchAndContents(query, {
      numResults: maxResults,
      includeDomains,
      excludeDomains,
      highlights: true,
      text: { maxCharacters: MAX_CONTENT_CHARS },
    });

    return results.map((r) => ({
      url: r.url,
      title: r.title ?? '',
      snippet: r.highlights?.join(' … ') ?? '',
      content: r.text || undefined,
    }));
  }
}
