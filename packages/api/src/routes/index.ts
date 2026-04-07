import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { TaskController } from '../controllers/taskController';
import { MCPIntegrationController } from '../controllers/mcpIntegrationController';
import { AgentController } from '../controllers/agentController';
import { FeedbackController } from '../controllers/feedbackController';
import { BuiltInIntegrationController } from '../controllers/builtInIntegrationController';
import { ChatController } from '../controllers/chatController';
import { AssetService, createCustomIntegrationRepository, createQdrantDataAdapter, Neo4jAdapter, FeatureService, createIndexingRunRepository } from '@ai-agent/shared';
import { CustomIntegrationController } from '../controllers/customIntegrationController';
import { IntegrationsController } from '../controllers/integrationsController';
import { SlackOAuthController } from '../controllers/slackOAuthController';
import { GitHubOAuthController } from '../controllers/githubOAuthController';
import { AssetController } from '../controllers/assetController';
import { ScanController } from '../controllers/scanController';
import { SecurityReviewController } from '../controllers/securityReviewController';
import { PolicyController } from '../controllers/policyController';
import { FeatureController } from '../controllers/featureController';
import { authMiddleware } from '../middleware/auth';
import { PolicyService, createPolicyTemplateRepository } from '@ai-agent/shared';

// ── PR Correlation rate limiter ────────────────────────────────────────────────
// [High-6] correlatePR calls external GitHub/GitLab APIs and is expensive.
// Limit: 10 requests per tenant per minute using a simple in-memory sliding window.
// Note: for multi-instance deployments, replace with a Redis-backed rate limiter.

const _correlationWindow: Map<string, number[]> = new Map();
const CORRELATE_MAX_REQUESTS = 10;
const CORRELATE_WINDOW_MS = 60_000; // 1 minute

function prCorrelationRateLimiter(req: Request, res: Response, next: NextFunction): void {
  // Use tenantId from verified JWT; fall back to IP for unauthenticated cases
  const key: string = (req.auth as { tenantId?: string } | undefined)?.tenantId
    ?? req.ip
    ?? 'unknown';

  const now = Date.now();
  const timestamps = (_correlationWindow.get(key) ?? []).filter(t => now - t < CORRELATE_WINDOW_MS);
  if (timestamps.length >= CORRELATE_MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many correlation requests. Please wait before retrying.' });
    return;
  }
  timestamps.push(now);
  _correlationWindow.set(key, timestamps);
  next();
}

/**
 * Router for security review REST endpoints.
 * TenantId is resolved from JWT auth context, request body, query string, or X-Tenant-Id header.
 * The authoritative auth path is the MCP endpoint (/mcp), which enforces Entra OAuth.
 */
export function createSecurityReviewRouter(controller: SecurityReviewController): express.Router {
  const router = express.Router();

  router.post('/security-reviews', controller.startReview.bind(controller));
  router.get('/security-reviews', controller.listReviews.bind(controller));
  router.get('/security-reviews/:id', controller.getReview.bind(controller));
  router.post('/security-reviews/:id/answers', controller.submitAnswers.bind(controller));
  router.post('/security-reviews/:id/acknowledge', controller.acknowledgeTasks.bind(controller));
  router.post('/security-reviews/:id/attestations', controller.submitAttestations.bind(controller));
  router.get('/security-reviews/:id/attestation-summary', controller.getAttestationSummary.bind(controller));
  router.post('/security-reviews/:id/refresh-snapshot', controller.refreshSnapshot.bind(controller));

  // PR correlation endpoints
  // [High-6] correlatePR is expensive (calls GitHub/GitLab APIs) — protected by
  // per-tenant rate limiting (10 req/min) enforced in the controller layer via
  // prCorrelationRateLimiter middleware.
  router.post('/security-reviews/:id/correlate-pr', prCorrelationRateLimiter, controller.correlatePR.bind(controller));
  router.get('/security-reviews/:id/pr-candidates', controller.getPRCandidates.bind(controller));
  router.put('/security-reviews/:id/correlated-pr', controller.linkPR.bind(controller));

  return router;
}

export function createPolicyRouter(controller: PolicyController): express.Router {
  const router = express.Router();
  // More-specific routes before parameterized ones
  router.get('/policies', controller.listPolicies.bind(controller));
  router.post('/policies/seed', controller.seedDefaults.bind(controller));
  router.post('/policies/reset/:type', controller.resetToDefaults.bind(controller));
  router.get('/policies/:id', controller.getPolicy.bind(controller));
  router.put('/policies/:id', controller.updatePolicy.bind(controller));
  return router;
}

export default async function createRouter(
  taskController: TaskController,
  mcpIntegrationController: MCPIntegrationController,
  agentController: AgentController,
  feedbackController: FeedbackController,
  builtInIntegrationController: BuiltInIntegrationController,
  chatController: ChatController
): Promise<express.Router> {
  const router: express.Router = express.Router();

  // Apply authentication middleware to all routes
  router.use(authMiddleware);

  // Custom integration management routes
  const customIntegrationRepo = createCustomIntegrationRepository();
  const customIntegrationController = new CustomIntegrationController(customIntegrationRepo);

  // Slack OAuth controller
  const slackOAuthController = new SlackOAuthController(customIntegrationRepo);

  // GitHub OAuth controller
  const githubOAuthController = new GitHubOAuthController(customIntegrationRepo);

  // Integrations controller that aggregates all integration types
  const integrationsController = new IntegrationsController(
    mcpIntegrationController,
    customIntegrationController,
  );

  // Asset controller for knowledge base (reuses QdrantDataAdapter)
  const qdrantAdapter = createQdrantDataAdapter();
  // Ensure asset collections exist before the first request hits them
  console.log('[router] initializing qdrantDataAdapter (QDRANT_URL =', process.env.QDRANT_URL ?? 'unset → http://localhost:6333', ')...');
  await qdrantAdapter.initialize();
  console.log('[router] qdrantDataAdapter ready');

  // Initialize Neo4j adapter if configured (for relationship queries)
  let neo4jAdapter = undefined;
  if (process.env.NEO4J_URI) {
    console.log('[router] creating Neo4jAdapter (NEO4J_URI =', process.env.NEO4J_URI, ')...');
    neo4jAdapter = new Neo4jAdapter({
      uri: process.env.NEO4J_URI,
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password',
    });
    console.log('[router] Neo4jAdapter created');
  }

  const indexingRunRepository = createIndexingRunRepository({
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY,
  });
  const assetService = new AssetService(qdrantAdapter, neo4jAdapter, indexingRunRepository);
  const assetController = new AssetController(assetService);
  const featureService = new FeatureService(qdrantAdapter, neo4jAdapter);
  const featureController = new FeatureController(featureService);
  const scanController = new ScanController();

  // Policy template controller
  const policyTemplateRepo = createPolicyTemplateRepository();
  await policyTemplateRepo.initialize();
  const policyService = new PolicyService(policyTemplateRepo);
  const policyController = new PolicyController(policyService);
  router.use(createPolicyRouter(policyController));

  // Agent routes
  router.post('/agents', agentController.createAgent.bind(agentController));
  router.get('/agents/:id', agentController.getAgent.bind(agentController));
  router.get('/agents', agentController.getAllAgents.bind(agentController));
  router.put('/agents/:id', agentController.updateAgent.bind(agentController));
  router.delete('/agents/:id', agentController.deleteAgent.bind(agentController));

  // Task routes
  router.post('/tasks', taskController.createTask.bind(taskController));
  router.get('/tasks/:id', taskController.getTask.bind(taskController));
  router.get('/tasks', taskController.getAllTasks.bind(taskController));
  router.delete('/tasks/:id', taskController.deleteTask.bind(taskController));
  router.post('/tasks/:id', taskController.updateTask.bind(taskController));
  router.post('/tasks/:id/message', taskController.sendTaskMessage.bind(taskController));
  router.post('/tasks/:id/execute', taskController.executeTask.bind(taskController));
  
  // Task run routes
  router.get('/runs', taskController.getAllTaskRuns.bind(taskController));
  router.get('/tasks/:id/runs', taskController.getTaskRuns.bind(taskController));
  router.get('/runs/:runId', taskController.getTaskRun.bind(taskController));
  router.get('/runs/:runId/stream', taskController.streamTaskRunEvents.bind(taskController));
  router.post('/runs/:runId/cancel', taskController.cancelTaskRun.bind(taskController));
  router.post('/tasks/:id/runs/:runId/refine-plan', taskController.refinePlanFromRun.bind(taskController));

  // MCP Integration routes
  router.post('/integrations/mcp', mcpIntegrationController.createIntegration.bind(mcpIntegrationController));
  router.get('/integrations/mcp/:id', mcpIntegrationController.getIntegration.bind(mcpIntegrationController));
  router.get('/integrations/mcp/:id/details', mcpIntegrationController.getIntegrationDetails.bind(mcpIntegrationController));
  router.get('/integrations/mcp', mcpIntegrationController.getAllIntegrations.bind(mcpIntegrationController));
  router.put('/integrations/mcp/:id', mcpIntegrationController.updateIntegration.bind(mcpIntegrationController));
  router.delete('/integrations/mcp/:id', mcpIntegrationController.deleteIntegration.bind(mcpIntegrationController));

  // Docker MCP discovery (dev only)
  router.get('/integrations/mcp/docker/servers', mcpIntegrationController.listDockerMCPServers.bind(mcpIntegrationController));
  router.post('/integrations/mcp/docker/add', mcpIntegrationController.addDockerMCPIntegration.bind(mcpIntegrationController));

  // Feedback routes
  router.post('/feedbacks', feedbackController.createFeedback.bind(feedbackController));
  router.get('/tasks/:taskId/feedbacks', feedbackController.getFeedbacksByTaskId.bind(feedbackController));
  router.get('/runs/:taskRunId/feedbacks', feedbackController.getFeedbacksByTaskRunId.bind(feedbackController));
  router.delete('/feedbacks/:id', feedbackController.deleteFeedback.bind(feedbackController));
  router.patch('/feedbacks/:id', feedbackController.updateFeedback.bind(feedbackController));

  // Built-in Integration routes
  router.get('/integrations/built-in', builtInIntegrationController.getBuiltInIntegrations.bind(builtInIntegrationController));
  router.post('/integrations/built-in/validate', builtInIntegrationController.validateIntegration.bind(builtInIntegrationController));

  // Unified integrations endpoint delegated to controller
  router.get('/integrations', integrationsController.getAllIntegrations.bind(integrationsController));

  // Custom + Code integration management routes
  // :type is either "custom" or "code" — the controller reads it to scope queries/writes.
  router.post('/integrations/:type', customIntegrationController.createIntegration.bind(customIntegrationController));
  router.get('/integrations/:type/:id', customIntegrationController.getIntegration.bind(customIntegrationController));
  router.get('/integrations/:type', customIntegrationController.getAllIntegrations.bind(customIntegrationController));
  router.put('/integrations/:type/:id', customIntegrationController.updateIntegration.bind(customIntegrationController));
  router.delete('/integrations/:type/:id', customIntegrationController.deleteIntegration.bind(customIntegrationController));

  // Slack OAuth routes
  router.post('/oauth/slack/complete', slackOAuthController.complete.bind(slackOAuthController));

  // GitHub OAuth routes
  router.post('/oauth/github/complete', githubOAuthController.complete.bind(githubOAuthController));

  // Asset routes (Knowledge Base)
  // Note: More specific routes must come before parameterized routes
  router.delete('/knowledge-base/assets', assetController.deleteAllAssets.bind(assetController));
  router.get('/knowledge-base/assets/categories', assetController.getAssetCategories.bind(assetController));
  router.get('/knowledge-base/asset/*/relationships', assetController.getAssetRelationships.bind(assetController));
  router.get('/knowledge-base/asset/*/artifacts', assetController.getRepositoryArtifacts.bind(assetController));
  router.get('/knowledge-base/asset/*/exploitability', assetController.getAssetExploitability.bind(assetController));
  router.get('/knowledge-base/asset/*', assetController.getAssetById.bind(assetController));
  router.get('/knowledge-base/assets/:category', assetController.getAssetsByCategory.bind(assetController));

  // Repository discovery (for UI repo-selection picker)
  router.get('/knowledge-base/repositories', scanController.listRepositories.bind(scanController));

  // Scan routes (trigger data indexer)
  // Note: /scan/stream must be registered before /scan/:scanId to avoid parameter capture
  router.post('/knowledge-base/scan/stream', scanController.streamScan.bind(scanController));
  router.post('/knowledge-base/scan', scanController.triggerScan.bind(scanController));
  router.get('/knowledge-base/scan', scanController.listScanHistory.bind(scanController));
  router.get('/knowledge-base/scan/:scanId', scanController.getScanStatus.bind(scanController));

  // Feature Analysis routes (Business Feature Threat Modeling)
  // Note: static sub-paths (/architecture-doc) must be before /:id to avoid param capture
  router.get('/knowledge-base/features/architecture-doc', featureController.getArchitectureDoc.bind(featureController));
  router.get('/knowledge-base/features/:id/history', featureController.getFeatureHistory.bind(featureController));
  router.get('/knowledge-base/features/:id', featureController.getFeatureById.bind(featureController));
  router.get('/knowledge-base/features', featureController.listFeatures.bind(featureController));

  // Chat routes
  router.post('/chat', chatController.chat.bind(chatController));

  return router;
}
