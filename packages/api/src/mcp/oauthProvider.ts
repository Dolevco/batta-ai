/**
 * MCP OAuth Provider – pure resource server (token verifier only).
 *
 * Validates tokens issued by Microsoft Entra ID via JWKS (RS256).
 * This server NEVER issues tokens – all tokens come from Entra.
 *
 * OAuth discovery flow (no proxy on our side):
 *   1. Agent → POST /mcp (no token) → 401 WWW-Authenticate pointing to RS metadata
 *   2. Agent → GET /.well-known/oauth-protected-resource/mcp → authorization_servers: [Entra issuer]
 *   3. Agent → GET /.well-known/oauth-authorization-server → Entra endpoints (served by us, describing Entra)
 *   4. Agent authenticates DIRECTLY with Entra (Authorization Code + PKCE, public client)
 *   5. Entra issues RS256 access token; agent sends it on every POST /mcp request
 *   6. Server validates: RS256 signature (JWKS), issuer, audience, expiry, required scopes
 *
 * Required env vars: ENTRA_TENANT_ID, ENTRA_CLIENT_ID
 * Optional:         ENTRA_AUDIENCE (defaults to api://<ENTRA_CLIENT_ID>)
 */

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { verifyJWT } from '../middleware/auth';

// ── Token validator – delegates to the shared verifyJWT from auth.ts ──────────

async function verifyEntraToken(
  token: string,
  audience: string,
  configuredTenantId: string,
): Promise<AuthInfo> {
  // verifyJWT handles JWKS client caching, per-tenant key resolution, and
  // signature / issuer / expiry verification – no duplication needed here.
  const verified = await verifyJWT(token);

  if (!verified) {
    throw new InvalidTokenError('Token validation failed');
  }

  // Validate the audience explicitly (verifyJWT leaves audience open for REST middleware)
  const tokenAud = verified.aud;
  const audList = Array.isArray(tokenAud) ? tokenAud : [tokenAud, `api://${tokenAud}`];
  if (!audList.includes(audience)) {
    throw new InvalidTokenError('Token validation failed');
  }

  const tenantId = (verified['tid'] as string | undefined) ?? configuredTenantId;
  const userId   = ((verified['oid'] ?? verified.sub) as string | undefined) ?? '';
  const email    = (verified['preferred_username'] ?? verified['email']) as string | undefined;
  // Display name from the `name` claim (e.g. "John Doe") – used for "on behalf of" attribution
  const name     = verified['name'] as string | undefined;
  // Delegated scopes are space-separated in the `scp` claim
  const scopes   = typeof verified['scp'] === 'string'
    ? (verified['scp'] as string).split(' ').filter(Boolean)
    : [];

  console.log(
    `[MCP Auth] ✓ user=${name ?? email ?? userId} · tenant=${tenantId} · scopes=[${scopes.join(', ')}]`,
  );

  return {
    token,
    clientId: ((verified['azp'] ?? verified['appid'] ?? verified.sub) as string | undefined) ?? '',
    scopes,
    expiresAt: verified.exp as number,
    extra: { tenantId, userId, email, name },
    // Augmented fields (declared in auth.d.ts module augmentation)
    tenantId,
    userId,
    email,
    name,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface McpVerifier {
  /** Verifier for requireBearerAuth – validates Entra RS256 tokens via JWKS. */
  verifier: OAuthTokenVerifier;
  /** Entra AS metadata – passed to mcpAuthMetadataRouter so clients discover Entra directly. */
  oauthMetadata: OAuthMetadata;
}

/**
 * Creates the MCP token verifier and the Entra AS OAuth metadata.
 * Requires ENTRA_TENANT_ID + ENTRA_CLIENT_ID environment variables.
 */
export function createMcpVerifier(): McpVerifier {
  const tenantId = process.env.ENTRA_TENANT_ID;
  if (!tenantId) {
    throw new Error('ENTRA_TENANT_ID must be set for MCP authentication');
  }
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!clientId) {
    throw new Error('ENTRA_CLIENT_ID must be set for MCP authentication');
  }

  const audience = process.env.ENTRA_AUDIENCE ?? `api://${clientId}`;
  const authBase = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

  console.log(`[MCP OAuth] Provider: Entra ID · tenant=${tenantId} · audience=${audience}`);

  const verifier: OAuthTokenVerifier = {
    verifyAccessToken: (token: string) => verifyEntraToken(token, audience, tenantId),
  };

  // Entra AS metadata served at /.well-known/oauth-authorization-server.
  // Clients (Claude Code, Copilot) use this to discover authorization + token endpoints.
  //
  // IMPORTANT: issuer must be set to the SERVER's base URL (not the Entra issuer URL).
  //
  // mcpAuthMetadataRouter copies `oauthMetadata.issuer` into the protected resource
  // metadata as `authorization_servers[0]`. MCP clients (Claude Code, VS Code) then fetch
  // /.well-known/oauth-authorization-server relative to that URL. If issuer is set to the
  // Entra URL, clients will fetch Entra's own discovery document which has no
  // registration_endpoint, causing:
  //   "Incompatible auth server: does not support dynamic client registration"
  //
  // By setting issuer to the server URL, clients fetch OUR /.well-known/oauth-authorization-server
  // which includes registration_endpoint pointing to our /register stub. The actual
  // authorization_endpoint and token_endpoint still point directly to Entra.
  const serverBaseUrl = process.env.MCP_ISSUER_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
  // Proxy endpoints are always under /api/ so they're routed to the API by AFD.
  // The issuer stays at the root domain (serverBaseUrl) for discovery URL construction.
  const apiBase = `${serverBaseUrl}/api`;

  // Proxy endpoints on our server that strip the `resource` parameter (RFC 8707)
  // before forwarding to Entra. MCP clients send resource=<mcp-url> which Entra
  // rejects (AADSTS9010010) unless that URL is a registered Application ID URI.
  // Container app hostnames can't be registered, so we proxy both /authorize and
  // /token to drop the parameter before it reaches Entra.
  const oauthMetadata: OAuthMetadata = {
    issuer: serverBaseUrl,
    authorization_endpoint: `${apiBase}/authorize`,
    token_endpoint:          `${apiBase}/token`,
    revocation_endpoint:     `${authBase}/revoke`,
    // Static registration stub – see POST /register in index.ts
    registration_endpoint:   `${apiBase}/register`,
    response_types_supported:              ['code'],
    grant_types_supported:                 ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported:      ['S256'],
    token_endpoint_auth_methods_supported: ['none'], // public client – no secret
  };

  return { verifier, oauthMetadata };
}

/**
 * Extracts the tenantId from MCP AuthInfo.
 * Falls back to "default" only if the token carried no tenant claim.
 */
export function tenantIdFromAuthInfo(authInfo: AuthInfo): string {
  return (authInfo.extra?.tenantId as string | undefined) ?? authInfo.tenantId ?? 'default';
}
