// src/mastra/schemas/research-memory.ts

import { z } from 'zod';

const confidenceLevel = z.enum(['high', 'medium', 'low']);

// Plain string + refine instead of `z.url()`. Zod's `z.url()` emits JSON-schema
// `format: "uri"`, which Mastra's Ajv (configured without ajv-formats) cannot
// resolve — logging `unknown format "uri" ignored in schema` on every
// working-memory write. A `.refine` validates URL-ness at parse time (in
// readResearchMemory's safeParse) without emitting a `format` keyword, so the
// tool-input schema is a bare string and the Ajv noise is gone.
const urlString = z
  .string()
  .refine((v) => URL.canParse(v), { message: 'must be a valid URL' });

const marketTrendSchema = z.object({
  claim: z.string(),
  evidence: z.string(),
  sourceUrl: urlString,
  publisher: z.string(),
  year: z.number().int().optional(),
  confidence: confidenceLevel,
});

const competitorSchema = z.object({
  name: z.string(),
  description: z.string(),
  weightClass: z.enum(['enterprise', 'mid-market', 'boutique']),
  sources: z.array(urlString).min(1),
});

const icpSchema = z.object({
  persona: z.string(),
  pains: z.array(z.string()).min(2),
  buyingSignals: z.array(z.string()).min(1),
});

const sourceConsultedSchema = z.object({
  url: urlString,
  classifier: z.enum([
    'government',
    'analyst',
    'consulting',
    'trade-press',
    'sec-filing',
    'company-ir',
    'vendor',
    'other',
  ]),
});

// Top-level sections are `.optional()` (deliberately NOT `.default([])`) so the
// `updateWorkingMemory` tool accepts PARTIAL writes. Mastra merges working
// memory by top-level field, so the researcher can send only the section(s) it
// is changing and the rest are preserved — instead of being forced to resend
// the whole ~5k-token document on every write (and hard-failing when it sends a
// subset). `.default([])` would be a trap: Zod would materialize an empty array
// into the parsed tool input, and because Mastra REPLACES arrays wholesale, that
// empty array would WIPE the existing section. `.optional()` (an absent field)
// is precisely what lets merge keep the prior value.
export const researchMemorySchema = z.object({
  marketTrends: z.array(marketTrendSchema).optional(),
  competitors: z.array(competitorSchema).optional(),
  candidateIcps: z.array(icpSchema).optional(),
  sourcesConsulted: z.array(sourceConsultedSchema).optional(),
  openQuestions: z.array(z.string()).optional(),
});

export type MarketTrend = z.infer<typeof marketTrendSchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type Icp = z.infer<typeof icpSchema>;
export type SourceConsulted = z.infer<typeof sourceConsultedSchema>;

// Read-side strict shape: `readResearchMemory` coalesces every absent section to
// `[]`, so all downstream consumers (gate, metrics, corroboration, synthesizer)
// see guaranteed arrays and need no `?? []` guards of their own.
export interface ResearchMemory {
  marketTrends: MarketTrend[];
  competitors: Competitor[];
  candidateIcps: Icp[];
  sourcesConsulted: SourceConsulted[];
  openQuestions: string[];
}
