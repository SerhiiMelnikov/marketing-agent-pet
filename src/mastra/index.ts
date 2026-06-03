import { Mastra } from '@mastra/core/mastra';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { logger } from '../utils/logger';
import { init as searchInit } from '../modules/search';
import { init as fetchInit } from '../modules/fetch';
import { researcher } from './agents/researcher';
import { synthesizer } from './agents/synthesizer';
import { webSearchTool } from './tools/web-search.tool';
import { fetchTool } from './tools/fetch.tool';
import { storage } from './storage';
import { verticalEntryWorkflow } from './workflows/vertical-entry';
import { citationFormatScorer } from './scorers/citation-format.scorer';
import { sourceDiversityScorer } from './scorers/source-diversity.scorer';
import { citationIntegrityScorer } from './scorers/citation-integrity.scorer';
import { companyFitScorer } from './scorers/company-fit.scorer';
import { claimGroundingScorer } from './scorers/claim-grounding.scorer';

searchInit();
fetchInit();

export const mastra = new Mastra({
  workflows: { verticalEntryWorkflow },
  agents: { researcher, synthesizer },
  tools: { webSearchTool, fetchTool },
  scorers: {
    citationFormat: citationFormatScorer,
    sourceDiversity: sourceDiversityScorer,
    citationIntegrity: citationIntegrityScorer,
    companyFit: companyFitScorer,
    claimGrounding: claimGroundingScorer,
  },
  storage,
  logger,
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
