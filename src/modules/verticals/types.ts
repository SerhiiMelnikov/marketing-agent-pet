// src/modules/verticals/types.ts

export interface VerticalBias {
  key: string;
  /** Lowercased keywords matched as substrings of the brief's free-text vertical. */
  aliases: string[];
  government: string[];
  tradePress: string[];
  /** Optional vertical-specific analyst firms, merged on top of the shared core. */
  analysts?: string[];
}

export interface ResolvedBias {
  /** The matched vertical key, or null when no config matched (generic fallback). */
  matchedKey: string | null;
  government: string[];
  secAndCorporate: string[];
  analysts: string[];
  consulting: string[];
  tradePress: string[];
}
