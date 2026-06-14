/**
 * MCP OAuth router – all OAuth discovery and proxy endpoints in one place.
 *
 * Entra ID does not support RFC 8707 resource indicators with arbitrary URLs,
 * so clients that send `resource=<mcp-url>` receive AADSTS9010010. We work
 * around this by proxying /authorize and /token and stripping the parameter.
 *
 * All clients use the same proxy flow:
 *   → authorization_servers points to THIS server (serverBaseUrl)
 *   → client does dynamic registration (/register), then hits /authorize
 *     and /token proxies which strip `resource` before forwarding to Entra
 *
 * Endpoints mounted by this router:
 *   GET  /.well-known/oauth-protected-resource/mcp  – PRM (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server    – AS metadata (RFC 8414)
 *   POST /register                                  – static client registration stub
 *   GET  /authorize                                 – authorize proxy (strips resource)
 *   POST /token                                     – token proxy (strips resource)
 */

import express, { type Router } from 'express';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

// ── Router factory ────────────────────────────────────────────────────────────

export interface McpRouterOptions {
  /** Full HTTPS URL of the MCP endpoint, e.g. https://example.com/mcp */
  mcpResourceUrl: URL;
  /** Server base URL used as issuer for Claude Code's OAuth flow */
  serverBaseUrl: string;
  /** AS metadata returned to Claude Code clients */
  oauthMetadata: OAuthMetadata;
  /** Scopes advertised in the protected resource metadata */
  scopesSupported: string[];
  /** Entra tenant ID */
  tenantId: string;
}

export function createMcpOAuthRouter(opts: McpRouterOptions): Router {
  const { mcpResourceUrl, serverBaseUrl, oauthMetadata, scopesSupported, tenantId } = opts;

  const entraBase = `https://login.microsoftonline.com/${tenantId}`;
  const entraV2   = `${entraBase}/oauth2/v2.0`;

  const router = express.Router();

  // ── GET /.well-known/oauth-protected-resource/mcp ──────────────────────────
  // RFC 9728 Protected Resource Metadata. All clients use the proxy flow.
  router.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
    const ua = req.headers['user-agent'] ?? '';
    console.log(`[MCP OAuth] PRM request · UA="${ua}" → authorization_servers=[${serverBaseUrl}]`);
    res.json({
      resource:              mcpResourceUrl.href,
      authorization_servers: [serverBaseUrl],
      scopes_supported:      scopesSupported,
      resource_name:         'Security Review MCP',
    });
  });

  // ── GET /.well-known/oauth-authorization-server ────────────────────────────
  // RFC 8414 AS metadata – returned to Claude Code after it discovers this
  // server as the authorization server. Contains proxy endpoints.
  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(oauthMetadata);
  });

  // ── POST /register ─────────────────────────────────────────────────────────
  // Static client registration stub (RFC 7591).
  // Entra does not support dynamic registration. We echo back the pre-configured
  // client_id so the MCP SDK can proceed to /authorize without creating anything.
  router.post('/register', (req, res) => {
    const clientId = process.env.ENTRA_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: 'server_error', error_description: 'ENTRA_CLIENT_ID not configured' });
      return;
    }
    res.status(201).json({
      ...(req.body ?? {}),
      client_id:                  clientId,
      client_id_issued_at:        Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: 'none', // public client – no secret
    });
  });

  // ── GET /authorize ─────────────────────────────────────────────────────────
  // Redirect proxy: strips the `resource` parameter then redirects to Entra.
  // Entra rejects resource=<container-app-url> (AADSTS9010010) because that URL
  // is not a registered Application ID URI.
  // Also injects `scope` if the client omitted it (AADSTS900144: scope is required).
  router.get('/authorize', (req, res) => {
    const target = new URL(`${entraV2}/authorize`);
    const entraClientId = process.env.ENTRA_CLIENT_ID ?? '';
    const defaultScope = entraClientId
      ? `api://${entraClientId}/security_review offline_access`
      : 'security_review offline_access';

    for (const [key, value] of Object.entries(req.query as Record<string, string>)) {
      if (key !== 'resource') target.searchParams.set(key, value);
    }
    // Entra requires `scope` in every authorization request (AADSTS900144).
    // The MCP SDK may omit it when it builds the redirect from registration metadata.
    if (!target.searchParams.get('scope')) {
      target.searchParams.set('scope', defaultScope);
    }
    console.log(`[MCP OAuth] /authorize proxy → ${target.toString()}`);
    res.redirect(302, target.toString());
  });

  // ── POST /token ────────────────────────────────────────────────────────────
  // Token proxy: strips `resource` then forwards to Entra.
  // Also injects `scope` if the client omitted it (AADSTS900144: scope is required).
  // Uses its own urlencoded parser – the global express.json() middleware does
  // not parse application/x-www-form-urlencoded bodies.
  router.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
    const entraClientId = process.env.ENTRA_CLIENT_ID ?? '';
    const defaultScope = entraClientId
      ? `api://${entraClientId}/security_review offline_access`
      : 'security_review offline_access';

    const params = new URLSearchParams(req.body as Record<string, string>);
    params.delete('resource');
    // Entra requires `scope` in every token request (AADSTS900144).
    if (!params.get('scope')) {
      params.set('scope', defaultScope);
    }

    console.log(`[MCP OAuth] /token proxy · grant=${params.get('grant_type')} · scope=${params.get('scope')}`);

    const entraRes = await fetch(`${entraV2}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    const body = await entraRes.json();
    res.status(entraRes.status).json(body);
  });

  return router;
}
