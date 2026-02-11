import type { RequestHandler } from 'express';
import { supabase, supabaseOAuthEndpoints } from './supabase.js';

// AuthInfo type expected by MCP SDK
export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

/**
 * Verify an access token with Supabase
 */
export async function verifyAccessToken(token: string): Promise<AuthInfo> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }
  // Use Supabase to verify the token and get user info
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error(error?.message || 'Invalid token');
  }

  // Extract expiration from JWT (tokens are JWTs)
  // The token payload is base64url encoded in the second segment
  let expiresAt = Math.floor(Date.now() / 1000) + 3600; // Default 1 hour
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    );
    if (payload.exp) {
      expiresAt = payload.exp;
    }
  } catch {
    // Use default expiration if parsing fails
  }

  return {
    token,
    clientId: user.id,
    scopes: [], // Supabase beta doesn't have granular scopes yet
    expiresAt,
  };
}

/**
 * OAuth token verifier for MCP SDK
 */
export const tokenVerifier = {
  verifyAccessToken,
};

/**
 * Bearer auth middleware for protecting MCP endpoints
 */
let authDisabledWarningShown = false;

export function requireBearerAuth(options?: {
  requiredScopes?: string[];
}): RequestHandler {
  return async (req, res, next) => {
    // Skip auth if Supabase not configured (unauthenticated mode)
    if (!supabase) {
      if (!authDisabledWarningShown) {
        console.warn('⚠️  Auth disabled: SUPABASE_URL not configured. All requests are unauthenticated.');
        authDisabledWarningShown = true;
      }
      next();
      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        error_description: 'Missing or invalid Authorization header',
      });
      return;
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    try {
      const authInfo = await verifyAccessToken(token);

      // Check required scopes if specified
      if (options?.requiredScopes?.length) {
        const hasScopes = options.requiredScopes.every((scope) =>
          authInfo.scopes.includes(scope)
        );
        if (!hasScopes) {
          res.status(403).json({
            error: 'insufficient_scope',
            error_description: 'Token does not have required scopes',
          });
          return;
        }
      }

      // Attach auth info to request
      req.auth = authInfo;
      next();
    } catch (error) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: error instanceof Error ? error.message : 'Invalid token',
      });
    }
  };
}

/**
 * OAuth metadata for Supabase OAuth 2.1 server
 * This tells MCP clients where to authenticate
 */
export function getOAuthMetadata() {
  return {
    issuer: supabaseOAuthEndpoints.issuer,
    authorization_endpoint: supabaseOAuthEndpoints.authorizationEndpoint,
    token_endpoint: supabaseOAuthEndpoints.tokenEndpoint,
    registration_endpoint: supabaseOAuthEndpoints.registrationEndpoint,
    jwks_uri: supabaseOAuthEndpoints.jwksUri,
    userinfo_endpoint: supabaseOAuthEndpoints.userinfoEndpoint,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: ['openid', 'email', 'profile', 'phone'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'HS256', 'ES256'],
  };
}
