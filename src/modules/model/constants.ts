import { cwd } from 'node:process';
import { join } from 'node:path';

export const ENDPOINT = 'https://shir-man.com/api/free-llm/top-models';
export const FETCH_TIMEOUT_MS = 15_000;
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STATE_FILE = join(cwd(), '.persisted-model', 'daily-model.json');
export const FILE_ENCODING = 'utf8';
export const MODEL_EXPR = /^[^/]+\/.+$/;
export const OPENROUTER_PREFIX = 'openrouter/';
export const OPENROUTER_PREFIX_EXPR = /^openrouter\//;
// Strip MODEL_REGEX's leading `^` so it composes after the prefix.
export const OPENROUTER_MODEL_EXPR = new RegExp(OPENROUTER_PREFIX_EXPR.source + MODEL_EXPR.source.slice(1));
