# Semantic Scholar MCP Server

Remote MCP server with Streamable HTTP transport for Semantic Scholar API access.

## Features

- 🔌 **Streamable HTTP Transport** - Remote MCP server accessible anywhere
- 💾 **SQLite Caching** - Persistent cache with TTL-based expiration
- 🚦 **Rate Limiting** - Token bucket algorithm to prevent API quota exhaustion
- 📊 **Metrics** - Prometheus-compatible metrics endpoint
- 📝 **Structured Logging** - JSON logs with request IDs
- 🔒 **Security** - API key via environment variable only (no CLI exposure)

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/semantic-scholar-mcp.git
cd semantic-scholar-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Configuration

Set environment variables:

```bash
# Required: Semantic Scholar API key (get from https://www.semanticscholar.org/product/api)
export SEMANTIC_SCHOLAR_API_KEY="your-api-key"

# Optional: Server configuration
export PORT=3000
export HOST="0.0.0.0"
export LOG_LEVEL="info"

# Optional: Cache configuration
export CACHE_TTL_DAYS=7
export CACHE_MAX_SIZE=1073741824

# Optional: Rate limiting
export RATE_LIMIT_REQUESTS_PER_MINUTE=10
export RATE_LIMIT_BURST_SIZE=5
```

### Running

```bash
# Production
npm start

# Development (with hot reload)
npm run dev
```

### Connect from Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "semantic-scholar": {
      "type": "streamable-http",
      "url": "http://your-server:3000"
    }
  }
}
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP protocol handler |
| `GET /health` | Health check |
| `GET /metrics` | Prometheus metrics |

## Available Tools

| Tool | Description |
|------|-------------|
| `search_papers` | Search for papers with filters |
| `get_paper` | Get paper details by ID |
| `get_authors` | Get authors for a paper |
| `get_citations` | Get papers that cite a paper |
| `get_references` | Get papers referenced by a paper |
| `batch_fetch` | Fetch multiple papers efficiently |
| `get_cache_stats` | View cache statistics |
| `clear_cache` | Clear cached data |

## Deployment

### Docker

```bash
# Build image
docker build -t semantic-scholar-mcp .

# Run container
docker run -d \
  --name semantic-scholar-mcp \
  -p 3000:3000 \
  -e SEMANTIC_SCHOLAR_API_KEY="your-key" \
  semantic-scholar-mcp
```

### Railway Deployment

**One-click deploy:**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?template=https://github.com/truaxki/semantic-scholar-mcp)

**Manual deployment:**

1. **Connect repository**
   - Go to [Railway](https://railway.app) and sign in
   - Click "New Project" → "Deploy from GitHub repo"
   - Select `truaxki/semantic-scholar-mcp`

2. **Configure environment variables**
   - In Railway dashboard, go to your service's "Variables" tab
   - Add:
     ```
     SEMANTIC_SCHOLAR_API_KEY=your-api-key-here
     LOG_LEVEL=info
     PORT=3000
     ```

3. **Deploy**
   - Railway automatically detects Node.js and builds
   - Deploys with Streamable HTTP on port 3000
   - Gets free HTTPS endpoint automatically

4. **Connect from Claude Code**
   ```json
   {
     "mcpServers": {
       "semantic-scholar": {
         "type": "streamable-http",
         "url": "https://your-service.up.railway.app/mcp"
       }
     }
   }
   ```

**Railway pricing:** Free tier available, $5/month for dedicated resources.

### Manual Server (srv1338041)

```bash
# SSH to server
ssh user@srv1338041

# Clone and build
git clone your-repo
cd semantic-scholar-mcp
npm install
npm run build

# Create systemd service (see deploy/semantic-scholar-mcp.service)
sudo cp deploy/semantic-scholar-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable semantic-scholar-mcp
sudo systemctl start semantic-scholar-mcp
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Semantic Scholar MCP Server             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │   Express   │──▶│   MCP SDK   │──▶│  Tools    │ │
│  │   HTTP      │  │   Server    │  │  Registry │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│         │                 │                           │
│         ▼                 ▼                           │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │   Logging   │  │   Cache     │                  │
│  │  (Pino)     │  │ (SQLite)    │                  │
│  └──────────────┘  └──────────────┘                  │
│                                                      │
└─────────────────────────────────────────────────────┘
         │                 │                           │
         ▼                 ▼                           ▼
  HTTPS Endpoint    Persistent Cache    Rate Limited API
```

## API Key

Get your free Semantic Scholar API key from:
https://www.semanticscholar.org/product/api

Free tier: 100 requests/day

## License

MIT
