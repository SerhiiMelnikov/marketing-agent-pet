import { cwd } from 'node:process';
import { join } from 'node:path';

export const ENDPOINT = 'https://shir-man.com/api/free-llm/top-models';
export const FETCH_TIMEOUT_MS = 15_000;
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STATE_FILE = join(cwd(), 'data', 'daily-model.json');
