/**
 * MCP endpoint handler – embedded directly in the API server.
 *
 * Mounts a Streamable HTTP MCP transport at POST /mcp, protected by OAuth 2.0
 * bearer authentication.  VS Code automatically opens a browser for the user
 * to authenticate before any MCP tool calls are made.
 *
 * Authentication flow
 * ───────────────────
 * 1. VS Code sends POST /mcp without a token.
 * 2. Server responds 401 with WWW-Authenticate pointing to the protected-resource
 *    metadata URL (RFC 9728).
 * 3. VS Code fetches /.well-known/oauth-protected-resource  →  finds the AS URL.
 * 4. VS Code fetches /.well-known/oauth-authorization-server  →  finds /authorize.
 * 5. VS Code opens a browser; user authenticates at login.microsoftonline.com.
 * 6. VS Code exchanges the auth code for an Entra JWT at /token (proxied to Entra).
 * 7. VS Code retries POST /mcp with Authorization: Bearer <entra-token>.
 * 8. requireBearerAuth validates the token (RS256, trusted issuer, audience, expiry,
 *    scope) and sets req.auth; the handler extracts tenantId and scopes all data.
 *
 * Identity provider
 * ─────────────────
 * Only Microsoft Entra ID (or a configured OIDC authority) is accepted.
 * Localhost / self-signed issuers are rejected. Configure via packages/api/.env:
 *   ENTRA_TENANT_ID  – Azure AD tenant GUID
 *   ENTRA_CLIENT_ID  – App Registration client ID (same as UI)
 *   ENTRA_AUDIENCE   – Expected aud claim (default: api://<ENTRA_CLIENT_ID>)
 */

import type { Request, Response, RequestHandler } from 'express';
import * as http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { SecurityReviewService } from '@ai-agent/shared';
import type { SecurityReviewAnswer, SecurityAttestation, AttestationArchitectureUpdate } from '@ai-agent/shared';
import { createMcpVerifier, tenantIdFromAuthInfo } from './oauthProvider';

// ── Required scope per tool (Least-Privilege enforcement) ─────────────────────
//
// Every tool declares the minimum Entra scope the caller must hold.
// The short scope name (e.g. "security_review") must match what appears in the
// `scp` claim of the Entra access token (full URI is api://<clientId>/<name>).
//
// To add a new scope:
//   1. Define it in the Entra App Registration → Expose an API → Add a scope
//   2. Add an entry here
//   3. Update VITE_MSAL_SCOPES in the UI and the scopesSupported list in index.ts

const TOOL_REQUIRED_SCOPES: Record<string, string> = {
  start_security_review:        'security_review',
  submit_security_answers:      'security_review',
  acknowledge_security_tasks:   'security_review',
  submit_security_attestations: 'security_review',
  get_security_review:          'security_review',
  list_security_reviews:        'security_review',
};

// ── Tool definitions (kept in-sync with mcp-security-review package) ─────────

const TOOLS = [
  {
    name: 'start_security_review',
    description:
      'Start a security review during the planning phase, after exploring the codebase ' +
      'but before writing any implementation code. ' +
      'Returns a questionnaire (questions array) and a review ID for subsequent steps. ' +
      'When services are provided, the response also includes a matchedFeatures array ' +
      'containing each matched feature with its id, name, description, and businessValue — ' +
      'enough to identify which feature this change belongs to. ' +
      'A feature_scope question is appended asking which existing feature(s) this change applies to, ' +
      'or "new feature" if it introduces new capability. ' +
      'Incorporate the returned security tasks into the implementation plan before coding.',
    inputSchema: {
      type: 'object',
      properties: {
        featureDescription: {
          type: 'string',
          description: 'One-sentence description of the feature you are about to implement.',
        },
        title: {
          type: 'string',
          description:
            'Short, PR-style title for the review ' +
            '(e.g. "feat: add PR link to security review"). ' +
            'Displayed as the review headline in the UI.',
        },
        agentName: {
          type: 'string',
          description:
            'Name of the AI agent calling this tool ' +
            '(e.g. "Claude Code", "GitHub Copilot", "Cursor"). ' +
            'Stored for audit and context purposes.',
        },
        services: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of packages or services involved in this change ' +
            '(e.g. ["api", "shared", "ui"]). ' +
            'Used to scope the security context to the relevant parts of the repository.',
        },
        prLink: {
          type: 'string',
          description:
            'URL of the associated pull request or merge request ' +
            '(e.g. "https://github.com/org/repo/pull/42"). ' +
            'Must be an https:// URL.',
        },
        gitContext: {
          type: 'object',
          description:
            'Optional git metadata captured at review creation time from the local working tree. ' +
            'Used to correlate this review with a PR/MR automatically. ' +
            'Collect with: git rev-parse --abbrev-ref HEAD (branchName), ' +
            'git rev-parse HEAD (commitSha), git log -1 --format="%s" (commitMessage), ' +
            'git log -1 --format="%ae" (authorEmail), ' +
            'git log -1 --format="%an" (authorName), ' +
            'git log -1 --format="%aI" (commitTimestamp), ' +
            'git rev-parse --abbrev-ref @{upstream} 2>/dev/null (baseBranch). ' +
            'All fields are optional; provide as many as available.',
          properties: {
            branchName:       { type: 'string', description: 'Current feature/fix branch name.' },
            commitSha:        { type: 'string', description: 'Full 40-character commit SHA of HEAD.' },
            commitShortSha:   { type: 'string', description: 'First 7 characters of HEAD commit SHA.' },
            authorEmail:      { type: 'string', description: 'Author email of HEAD commit (PII — stored encrypted).' },
            authorName:       { type: 'string', description: 'Author name of HEAD commit (PII — stored encrypted).' },
            commitMessage:    { type: 'string', description: 'Subject line of HEAD commit.' },
            commitTimestamp:  { type: 'string', description: 'ISO 8601 timestamp of HEAD commit.' },
            baseBranch:       { type: 'string', description: 'Upstream / target branch (e.g. main, master).' },
            remoteUrl:        { type: 'string', description: 'Sanitised remote origin URL.' },
          },
          additionalProperties: false,
        },
      },
      required: ['featureDescription','title', 'agentName'],
    },
  },
  {
    name: 'submit_security_answers',
    description:
      'Submit answers to the security questionnaire. ' +
      'Returns the review with a tasks array of security requirements you must address. ' +
      'Always returns a featureSecurityContext array containing the architectural baseline:\n' +
      '  - Existing feature linked: one entry per linked feature with its full DFD baseline ' +
      '(dataFlowSummary, dataClassificationSummary, complianceConsiderations, STRIDE threats).\n' +
      '  - New feature ("new feature" answer): one entry with featureId = "service-dfd" containing ' +
      'the merged data flows from all affected services — use this as your architectural baseline.\n\n' +
      'IMPORTANT: Study the dataFlowSummary and dataClassificationSummary in featureSecurityContext ' +
      'before implementing. These are the BASELINE you must compare against in ' +
      'submit_security_attestations. Note the featureId of each entry — you will need it.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: 'The review ID from start_security_review.' },
        answers: {
          type: 'array',
          description: 'An answer for EVERY question returned in the questionnaire.',
          items: {
            type: 'object',
            properties: {
              questionId: { type: 'string' },
              answer: {
                type: 'string',
                description: 'Start with "Yes" or "No", then add detail.',
              },
            },
            required: ['questionId', 'answer'],
          },
        },
      },
      required: ['reviewId', 'answers'],
    },
  },
  {
    name: 'acknowledge_security_tasks',
    description:
      'Acknowledge that you have read and understood the security tasks. ' +
      'You MUST call this before writing any implementation code.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string' },
      },
      required: ['reviewId'],
    },
  },
  {
    name: 'submit_security_attestations',
    description:
      'After implementing the feature, attest how you handled each security task. ' +
      'Provide an attestation for EVERY task. This closes the security review loop.\n\n' +
      'ARCHITECTURE DOCUMENTATION (REQUIRED — always supply architectureUpdates):\n' +
      'The platform diffs your updates against the featureSecurityContext baseline returned by ' +
      'submit_security_answers and displays the result to security architects.\n\n' +
      'One entry per featureSecurityContext entry you received. Use the featureId exactly as it ' +
      'appeared in featureSecurityContext (a real feature ID, or "service-dfd" for the new-feature path).\n\n' +
      'Each entry MUST include:\n' +
      '  - featureId: copied verbatim from the matching featureSecurityContext entry\n' +
      '  - updatedDataFlowSummary: the COMPLETE data flow table after your change\n' +
      '    (all existing flows plus new ones; omit removed flows)\n' +
      '  - updatedDataClassification: the COMPLETE data classification table after your change\n' +
      '  - dfdChangeRationale: 1-3 sentences explaining what changed and why — name specific\n' +
      '    flows added/removed, data types introduced, and any encryption or auth changes.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string' },
        attestations: {
          type: 'array',
          description: 'One attestation per security task.',
          items: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              handled: { type: 'boolean', description: 'true if addressed, false if not.' },
              notes: {
                type: 'string',
                description:
                  'Explain exactly how you addressed the task (file, function, mechanism). ' +
                  'If handled=false, explain why and what the residual risk is.',
              },
            },
            required: ['taskId', 'handled', 'notes'],
          },
        },
        architectureUpdates: {
          type: 'array',
          description:
            'One entry per featureSecurityContext entry returned by submit_security_answers. ' +
            'Provide the COMPLETE current state of each section after the feature is implemented.',
          items: {
            type: 'object',
            properties: {
              featureId: {
                type: 'string',
                description:
                  'The featureId from the matching featureSecurityContext entry returned by ' +
                  'submit_security_answers. For an existing feature this is the feature UUID; ' +
                  'for the new-feature path it is "service-dfd".',
              },
              updatedDataFlowSummary: {
                type: 'array',
                description: 'Complete, updated data flow table for this feature.',
                items: {
                  type: 'object',
                  properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                    dataTypes: { type: 'array', items: { type: 'string' } },
                    protocol: { type: 'string' },
                    encrypted: { type: 'boolean' },
                    authRequired: { type: 'boolean' },
                  },
                  required: ['from', 'to', 'dataTypes', 'protocol', 'encrypted', 'authRequired'],
                },
              },
              updatedDataClassification: {
                type: 'array',
                description: 'Complete, updated data classification table for this feature.',
                items: {
                  type: 'object',
                  properties: {
                    classification: { type: 'string' },
                    dataTypes: { type: 'array', items: { type: 'string' } },
                    protectionMechanisms: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['classification', 'dataTypes', 'protectionMechanisms'],
                },
              },
              dfdChangeRationale: {
                type: 'string',
                description:
                  'Concise explanation (1-3 sentences) of why the data flows or classifications ' +
                  'changed in this feature. Name specific flows added/removed, data types introduced, ' +
                  'and reasons for any security property changes (encryption, auth). ' +
                  'This is shown to security architects as the human-readable justification.',
              },
            },
            required: ['featureId', 'updatedDataFlowSummary', 'updatedDataClassification', 'dfdChangeRationale'],
          },
        },
      },
      required: ['reviewId', 'attestations'],
    },
  },
  {
    name: 'get_security_review',
    description: 'Retrieve a specific security review by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string' },
      },
      required: ['reviewId'],
    },
  },
  {
    name: 'list_security_reviews',
    description: 'List all security reviews for the current tenant.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Tool handler (direct service calls – no HTTP round-trip) ──────────────────

/**
 * Resolve tenant ID for a tool call.
 * Priority: authenticated token claim > env var > 'default'
 *
 * The `authTenantId` comes from the verified OAuth token and is the sole
 * authoritative source. Callers must not supply tenantId in tool arguments.
 */
function resolveTenantId(authTenantId?: string): string {
  return authTenantId!;
}

async function handleTool(
  name: string,
  args: Record<string, unknown>,
  service: SecurityReviewService,
  authInfo?: AuthInfo,
  /** Repository name extracted from the MCP server URL (?repo=...) – never from agent input. */
  repository?: string,
): Promise<string> {
  // ── Scope enforcement (Least-Privilege) ────────────────────────────────────
  // Every tool requires a specific Entra scope. Reject with a clear 403-style
  // message if the token does not carry the required scope.
  const requiredScope = TOOL_REQUIRED_SCOPES[name];
  if (requiredScope) {
    const grantedScopes = authInfo?.scopes ?? [];
    if (!grantedScopes.includes(requiredScope)) {
      throw new Error(
        `Insufficient scope: '${requiredScope}' is required to call '${name}'. ` +
        `Granted scopes: [${grantedScopes.join(', ') || 'none'}].`,
      );
    }
  }

  const tenantId = resolveTenantId(
    authInfo ? tenantIdFromAuthInfo(authInfo) : undefined,
  );

  switch (name) {
    case 'start_security_review': {
      // Sanitize the agent-supplied name: trim whitespace, cap at 100 chars
      const rawAgentName = typeof args.agentName === 'string'
        ? args.agentName.trim().slice(0, 100)
        : undefined;

      // Sanitize the title: trim whitespace, cap at 200 chars
      const rawTitle = typeof args.title === 'string'
        ? args.title.trim().slice(0, 200) || undefined
        : undefined;

      // humanResponsible is derived exclusively from the verified JWT `name` claim —
      // never from agent-supplied input — to prevent spoofing.
      const humanResponsible = authInfo?.name
        ? authInfo.name.trim().slice(0, 100)
        : undefined;

      // Sanitize prLink: must be a valid https:// URL; reject anything else silently.
      let sanitizedPrLink: string | undefined;
      if (typeof args.prLink === 'string' && args.prLink.trim()) {
        try {
          const url = new URL(args.prLink.trim());
          if (url.protocol === 'https:') {
            sanitizedPrLink = url.href.slice(0, 500);
          }
        } catch {
          // Invalid URL — discard silently; do not surface internal parsing errors
        }
      }

      const review = await service.startReview(
        tenantId,
        args.featureDescription as string,
        {
          title: rawTitle,
          agentName: rawAgentName,
          humanResponsible,
          services: args.services as string[] | undefined,
          // Repository is derived from the MCP server URL (?repo=...), not from agent input.
          // Sanitize: trim whitespace, cap at 200 chars, reject empty strings.
          repository: typeof repository === 'string' && repository.trim()
            ? repository.trim().slice(0, 200)
            : undefined,
          prLink: sanitizedPrLink,
          // gitContext is sanitised inside startReview via sanitiseGitContext()
          gitContext: args.gitContext && typeof args.gitContext === 'object'
            ? (args.gitContext as Record<string, unknown>)
            : undefined,
        },
      );
      return JSON.stringify(review, null, 2);
    }
    case 'submit_security_answers': {
      const review = await service.submitAnswers(
        args.reviewId as string,
        tenantId,
        args.answers as SecurityReviewAnswer[],
      );
      // Return only what the agent needs:
      //   - tasks:                security tasks to address
      //   - featureSecurityContext: architectural baseline — enriched feature contexts
      //                             (existing-feature path) or a synthetic "service-dfd" entry
      //                             (new-feature path). Always use this as the baseline when
      //                             describing changes in submit_security_attestations.
      //   - linkedFeatureIds:     which feature IDs were resolved from the agent's answer
      //   - status / id:          for bookkeeping
      // Omit matchedFeatures (all start_review candidates) to avoid confusing the agent.
      const agentView = {
        id:                     review.id,
        status:                 review.status,
        tasks:                  review.tasks,
        linkedFeatureIds:       review.linkedFeatureIds ?? [],
        featureSecurityContext: review.featureSecurityContext ?? [],
      };
      return JSON.stringify(agentView, null, 2);
    }
    case 'acknowledge_security_tasks': {
      const review = await service.acknowledgeTasks(args.reviewId as string, tenantId);
      return JSON.stringify(review, null, 2);
    }
    case 'submit_security_attestations': {
      const review = await service.submitAttestations(
        args.reviewId as string,
        tenantId,
        args.attestations as SecurityAttestation[],
        args.architectureUpdates as AttestationArchitectureUpdate[] | undefined,
      );
      return JSON.stringify(review, null, 2);
    }
    case 'get_security_review': {
      const review = await service.getReview(args.reviewId as string, tenantId);
      return JSON.stringify(review, null, 2);
    }
    case 'list_security_reviews': {
      const reviews = await service.listReviews(tenantId);
      return JSON.stringify(reviews, null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP server factory (stateless: one instance per request) ─────────────────

function createMCPServer(service: SecurityReviewService, authInfo?: AuthInfo, repository?: string): McpServer {
  const mcp = new McpServer(
    { name: 'security-review', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Fetch available services for this tenant to enrich the start_security_review description.
    // Failures are non-fatal — the tool list is returned with the generic description.
    const tenantId = authInfo ? tenantIdFromAuthInfo(authInfo) : undefined;
    let availableServices: string[] = [];
    if (tenantId) {
      try {
        availableServices = await service.getAvailableServices(tenantId);
      } catch {
        // Graceful degradation
      }
    }

    const tools = TOOLS.map((t) => {
      if (t.name !== 'start_security_review' || availableServices.length === 0) {
        return { name: t.name, description: t.description, inputSchema: t.inputSchema };
      }

      // Patch the services property description with the closed list for this tenant
      const serviceList = availableServices.map(s => `"${s}"`).join(', ');
      const patchedInputSchema = {
        ...t.inputSchema,
        properties: {
          ...(t.inputSchema as any).properties,
          services: {
            type: 'array',
            items: { type: 'string' },
            description:
              'List of services affected by this change. ' +
              `Known services for this repository: [${serviceList}]. ` +
              'Use these exact names for consistent naming across reviews.',
          },
        },
      };

      return { name: t.name, description: t.description, inputSchema: patchedInputSchema };
    });

    return { tools };
  });

  mcp.server.setRequestHandler(
    CallToolRequestSchema,
    async (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => {
      const { name, arguments: toolArgs } = request.params;
      try {
        const result = await handleTool(name, toolArgs ?? {}, service, authInfo, repository);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  return mcp;
}

// ── Raw body reader (needed before Express parses JSON for MCP) ───────────────

/**
 * Returns the parsed request body.
 *
 * Express body-parser middleware consumes and parses the stream before any
 * route handler runs, so `req.readable` will be false (stream already ended)
 * and re-attaching 'data' listeners would hang forever.
 *
 * Strategy:
 *   1. If Express already parsed the body (`req.body` is set), use it directly.
 *   2. Otherwise the stream is still live – read and parse it manually.
 */
function readRawBody(req: http.IncomingMessage): Promise<unknown> {
  // Express attaches the parsed body to `req.body`.  Cast through `unknown`
  // because `http.IncomingMessage` doesn't declare `.body`.
  const expressBody = (req as unknown as { body?: unknown }).body;
  if (expressBody !== undefined) {
    return Promise.resolve(expressBody);
  }

  // Stream not yet consumed – read it manually (e.g. when body-parser is not
  // mounted for this route).
  return new Promise((resolve, reject) => {
    // If the stream has already ended without a body, resolve immediately.
    if (!req.readable) {
      resolve(undefined);
      return;
    }

    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', reject);
  });
}

// ── Express route handler factory ─────────────────────────────────────────────

/**
 * Returns:
 *   - `oauthMetadata` – Entra AS metadata; pass to `mcpAuthMetadataRouter` in index.ts
 *   - `bearerAuthMiddleware` – Express middleware that validates Entra bearer tokens
 *   - `mcpHandler` – the Express handler for POST /mcp (must be applied AFTER the bearer middleware)
 *
 * Usage in index.ts:
 *   const { oauthMetadata, bearerAuthMiddleware, mcpHandler } = createMcpRouteHandler(service);
 *   app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl: new URL('https://localhost:3001/mcp'), scopesSupported }));
 *   app.all('/mcp', bearerAuthMiddleware, mcpHandler);
 *
 * Repository context
 * ──────────────────
 * Each request may carry a ?repo=<name> query parameter that scopes the MCP
 * session to a specific repository belonging to the authenticated tenant.
 * The value is extracted per-request (never from agent tool arguments) and
 * validated: trimmed, capped at 200 chars, empty strings discarded.
 * The tenantId is always derived exclusively from the verified JWT.
 */
export function createMcpRouteHandler(
  service: SecurityReviewService,
): {
  oauthMetadata: ReturnType<typeof createMcpVerifier>['oauthMetadata'];
  bearerAuthMiddleware: RequestHandler;
  mcpHandler: (req: Request, res: Response) => Promise<void>;
} {
  const { verifier, oauthMetadata } = createMcpVerifier();

  const defaultScheme = process.env.HTTPS === 'true' ? 'https' : 'http';
  const serverBaseUrl = process.env.MCP_ISSUER_URL ?? `${defaultScheme}://localhost:${process.env.PORT ?? 3001}`;
  const resourceMetadataUrl = `${serverBaseUrl}/.well-known/oauth-protected-resource/mcp`;

  const bearerAuthMiddleware = requireBearerAuth({
    verifier,
    resourceMetadataUrl,
  });

  const mcpHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      // req.auth is set by requireBearerAuth; contains tenantId, userId, email, scopes
      const authInfo = (req as Request & { auth?: AuthInfo }).auth;

      // Extract repository from the request URL query parameter (?repo=...).
      // This is the per-request, per-tenant repository context.
      // Never sourced from agent tool arguments – only from the URL the client connects to.
      const rawRepo = typeof req.query.repo === 'string' ? req.query.repo : '';
      const repository = rawRepo.trim().slice(0, 200) || undefined;

      const body = await readRawBody(req as unknown as http.IncomingMessage);
      const server = createMCPServer(service, authInfo, repository);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on('close', () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(
        req as unknown as http.IncomingMessage,
        res as unknown as http.ServerResponse,
        body,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.status(500).json({ error: msg });
      }
    }
  };

  return { oauthMetadata, bearerAuthMiddleware, mcpHandler };
}
