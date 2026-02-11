# Semantic Scholar MCP Server

Remote MCP server with Streamable HTTP transport for querying the [Semantic Scholar API](https://api.semanticscholar.org/).

## Features

- 🔌 **Streamable HTTP Transport** — MCP over HTTP, connectable from any compatible client (Claude Code, etc.)
- 🔍 **8 tools** — search_papers, get_paper, get_author, get_citations, get_references, batch_papers, get_paper_recommendations, search_by_title
- 💾 **SQLite Caching** — persistent cache with configurable TTL
- 🔒 **Optional OAuth 2.1** — Supabase-backed auth (skips when not configured)

## Quick Start

```bash
npm install
npm run build
npm start
```

Server starts at `http://localhost:3100` by default.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | Server port |
| `SERVER_URL` | No | `http://localhost:${PORT}` | Public URL (for OAuth metadata) |
| `SEMANTIC_SCHOLAR_API_KEY` | No | — | S2 API key (higher rate limits) |
| `SUPABASE_URL` | No | — | Enables OAuth 2.1 when set |
| `SUPABASE_ANON_KEY` | No | — | Supabase anonymous key |

### Connect from Claude Code

```bash
claude mcp add semantic-scholar --transport http https://your-deployed-url/mcp
```

### Test

```bash
curl http://localhost:3100/health
```

## Deployment

### Railway

1. Create a new service in your Railway project
2. Connect to `truaxki/semantic-scholar-mcp`, branch `feature/oauth-auth`
3. Railway auto-detects the Dockerfile and deploys
4. Set `PORT` env var (Railway usually provides this)
5. Add a public domain

### Docker

```bash
docker compose up -d
```

## Architecture

```
Client → POST /mcp → Auth Middleware → StreamableHTTPServerTransport → McpServer → Semantic Scholar API
                          ↓ (skip if no Supabase)
                     Supabase token verification
```

Built mirroring the [RemoteServer](https://github.com/anthropics/anthropic-sdk-python) reference architecture from the MCP SDK.

## Source Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Express app, MCP endpoints, tool registration |
| `src/auth.ts` | OAuth 2.1 / Bearer token middleware |
| `src/supabase.ts` | Supabase client + OAuth endpoint config |
| `src/semantic-scholar.ts` | Semantic Scholar API client |
| `src/cache.ts` | SQLite cache with TTL |
