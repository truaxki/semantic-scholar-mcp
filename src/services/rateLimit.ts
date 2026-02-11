/**
 * Rate Limit Service
 * 
 * Token bucket rate limiting for API requests.
 * Features: Per-key limiting, burst support, metrics.
 */

import pino, { Logger } from 'pino';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Requests allowed per minute */
  requestsPerMinute: number;
  /** Burst size for initial requests */
  burstSize: number;
}

/**
 * Rate limit state for a key
 */
interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

/**
 * Rate Limit Service (Token Bucket Algorithm)
 */
export class RateLimitService {
  private config: RateLimitConfig;
  private logger: Logger;
  private states: Map<string, RateLimitState> = new Map();

  constructor(config: RateLimitConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    
    this.logger.info(config, 'Rate limiter initialized');
  }

  /**
   * Check if request is allowed for key
   */
  isAllowed(key: string = 'default'): boolean {
    const now = Date.now();
    let state = this.states.get(key);
    
    if (!state) {
      // Initialize with burst tokens
      state = {
        tokens: this.config.burstSize,
        lastRefill: now
      };
      this.states.set(key, state);
    }

    // Calculate tokens to add based on time elapsed
    const elapsed = now - state.lastRefill;
    const refillRate = this.config.requestsPerMinute / 60000; // tokens per ms
    const tokensToAdd = Math.floor(elapsed * refillRate);
    
    // Update state
    state.tokens = Math.min(
      this.config.burstSize,
      state.tokens + tokensToAdd
    );
    state.lastRefill = now;

    // Check if we can allow the request
    if (state.tokens >= 1) {
      state.tokens -= 1;
      this.logger.debug({ key, tokens: state.tokens }, 'Request allowed');
      return true;
    }

    this.logger.warn({ key, tokens: state.tokens }, 'Rate limit exceeded');
    return false;
  }

  /**
   * Wait for rate limit (non-blocking)
   */
  async waitForToken(key: string = 'default', maxWaitMs = 60000): Promise<boolean> {
    const startWait = Date.now();
    
    while (Date.now() - startWait < maxWaitMs) {
      if (this.isAllowed(key)) {
        return true;
      }
      
      // Calculate wait time
      const state = this.states.get(key);
      if (state) {
        const msPerToken = 60000 / this.config.requestsPerMinute;
        const waitTime = Math.min(msPerToken, maxWaitMs - (Date.now() - startWait));
        await new Promise(resolve => setTimeout(resolve, Math.ceil(waitTime)));
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    this.logger.warn({ key, maxWaitMs }, 'Rate limit wait timed out');
    return false;
  }

  /**
   * Get remaining tokens for key
   */
  getRemaining(key: string = 'default'): number {
    const now = Date.now();
    let state = this.states.get(key);
    
    if (!state) {
      return this.config.burstSize;
    }

    const elapsed = now - state.lastRefill;
    const refillRate = this.config.requestsPerMinute / 60000;
    const tokensToAdd = Math.floor(elapsed * refillRate);
    
    return Math.min(this.config.burstSize, state.tokens + tokensToAdd);
  }

  /**
   * Reset rate limit for key
   */
  reset(key: string = 'default'): void {
    this.states.delete(key);
    this.logger.debug({ key }, 'Rate limit reset');
  }

  /**
   * Clear all rate limit states
   */
  clear(): void {
    this.states.clear();
    this.logger.info('All rate limits cleared');
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Get rate limit headers for HTTP responses
   */
  getHeaders(key: string = 'default'): Record<string, string> {
    const remaining = this.getRemaining(key);
    const resetMs = Math.ceil(60000 / this.config.requestsPerMinute);
    
    return {
      'X-RateLimit-Limit': String(this.config.burstSize),
      'X-RateLimit-Remaining': String(Math.max(0, remaining)),
      'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + resetMs))
    };
  }
}
