// src/mastra/workflows/vertical-entry/read-memory.ts

import { researchMemory } from '../../memory';
import { researchMemorySchema, type ResearchMemory } from '../../schemas/research-memory';

export async function readResearchMemory(
  threadId: string,
  resourceId: string,
): Promise<ResearchMemory> {
  const raw = await researchMemory.getWorkingMemory({ threadId, resourceId });

  if (!raw) {
    throw new Error(
      'Researcher invoked but produced no working memory. The persistence layer may be failing — halting.',
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(
      `Working memory is not valid JSON. Length: ${raw.length}. Head: ${raw.slice(0, 200)}`,
    );
  }

  const parsed = researchMemorySchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      'Working memory does not match the expected schema: ' + parsed.error.message,
    );
  }

  return parsed.data;
}
