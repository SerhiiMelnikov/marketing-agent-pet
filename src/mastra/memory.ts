// src/mastra/memory.ts

import { Memory } from '@mastra/memory';
import { storage } from './storage';
import { researchMemorySchema } from './schemas/research-memory';

export const researchMemory = new Memory({
  storage,
  options: {
    workingMemory: {
      enabled: true,
      scope: 'thread',
      schema: researchMemorySchema,
    },
  },
});
