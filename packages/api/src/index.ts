import express from 'express';
import dotenv from 'dotenv';
import { createTaskRepository, createChatMessageRepository, createMCPIntegrationRepository, createAgentRepository, createTaskRunRepository, createFeedbackRepository, createCustomIntegrationRepository, createSecurityReviewRepository, createPolicyTemplateRepository, getDatabaseConfig, SecurityReviewService, FeatureService, AssetService, createQdrantDataAdapter, WorkerQueue } from '@ai-agent/shared';
import { TaskService } from './services/taskService';
import { AgentService } from './services/agentService';
import { TaskController } from './controllers/taskController';
import { MCPIntegrationController } from './controllers/mcpIntegrationController';
import { AgentController } from './controllers/agentController';
import { FeedbackController } from './controllers/feedbackController';
import { BuiltInIntegrationController } from './controllers/builtInIntegrationController';
import { ChatController } from './controllers/chatController';
import { SecurityReviewController } from './controllers/securityReviewController';
import { OverviewController } from './controllers/overviewController';
import { createMcpRouteHandler } from './mcp/handler';
import { createMcpOAuthRouter } from './mcp/mcpRouter';
import createRouter, { createSecurityReviewRouter } from './routes';
import { authMiddleware } from './middleware/auth';
import https from 'https';
import fs from 'fs';
import path from 'path';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3001;

  // SSL / HTTPS config (dev only)
  const USE_HTTPS = process.env.HTTPS === 'true';

  // Initialize repository and service
  const dbConfig = getDatabaseConfig();
  const taskRepository = createTaskRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
    collectionName: dbConfig.taskCollectionName,
  });

  const chatMessageRepository = createChatMessageRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
    collectionName: dbConfig.chatMessageCollectionName,
  });

  const mcpIntegrationRepository = createMCPIntegrationRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
  });

  const agentRepository = createAgentRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
    collectionName: 'agents',
  });

  const taskRunRepository = createTaskRunRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
    collectionName: 'task_runs',
  });

  const feedbackRepository = createFeedbackRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
    collectionName: 'feedbacks',
  });

  const customIntegrationRepository = createCustomIntegrationRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
  });

  const securityReviewRepository = createSecurityReviewRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
  });

  // Initialize the repositories (create collections if needed)
  console.log('[init] Qdrant URL:', dbConfig.qdrantUrl);
  console.log('[init] initializing taskRepository...');
  await taskRepository.initialize();
  console.log('[init] initializing chatMessageRepository...');
  await chatMessageRepository.initialize();
  console.log('[init] initializing mcpIntegrationRepository...');
  await mcpIntegrationRepository.initialize();
  console.log('[init] initializing customIntegrationRepository...');
  await customIntegrationRepository.initialize();
  console.log('[init] initializing agentRepository...');
  await agentRepository.initialize();
  console.log('[init] initializing taskRunRepository...');
  await taskRunRepository.initialize();
  console.log('[init] initializing feedbackRepository...');
  await feedbackRepository.initialize();
  console.log('[init] initializing securityReviewRepository...');
  await securityReviewRepository.initialize();
  console.log('[init] core repositories ready');

  const taskService = new TaskService(taskRepository, chatMessageRepository, mcpIntegrationRepository, taskRunRepository, feedbackRepository, customIntegrationRepository);
  const agentService = new AgentService(agentRepository);
  const taskController = new TaskController(taskService);
  const mcpIntegrationController = new MCPIntegrationController(mcpIntegrationRepository);
  const agentController = new AgentController(agentService);
  const feedbackController = new FeedbackController(feedbackRepository, taskService);
  const builtInIntegrationController = new BuiltInIntegrationController(customIntegrationRepository);

  const featureQdrantAdapter = createQdrantDataAdapter();
  const featureService = new FeatureService(featureQdrantAdapter);
  const assetService = new AssetService(featureQdrantAdapter);

  const policyTemplateRepository = createPolicyTemplateRepository({
    qdrantUrl: dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
  });
  await policyTemplateRepository.initialize();

  const securityReviewService = new SecurityReviewService(securityReviewRepository, featureService, policyTemplateRepository, customIntegrationRepository, taskRepository, new WorkerQueue());

  const chatController = new ChatController(securityReviewService, featureService);
  const securityReviewController = new SecurityReviewController(securityReviewService);
  const overviewController = new OverviewController(securityReviewService, assetService);

  app.use(express.json());

  // Enable CORS for web client access
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  app.get('/api/health', (_, res) => {
    res.json({ status: 'ok' });
  });

  // MCP endpoint – OAuth-protected Streamable HTTP transport for coding agents.
  // Discovery endpoints must be mounted BEFORE any authMiddleware routes so that
  // /api/.well-known/* requests are not intercepted by the bearer auth check.
  //
  //   GET /api/.well-known/oauth-protected-resource/mcp  – RS metadata (RFC 9728)
  //   GET /api/.well-known/oauth-authorization-server    – AS metadata (RFC 8414)
  //   GET /.well-known/oauth-protected-resource/mcp      – same, served at root
  //   GET /.well-known/oauth-authorization-server        – same, served at root
  //   GET /.well-known/openid-configuration              – OIDC passthrough for VS Code
  //   POST /api/register                                 – dynamic registration stub
  //   GET  /api/authorize                                – authorize proxy (strips resource)
  //   POST /api/token                                    – token proxy (strips resource)
  //   POST /api/mcp                                      – tool endpoint (bearer-auth protected)
  const defaultScheme = process.env.HTTPS === 'true' ? 'https' : 'http';
  const serverBaseUrl = process.env.MCP_ISSUER_URL ?? `${defaultScheme}://localhost:${PORT}`;
  const mcpResourceUrl = new URL('/api/mcp', serverBaseUrl);

  const { oauthMetadata, bearerAuthMiddleware, mcpHandler } = createMcpRouteHandler(securityReviewService);

  const entraClientId = process.env.ENTRA_CLIENT_ID ?? '';
  const scopesSupported = entraClientId
    ? [`api://${entraClientId}/security_review`]
    : ['security_review'];

  const mcpOAuthRouter = createMcpOAuthRouter({
    mcpResourceUrl,
    serverBaseUrl,
    oauthMetadata,
    scopesSupported,
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
  });

  // Mount OAuth discovery + proxy routes under /api (AFD routes /api/* to this server)
  app.use('/api', mcpOAuthRouter);
  // Also mount at root for local dev where serverBaseUrl has no /api prefix
  app.use('/', mcpOAuthRouter);
  // MCP tool endpoint – protected by bearer auth
  app.all('/api/mcp', bearerAuthMiddleware, mcpHandler);

  // Security review REST routes – protected by the same JWT bearer auth as all other /api routes
  app.use('/api', authMiddleware, createSecurityReviewRouter(securityReviewController));

  // Overview / dashboard aggregation endpoint
  app.get('/api/overview', authMiddleware, overviewController.getOverview.bind(overviewController));


  // Pass controllers to routes
  console.log('[init] building API router (initializes qdrantDataAdapter + neo4jAdapter)...');
  app.use('/api', await createRouter(taskController, mcpIntegrationController, agentController, feedbackController, builtInIntegrationController, chatController));
  console.log('[init] API router ready');

  // Start HTTP or HTTPS server depending on environment
  if (USE_HTTPS) {
    const rawKey  = process.env.SSL_KEY_PATH;
    const rawCert = process.env.SSL_CERT_PATH;

    // Helper: resolve a path that may be relative to cwd OR to the workspace root
    const resolveSslPath = (p: string): string => {
      if (path.isAbsolute(p)) return p;
      // Try relative to cwd first
      const fromCwd = path.resolve(process.cwd(), p);
      if (fs.existsSync(fromCwd)) return fromCwd;
      // Try relative to this package's directory (packages/api)
      const fromPkg = path.resolve(__dirname, '..', p);
      if (fs.existsSync(fromPkg)) return fromPkg;
      return fromCwd; // return cwd-relative even if it doesn't exist (error will surface below)
    };

    // Build candidates list: env vars first, then workspace-root ssl3/
    const candidates: Array<{ key: string; cert: string }> = [];

    if (rawKey && rawCert) {
      candidates.push({ key: resolveSslPath(rawKey), cert: resolveSslPath(rawCert) });
    }

    // Fallback: workspace-root ssl3/ directory (two levels up from packages/api)
    const wsRoot = path.resolve(__dirname, '../../..');
    const wsKey  = path.join(wsRoot, 'ssl3', 'key.pem');
    const wsCert = path.join(wsRoot, 'ssl3', 'cert.pem');
    if (fs.existsSync(wsKey) && fs.existsSync(wsCert)) {
      candidates.push({ key: wsKey, cert: wsCert });
    }

    const validCandidate = candidates.find(
      ({ key, cert }) => fs.existsSync(key) && fs.existsSync(cert)
    );

    if (validCandidate) {
      const key  = fs.readFileSync(validCandidate.key, 'utf8');
      const cert = fs.readFileSync(validCandidate.cert, 'utf8');
      https.createServer({ key, cert }, app).listen(PORT, () => {
        console.log(`🚀 API server running on https://localhost:${PORT}`);
        console.log(`   MCP endpoint:   https://localhost:${PORT}/api/mcp`);
        console.log(`   OAuth issuer:   ${process.env.MCP_ISSUER_URL ?? `https://localhost:${PORT}`}`);
      });
    } else {
      // Try devcert for local development
      try {
        const devcert = await import('devcert');
        if (devcert && typeof devcert.certificateFor === 'function') {
          const certData = await devcert.certificateFor('localhost');
          https.createServer({ key: certData.key, cert: certData.cert }, app).listen(PORT, () => {
            console.log(`🚀 API server running on https://localhost:${PORT} (devcert)`);
            console.log(`   MCP endpoint:   https://localhost:${PORT}/api/mcp`);
          });
          return;
        }
      } catch (_err) {
        // devcert unavailable – fall through to HTTP
      }
      console.warn('[SSL] No certs found and devcert unavailable – falling back to HTTP');
      console.warn('[SSL] Place certs in ssl3/key.pem + ssl3/cert.pem at the workspace root,');
      console.warn('[SSL] or set SSL_KEY_PATH + SSL_CERT_PATH in packages/api/.env');
      console.warn('[SSL] NOTE: Entra OAuth requires HTTPS – the MCP flow will not work over HTTP');
      app.listen(PORT, () => {
        console.log(`🚀 API server running on http://localhost:${PORT} (no SSL)`);
        console.log(`   MCP endpoint:   http://localhost:${PORT}/api/mcp`);
      });
    }
  } else {
    app.listen(PORT, () => {
      console.log(`🚀 API server running on http://localhost:${PORT}`);
      console.log(`   MCP endpoint:   http://localhost:${PORT}/api/mcp`);
    });
  }
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  console.error('  message:', error?.message);
  console.error('  cause:  ', error?.cause);
  console.error('Config snapshot:');
  console.error('  QDRANT_URL      =', process.env.QDRANT_URL ?? '(unset → http://localhost:6333)');
  console.error('  QDRANT_API_KEY  =', process.env.QDRANT_API_KEY ? '(set)' : '(unset)');
  console.error('  NEO4J_URI       =', process.env.NEO4J_URI ?? '(unset)');
  console.error('  NEO4J_USERNAME  =', process.env.NEO4J_USERNAME ?? '(unset)');
  console.error('  PORT            =', process.env.PORT ?? '(unset → 3001)');
  console.error('  HTTPS           =', process.env.HTTPS ?? '(unset)');
  console.error('  MCP_ISSUER_URL  =', process.env.MCP_ISSUER_URL ?? '(unset)');
  console.error('  ENTRA_TENANT_ID =', process.env.ENTRA_TENANT_ID ?? '(unset)');
  console.error('  ENTRA_CLIENT_ID =', process.env.ENTRA_CLIENT_ID ?? '(unset)');
  process.exit(1);
});
