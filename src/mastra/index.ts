import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { init as searchInit } from '../modules/search';
import { init as fetchInit } from '../modules/fetch';
import { startDailyModelScheduler } from '../modules/model/daily-model';
import { researcher } from './agents/researcher';
import { webSearchTool } from './tools/web-search.tool';
import { fetchTool } from './tools/fetch.tool';
import { storage } from './storage';
import { verticalEntryWorkflow } from './workflows/vertical-entry';
import { citationFormatScorer } from './scorers/citation-format.scorer';

searchInit();
fetchInit();
startDailyModelScheduler();

export const mastra = new Mastra({
  workflows: { verticalEntryWorkflow },
  agents: { researcher },
  tools: { webSearchTool, fetchTool },
  scorers: { citationFormat: citationFormatScorer },
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
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
