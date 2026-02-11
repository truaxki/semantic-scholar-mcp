/**
 * Semantic Scholar API Service
 * 
 * Handles all API communication with Semantic Scholar Graph API.
 * Features: Type-safe requests, error handling, response parsing.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import pino, { Logger } from 'pino';
import {
  SearchPapersParams,
  GetPaperParams,
  GetAuthorsParams,
  GetCitationsParams,
  BatchFetchParams,
  Paper,
  Author,
  AuthorDetail,
  SearchResponse,
  Citation,
  Reference,
  PAPER_FIELDS,
  AUTHOR_FIELDS
} from '../config.js';

/**
 * Custom API error with status code
 */
export class SemanticScholarError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseData?: unknown
  ) {
    super(message);
    this.name = 'SemanticScholarError';
  }
}

/**
 * Semantic Scholar API Service
 */
export class SemanticScholarService {
  private client: AxiosInstance;
  private logger: Logger;
  private defaultPaperFields: string[];
  private defaultAuthorFields: string[];

  constructor(apiKey: string, logger: Logger) {
    this.logger = logger;
    
    // Create axios client with defaults
    this.client = axios.create({
      baseURL: 'https://api.semanticscholar.org/graph/v1',
      timeout: 30000, // 30 second timeout
      headers: {
        'Accept': 'application/json',
        ...(apiKey && { 'x-api-key': apiKey })
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        this.logger.debug({
          method: config.method?.toUpperCase(),
          url: config.url,
          params: config.params
        }, 'Semantic Scholar API request');
        return config;
      },
      (error) => {
        this.logger.error({ error: String(error) }, 'API request interceptor error');
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data;
          
          this.logger.warn({
            status,
            url: error.config?.url,
            data
          }, 'Semantic Scholar API error');
          
          if (status === 429) {
            throw new SemanticScholarError(
              'Rate limit exceeded. Please try again later.',
              status,
              data
            );
          } else if (status === 404) {
            throw new SemanticScholarError(
              'Resource not found',
              status,
              data
            );
          } else if (status === 401 || status === 403) {
            throw new SemanticScholarError(
              'Authentication failed. Check your API key.',
              status,
              data
            );
          } else {
            throw new SemanticScholarError(
              `API error: ${status}`,
              status,
              data
            );
          }
        } else if (error.request) {
          throw new SemanticScholarError(
            'Network error. Please check your connection.',
            undefined,
            undefined
          );
        }
        throw error;
      }
    );

    // Default fields for common operations
    this.defaultPaperFields = [
      'paperId',
      'title',
      'abstract',
      'year',
      'authors',
      'citationCount',
      'fieldsOfStudy'
    ];

    this.defaultAuthorFields = [
      'authorId',
      'name',
      'affiliations',
      'citationCount',
      'hIndex'
    ];
  }

  /**
   * Search for papers
   */
  async searchPapers(params: SearchPapersParams): Promise<SearchResponse<Paper>> {
    const {
      query,
      fields = this.defaultPaperFields,
      limit = 10,
      offset = 0,
      year,
      fieldsOfStudy,
      openAccessPdf,
      publicationTypes,
      venue
    } = params;

    const requestParams: Record<string, unknown> = {
      query,
      fields: fields.join(','),
      limit: Math.min(limit, 100), // API max is 100
      offset
    };

    if (year) requestParams.year = year;
    if (fieldsOfStudy) requestParams.fieldsOfStudy = fieldsOfStudy.join(',');
    if (openAccessPdf) requestParams.openAccessPdf = true;
    if (publicationTypes) requestParams.publicationTypes = publicationTypes.join(',');
    if (venue) requestParams.venue = venue;

    const response = await this.client.get('/paper/search', { params: requestParams });

    return {
      total: response.data.total || 0,
      offset: response.data.offset || 0,
      data: response.data.data || []
    };
  }

  /**
   * Get a specific paper by ID
   */
  async getPaper(params: GetPaperParams): Promise<Paper> {
    const { paperId, fields = this.defaultPaperFields } = params;

    const response = await this.client.get(`/paper/${encodeURIComponent(paperId)}`, {
      params: { fields: fields.join(',') }
    });

    return response.data;
  }

  /**
   * Get authors for a paper
   */
  async getAuthors(params: GetAuthorsParams): Promise<SearchResponse<Author>> {
    const { 
      paperId, 
      fields = this.defaultAuthorFields,
      limit = 100,
      offset = 0 
    } = params;

    const response = await this.client.get(`/paper/${encodeURIComponent(paperId)}/authors`, {
      params: {
        fields: fields.join(','),
        limit: Math.min(limit, 1000), // API max is 1000
        offset
      }
    });

    return {
      total: response.data.total || 0,
      offset: response.data.offset || 0,
      data: response.data.data || []
    };
  }

  /**
   * Get citations for a paper
   */
  async getCitations(params: GetCitationsParams): Promise<SearchResponse<Citation>> {
    const { 
      paperId,
      fields = ['paperId', 'title', 'year', 'citationCount'],
      limit = 100,
      offset = 0
    } = params;

    const response = await this.client.get(`/paper/${encodeURIComponent(paperId)}/citations`, {
      params: {
        fields: fields.join(','),
        limit: Math.min(limit, 1000),
        offset
      }
    });

    return {
      total: response.data.total || 0,
      offset: response.data.offset || 0,
      data: response.data.data || []
    };
  }

  /**
   * Get references for a paper
   */
  async getReferences(params: GetCitationsParams): Promise<SearchResponse<Reference>> {
    const { 
      paperId,
      fields = ['paperId', 'title', 'year', 'citationCount'],
      limit = 100,
      offset = 0
    } = params;

    const response = await this.client.get(`/paper/${encodeURIComponent(paperId)}/references`, {
      params: {
        fields: fields.join(','),
        limit: Math.min(limit, 1000),
        offset
      }
    });

    return {
      total: response.data.total || 0,
      offset: response.data.offset || 0,
      data: response.data.data || []
    };
  }

  /**
   * Get author details
   */
  async getAuthor(authorId: string, paperLimit = 10): Promise<AuthorDetail> {
    const response = await this.client.get(`/author/${encodeURIComponent(authorId)}`, {
      params: {
        fields: AUTHOR_FIELDS.join(','),
        limit: paperLimit
      }
    });

    return response.data;
  }

  /**
   * Batch fetch papers (efficient for pipeline)
   */
  async batchFetchPapers(params: BatchFetchParams): Promise<Map<string, Paper>> {
    const { paperIds, fields = this.defaultPaperFields } = params;
    
    const results = new Map<string, Paper>();
    const batchSize = 100; // API max batch size

    for (let i = 0; i < paperIds.length; i += batchSize) {
      const batch = paperIds.slice(i, i + batchSize);
      
      try {
        const response = await this.client.post('/paper/batch', {
          ids: batch,
          fields: fields.join(',')
        });

        for (const paper of response.data) {
          if (paper) {
            results.set(paper.paperId, paper);
          }
        }
      } catch (error) {
        this.logger.warn({ 
          batch: { start: i, end: i + batch },
          error: String(error) 
        }, 'Batch fetch partially failed');
        
        // Fallback to individual requests for failed batch
        for (const paperId of batch) {
          try {
            const paper = await this.getPaper({ paperId, fields });
            results.set(paperId, paper);
          } catch {
            this.logger.warn({ paperId }, 'Failed to fetch paper individually');
          }
        }
      }
    }

    return results;
  }

  /**
   * Get popular papers (for recommendation)
   */
  async getTrendingPapers(limit = 10): Promise<Paper[]> {
    // Note: Semantic Scholar doesn't have a direct trending API
    // This would need to be implemented with a custom query
    const response = await this.client.get('/graph/v1/popular', {
      params: { limit }
    });
    
    return response.data.papers || [];
  }

  /**
   * Get paper counts by field of study
   */
  async getFieldStats(): Promise<Record<string, number>> {
    const response = await this.client.get('/graph/v1/stats/fieldsOfStudy');
    return response.data;
  }
}
