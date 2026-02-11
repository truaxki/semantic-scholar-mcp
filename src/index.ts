/**
 * Semantic Scholar MCP Server
 * 
 * Remote MCP server with Streamable HTTP transport for Semantic Scholar API access.
 * Features: SQLite caching, rate limiting, structured logging.
 * 
 * @packageDocumentation
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { McpServer, Resource } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

import { SemanticScholarService } from './services/semanticScholar.js';
import { CacheService } from './services/cache.js';
import { RateLimitService } from './services/rateLimit.js';
import { registerTools } from './tools/index.js';
import { SemanticScholarConfig } from './config.js';

// Get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logger setup
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino/file',
    options: { destination: 1 } // stdout
  }
});

/**
 * Main server class for Semantic Scholar MCP Server
 */
export class SemanticScholarMCPServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private transport: StreamableHTTPServerTransport | null = null;
  private mcpServer: McpServer;
  private semanticScholar: SemanticScholarService;
  private cache: CacheService;
  private rateLimit: RateLimitService;
  private sessions: Map<string, StreamableHTTPServerTransport> = new Map();

  constructor(private config: SemanticScholarConfig) {
    this.app = express();
    this.server = createServer(this.app);
    
    // Initialize services
    this.semanticScholar = new SemanticScholarService(config.apiKey, logger);
    this.cache = new CacheService(path.join(__dirname, '..', 'cache.sqlite'), logger);
    this.rateLimit = new RateLimitService({
      requestsPerMinute: config.rateLimit?.requestsPerMinute || 10,
      burstSize: config.rateLimit?.burstSize || 5
    }, logger);

    // Initialize MCP server
    this.mcpServer = new McpServer({
      name: 'semantic-scholar-mcp',
      version: '1.0.0',
      logger
    });

    // Setup middleware
    this.setupMiddleware();

    // Register tools and resources
    registerTools(this.mcpServer, this.semanticScholar, this.cache, this.rateLimit, logger);
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // JSON body parser
    this.app.use(express.json());

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      const requestId = uuidv4().slice(0, 8);
      (req as any).requestId = requestId;
      logger.info({ 
        requestId, 
        method: req.method, 
        path: req.path 
      }, 'Incoming request');
      next();
    });

    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Metrics endpoint (Prometheus-compatible)
    this.app.get('/metrics', (_req: Request, res: Response) => {
      const metrics = this.getMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    });

    // MCP endpoint - handles all MCP protocol traffic
    this.app.all('/mcp', async (req: Request, res: Response, next: NextFunction) => {
      try {
        await this.handleMCPRequest(req, res);
      } catch (error) {
        next(error);
      }
    });
  }

  /**
   * Handle MCP protocol requests via Streamable HTTP
   */
  private async handleMCPRequest(req: Request, res: Response): Promise<void> {
    const requestId = (req as any).requestId;
    
    // Get or create session ID
    let sessionId = req.headers['mcp-session-id'] as string | undefined;
    
    if (!sessionId && isInitializeRequest(req.body)) {
      // New session for initialize request
      sessionId = uuidv4();
    } else if (!sessionId) {
      // No session for non-initialize request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Missing MCP session ID'
        }
      });
      return;
    }

    // Get or create transport for session
    let transport = this.sessions.get(sessionId);
    
    if (!transport && isInitializeRequest(req.body)) {
      // Create new transport for new session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId!,
        logger
      });
      
      // Handle session close
      transport.onclose = () => {
        logger.info({ sessionId }, 'Session closed');
        this.sessions.delete(sessionId!);
      };
      
      this.sessions.set(sessionId, transport);
      
      // Connect transport to MCP server
      await this.mcpServer.connect(transport);
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid session'
        }
      });
      return;
    }

    // Handle the request
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error({ requestId, error: String(error) }, 'Error handling MCP request');
      throw error;
    }
  }

  /**
   * Get Prometheus-compatible metrics
   */
  private getMetrics(): string {
    const metrics: string[] = [];

    // Cache metrics
    metrics.push(`# HELP semantic_scholar_cache_hits Total cache hits`);
    metrics.push(`# TYPE semantic_scholar_cache_hits counter`);
    metrics.push(`semantic_scholar_cache_hits ${this.cache.getHitCount()}`);
    
    metrics.push(`# HELP semantic_scholar_cache_misses Total cache misses`);
    metrics.push(`# TYPE semantic_scholar_cache_misses counter`);
    metrics.push(`semantic_scholar_cache_misses ${this.cache.getMissCount()}`);

    // Rate limit metrics
    metrics.push(`# HELP semantic_scholar_rate_limit_remaining Remaining rate limit tokens`);
    metrics.push(`# TYPE semantic_scholar_rate_limit_remaining gauge`);
    metrics.push(`semantic_scholar_rate_limit_remaining ${this.rateLimit.getRemaining()}`);

    // Session metrics
    metrics.push(`# HELP semantic_scholar_active_sessions Number of active MCP sessions`);
    metrics.push(`# TYPE semantic_scholar_active_sessions gauge`);
    metrics.push(`semantic_scholar_active_sessions ${this.sessions.size}`);

    return metrics.join('\n');
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '0.0.0.0';

    return new Promise((resolve) => {
      this.server.listen(port, host, () => {
        logger.info({ host, port }, 'Semantic Scholar MCP Server started');
        logger.info('Endpoints:');
        logger.info(`  MCP: http://${host}:${port}/mcp`);
        logger.info(`  Health: http://${host}:${port}/health`);
        logger.info(`  Metrics: http://${host}:${port}/metrics`);
        resolve();
      });
    });
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    logger.info('Shutting down server...');
    
    // Close all sessions
    for (const [sessionId, transport] of this.sessions) {
      logger.debug({ sessionId }, 'Closing session');
      await transport.close();
    }
    this.sessions.clear();

    // Close server
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('Server stopped');
        resolve();
      });
    });
  }
}

/**
 * Default configuration
 */
export const defaultConfig: SemanticScholarConfig = {
  apiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
  baseUrl: process.env.SEMANTIC_SCHOLAR_API_URL || 'https://api.semanticscholar.org/graph/v1',
  cache: {
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxSize: 1000 * 1024 * 1024 // 1GB
  },
  rateLimit: {
    requestsPerMinute: 10,
    burstSize: 5
  }
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SemanticScholarMCPServer(defaultConfig);
  
  // Graceful shutdown
  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  server.start().catch((error) => {
    logger.error({ error: String(error) }, 'Failed to start server');
    process.exit(1);
  });
}
