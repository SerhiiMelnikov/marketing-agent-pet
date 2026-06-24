// src/modules/verticals/shared.ts

/** Vertical-agnostic authoritative domains, shared by every resolved bias. */
// `investor.*` / `ir.*` are subdomain-prefix patterns (investor-relations hosts of
// named incumbents), not literal hostnames — the search provider biases on them as prefixes.
export const SHARED_SEC_AND_CORPORATE = ['sec.gov', 'investor.*', 'ir.*'];
export const SHARED_ANALYSTS = [
  'gartner.com',
  'forrester.com',
  'idc.com',
  'everestgrp.com',
  'hfsresearch.com',
];
export const SHARED_CONSULTING = [
  'deloitte.com',
  'mckinsey.com',
  'bcg.com',
  'bain.com',
  'capgemini.com',
  'accenture.com',
];
