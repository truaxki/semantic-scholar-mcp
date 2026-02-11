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
import { searchPapers, getPaper, getAuthors, getCitations, getReferences, batchFetchPapers, getAuthor, searchAuthors, getPaperWithEmbedding, getAuthorWithPapers } from './semantic-scholar.js';
import { getCachedOrFetch, getCacheStats, clearCache } from './cache.js';
import { executeReadQuery, isNeo4jConnected, closeDriver } from './neo4j.js';

// Check if request is an MCP initialize request
function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'method' in body &&
    (body as { method: string }).method === 'initialize'
  );
}

function consentPage(authorizationId: string, supabaseUrl: string, supabaseAnonKey: string): string {
  return `<!DOCTYPE html>
<html><head>
<title>Authorize — AgentLocker Graph</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #1e293b; border-radius: 12px; padding: 2rem; max-width: 420px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
  h2 { margin-bottom: 0.5rem; color: #f8fafc; }
  .subtitle { color: #94a3b8; margin-bottom: 1.5rem; font-size: 0.9rem; }
  .client-info { background: #0f172a; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; font-size: 0.85rem; }
  .client-info dt { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .client-info dd { color: #e2e8f0; margin-bottom: 0.5rem; }
  .scopes { list-style: none; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .scopes li { background: #334155; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; }
  .actions { display: flex; gap: 0.75rem; }
  button { flex: 1; padding: 0.75rem; font-size: 1rem; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .approve { background: #4f46e5; color: white; }
  .approve:hover { background: #4338ca; }
  .deny { background: #334155; color: #94a3b8; }
  .deny:hover { background: #475569; }
  .login-form { display: flex; flex-direction: column; gap: 0.75rem; }
  input[type=email], input[type=password] { padding: 0.75rem; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 1rem; }
  .error { color: #f87171; font-size: 0.85rem; margin-top: 0.5rem; }
  .loading { color: #94a3b8; text-align: center; padding: 2rem; }
  #status { margin-top: 0.75rem; font-size: 0.85rem; }
</style>
</head>
<body>
<div class="card" id="app">
  <div class="loading">Loading...</div>
</div>
<script>
const AUTHORIZATION_ID = '${authorizationId}';
const supabase = window.supabase.createClient('${supabaseUrl}', '${supabaseAnonKey}');
const app = document.getElementById('app');

async function init() {
  // Check if user is logged in
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    showLogin();
    return;
  }

  // Get authorization details
  try {
    const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(AUTHORIZATION_ID);
    if (error) {
      app.innerHTML = '<h2>Error</h2><p class="error">' + error.message + '</p>';
      return;
    }
    showConsent(details, user);
  } catch (e) {
    app.innerHTML = '<h2>Error</h2><p class="error">' + e.message + '</p>';
  }
}

function showLogin() {
  app.innerHTML = \`
    <h2>Sign In</h2>
    <p class="subtitle">Sign in to authorize this application</p>
    <form class="login-form" onsubmit="handleLogin(event)">
      <input type="email" id="email" placeholder="Email" required />
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit" class="approve">Sign In</button>
    </form>
    <div id="status"></div>
  \`;
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const status = document.getElementById('status');
  status.innerHTML = 'Signing in...';
  
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    status.innerHTML = '<span class="error">' + error.message + '</span>';
    return;
  }
  
  // Logged in, now show consent
  init();
}

function showConsent(details, user) {
  const client = details.client || {};
  const scopes = (details.scope || '').split(' ').filter(Boolean);
  
  app.innerHTML = \`
    <h2>Authorize Application</h2>
    <p class="subtitle">Signed in as \${user.email}</p>
    <dl class="client-info">
      <dt>Application</dt>
      <dd>\${client.name || 'Unknown App'}</dd>
      \${scopes.length ? '<dt>Permissions</dt><dd><ul class="scopes">' + scopes.map(s => '<li>' + s + '</li>').join('') + '</ul></dd>' : ''}
    </dl>
    <div class="actions">
      <button class="deny" onclick="handleDeny()">Deny</button>
      <button class="approve" onclick="handleApprove()">Approve</button>
    </div>
    <div id="status"></div>
  \`;
}

async function handleApprove() {
  const status = document.getElementById('status');
  status.innerHTML = 'Approving...';
  
  try {
    const { data, error } = await supabase.auth.oauth.approveAuthorization(AUTHORIZATION_ID);
    if (error) {
      status.innerHTML = '<span class="error">' + error.message + '</span>';
      return;
    }
    if (data && data.redirect_to) {
      window.location.href = data.redirect_to;
    } else {
      status.innerHTML = '<span class="error">No redirect received</span>';
    }
  } catch (e) {
    status.innerHTML = '<span class="error">' + e.message + '</span>';
  }
}

async function handleDeny() {
  const status = document.getElementById('status');
  status.innerHTML = 'Denying...';
  
  try {
    const { data, error } = await supabase.auth.oauth.denyAuthorization(AUTHORIZATION_ID);
    if (error) {
      status.innerHTML = '<span class="error">' + error.message + '</span>';
      return;
    }
    if (data && data.redirect_to) {
      window.location.href = data.redirect_to;
    } else {
      window.close();
    }
  } catch (e) {
    status.innerHTML = '<span class="error">' + e.message + '</span>';
  }
}

init();
</script>
</body></html>`;
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

  // Tool: get_author
  server.registerTool(
    'get_author',
    {
      description: 'Get details for an author by Semantic Scholar author ID.',
      inputSchema: {
        authorId: z.string().describe('Semantic Scholar author ID'),
        fields: z.string().optional().describe('Comma-separated fields (default: name,affiliations,citationCount,hIndex,paperCount)'),
      },
    },
    async ({ authorId, fields }): Promise<CallToolResult> => {
      const fieldList = fields || 'name,affiliations,citationCount,hIndex,paperCount';
      const cacheKey = `author:${authorId}:${fieldList}`;
      const raw = await getCachedOrFetch(cacheKey, 86400, async () => {
        return JSON.stringify(await getAuthor(API_KEY, authorId, fieldList));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: search_authors
  server.registerTool(
    'search_authors',
    {
      description: 'Search for authors by name.',
      inputSchema: {
        query: z.string().describe('Author name to search'),
        limit: z.number().min(1).max(100).default(10).describe('Max results'),
      },
    },
    async ({ query, limit }): Promise<CallToolResult> => {
      const cacheKey = `author-search:${query}:${limit}`;
      const raw = await getCachedOrFetch(cacheKey, 3600, async () => {
        return JSON.stringify(await searchAuthors(API_KEY, query, limit));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: get_paper_with_embedding
  server.registerTool(
    'get_paper_with_embedding',
    {
      description: 'Get full paper details including SPECTER embedding (768-dim), TLDR, fields of study, and external IDs. Ideal for Neo4j ingestion.',
      inputSchema: {
        paperId: z.string().describe('Paper ID, DOI, ARXIV:id, or URL:url'),
      },
    },
    async ({ paperId }): Promise<CallToolResult> => {
      const cacheKey = `paper-embed:${paperId}`;
      const raw = await getCachedOrFetch(cacheKey, 86400, async () => {
        return JSON.stringify(await getPaperWithEmbedding(API_KEY, paperId));
      });
      return { content: [{ type: 'text', text: raw }] };
    }
  );

  // Tool: get_author_with_papers
  server.registerTool(
    'get_author_with_papers',
    {
      description: 'Get author details plus their papers with co-authors. One call gives you the full co-authorship graph for an author. Ideal for Neo4j ingestion and author clustering.',
      inputSchema: {
        authorId: z.string().describe('Semantic Scholar author ID'),
        limit: z.number().min(1).max(500).default(100).describe('Max papers to return'),
      },
    },
    async ({ authorId, limit }): Promise<CallToolResult> => {
      const cacheKey = `author-papers:${authorId}:${limit}`;
      const raw = await getCachedOrFetch(cacheKey, 86400, async () => {
        return JSON.stringify(await getAuthorWithPapers(API_KEY, authorId, limit));
      });
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

  // ============================================================
  // Neo4j Graph Tools (read-only)
  // ============================================================

  // Tool: read_cypher
  server.registerTool(
    'read_cypher',
    {
      description: 'Execute a read-only Cypher query against the Neo4j knowledge graph. Write operations are blocked. Returns JSON array of result rows. Graph contains academic papers, authors, fields, and communities from Semantic Scholar.',
      inputSchema: {
        query: z.string().describe('Cypher query (read-only). Example: MATCH (a:Author)-[:WROTE]->(p:Paper) WHERE a.name CONTAINS "LeCun" RETURN a.name, p.title LIMIT 10'),
        params: z.record(z.unknown()).optional().describe('Query parameters (optional). Example: {name: "Yann LeCun"}'),
      },
    },
    async ({ query, params }): Promise<CallToolResult> => {
      try {
        const cacheKey = `cypher:${query}:${JSON.stringify(params || {})}`;
        const raw = await getCachedOrFetch(cacheKey, 300, async () => {
          const rows = await executeReadQuery(query, params || {});
          return JSON.stringify(rows);
        });
        return { content: [{ type: 'text', text: raw }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }
  );

  // Tool: graph_stats
  server.registerTool(
    'graph_stats',
    {
      description: 'Get overview statistics of the Neo4j knowledge graph: node counts, relationship counts, community count, embedding coverage.',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const cacheKey = 'graph_stats';
        const raw = await getCachedOrFetch(cacheKey, 3600, async () => {
          const rows = await executeReadQuery(`
            MATCH (p:Paper) WITH count(p) AS papers
            MATCH (a:Author) WITH papers, count(a) AS authors
            MATCH (f:Field) WITH papers, authors, count(f) AS fields
            RETURN papers, authors, fields
          `);
          const base = rows[0] || { papers: 0, authors: 0, fields: 0 };

          const communityRows = await executeReadQuery(`
            MATCH (a:Author) WHERE a.community IS NOT NULL
            RETURN count(DISTINCT a.community) AS communities
          `);
          const communities = (communityRows[0]?.communities as number) || 0;

          const embeddingRows = await executeReadQuery(`
            MATCH (p:Paper) WHERE p.embedding IS NOT NULL
            RETURN count(p) AS withEmbeddings
          `);
          const withEmbeddings = (embeddingRows[0]?.withEmbeddings as number) || 0;

          const wroteRows = await executeReadQuery(`
            MATCH ()-[r:WROTE]->() RETURN count(r) AS wrote
          `);
          const wrote = (wroteRows[0]?.wrote as number) || 0;

          const citesRows = await executeReadQuery(`
            MATCH ()-[r:CITES]->() RETURN count(r) AS cites
          `);
          const cites = (citesRows[0]?.cites as number) || 0;

          return JSON.stringify({
            papers: base.papers,
            authors: base.authors,
            fields: base.fields,
            communities,
            embeddings: withEmbeddings,
            wrote_rels: wrote,
            cites_rels: cites,
          });
        });
        return { content: [{ type: 'text', text: raw }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }
  );

  // Tool: find_authors
  server.registerTool(
    'find_authors',
    {
      description: 'Search for authors by name in the Neo4j knowledge graph. Returns author details, community membership, top co-authors, and top papers.',
      inputSchema: {
        name: z.string().describe('Author name or partial name to search for'),
      },
    },
    async ({ name }): Promise<CallToolResult> => {
      try {
        const rows = await executeReadQuery(`
          MATCH (a:Author)
          WHERE toLower(a.name) CONTAINS toLower($name)
          OPTIONAL MATCH (a)-[:WROTE]->(p:Paper)
          WITH a, p ORDER BY p.citationCount DESC
          WITH a, collect(p { .id, .title, .year, .citationCount })[..5] AS topPapers
          OPTIONAL MATCH (a)-[:WROTE]->(:Paper)<-[:WROTE]-(coauthor:Author)
          WHERE coauthor <> a
          WITH a, topPapers, coauthor, count(*) AS collabs
          ORDER BY collabs DESC
          WITH a, topPapers, collect(coauthor { .id, .name, .hIndex, collaborations: collabs })[..5] AS topCoauthors
          RETURN a { .id, .name, .hIndex, .citationCount, .paperCount, .affiliations, .community } AS author,
                 topPapers,
                 topCoauthors
          LIMIT 20
        `, { name });
        return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }
  );

  // Tool: find_communities
  server.registerTool(
    'find_communities',
    {
      description: 'Explore research communities in the knowledge graph. Search by topic keyword or community ID. Returns community members, field distribution, and key papers.',
      inputSchema: {
        topic: z.string().optional().describe('Topic keyword to search for communities (e.g. "machine learning")'),
        communityId: z.number().optional().describe('Specific community ID number to explore'),
      },
    },
    async ({ topic, communityId }): Promise<CallToolResult> => {
      try {
        if (communityId !== undefined) {
          const rows = await executeReadQuery(`
            MATCH (a:Author { community: $communityId })-[:WROTE]->(p:Paper)
            WITH a, p
            ORDER BY p.citationCount DESC
            WITH collect(DISTINCT a { .id, .name, .hIndex, .citationCount })[..20] AS members,
                 collect(DISTINCT p { .id, .title, .year, .citationCount })[..10] AS keyPapers
            RETURN $communityId AS communityId, members, keyPapers
          `, { communityId });

          // Get field distribution for this community
          const fieldRows = await executeReadQuery(`
            MATCH (a:Author { community: $communityId })-[:WROTE]->(p:Paper)-[:IN_FIELD]->(f:Field)
            RETURN f.name AS field, count(*) AS count
            ORDER BY count DESC
            LIMIT 10
          `, { communityId });

          const result = rows[0] || { communityId, members: [], keyPapers: [] };
          return { content: [{ type: 'text', text: JSON.stringify({ ...result, fields: fieldRows }) }] };
        }

        if (topic) {
          // Find communities related to a topic via fields and papers
          const rows = await executeReadQuery(`
            MATCH (f:Field)
            WHERE toLower(f.name) CONTAINS toLower($topic)
            MATCH (p:Paper)-[:IN_FIELD]->(f)
            MATCH (a:Author)-[:WROTE]->(p)
            WHERE a.community IS NOT NULL
            WITH a.community AS communityId, collect(DISTINCT f.name) AS matchedFields,
                 count(DISTINCT a) AS memberCount, count(DISTINCT p) AS paperCount
            ORDER BY paperCount DESC
            LIMIT 10
            RETURN communityId, matchedFields, memberCount, paperCount
          `, { topic });
          return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        }

        // No input: list all communities
        const rows = await executeReadQuery(`
          MATCH (a:Author)
          WHERE a.community IS NOT NULL
          WITH a.community AS communityId, count(a) AS memberCount
          ORDER BY memberCount DESC
          LIMIT 50
          RETURN communityId, memberCount
        `);
        return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }
  );

  // Tool: hybrid_search
  server.registerTool(
    'hybrid_search',
    {
      description: 'Sequential search: queries Neo4j knowledge graph first, then Semantic Scholar API, and compares results. Identifies deltas between local graph and live API data. Returns results from both sources with confidence level and suggestions.',
      inputSchema: {
        query: z.string().describe('Search query (e.g. author name, paper title, or topic)'),
        type: z.enum(['paper', 'author', 'topic']).describe('Type of search: paper, author, or topic'),
      },
    },
    async ({ query, type }): Promise<CallToolResult> => {
      try {
        let graphResults: unknown[] = [];
        let apiResults: unknown = null;
        let graphError: string | null = null;
        let apiError: string | null = null;

        // Step 1: Query Neo4j graph
        try {
          if (type === 'paper') {
            graphResults = await executeReadQuery(`
              MATCH (p:Paper)
              WHERE toLower(p.title) CONTAINS toLower($query)
              OPTIONAL MATCH (a:Author)-[:WROTE]->(p)
              WITH p, collect(a.name)[..5] AS authors
              RETURN p { .id, .title, .year, .citationCount, .abstract } AS paper, authors
              ORDER BY p.citationCount DESC
              LIMIT 10
            `, { query });
          } else if (type === 'author') {
            graphResults = await executeReadQuery(`
              MATCH (a:Author)
              WHERE toLower(a.name) CONTAINS toLower($query)
              OPTIONAL MATCH (a)-[:WROTE]->(p:Paper)
              WITH a, count(p) AS graphPaperCount
              RETURN a { .id, .name, .hIndex, .citationCount, .paperCount, .community } AS author, graphPaperCount
              ORDER BY a.citationCount DESC
              LIMIT 10
            `, { query });
          } else {
            // topic
            graphResults = await executeReadQuery(`
              MATCH (f:Field)
              WHERE toLower(f.name) CONTAINS toLower($query)
              OPTIONAL MATCH (p:Paper)-[:IN_FIELD]->(f)
              WITH f, count(p) AS paperCount
              RETURN f.name AS field, paperCount
              ORDER BY paperCount DESC
              LIMIT 10
            `, { query });
          }
        } catch (error) {
          graphError = error instanceof Error ? error.message : String(error);
        }

        // Step 2: Query S2 API
        try {
          if (type === 'paper') {
            apiResults = await searchPapers(API_KEY, query, { limit: 10 });
          } else if (type === 'author') {
            apiResults = await searchAuthors(API_KEY, query, 10);
          } else {
            // For topic, search papers in that field
            apiResults = await searchPapers(API_KEY, query, { limit: 10 });
          }
        } catch (error) {
          apiError = error instanceof Error ? error.message : String(error);
        }

        // Step 3: Compute deltas and confidence
        const hasGraph = graphResults.length > 0;
        const hasApi = apiResults !== null && !apiError;

        let source: string;
        let confidence: string;
        let suggestion: string | null = null;
        const deltas: string[] = [];

        if (hasGraph && hasApi) {
          source = 'both';
          confidence = 'high';
          // Flag count differences
          const apiCount = Array.isArray(apiResults) ? apiResults.length :
            (apiResults as { data?: unknown[] })?.data?.length || 0;
          if (graphResults.length > 0 && apiCount > 0 && graphResults.length !== apiCount) {
            deltas.push(`Graph returned ${graphResults.length} results, API returned ${apiCount}. Graph may be a subset.`);
          }
        } else if (hasGraph && !hasApi) {
          source = 'graph';
          confidence = 'medium';
          if (apiError) deltas.push(`S2 API error: ${apiError}`);
          suggestion = 'Results from local graph only. S2 API unavailable — results may be stale.';
        } else if (!hasGraph && hasApi) {
          source = 'api';
          confidence = 'medium';
          if (graphError) {
            deltas.push(`Graph error: ${graphError}`);
          } else {
            deltas.push('No matching results in local graph.');
          }
          suggestion = 'Not yet in the knowledge graph. Consider ingesting these results.';
        } else {
          source = 'none';
          confidence = 'low';
          if (graphError) deltas.push(`Graph error: ${graphError}`);
          if (apiError) deltas.push(`API error: ${apiError}`);
          suggestion = 'No results in graph or S2. Try web search.';
        }

        const result = {
          graphResults,
          apiResults,
          deltas,
          source,
          confidence,
          suggestion,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
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
// OAuth 2.1 Consent Endpoint
// ============================================================

app.get('/oauth/consent', async (req: Request, res: Response) => {
  const authorizationId = req.query.authorization_id as string | undefined;

  if (!authorizationId) {
    res.status(400).send('Missing authorization_id parameter');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).send('Supabase not configured');
    return;
  }

  // Serve the consent page — supabase-js handles auth client-side
  res.status(200).send(consentPage(authorizationId, supabaseUrl, supabaseAnonKey));
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
app.get('/health', async (_req: Request, res: Response) => {
  const neo4jConnected = await isNeo4jConnected();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    oauth: !!process.env.SUPABASE_URL,
    apiKey: !!API_KEY,
    neo4j: neo4jConnected,
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
  await closeDriver();
  process.exit(0);
});
