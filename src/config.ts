/**
 * Configuration types for Semantic Scholar MCP Server
 */

export interface SemanticScholarConfig {
  /** Semantic Scholar API key */
  apiKey: string;
  
  /** Base URL for Semantic Scholar API */
  baseUrl: string;
  
  /** Cache configuration */
  cache?: {
    /** Time to live in milliseconds */
    ttl: number;
    /** Maximum cache size in bytes */
    maxSize: number;
  };
  
  /** Rate limit configuration */
  rateLimit?: {
    /** Requests per minute */
    requestsPerMinute: number;
    /** Burst size */
    burstSize: number;
  };
  
  /** Logging configuration */
  logging?: {
    /** Log level */
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * Paper fields that can be requested
 */
export const PAPER_FIELDS = [
  'paperId',
  'title',
  'abstract',
  'year',
  'publicationDate',
  'authors',
  'citationCount',
  'referenceCount',
  'influentialCitationCount',
  'fieldsOfStudy',
  'venue',
  'journal',
  'doi',
  'arxivId',
  'url',
  'pdfUrl',
  'openAccessPdf',
  'embedding'
] as const;

/**
 * Author fields that can be requested
 */
export const AUTHOR_FIELDS = [
  'authorId',
  'name',
  'affiliations',
  'homepageUrl',
  'citationCount',
  'hIndex',
  'paperCount'
] as const;

/**
 * Paper search parameters
 */
export interface SearchPapersParams {
  query: string;
  fields?: string[];
  limit?: number;
  offset?: number;
  year?: string;
  fieldsOfStudy?: string[];
  openAccessPdf?: boolean;
  publicationTypes?: string[];
  venue?: string;
}

/**
 * Get paper parameters
 */
export interface GetPaperParams {
  paperId: string;
  fields?: string[];
}

/**
 * Get authors for a paper
 */
export interface GetAuthorsParams {
  paperId: string;
  fields?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Get citations for a paper
 */
export interface GetCitationsParams {
  paperId: string;
  limit?: number;
  offset?: number;
  fields?: string[];
}

/**
 * Batch fetch papers (for pipeline)
 */
export interface BatchFetchParams {
  paperIds: string[];
  fields?: string[];
}

/**
 * API response types
 */
export interface Paper {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  publicationDate?: string;
  authors?: Author[];
  citationCount?: number;
  referenceCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  venue?: string;
  journal?: {
    name: string;
    volume?: string;
    pages?: string;
  };
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfUrl?: string;
  openAccessPdf?: {
    url: string;
    isOpenAccess: boolean;
  };
  embedding?: {
    model: string;
    vector: number[];
  };
  [key: string]: unknown;
}

export interface Author {
  authorId: string;
  name: string;
  affiliations?: string[];
  homepageUrl?: string;
  citationCount?: number;
  hIndex?: number;
  paperCount?: number;
  [key: string]: unknown;
}

export interface AuthorDetail extends Author {
  papers?: Paper[];
}

export interface SearchResponse<T> {
  total: number;
  offset: number;
  data: T[];
}

export interface Citation {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  authors?: Author[];
  citationCount?: number;
}

export interface Reference {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  authors?: Author[];
  citationCount?: number;
}
