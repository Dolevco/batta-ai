/**
 * Data Indexer Package
 * 
 * Agent-native data indexing layer for cybersecurity platform.
 * 
 * @packageDocumentation
 */

// Core types - re-export from shared
export * from '@ai-agent/shared';

// Connector types
export * from './types/connector.types';
export * from './types/pipeline.types';

// Adapters - re-export from shared
export { QdrantAdapter } from '@ai-agent/shared';
export type { QdrantConfig, SearchQuery, SearchResult } from '@ai-agent/shared';
export { Neo4jAdapter } from '@ai-agent/shared';
export type { Neo4jConfig } from '@ai-agent/shared';
export { SecurityQueryTools } from '@ai-agent/shared';
export type { SecurityQueryConfig } from '@ai-agent/shared';
export { VulnerabilityImpactAnalyzer } from '@ai-agent/shared';

// Services
export { CloudDiscoveryStage } from './services/cloud-discovery.stage';
export type { CloudDiscoveryConfig, CloudDiscoveryOutput } from './services/cloud-discovery.stage';export { LLMCorrelator } from './services/llm-correlator';
export type { RepositoryCorrelationInput, CorrelationResult } from './services/llm-correlator';

// Queue-based indexing (production-ready)
export { QueueManager } from './services/queue-manager';
export type { QueueManagerConfig } from './services/queue-manager';
export { CheckpointManager } from './services/checkpoint-manager';
export type { CheckpointManagerConfig } from './services/checkpoint-manager';
export { CodeIndexingOrchestrator } from './services/indexing-orchestrator';
export type { OrchestrationResult, OrchestrationOptions } from './services/indexing-orchestrator';
export { IndexingWorker } from './services/queue-worker';
export type { WorkerConfig } from './services/queue-worker';
export { RepositoryTaskProcessor } from './services/task-processor';
export type { TaskProcessorConfig } from './services/task-processor';
export { IntegrationFetcher } from './services/integration-fetcher';
export type { IntegrationFetcherConfig, FetchedIntegrations } from './services/integration-fetcher';
export { RepositorySetup } from './services/repository-setup';
export type { RepositorySetupConfig } from './services/repository-setup';

// Agent registry — used by the worker for pr-validation and future background agents
export { DataIndexerAgentRegistry, DataIndexerAgentType, createDataIndexerRegistry } from './agents';

// Queue types
export * from './types/queue.types';

// Connectors
export { CodeIndexingPipeline } from './connectors/code.pipeline';
export { CodeDiscoveryStage } from './connectors/stages/discovery.stage';
export type { CodeIndexerConfig } from './connectors/code.pipeline';
export { AzureResourceGraphConnector } from './connectors/azure-resource-graph.connector';
export type { AzureResourceGraphConfig } from './connectors/azure-resource-graph.connector';

// Utils
export { extractAzureRelationships } from './utils/azure-relationship-extractor';
export { extractAzureIdentities } from './utils/azure-identity-extractor';
export type { AzureIdentityExtractionResult } from './utils/azure-identity-extractor';
export { 
  sanitizeSecrets, 
  containsSecrets, 
  sanitizeEvidence, 
  sanitizeMetadata 
} from './utils/secret-sanitizer';
