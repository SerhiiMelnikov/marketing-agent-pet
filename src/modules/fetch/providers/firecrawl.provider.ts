import Firecrawl, {
  type FirecrawlClientOptions,
  type FirecrawlClient,
} from '@mendable/firecrawl-js';
import type { FetchRequest, FetchResult, FetchProvider } from '../types';
import { FetchProviderName } from '../enums/provider-name.enum';
import { FetchError } from '../error';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { getErrMsg } from '../../../utils/errors';

export class FirecrawlProvider implements FetchProvider {
  readonly name = FetchProviderName.Firecrawl;
  private readonly client: FirecrawlClient;

  constructor(config: FirecrawlClientOptions) {
    const cfgWithDefaults = { ...config };

    cfgWithDefaults.timeoutMs ??= DEFAULT_TIMEOUT_MS;

    this.client = new Firecrawl(cfgWithDefaults);
  }

  canHandle(request: FetchRequest) {
    try {
      const url = new URL(request.url);

      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async fetchOrError(request: FetchRequest) {
    try {
      return await this.client.scrape(request.url, {
        formats: ['markdown'],
        onlyMainContent: true,
      });
    } catch (err) {
      throw new FetchError(
        `Firecrawl scrape failed: ${getErrMsg(err)}`,
        request.url,
        this.name,
        err,
      );
    }
  }

  async fetch(request: FetchRequest): Promise<FetchResult> {
    const { markdown, metadata } = await this.fetchOrError(request);

    if (!markdown?.trim().length) {
      throw new FetchError('Firecrawl returned no markdown content', request.url, this.name);
    }

    return {
      url: request.url,
      finalUrl: metadata?.sourceURL ?? request.url,
      title: metadata?.title,
      markdown,
      source: this.name,
      fetchedAt: new Date().toISOString(),
    };
  }
}
