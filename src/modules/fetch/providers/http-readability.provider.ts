import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { FetchRequest, FetchResult, FetchProvider } from '../types';
import { FetchProviderName } from '../enums/provider-name.enum';
import { FetchError } from '../error';
import { DEFAULT_TIMEOUT_MS, USER_AGENT, MAX_HTML_CHARS } from '../constants';
import { getErrMsg } from '../../../utils/errors';

const HTML_CONTENT_TYPE = /text\/html|application\/xhtml\+xml/i;

/**
 * Own fetch provider: HTTP GET → Readability main-content extraction → markdown.
 * HTML only. No JS rendering and no PDF parsing — unsupported pages throw a
 * FetchError so the chain records them as gaps. Caching, block detection, and
 * the short-content fallback live above this provider in `index.ts`.
 */
export class HttpReadabilityProvider implements FetchProvider {
  readonly name = FetchProviderName.HttpReadability;

  private readonly turndown = new TurndownService();

  canHandle(request: FetchRequest) {
    try {
      const { protocol } = new URL(request.url);

      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  async fetch(request: FetchRequest): Promise<FetchResult> {
    let response: Response;

    try {
      response = await fetch(request.url, {
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FetchError(`HTTP request failed: ${getErrMsg(err)}`, request.url, this.name, err);
    }

    if (!response.ok) {
      throw new FetchError(`HTTP ${response.status} ${response.statusText}`, request.url, this.name);
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType && !HTML_CONTENT_TYPE.test(contentType)) {
      throw new FetchError(`Unsupported content-type: ${contentType}`, request.url, this.name);
    }

    const raw = await response.text();
    const html = raw.length > MAX_HTML_CHARS ? raw.slice(0, MAX_HTML_CHARS) : raw;

    const { document } = parseHTML(html);
    // linkedom's document satisfies Readability at runtime; the cast bridges the
    // type gap (tsconfig has no DOM lib, so the `Document` type isn't in scope).
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
    ).parse();

    if (!article?.content?.trim()) {
      throw new FetchError('Readability extracted no content', request.url, this.name);
    }

    const markdown = this.turndown.turndown(article.content).trim();

    if (!markdown) {
      throw new FetchError('Markdown conversion produced empty content', request.url, this.name);
    }

    return {
      url: request.url,
      finalUrl: response.url || request.url,
      title: article.title ?? undefined,
      markdown,
      source: this.name,
      fetchedAt: new Date().toISOString(),
    };
  }
}
