/**
 * SQLite Cache Service
 * 
 * Persistent cache for Semantic Scholar API responses.
 * Features: TTL-based expiration, size limits, metrics.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import pino, { Logger } from 'pino';

/**
 * Cache entry types
 */
type CacheEntryType = 'paper' | 'search' | 'author' | 'citations' | 'references';

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  entries: number;
}

/**
 * Generic cache entry
 */
interface CacheEntry {
  id: string;
  type: CacheEntryType;
  key: string;
  data: string;
  createdAt: number;
  expiresAt: number;
  size: number;
}

/**
 * SQLite Cache Service
 */
export class CacheService {
  private db: Database.Database;
  private logger: Logger;
  private hitCount = 0;
  private missCount = 0;
  private maxSize: number;
  private ttl: number;

  constructor(dbPath: string, logger: Logger) {
    this.logger = logger;
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open or create database
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Get configuration from environment
    this.ttl = parseInt(process.env.CACHE_TTL_DAYS || '7', 10) * 24 * 60 * 60 * 1000;
    this.maxSize = parseInt(process.env.CACHE_MAX_SIZE || '1073741824', 10); // 1GB default

    // Initialize schema
    this.initializeSchema();
    
    this.logger.info({ 
      path: dbPath, 
      ttl: this.ttl,
      maxSize: this.maxSize 
    }, 'Cache initialized');
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_cache_type ON cache(type);
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expiresAt);
      CREATE INDEX IF NOT EXISTS idx_cache_key ON cache(key);
    `);

    // Create cleanup trigger
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS cleanup_expired
      AFTER INSERT ON cache
      BEGIN
        DELETE FROM cache WHERE expiresAt < strftime('%s', 'now') * 1000;
      END;
    `);
  }

  /**
   * Generate cache key from parameters
   */
  static generateKey(type: CacheEntryType, params: Record<string, unknown>): string {
    const sorted = Object.keys(params)
      .sort()
      .map(key => `${key}:${JSON.stringify(params[key])}`)
      .join('|');
    return `${type}:${Buffer.from(sorted).toString('base64')}`;
  }

  /**
   * Get cached value
   */
  get<T>(type: CacheEntryType, params: Record<string, unknown>): T | null {
    const key = CacheService.generateKey(type, params);
    
    const stmt = this.db.prepare(`
      SELECT data FROM cache
      WHERE key = ? AND expiresAt > strftime('%s', 'now') * 1000
    `);
    
    const row = stmt.get(key) as { data: string } | undefined;
    
    if (row) {
      this.hitCount++;
      this.logger.debug({ type, key: key.slice(0, 50) }, 'Cache hit');
      return JSON.parse(row.data) as T;
    }
    
    this.missCount++;
    this.logger.debug({ type, key: key.slice(0, 50) }, 'Cache miss');
    return null;
  }

  /**
   * Set cached value
   */
  set<T>(
    type: CacheEntryType,
    params: Record<string, unknown>,
    data: T
  ): void {
    const key = CacheService.generateKey(type, params);
    const serialized = JSON.stringify(data);
    const now = Date.now();
    const size = Buffer.byteLength(serialized, 'utf8');

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO cache (id, type, key, data, createdAt, expiresAt, size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      stmt.run(
        id,
        type,
        key,
        serialized,
        now,
        now + this.ttl,
        size
      );

      this.logger.debug({ type, key: key.slice(0, 50), size }, 'Cache set');
      
      // Check size and cleanup if needed
      this.checkSize();
    } catch (error) {
      this.logger.warn({ error: String(error), type }, 'Cache set failed');
    }
  }

  /**
   * Invalidate cache entry
   */
  invalidate(type: CacheEntryType, params: Record<string, unknown>): void {
    const key = CacheService.generateKey(type, params);
    
    const stmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
    const result = stmt.run(key);
    
    if (result.changes > 0) {
      this.logger.debug({ type, key: key.slice(0, 50) }, 'Cache invalidated');
    }
  }

  /**
   * Invalidate all entries of a type
   */
  invalidateType(type: CacheEntryType): void {
    const stmt = this.db.prepare('DELETE FROM cache WHERE type = ?');
    const result = stmt.run(type);
    
    if (result.changes > 0) {
      this.logger.info({ type, count: result.changes }, 'Cache type invalidated');
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.db.prepare('DELETE FROM cache').run();
    this.logger.info('Cache cleared');
  }

  /**
   * Check cache size and cleanup if needed
   */
  private checkSize(): void {
    const sizeStmt = this.db.prepare('SELECT SUM(size) as totalSize FROM cache');
    const { totalSize } = sizeStmt.get() as { totalSize: number };
    
    if (totalSize > this.maxSize) {
      // Delete oldest entries until under limit
      const deleteStmt = this.db.prepare(`
        DELETE FROM cache
        WHERE id IN (
          SELECT id FROM cache
          ORDER BY createdAt ASC
          LIMIT ?
        )
      `);
      
      const deleteCount = Math.floor(totalSize * 0.1 / this.ttl); // Delete 10% of oldest
      deleteStmt.run(Math.max(100, deleteCount));
      
      this.logger.warn({ 
        freed: totalSize - (this.maxSize * 0.9) 
      }, 'Cache cleanup performed');
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const sizeStmt = this.db.prepare('SELECT SUM(size) as totalSize, COUNT(*) as count FROM cache');
    const { totalSize, count } = sizeStmt.get() as { totalSize: number; count: number };
    
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: totalSize || 0,
      entries: count || 0
    };
  }

  /**
   * Get hit count (for metrics)
   */
  getHitCount(): number {
    return this.hitCount;
  }

  /**
   * Get miss count (for metrics)
   */
  getMissCount(): number {
    return this.missCount;
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const stmt = this.db.prepare(`
      DELETE FROM cache WHERE expiresAt < strftime('%s', 'now') * 1000
    `);
    const result = stmt.run();
    
    if (result.changes > 0) {
      this.logger.info({ count: result.changes }, 'Expired entries cleaned up');
    }
    
    return result.changes;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    this.logger.info('Cache database closed');
  }
}
