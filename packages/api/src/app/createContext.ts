import {
  AssetService,
  ArchitectureQueryService,
  CapabilityService,
  FeatureService,
  PolicyService,
  RepositoryIndexingService,
  SecurityReviewService,
  JiraIssueService,
  SecurityReviewJiraExportService,
  WorkItemReviewRunner,
  createChatMessageRepository,
  createCustomIntegrationRepository,
  createIndexingRunRepository,
  createMCPIntegrationRepository,
  createPolicyTemplateRepository,
  createPostgresDataAdapter,
  createPostgresGraphAdapter,
  createSecurityReviewRepository,
} from '@batta/shared';
import {
  NoopEmbeddingClient,
  createEmbeddingClientFromEnv,
  createLlmClientFromEnv,
  isEmbeddingsConfiguredFromEnv,
  type ILLMApiHandler,
} from '@batta/core';
import { ScanOrchestrator, createDataIndexerRegistry } from '@batta/data-indexer';
import { AssetController } from '../controllers/assetController';
import { BuiltInIntegrationController } from '../controllers/builtInIntegrationController';
import { CapabilitiesController } from '../controllers/capabilitiesController';
import { ChatController } from '../controllers/chatController';
import { CustomIntegrationController } from '../controllers/customIntegrationController';
import { DataStoreController } from '../controllers/dataStoreController';
import { FeatureController } from '../controllers/featureController';
import { GitHubOAuthController } from '../controllers/githubOAuthController';
import { GitHubTokenController } from '../controllers/githubTokenController';
import { IntegrationsController } from '../controllers/integrationsController';
import { MCPIntegrationController } from '../controllers/mcpIntegrationController';
import { PolicyController } from '../controllers/policyController';
import { ScanController } from '../controllers/scanController';
import { SecurityReviewController } from '../controllers/securityReviewController';
import { SlackOAuthController } from '../controllers/slackOAuthController';
import type { ApiEnv } from '../config/env';
import { logStartupConfig } from '../config/logger';

export interface AppContext {
  env: ApiEnv;
  controllers: {
    asset: AssetController;
    builtInIntegration: BuiltInIntegrationController;
    capabilities: CapabilitiesController;
    chat: ChatController;
    customIntegration: CustomIntegrationController;
    dataStore: DataStoreController;
    feature: FeatureController;
    githubOAuth: GitHubOAuthController;
    githubToken: GitHubTokenController;
    integrations: IntegrationsController;
    mcpIntegration: MCPIntegrationController;
    policy: PolicyController;
    scan: ScanController;
    securityReview: SecurityReviewController;
    slackOAuth: SlackOAuthController;
  };
  services: {
    securityReview: SecurityReviewService;
    feature: FeatureService;
    scanOrchestrator: ScanOrchestrator;
    repositoryIndexing: RepositoryIndexingService;
    architectureQuery: ArchitectureQueryService;
    capabilities: CapabilityService;
  };
}

export async function createAppContext(env: ApiEnv): Promise<AppContext> {
  logStartupConfig(env);

  const chatMessageRepository = createChatMessageRepository();
  const mcpIntegrationRepository = createMCPIntegrationRepository();
  const customIntegrationRepository = createCustomIntegrationRepository();
  const securityReviewRepository = createSecurityReviewRepository();
  const policyTemplateRepository = createPolicyTemplateRepository();
  const indexingRunRepository = createIndexingRunRepository();

  console.log('[init] initializing chatMessageRepository...');
  await chatMessageRepository.initialize();
  console.log('[init] initializing mcpIntegrationRepository...');
  await mcpIntegrationRepository.initialize();
  console.log('[init] initializing customIntegrationRepository...');
  await customIntegrationRepository.initialize();
  console.log('[init] initializing securityReviewRepository...');
  await securityReviewRepository.initialize();
  console.log('[init] initializing policyTemplateRepository...');
  await policyTemplateRepository.initialize();
  console.log('[init] core repositories ready');

  const embeddingClient = createEmbeddingClientFromEnv();
  const dataAdapter = createPostgresDataAdapter(embeddingClient);
  console.log('[init] initializing PostgresDataAdapter...');
  await dataAdapter.initialize();
  console.log('[init] PostgresDataAdapter ready');

  const llmClient: ILLMApiHandler | undefined = createLlmClientFromEnv();
  const agentRegistry = llmClient ? createDataIndexerRegistry(llmClient) : undefined;

  const graphAdapter = createPostgresGraphAdapter();
  console.log('[init] initializing indexingRunRepository...');
  await indexingRunRepository.initialize();
  console.log('[init] indexingRunRepository ready');

  const assetService = new AssetService(dataAdapter, graphAdapter, indexingRunRepository);
  const repositoryIndexingService = new RepositoryIndexingService(indexingRunRepository, dataAdapter, graphAdapter);
  const featureService = new FeatureService(dataAdapter, graphAdapter);
  const architectureQueryService = new ArchitectureQueryService(dataAdapter, featureService, indexingRunRepository);
  const policyService = new PolicyService(policyTemplateRepository);
  const jiraService = new JiraIssueService(customIntegrationRepository);
  const exportService = new SecurityReviewJiraExportService(jiraService, securityReviewRepository);
  const securityReviewService = new SecurityReviewService(
    securityReviewRepository,
    featureService,
    policyTemplateRepository,
    exportService,
  );
  const scanOrchestrator = new ScanOrchestrator();
  const workItemRunner = agentRegistry ? new WorkItemReviewRunner(
    securityReviewRepository,
    policyTemplateRepository,
    jiraService,
    agentRegistry,
    (id: string, tenantId: string, answers: import('@batta/shared').SecurityReviewAnswer[]) => securityReviewService.submitAnswers(id, tenantId, answers),
    (id: string, tenantId: string) => securityReviewService.acknowledgeTasks(id, tenantId),
    exportService,
  ) : undefined;

  const mcpIntegration = new MCPIntegrationController(mcpIntegrationRepository);
  const customIntegration = new CustomIntegrationController(customIntegrationRepository);
  const builtInIntegration = new BuiltInIntegrationController(customIntegrationRepository);
  const processState = {
    database: true,
    mcp: true,
    llm: Boolean(llmClient),
    embeddings: !(embeddingClient instanceof NoopEmbeddingClient) && isEmbeddingsConfiguredFromEnv(),
  };
  const capabilityService = new CapabilityService(processState, customIntegrationRepository, mcpIntegrationRepository);

  return {
    env,
    controllers: {
      asset: new AssetController(assetService),
      builtInIntegration,
      capabilities: new CapabilitiesController(capabilityService),
      chat: new ChatController(securityReviewService, featureService, embeddingClient, customIntegrationRepository, capabilityService, llmClient),
      customIntegration,
      dataStore: new DataStoreController(assetService),
      feature: new FeatureController(featureService),
      githubOAuth: new GitHubOAuthController(customIntegrationRepository),
      githubToken: new GitHubTokenController(customIntegrationRepository),
      integrations: new IntegrationsController(mcpIntegration, customIntegration),
      mcpIntegration,
      policy: new PolicyController(policyService),
      scan: new ScanController(scanOrchestrator, capabilityService),
      securityReview: new SecurityReviewController(securityReviewService, jiraService, workItemRunner, exportService),
      slackOAuth: new SlackOAuthController(customIntegrationRepository),
    },
    services: {
      securityReview: securityReviewService,
      feature: featureService,
      scanOrchestrator,
      repositoryIndexing: repositoryIndexingService,
      architectureQuery: architectureQueryService,
      capabilities: capabilityService,
    },
  };
}
