import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { fetchUrl } from '../../modules/fetch';

const descriptions = {
  tool: 'Fetch a single web page and return its main content as clean markdown. Use this after `web-search` when you need the full text of a result rather than just the snippet, or when an agent already has a known URL (e.g. a competitor homepage, a 10-K, an analyst report). Providers are tried in order — cheap HTTP+readability first, then Firecrawl for JS-heavy pages — so calls are best-effort and may return empty/short content for paywalls, bot walls, or dynamic apps.',

  input: {
    url: 'Absolute URL of the page to fetch. Must be a fully qualified http(s) URL.',
    requiresJs:
      'Hint that the page is JS-heavy (an SPA, dashboard, or paywalled article) and cheap providers will likely fail. Set true to skip straight to the JS-capable provider; leave omitted to let the chain decide.',
  },

  output: {
    url: 'The URL that was requested.',
    finalUrl: 'The resolved URL after any redirects. May differ from `url`.',
    title: 'Page title, when the provider could extract one.',
    markdown:
      'Clean markdown extracted from the page. May be empty or very short if the page was blocked, paywalled, or returned no meaningful content.',
    source: 'Name of the provider that produced this result (e.g. "firecrawl"). Useful for logs.',
    fetchedAt: 'ISO 8601 timestamp of when the fetch completed.',
  },
} as const;

export const fetchTool = createTool({
  id: 'fetch-url',
  description: descriptions.tool,
  inputSchema: z.object({
    url: z.url().describe(descriptions.input.url),
    requiresJs: z.boolean().optional().describe(descriptions.input.requiresJs),
  }),
  outputSchema: z.object({
    url: z.url().describe(descriptions.output.url),
    finalUrl: z.url().describe(descriptions.output.finalUrl),
    title: z.string().optional().describe(descriptions.output.title),
    markdown: z.string().describe(descriptions.output.markdown),
    source: z.string().describe(descriptions.output.source),
    fetchedAt: z.iso.datetime().describe(descriptions.output.fetchedAt),
  }),
  execute: (request) => fetchUrl(request),
});
