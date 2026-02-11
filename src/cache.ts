import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'cache.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const getStmt = db.prepare('SELECT value, created_at FROM cache WHERE key = ?');
const upsertStmt = db.prepare(
  'INSERT OR REPLACE INTO cache (key, value, created_at) VALUES (?, ?, ?)'
);
const countStmt = db.prepare('SELECT COUNT(*) as count FROM cache');
const clearStmt = db.prepare('DELETE FROM cache');

export async function getCachedOrFetch(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<string>
): Promise<string> {
  const row = getStmt.get(key) as { value: string; created_at: number } | undefined;
  const now = Math.floor(Date.now() / 1000);

  if (row && now - row.created_at < ttlSeconds) {
    return row.value;
  }

  const value = await fetchFn();
  upsertStmt.run(key, value, now);
  return value;
}

export function getCacheStats() {
  const { count } = countStmt.get() as { count: number };
  return { entries: count };
}

export function clearCache() {
  clearStmt.run();
}
