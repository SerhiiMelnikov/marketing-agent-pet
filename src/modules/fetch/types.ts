import type { BlockReason } from './enums/block-reason.enum';
import type { FetchProviderName } from './enums/provider-name.enum';

export interface FetchRequest {
  url: string;
  runId: string;
  /** Hint that the page is JS-heavy; providers may use this to skip cheaper paths. */
  requiresJs?: boolean;
}
export interface SignalGroup {
  reason: BlockReason;
  patterns: RegExp[];
}

export interface BlockedInfo {
  reason: BlockReason;
  /** What triggered detection (regex source or "title:..." marker), for debugging. */
  signal: string;
}

export interface FetchResult {
  url: string;
  /** The resolved URL after any redirects. May differ from the requested URL. */
  finalUrl: string;
  title?: string;
  /** Clean markdown extracted from the page. */
  markdown: string;
  /** Which provider produced this result. Useful for logs and debugging. */
  source: string;
  /** ISO timestamp of when the fetch completed. */
  fetchedAt: string;
  /** Set when the page was reachable but content is gated/blocked. */
  blocked?: BlockedInfo;
  /** True when the result came from the per-run cache, not a provider. */
  fromCache?: boolean;
}

export interface FetchProvider {
  readonly name: FetchProviderName;
  /** True if this provider can reasonably handle the given URL. */
  canHandle(request: FetchRequest): boolean;
  fetch(request: FetchRequest): Promise<FetchResult>;
}
