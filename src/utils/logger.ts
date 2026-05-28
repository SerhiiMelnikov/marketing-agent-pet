import { PinoLogger } from '@mastra/loggers';

export const logger = new PinoLogger({
  name: 'marketing-agent',
  level: 'info',
});
