/**
 * MCP Tools Registration
 * 
 * Registers all Semantic Scholar tools with the MCP server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import pino, { Logger } from 'pino';

import { SemanticScholarService } from '../services/semanticScholar.js';
import { CacheService } from '../services/cache.js';
import { RateLimitService } from '../services/rateLimit.js';
import {
  SearchPapersParams,
  GetPaperParams,
  GetAuthorsParams,
  GetCitationsParams,
  BatchFetchParams,
  Paper,
  SearchResponse,
  Author,
  Citation,
  Reference
} from '../config.js';

/**
 * Register all Semantic Scholar tools
 */
export function registerTools(
  server: McpServer,
  semanticScholar: SemanticScholarService,
  cache: CacheService,
  rateLimit: RateLimitService,
  logger: pino.Logger
): void {
  /**
   * Tool: search_papers
   * Search for academic papers with filters
   */
  server.registerTool(
    'search_papers',
    {
      title: 'Search Papers',
      description: `Search for academic papers using Semantic Scholar. Supports filtering by year, field of study, open access, and more.
      
      **Use this to:**
      - Find papers on a specific topic
      - Filter by publication year or range
      - Find open access papers only
      - Limit results to specific fields like Computer Science
      
      **Returns:** List of papers with metadata (title, authors, citations, year)`,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Plain text search query. Use specific terms for better results.'
          },
          year: {
            type: 'string',
            description: 'Publication year or range (e.g., "2023", "2020-2024")'
          },
          fieldsOfStudy: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fields of study to filter (e.g., ["Computer Science", "Physics"])'
          },
          openAccessPdf: {
            type: 'boolean',
            description: 'Only return papers with freely available PDFs'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 10,
            description: 'Maximum number of results to return'
          }
        },
        required: ['query']
      }
    },
    async (args: Record<string, unknown>) => {
      const params: SearchPapersParams = {
        query: String(args.query),
        year: args.year ? String(args.year) : undefined,
        fieldsOfStudy: args.fieldsOfStudy as string[] | undefined,
        openAccessPdf: args.openAccessPdf as boolean | undefined,
        limit: args.limit ? Number(args.limit) : 10
      };

      // Check cache first
      const cached = cache.get<SearchResponse<Paper>>('search', params);
      if (cached) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...cached,
                cached: true,
                message: `Found ${cached.data.length} papers (cached)`
              }, null, 2)
            }
          ]
        };
      }

      // Check rate limit
      if (!rateLimit.isAllowed()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Rate limit exceeded. Please wait before making more requests.',
                retryAfter: '~6 seconds'
              }, null, 2)
            }
          ]
        };
      }

      try {
        const results = await semanticScholar.searchPapers(params);
        
        // Cache the results
        cache.set('search', params, results);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...results,
                cached: false,
                message: `Found ${results.total} papers, showing ${results.data.length}`
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error({ error: String(error) }, 'Search failed');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  /**
   * Tool: get_paper
   * Get detailed information about a specific paper
   */
  server.registerTool(
    'get_paper',
    {
      title: 'Get Paper Details',
      description: `Get detailed information about a specific paper by ID.
      
      **Supported ID formats:**
      - Semantic Scholar ID: \`649def34f8be52c8b66281af98ae884c09aef38b\`
      - DOI: \`10.18653/v1/N18-3011\`
      - arXiv: \`ARXIV:2106.15928\`
      - URL: \`URL:https://arxiv.org/abs/2106.15928\`
      
      **Returns:** Full paper metadata including abstract, authors, citations`,
      inputSchema: {
        type: 'object',
        properties: {
          paperId: {
            type: 'string',
            description: 'Paper ID (Semantic Scholar SHA, DOI, arXiv ID, or URL)'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional fields to include (abstract, journal, embedding, etc.)',
            default: ['title', 'authors', 'year', 'citationCount']
          }
        },
        required: ['paperId']
      }
    },
    async (args: Record<string, unknown>) => {
      const params: GetPaperParams = {
        paperId: String(args.paperId),
        fields: args.fields as string[] | undefined
      };

      // Check cache
      const cached = cache.get<Paper>('paper', params);
      if (cached) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...cached,
                cached: true
              }, null, 2)
            }
          ]
        };
      }

      // Check rate limit
      if (!rateLimit.isAllowed()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Rate limit exceeded'
              }, null, 2)
            }
          ]
        };
      }

      try {
        const paper = await semanticScholar.getPaper(params);
        cache.set('paper', params, paper);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(paper, null, 2)
            }
          ];
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  /**
   * Tool: get_authors
   * Get authors for a specific paper
   */
  server.registerTool(
    'get_authors',
    {
      title: 'Get Paper Authors',
      description: `Get the list of authors for a specific paper with their details.
      
      **Returns:** Author names, affiliations, citation counts, and h-index`,
      inputSchema: {
        type: 'object',
        properties: {
          paperId: {
            type: 'string',
            description: 'Paper ID to get authors for'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            default: 100,
            description: 'Maximum number of authors to return'
          }
        },
        required: ['paperId']
      }
    },
    async (args: Record<string, unknown>) => {
      const params: GetAuthorsParams = {
        paperId: String(args.paperId),
        limit: args.limit ? Number(args.limit) : 100
      };

      if (!rateLimit.isAllowed()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Rate limit exceeded' }, null, 2)
            }
          ]
        };
      }

      try {
        const authors = await semanticScholar.getAuthors(params);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                total: authors.total,
                authors: authors.data
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  /**
   * Tool: get_citations
   * Get papers that cite a specific paper
   */
  server.registerTool(
    'get_citations',
    {
      title: 'Get Citations',
      description: `Get the list of papers that cite a specific paper (incoming citations).
      
      Useful for finding follow-up work and understanding a paper's influence.`,
      inputSchema: {
        type: 'object',
        properties: {
          paperId: {
            type: 'string',
            description: 'Paper ID to get citations for'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            default: 100,
            description: 'Maximum number of citations to return'
          }
        },
        required: ['paperId']
      }
    },
    async (args: Record<string, unknown>) => {
      const params: GetCitationsParams = {
        paperId: String(args.paperId),
        limit: args.limit ? Number(args.limit) : 100
      };

      if (!rateLimit.isAllowed()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Rate limit exceeded' }, null, 2)
            }
          ]
        };
      }

      try {
        const citations = await semanticScholar.getCitations(params);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                total: citations.total,
                citations: citations.data
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  /**
   * Tool: get_references
   * Get papers referenced by a specific paper
   */
  server.registerTool(
    'get_references',
    {
      title: 'Get References',
      description: `Get the list of papers referenced by a specific paper (outgoing references).
      
      Useful for finding related work and understanding a paper's foundations.`,
      inputSchema: {
        type: 'object',
        properties: {
          paperId: {
            type: 'string',
            description: 'Paper ID to get references for'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            default: 100,
            description: 'Maximum number of references to return'
          }
        },
        required: ['paperId']
      }
    },
    async (args: Record<string, unknown>) => {
      const params: GetCitationsParams = {
        paperId: String(args.paperId),
        limit: args.limit ? Number(args.limit) : 100
      };

      if (!rateLimit.isAllowed()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Rate limit exceeded' }, null, 2)
            }
          ]
        };
      }

      try {
        const references = await semanticScholar.getReferences(params);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                total: references.total,
                references: references.data
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  /**
   * Tool: batch_fetch
   * Batch fetch multiple papers (for pipeline)
   */
  server.registerTool(
    'batch_fetch',
    {
      title: 'Batch Fetch Papers',
      description: `Efficiently fetch multiple papers by ID in a single request.
      
      **Use this for:**
      - Loading papers for a knowledge graph
      - Fetching a list of known papers
      - Data pipeline operations
      
      **Note:** Maximum 100 papers per batch.`,
      inputSchema: {
        type: 'object',
        properties: {
          paperIds: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 100,
            description: 'List of paper IDs to fetch'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fields to include for each paper'
          }
        },
        required: ['paperIds']
      }
    },
    async (args: Record<string, unknown>) => {
      const paperIds = args.paperIds as string[];
      const fields = args.fields as string[] | undefined;

      if (!rateLimit.isAllowed()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Rate limit exceeded' }, null, 2)
            }
          ]
        };
      }

      try {
        const papers = await semanticScholar.batchFetchPapers({
          paperIds,
          fields
        });
        
        const results = Array.from(papers.values());
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                requested: paperIds.length,
                fetched: results.length,
                papers: results
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  /**
   * Tool: get_cache_stats
   * Get cache statistics
   */
  server.registerTool(
    'get_cache_stats',
    {
      title: 'Get Cache Statistics',
      description: 'Get statistics about the API cache (hits, misses, size)',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    async () => {
      const stats = cache.getStats();
      const rateLimitRemaining = rateLimit.getRemaining();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              cache: stats,
              rateLimit: {
                remaining: rateLimitRemaining,
                limit: rateLimit.getConfig().burstSize
              }
            }, null, 2)
          }
        ]
      };
    }
  );

  /**
   * Tool: clear_cache
   * Clear the API cache
   */
  server.registerTool(
    'clear_cache',
    {
      title: 'Clear Cache',
      description: 'Clear all cached API responses',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    async () => {
      cache.clear();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Cache cleared'
            }, null, 2)
          }
        ]
      };
    }
  );
}
