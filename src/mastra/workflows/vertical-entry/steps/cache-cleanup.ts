// src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts

import { getCache } from '../../../../modules/page-cache';
import { logger } from '../../../../utils/logger';
import { getErrMsg } from '../../../../utils/errors';

const log = logger.child({ module: 'vertical-entry-cache-cleanup' });

/**
 * Clear the per-run page cache, swallowing failures so a cleanup error
 * never masks the actual workflow result. Called from the dountil
 * callback on both terminal paths (deficits cleared → loop exits;
 * iteration cap reached → throw) and from the research-iteration step's
 * catch block when the researcher invocation itself throws. The
 * mid-loop retry path intentionally leaves the cache warm so the next
 * iteration can hit it.
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
