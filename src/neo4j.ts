import neo4j, { type Driver, type Record as Neo4jRecord } from 'neo4j-driver';

// Write-operation keywords to block (case-insensitive)
const WRITE_KEYWORDS = [
  /\bCREATE\b/i,
  /\bMERGE\b/i,
  /\bSET\b/i,
  /\bDELETE\b/i,
  /\bREMOVE\b/i,
  /\bDROP\b/i,
  /\bDETACH\b/i,
  /\bLOAD\s+CSV\b/i,
  /\bCALL\b[^)]*\bdbms\b/i,
  /\bCALL\b[^)]*\bapoc\.trigger\b/i,
];

const MAX_ROWS = 1000;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

let driver: Driver | null = null;

/**
 * Get or create the Neo4j driver (connection pool).
 * Returns null if NEO4J_URI is not configured.
 */
export function getDriver(): Driver | null {
  if (driver) return driver;

  const uri = process.env.NEO4J_URI;
  if (!uri) return null;

  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || '';

  driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 5000,
    connectionTimeout: 5000,
  });

  return driver;
}

/**
 * Check if Neo4j is connected and responding.
 */
export async function isNeo4jConnected(): Promise<boolean> {
  const d = getDriver();
  if (!d) return false;
  try {
    await d.verifyConnectivity();
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a Cypher query is read-only.
 * Throws if any write keywords are detected.
 */
export function validateReadOnly(cypher: string): void {
  for (const pattern of WRITE_KEYWORDS) {
    if (pattern.test(cypher)) {
      throw new Error(`Write operations are not allowed. Blocked pattern: ${pattern.source}`);
    }
  }
}

/**
 * Execute a read-only Cypher query with retry, timeout, and row limit.
 * Returns an array of plain objects (one per row).
 */
export async function executeReadQuery(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  const d = getDriver();
  if (!d) {
    throw new Error('Graph database not configured. Set NEO4J_URI to enable graph queries.');
  }

  validateReadOnly(cypher);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const session = d.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(cypher, params, {
        timeout: neo4j.int(QUERY_TIMEOUT_MS),
      });

      const rows = result.records.slice(0, MAX_ROWS).map((record: Neo4jRecord) => {
        const obj: Record<string, unknown> = {};
        for (const key of record.keys) {
          const k = String(key);
          obj[k] = toPlainValue(record.get(k));
        }
        return obj;
      });

      return rows;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Only retry on connection errors, not query errors
      if (!isRetryableError(lastError)) {
        throw lastError;
      }
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } finally {
      await session.close();
    }
  }

  throw lastError || new Error('Query failed after retries');
}

/**
 * Determine if an error is retryable (connection issues).
 */
function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes('connection') ||
    msg.includes('socket') ||
    msg.includes('timeout') ||
    msg.includes('unavailable') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset')
  );
}

/**
 * Convert Neo4j values to plain JavaScript values.
 */
function toPlainValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  // Neo4j Integer -> number
  if (neo4j.isInt(value)) {
    return (value as { toNumber(): number }).toNumber();
  }

  // Neo4j Node -> plain object with properties + labels
  if (isNeo4jNode(value)) {
    return {
      _labels: value.labels,
      ...toPlainObject(value.properties),
    };
  }

  // Neo4j Relationship -> plain object with properties + type
  if (isNeo4jRelationship(value)) {
    return {
      _type: value.type,
      ...toPlainObject(value.properties),
    };
  }

  // Neo4j Path -> simplified
  if (isNeo4jPath(value)) {
    return {
      start: toPlainValue(value.start),
      end: toPlainValue(value.end),
      segments: value.segments.map((s: { start: unknown; relationship: unknown; end: unknown }) => ({
        start: toPlainValue(s.start),
        relationship: toPlainValue(s.relationship),
        end: toPlainValue(s.end),
      })),
    };
  }

  // Arrays
  if (Array.isArray(value)) {
    return value.map(toPlainValue);
  }

  // Plain objects
  if (typeof value === 'object' && value !== null) {
    return toPlainObject(value as Record<string, unknown>);
  }

  return value;
}

function toPlainObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = toPlainValue(val);
  }
  return result;
}

// Type guards for Neo4j types
interface Neo4jNode { labels: string[]; properties: Record<string, unknown>; identity: unknown }
interface Neo4jRelationship { type: string; properties: Record<string, unknown>; identity: unknown; start: unknown; end: unknown }
interface Neo4jPath { start: unknown; end: unknown; segments: Array<{ start: unknown; relationship: unknown; end: unknown }> }

function isNeo4jNode(value: unknown): value is Neo4jNode {
  return typeof value === 'object' && value !== null && 'labels' in value && 'properties' in value && 'identity' in value;
}

function isNeo4jRelationship(value: unknown): value is Neo4jRelationship {
  return typeof value === 'object' && value !== null && 'type' in value && 'properties' in value && 'start' in value && 'end' in value && 'identity' in value;
}

function isNeo4jPath(value: unknown): value is Neo4jPath {
  return typeof value === 'object' && value !== null && 'start' in value && 'end' in value && 'segments' in value;
}

/**
 * Gracefully close the driver (call on shutdown).
 */
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
