import { z } from 'zod';
import { createScorer } from '@mastra/core/evals';
import { model } from '../../modules/model';
import { ModelRole } from '../../modules/model';
import { extractReportText } from './extract-report-text';

export const companyFitScorer = createScorer({
  id: 'company-fit',
  description:
    'Checks whether the report tailors analysis to the specific company in the brief, vs. generic output',
  judge: {
    model: model(ModelRole.Cheap)(),
    instructions: 'You are a strict evaluator of market-entry research quality.',
  },
})
  .analyze({
    description: 'Assess how well the report uses company specifics',
    outputSchema: z.object({
      usesCompanySize: z.boolean(),
      usesTechStack: z.boolean(),
      usesDomainHistory: z.boolean(),
      addressesWeightClass: z.boolean(),
      flagsSpecificGaps: z.boolean(),
      genericnessNote: z.string(),
    }),
    createPrompt: ({ run }) =>
      `
A research report was produced for THIS company brief:
"""
${extractReportText(run.input)}
"""

Evaluate whether the report below actually TAILORS its analysis to this specific
company, or whether it reads as generic content that would fit any mid-size
outsourcer. Answer each boolean honestly.

Report:
"""
${extractReportText(run.output)}
"""
    `.trim(),
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;
    const checks = [
      a.usesCompanySize,
      a.usesTechStack,
      a.usesDomainHistory,
      a.addressesWeightClass,
      a.flagsSpecificGaps,
    ];

    return checks.filter(Boolean).length / checks.length;
  })
  .generateReason(({ results }) => results.analyzeStepResult.genericnessNote);
