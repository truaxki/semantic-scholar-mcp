import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireBearerAuth, getOAuthMetadata } from './auth.js';
import { supabaseOAuthEndpoints } from './supabase.js';
import { searchPapers, getPaper, getAuthors, getCitations, getReferences, batchFetchPapers } from './semantic-scholar.js';
import { getCachedOrFetch, getCacheStats, clearCache } from './cache.js';

// Check if request is an MCP initialize request
function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'method' in body &&
    (body as { method: string }).method === 'initialize'
  );
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3100;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || '';

// Create the MCP server with Semantic Scholar tools
function createServer() {
  const server = new McpServer({
    name: 'semantic-scholar-mcp',
    version: '1.0.0',
  });

  // Tool: search_papers
  server.registerTool(
    'search_papers',
    {
      description: 'Search for academic papers on Semantic Scholar. Returns titles, authors, year, citation count.',
      inputSchema: {
        query: z.string().describe('Search query (e.g. "knowledge graph construction")'),
        year: z.string().optional().describe('Year or range: "2023" or "2020-2024"'),
        limit: z.number().min(1).max(100).default(10).describe('Max results'),
        openAccessOnly: z.boolean().default(false).describe('Only open access papers'),
      },
    },
    async ({ query, year, limit, openAccessOnly }): Promise<CallToolResult> => {
      const cacheKey = `search:${query}:${year || ''}:${limit}:${openAccessOnly}`;
      const raw = await getCachedOrFetch(cacheKey, 3600, async () => {
        return JSON.stringify(await searchPapers(API_KEY, query, { year, limit, openAccessOnly }));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: get_paper
  server.registerTool(
    'get_paper',
    {
      description: 'Get details for a paper by ID (S2 ID, DOI, arXiv ID, or URL).',
      inputSchema: {
        paperId: z.string().describe('Paper ID, DOI, ARXIV:id, or URL:url'),
        fields: z.string().optional().describe('Comma-separated fields (default: title,authors,year,abstract,citationCount)'),
      },
    },
    async ({ paperId, fields }): Promise<CallToolResult> => {
      const fieldList = fields || 'title,authors,year,abstract,citationCount,referenceCount,url';
      const cacheKey = `paper:${paperId}:${fieldList}`;
      const raw = await getCachedOrFetch(cacheKey, 86400, async () => {
        return JSON.stringify(await getPaper(API_KEY, paperId, fieldList));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: get_authors
  server.registerTool(
    'get_authors',
    {
      description: 'Get authors of a paper by paper ID.',
      inputSchema: {
        paperId: z.string().describe('Paper ID'),
        limit: z.number().min(1).max(1000).default(100).describe('Max authors'),
      },
    },
    async ({ paperId, limit }): Promise<CallToolResult> => {
      const cacheKey = `authors:${paperId}:${limit}`;
      const raw = await getCachedOrFetch(cacheKey, 86400, async () => {
        return JSON.stringify(await getAuthors(API_KEY, paperId, limit));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: get_citations
  server.registerTool(
    'get_citations',
    {
      description: 'Get papers that cite a given paper (incoming citations).',
      inputSchema: {
        paperId: z.string().describe('Paper ID'),
        limit: z.number().min(1).max(1000).default(100).describe('Max citations'),
      },
    },
    async ({ paperId, limit }): Promise<CallToolResult> => {
      const cacheKey = `citations:${paperId}:${limit}`;
      const raw = await getCachedOrFetch(cacheKey, 3600, async () => {
        return JSON.stringify(await getCitations(API_KEY, paperId, limit));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: get_references
  server.registerTool(
    'get_references',
    {
      description: 'Get papers referenced by a given paper (outgoing references).',
      inputSchema: {
        paperId: z.string().describe('Paper ID'),
        limit: z.number().min(1).max(1000).default(100).describe('Max references'),
      },
    },
    async ({ paperId, limit }): Promise<CallToolResult> => {
      const cacheKey = `refs:${paperId}:${limit}`;
      const raw = await getCachedOrFetch(cacheKey, 3600, async () => {
        return JSON.stringify(await getReferences(API_KEY, paperId, limit));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: batch_fetch
  server.registerTool(
    'batch_fetch',
    {
      description: 'Fetch multiple papers by ID in one request (max 100).',
      inputSchema: {
        paperIds: z.array(z.string()).max(100).describe('Array of paper IDs'),
        fields: z.string().optional().describe('Comma-separated fields'),
      },
    },
    async ({ paperIds, fields }): Promise<CallToolResult> => {
      const fieldList = fields || 'title,authors,year,abstract,citationCount';
      const raw = JSON.stringify(await batchFetchPapers(API_KEY, paperIds, fieldList));
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: cache_stats
  server.registerTool(
    'cache_stats',
    {
      description: 'Get cache statistics (size, entries).',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      const stats = getCacheStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  // Tool: clear_cache
  server.registerTool(
    'clear_cache',
    {
      description: 'Clear the API response cache.',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      clearCache();
      return { content: [{ type: 'text', text: '{"success": true, "message": "Cache cleared"}' }] };
    }
  );

  return server;
}

// Parse allowed hosts
const serverHost = new URL(SERVER_URL).host;
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

let app;
if (isRailway) {
  // Railway's reverse proxy handles host validation — skip allowedHosts entirely
  console.log('Railway detected, skipping host validation');
  app = createMcpExpressApp({ host: '0.0.0.0' });
} else {
  const allowedHosts = [
    'localhost',
    '127.0.0.1',
    `localhost:${PORT}`,
    serverHost,
    ...(railwayDomain ? [railwayDomain] : []),
  ];
  console.log('Allowed hosts:', allowedHosts);
  app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts });
}

// ============================================================
// OAuth 2.1 Metadata Endpoints
// ============================================================

app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
  res.json(getOAuthMetadata());
});

app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
  res.json({
    resource: `${SERVER_URL}/mcp`,
    authorization_servers: [supabaseOAuthEndpoints.issuer],
    scopes_supported: ['openid', 'email', 'profile'],
  });
});

// ============================================================
// MCP Endpoints (Protected with Bearer Auth)
// ============================================================

const transports: Map<string, StreamableHTTPServerTransport> = new Map();
const authMiddleware = requireBearerAuth();

app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  console.log(`[MCP] POST from user: ${req.auth?.clientId || 'anonymous'}`);

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          console.log(`[MCP] Session initialized: ${sid}`);
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          console.log(`[MCP] Session closed: ${sid}`);
          transports.delete(sid);
        }
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
});

app.delete('/mcp', authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
});

// ============================================================
// Health check
// ============================================================
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    oauth: !!process.env.SUPABASE_URL,
    apiKey: !!API_KEY,
  });
});

// ============================================================
// Start
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Semantic Scholar MCP Server at ${SERVER_URL}

   MCP:     ${SERVER_URL}/mcp (POST/GET/DELETE)
   Health:  ${SERVER_URL}/health
   OAuth:   ${SERVER_URL}/.well-known/oauth-authorization-server
${!process.env.SUPABASE_URL ? '\n   ⚠️  AUTH DISABLED: Set SUPABASE_URL to enable OAuth 2.1' : ''}
  `);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  for (const [sid, transport] of transports) {
    console.log(`Closing session ${sid}`);
    await transport.close();
  }
  process.exit(0);
});
