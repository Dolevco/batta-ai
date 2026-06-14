import express from 'express';
import { createMcpRouteHandler } from '../mcp/handler';
import { createMcpOAuthRouter } from '../mcp/mcpRouter';
import { createCorsMiddleware } from '../config/cors';
import { createRestRouter } from '../http/routes';
import { renderAgentLedOnboardingInstructions } from '../onboarding/agentLedOnboarding';
import type { AppContext } from './createContext';

function readRepoKey(value: unknown): string {
  if (typeof value !== 'string') {
    return '<repo-name>';
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return '<repo-name>';
  }

  return trimmed;
}

export function createApp(context: AppContext): express.Express {
  const app = express();
  const { env } = context;

  app.use(express.json());
  app.use(createCorsMiddleware(env));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const defaultScheme = env.https ? 'https' : 'http';
  const serverBaseUrl = env.mcpIssuerUrl ?? `${defaultScheme}://localhost:${env.port}`;
  const mcpResourceUrl = new URL('/api/mcp', serverBaseUrl);

  app.get('/api/onboarding/agent-led', (req, res) => {
    const repoKey = readRepoKey(req.query.repo);
    const encodedRepoKey = repoKey === '<repo-name>' ? repoKey : encodeURIComponent(repoKey);
    const onboardingMcpUrl = `${mcpResourceUrl.toString()}?repo=${encodedRepoKey}`;

    res.type('text/markdown').send(renderAgentLedOnboardingInstructions(onboardingMcpUrl));
  });

  const { oauthMetadata, bearerAuthMiddleware, mcpHandler } = createMcpRouteHandler(
    context.services.securityReview,
    context.services.repositoryIndexing,
    context.services.architectureQuery,
  );

  const scopesSupported = env.entraClientId
    ? [`api://${env.entraClientId}/security_review`]
    : ['security_review'];

  const mcpOAuthRouter = createMcpOAuthRouter({
    mcpResourceUrl,
    serverBaseUrl,
    oauthMetadata,
    scopesSupported,
    tenantId: env.entraTenantId ?? '',
  });

  app.use('/api', mcpOAuthRouter);
  app.use('/', mcpOAuthRouter);

  // When AUTH_DISABLED=true the MCP endpoint is open — all requests are treated as
  // the synthetic local tenant (TENANT_ID env var). Never enable in production.
  if (env.authDisabled) {
    app.all('/api/mcp', mcpHandler);
  } else {
    app.all('/api/mcp', bearerAuthMiddleware, mcpHandler);
  }

  console.log('[init] building API router...');
  app.use('/api', createRestRouter(context));
  console.log('[init] API router ready');

  return app;
}
