// src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts

import { getCache } from '../../../../modules/page-cache';
import { logger } from '../../../../utils/logger';
import { getErrMsg } from '../../../../utils/errors';

const log = logger.child({ module: 'vertical-entry-cache-cleanup' });

/**
 * Clear the per-run page cache, swallowing failures so a cleanup error
 * never masks the actual workflow result. The sole caller is the
 * vertical-entry workflow's `options.onFinish` lifecycle hook, which
 * fires on every terminal status except `'suspended'`. The TTL on
 * cached entries is the safety net for any path Mastra's onFinish
 * doesn't cover (e.g. process crash, future framework changes).
 */
export async function clearCache(runId: string): Promise<void> {
  try {
    await getCache().clear(runId);
  } catch (err) {
    log.warn(
      `Failed to clear page cache for run ${runId}: ${getErrMsg(err)} — entries will expire via TTL`,
    );
  }
}
