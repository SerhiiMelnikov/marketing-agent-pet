import type { VerticalBias } from './types';

export const HEALTHCARE: VerticalBias = {
  key: 'healthcare',
  aliases: ['healthcare', 'health', 'hospital', 'clinical', 'hipaa', 'payer', 'provider', 'ehr', 'hl7', 'fhir'],
  government: ['hhs.gov', 'cms.gov', 'healthit.gov', 'fda.gov', 'federalregister.gov', 'gao.gov', 'ftc.gov'],
  tradePress: ['healthcareitnews.com', 'fiercehealthcare.com', 'beckershospitalreview.com', 'himss.org', 'modernhealthcare.com', 'statnews.com'],
  analysts: ['klasresearch.com'],
};
