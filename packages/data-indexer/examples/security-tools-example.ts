/**
 * Security Query Tools Example
 * 
 * This example demonstrates:
 * 1. Indexing code repository data with GitHub integration
 * 2. Using AI agent with security query tools to analyze vulnerability impact
 * 3. Optional: Azure cloud resource discovery using Microsoft Defender integration
 * 
 * Prerequisites:
 * - Azure OpenAI credentials:
 *   - AZURE_OPENAI_ENDPOINT
 *   - AZURE_OPENAI_API_KEY  
 *   - AZURE_OPENAI_DEPLOYMENT
 * - Optional: Qdrant for persistent storage and integration configs
 *   - QDRANT_URL
 *   - QDRANT_API_KEY (optional)
 * - Optional: Neo4j for graph-based storage
 *   - NEO4J_URI
 *   - NEO4J_USERNAME
 *   - NEO4J_PASSWORD
 * 
 * Integration Configuration:
 * - GitHub and Microsoft Defender integrations are loaded from Qdrant database
 * - Fallback to minimal GitHub integration if not found in database
 * - Fallback to environment variables for Azure credentials:
 *   - AZURE_TENANT_ID
 *   - AZURE_CLIENT_ID
 *   - AZURE_CLIENT_SECRET
 *   - AZURE_SUBSCRIPTION_ID
 * 
 * Usage:
 *   # Basic usage with Azure OpenAI
 *   AZURE_OPENAI_ENDPOINT=https://... AZURE_OPENAI_API_KEY=xxx \
 *   AZURE_OPENAI_DEPLOYMENT=gpt-4 \
 *     npx tsx examples/security-tools-example.ts
 * 
 *   # With persistent storage and integrations
 *   QDRANT_URL=http://localhost:6333 \
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USERNAME=neo4j NEO4J_PASSWORD=password \
 *     npx tsx examples/security-tools-example.ts
 * 
 *   # With Azure cloud discovery (environment variables fallback)
 *   AZURE_TENANT_ID=xxx AZURE_CLIENT_ID=xxx AZURE_CLIENT_SECRET=xxx AZURE_SUBSCRIPTION_ID=xxx \
 *     npx tsx examples/security-tools-example.ts
 */

import { 
  CodeIndexingPipeline,
  type Dependency,
} from '../src';
import { 
  GitHubIntegration,
  MicrosoftDefenderIntegration,
  type DefenderConfig,
} from '@ai-agent/shared';
import { 
  AzureOpenAIClient,
  AzureOpenAIEmbeddingClient,
  Task,
  MODES,
  getFullSystemPrompt,
  createTaskTools
} from '@ai-agent/core';
import { 
  Neo4jAdapter,
  QdrantAdapter,
  initializeSecurityQueryTools,
  createCustomIntegrationRepository,
} from '@ai-agent/shared';
import * as path from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

async function main() {
  console.log('='.repeat(80));
  console.log('Security Query Tools Example');
  console.log('='.repeat(80));
  console.log();

  const tenantId = '0361b075-6fe1-44cd-89f2-e9603816fa52';
  const repoPath = process.env.REPO_PATH || path.resolve(__dirname, '../../../');
  const repoName = path.basename(repoPath);
  
  console.log(`📂 Repository: ${repoName}`);
  console.log(`📍 Path: ${repoPath}`);
  console.log();

  // ============================================================================
  // Initialize Azure OpenAI Client
  // ============================================================================
  if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_API_KEY) {
    console.error('❌ Missing required Azure OpenAI environment variables');
    console.error('   Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY');
    process.exit(1);
  }

  const apiClient = new AzureOpenAIClient({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  });
  
  const embeddingClient = new AzureOpenAIEmbeddingClient({
    endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY,
    deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-ada-002',
    apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
  });
  
  console.log('✅ Azure OpenAI client initialized');
  console.log();

  // ============================================================================
  // Initialize Storage Adapters (Optional)
  // ============================================================================
  let neo4j: Neo4jAdapter;
  let qdrant: QdrantAdapter;

  console.log('🔗 Initializing Neo4j connection...');
  neo4j = new Neo4jAdapter({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  });
  await neo4j.initialize();
  console.log('✅ Neo4j connected');
  console.log();

  console.log('🔍 Initializing Qdrant connection...');
  
  qdrant = new QdrantAdapter({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collectionPrefix: 'code_indexer',
  }, embeddingClient);

  await qdrant.initialize();
  console.log('✅ Qdrant connected');
  console.log();

  // ============================================================================
  // Initialize GitHub Integration
  // ============================================================================
  let githubIntegration: GitHubIntegration | undefined;

  if (process.env.QDRANT_URL) {
    try {
      console.log('🔍 Looking for GitHub integration in database...');
      const customIntegrationRepo = createCustomIntegrationRepository({
        qdrantUrl: process.env.QDRANT_URL,
        qdrantApiKey: process.env.QDRANT_API_KEY,
      });
      await customIntegrationRepo.initialize();

      const customIntegrations = await customIntegrationRepo.getAll(tenantId, true);
      const githubConfig = customIntegrations.find(
        (ci) => ci.type === 'code' && ci.enabled && ci.name?.toLowerCase().includes('github')
      );

      if (githubConfig) {
        const cfg = githubConfig.config;
        githubIntegration = new GitHubIntegration({
          tenantId,
          installationId: cfg.installationId || '',
          appId: cfg.appId,
        });
        console.log('✅ Found GitHub integration in database');
      } else {
        console.log('ℹ️  No GitHub integration found in database');
      }
    } catch (error: any) {
      console.log(`⚠️  Failed to fetch GitHub config from database: ${error.message}`);
    }
  }

  // Fallback: create a minimal GitHub integration if not found in database
  if (!githubIntegration) {
    console.log('ℹ️  Using minimal GitHub integration (local repos only)');
    githubIntegration = {
      getRepositories: async () => [],
    } as unknown as GitHubIntegration;
  }

  // ============================================================================
  // Initialize Microsoft Defender Integration (Optional)
  // ============================================================================
  let azureConfig: DefenderConfig | undefined;
  let defenderIntegration: MicrosoftDefenderIntegration | undefined;

  if (process.env.QDRANT_URL) {
    try {
      console.log('🔍 Looking for Microsoft Defender integration in database...');
      const customIntegrationRepo = createCustomIntegrationRepository({
        qdrantUrl: process.env.QDRANT_URL,
      });
      await customIntegrationRepo.initialize();

      const customIntegrations = await customIntegrationRepo.getAll(tenantId, true);
      const defenderConfig = customIntegrations.find(
        (ci) => ci.name === 'Microsoft Defender for Cloud' && ci.enabled
      );

      if (defenderConfig) {
        const cfg = defenderConfig.config as Record<string, string>;
        azureConfig = {
          tenantId: cfg.tenantId || '',
          clientId: cfg.clientId || '',
          clientSecret: cfg.clientSecret || '',
          subscriptionId: cfg.subscriptionId || '',
        };
        console.log('✅ Found Microsoft Defender config in database');
      } else {
        console.log('ℹ️  No Microsoft Defender integration found in database');
      }
    } catch (error: any) {
      console.log(`⚠️  Failed to fetch config from database: ${error.message}`);
    }
  }

  // Fallback to environment variables if not found in database
  if (!azureConfig && process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
    azureConfig = {
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    };
    console.log('ℹ️  Using Azure config from environment variables');
  }

  if (azureConfig) {
    console.log('☁️  Azure cloud discovery enabled');
    console.log(`   Subscription: ${azureConfig.subscriptionId || 'default'}`);
    defenderIntegration = new MicrosoftDefenderIntegration(azureConfig);
    console.log('✅ Microsoft Defender integration initialized');
    console.log();
  }

  // ============================================================================
  // Index Repository
  // ============================================================================
  console.log('='.repeat(80));
  console.log('Indexing Repository');
  console.log('='.repeat(80));
  console.log();

  const pipeline = new CodeIndexingPipeline(
    tenantId,
    githubIntegration,
    {
      api: apiClient,
      localPath: repoPath,
      skipClone: true,
      analysisDepth: 'deep',
      enableSemanticAnalysis: false,
      enableVectorIndexing: false,
      enableCloudDiscovery: !!azureConfig,
      cloudDiscovery: azureConfig ? {
        azure: {
          tenantId: azureConfig.tenantId,
          clientId: azureConfig.clientId,
          clientSecret: azureConfig.clientSecret,
          subscriptionId: azureConfig.subscriptionId,
        }
      } : undefined,
      qdrant,
      neo4j,
    }
  );

  console.log('🔍 Running code indexing...');
  const indexingResult = await pipeline.run(tenantId, {
    repositories: [repoName],
  });

  console.log('\n📊 Indexing Results:');
  console.log(`  • Total entities: ${indexingResult.entities.length}`);
  console.log(`  • Relationships: ${indexingResult.relationships.length}`);
  console.log(`  • Duration: ${indexingResult.summary.duration}ms`);
  
  const entityCounts = indexingResult.entities.reduce((acc, e) => {
    acc[e.entityType] = (acc[e.entityType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('  • Entity types:');
  Object.entries(entityCounts).forEach(([type, count]) => {
    console.log(`    - ${type}: ${count}`);
  });
  console.log();

  // List dependencies found
  const dependencies = indexingResult.entities.filter(
    (e): e is Dependency => e.entityType === 'dependency'
  );
  const uniqueDeps = Array.from(
    new Set(dependencies.map(d => d.name))
  ).sort();

  console.log(`📋 Found ${uniqueDeps.length} unique dependencies`);
  console.log();

  // ============================================================================
  // Initialize Security Query Tools
  // ============================================================================
  console.log('='.repeat(80));
  console.log('Initializing Security Query Tools');
  console.log('='.repeat(80));
  console.log();

  const securityTools = await initializeSecurityQueryTools({
    tenantId,
    neo4j,
    qdrant,
  });

  console.log(`✅ Initialized ${securityTools.length} security tools`);
  securityTools.forEach((tool: any) => {
    console.log(`   • ${tool.name}: ${tool.description}`);
  });
  console.log();

  // ============================================================================
  // Use AI Agent with Security Tools
  // ============================================================================
  console.log('='.repeat(80));
  console.log('AI Agent Analysis');
  console.log('='.repeat(80));
  console.log();

  const tools = [...securityTools, ...createTaskTools({})];

  // Build system prompt with security tools
  const systemPrompt = getFullSystemPrompt(
    tools,
    MODES.CODE_ASSISTANT,
    'You are a security analysis assistant specialized in vulnerability impact assessment and dependency analysis.',
    repoPath
  );

  const task = new Task(
    apiClient,
    {
      systemPrompt,
      tools,
      maxIterations: 15,
    },
    embeddingClient
  );

  console.log('🤖 Asking AI to analyze Redis vulnerability impact...');
  console.log();

  const userMessage = `Analyze the impact of a vulnerability in the "redis" package. 
Follow these steps:
1. First, use search_entities to search for "redis" to confirm it exists in the codebase
2. If found, use analyze_vulnerability_impact to analyze the vulnerability impact for the redis package
3. Provide a summary of your findings including:
   - Whether redis is found in the indexed data
   - The blast radius (affected services, entry points)
   - The exposure level (direct-internet-facing, indirect, or internal)
   - security summary - what are the services that are impacted, what is the usage of the package in the code and how it could impact the services and other entities that depend on it, and prioritization based on the given information.
4. Use complete_task to finish with your summary`;

  const result = await task.execute(userMessage);

  console.log('\n' + '='.repeat(80));
  console.log('AI Agent Response');
  console.log('='.repeat(80));
  console.log(result.summary);
  console.log();

  // ============================================================================
  // Cleanup
  // ============================================================================
  if (neo4j) {
    await neo4j.close();
  }

  console.log('='.repeat(80));
  console.log('✅ Example Complete!');
  console.log('='.repeat(80));
}

main().catch(error => {
  console.error('\n❌ Error running example:');
  console.error(error);
  process.exit(1);
});
