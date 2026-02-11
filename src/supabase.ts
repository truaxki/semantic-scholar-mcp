import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

// Create client (may be empty if OAuth not configured)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const supabaseProjectRef = supabaseUrl
  ? new URL(supabaseUrl).hostname.split('.')[0]
  : '';

export const supabaseOAuthEndpoints = {
  issuer: `${supabaseUrl}/auth/v1`,
  authorizationEndpoint: `${supabaseUrl}/auth/v1/oauth/authorize`,
  tokenEndpoint: `${supabaseUrl}/auth/v1/oauth/token`,
  registrationEndpoint: `${supabaseUrl}/auth/v1/oauth/clients/register`,
  jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
  userinfoEndpoint: `${supabaseUrl}/auth/v1/oauth/userinfo`,
  wellKnown: `${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`,
};
