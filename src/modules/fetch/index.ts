import { SUSPICIOUSLY_SHORT_THRESHOLD } from './constants';
import { detectBlock } from './detect-block';
import { FetchError } from './error';
import * as Factory from './factory';
import type { FetchRequest } from './types';
import { getCache } from '../page-cache';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'fetch' });

export { BlockReason } from './enums/block-reason.enum';
export type { FetchRequest, FetchResult, FetchProvider, BlockedInfo } from './types';

export async function fetchUrl(request: FetchRequest) {
  const cache = getCache();
  const hit = await cache.get(request.runId, request.url);
  if (hit) {
    log.info(`cache hit: ${request.url} (run ${request.runId})`);
    return {
      url: hit.url,
      finalUrl: hit.finalUrl,
      title: hit.title,
      markdown: hit.markdown,
      source: 'cache',
      fetchedAt: hit.fetchedAt,
      fromCache: true,
    };
  }

  const chain = Factory.getChain();
  const errors: FetchError[] = [];

  for (const provider of chain) {
    if (!provider.canHandle(request)) continue;

    try {
      const result = await provider.fetch(request);
      const isLast = provider === chain[chain.length - 1];
      const blocked = detectBlock(result.title, result.markdown);

      if (blocked) {
        result.blocked = blocked;
        return result;
      }
      if (!isLast && result.markdown.length < SUSPICIOUSLY_SHORT_THRESHOLD) {
        continue;
      }

      await cache.set({
        runId: request.runId,
        url: request.url,
        finalUrl: result.finalUrl,
        markdown: result.markdown,
        title: result.title,
        fetchedAt: result.fetchedAt,
        sizeBytes: Buffer.byteLength(result.markdown, 'utf8'),
        truncated: false,
      });

      return result;
    } catch (err) {
      if (err instanceof FetchError) {
        errors.push(err);
        continue;
      }
      throw err;
    }
  }

  throw new FetchError(
    `All fetch providers failed for ${request.url}: ` +
      errors.map((e) => `[${e.provider}] ${e.message}`).join('; '),
    request.url,
    'chain',
  );
}

export function init() {
  Factory.init();
}
