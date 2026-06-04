import { createClient, type Client } from '@libsql/client';
import { MAX_ENTRY_BYTES, TABLE_NAME, TTL_MS } from './constants';
import type { PageCache, PageCacheEntry } from './types';

export class LibSqlPageCache implements PageCache {
  constructor(private readonly client: Client) {}

  static async create(url: string): Promise<LibSqlPageCache> {
    const client = createClient({ url });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        run_id     TEXT NOT NULL,
        url        TEXT NOT NULL,
        final_url  TEXT NOT NULL,
        markdown   TEXT NOT NULL,
        title      TEXT,
        fetched_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        truncated  INTEGER NOT NULL,
        PRIMARY KEY (run_id, url)
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_run_id ON ${TABLE_NAME}(run_id)`,
    );
    return new LibSqlPageCache(client);
  }

  async get(runId: string, url: string): Promise<PageCacheEntry | null> {
    const res = await this.client.execute({
      sql: `SELECT * FROM ${TABLE_NAME} WHERE run_id = ? AND url = ?`,
      args: [runId, url],
    });
    const row = res.rows[0];
    if (!row) return null;

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const fetchedAt = String(row.fetched_at);
    const fetchedAtMs = new Date(fetchedAt).getTime();
    if (Number.isNaN(fetchedAtMs) || Date.now() - fetchedAtMs > TTL_MS) return null;

    return {
      runId: row.run_id as string,
      url: row.url as string,
      finalUrl: row.final_url as string,
      markdown: row.markdown as string,
      title: row.title == null ? undefined : (row.title as string),
      fetchedAt,
      sizeBytes: Number(row.size_bytes),
      truncated: Number(row.truncated) === 1,
    };
  }

  async set(entry: PageCacheEntry): Promise<void> {
    const truncated = entry.sizeBytes > MAX_ENTRY_BYTES;
    const markdown = truncated ? entry.markdown.slice(0, MAX_ENTRY_BYTES) : entry.markdown;
    const sizeBytes = truncated ? MAX_ENTRY_BYTES : entry.sizeBytes;

    await this.client.execute({
      sql: `INSERT OR REPLACE INTO ${TABLE_NAME}
            (run_id, url, final_url, markdown, title, fetched_at, size_bytes, truncated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.runId,
        entry.url,
        entry.finalUrl,
        markdown,
        entry.title ?? null,
        entry.fetchedAt,
        sizeBytes,
        truncated ? 1 : 0,
      ],
    });
  }

  async list(runId: string): Promise<PageCacheEntry[]> {
    const res = await this.client.execute({
      sql: `SELECT * FROM ${TABLE_NAME} WHERE run_id = ?`,
      args: [runId],
    });
    return res.rows.map((row) => ({
      runId: row.run_id as string,
      url: row.url as string,
      finalUrl: row.final_url as string,
      markdown: row.markdown as string,
      title: row.title == null ? undefined : (row.title as string),
      fetchedAt: row.fetched_at as string,
      sizeBytes: Number(row.size_bytes),
      truncated: Number(row.truncated) === 1,
    }));
  }

  async clear(runId: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM ${TABLE_NAME} WHERE run_id = ?`,
      args: [runId],
    });
  }
}
