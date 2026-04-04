// Types exports
export * from '../types';

// Data adapters exports
export * from './qdrantDataAdapter';
export * from './neo4jAdapter';
export * from '../tools/securityQueryTools';
export * from '../tools/securityQueryTool';
export * from '../tools/vulnerabilityImpactAnalyzer';

// Persistence layer exports
import type { ITaskRepository, IChatMessageRepository, IMCPIntegrationRepository, IAgentRepository, RepositoryConfig, ICustomIntegrationRepository } from './interfaces';
import type { ITaskRunRepository, IFeedbackRepository, IIndexingRunRepository } from './interfaces';
import { QdrantTaskRepository } from './qdrantTaskRepository';
import { QdrantChatMessageRepository } from './qdrantChatMessageRepository';
import { QdrantMCPIntegrationRepository } from './qdrantMCPIntegrationRepository';
import { QdrantAgentRepository } from './qdrantAgentRepository';
import { QdrantTaskRunRepository } from './qdrantTaskRunRepository';
import { QdrantFeedbackRepository } from './qdrantFeedbackRepository';
import { QdrantCustomIntegrationRepository } from './qdrantCustomIntegrationRepository';
import { QdrantSecurityReviewRepository } from './qdrantSecurityReviewRepository';
import type { ISecurityReviewRepository } from './interfaces';
import { QdrantPolicyTemplateRepository } from './qdrantPolicyTemplateRepository';
import type { IPolicyTemplateRepository } from './interfaces';
import { QdrantIndexingRunRepository } from './qdrantIndexingRunRepository';

export * from './interfaces';
export * from './qdrantTaskRepository';
export * from './qdrantChatMessageRepository';
export * from './qdrantMCPIntegrationRepository';
export * from './qdrantAgentRepository';
export * from './qdrantTaskRunRepository';
export * from './qdrantFeedbackRepository';
export * from './qdrantCustomIntegrationRepository';
export * from './qdrantSecurityReviewRepository';
export * from './qdrantPolicyTemplateRepository';
export * from './qdrantIndexingRunRepository';

// Database config
export { getDatabaseConfig, type DatabaseConfig } from './database';

// Integration exports
export { GitHubIntegration, type GitHubConfig } from '../integrations/githubIntegration';
export { SlackIntegration, type SlackConfig } from '../integrations/slackIntegration';
export { MicrosoftDefenderIntegration } from '../integrations/microsoftDefenderIntegration';
export { getInstallationToken, type InstallationAuthResult } from '../integrations/githubAuth';

/**
 * Factory function to create a task repository.
 * Currently returns a Qdrant implementation, but can be extended
 * to support other database backends based on configuration.
 */
export function createTaskRepository(config?: RepositoryConfig): ITaskRepository {
  // For now, we only have Qdrant implementation
  // In the future, we could check config.type and return different implementations
  return new QdrantTaskRepository(config);
}

/**
 * Factory function to create a chat message repository.
 * Currently returns a Qdrant implementation, but can be extended
 * to support other database backends based on configuration.
 */
export function createChatMessageRepository(config?: RepositoryConfig): IChatMessageRepository {
  // For now, we only have Qdrant implementation
  // In the future, we could check config.type and return different implementations
  return new QdrantChatMessageRepository(config);
}

/**
 * Factory function to create an MCP integration repository.
 * Currently returns a Qdrant implementation, but can be extended
 * to support other database backends based on configuration.
 */
export function createMCPIntegrationRepository(config?: RepositoryConfig): IMCPIntegrationRepository {
  // For now, we only have Qdrant implementation
  // In the future, we could check config.type and return different implementations
  return new QdrantMCPIntegrationRepository(config);
}



/**
 * Factory function to create an agent repository.
 * Currently returns a Qdrant implementation, but can be extended
 * to support other database backends based on configuration.
 */
export function createAgentRepository(config?: RepositoryConfig): IAgentRepository {
  return new QdrantAgentRepository(config);
}

/**
 * Factory function to create a task run repository.
 * Currently returns a Qdrant implementation, but can be extended
 * to support other database backends based on configuration.
 */
export function createTaskRunRepository(config?: RepositoryConfig): ITaskRunRepository {
  return new QdrantTaskRunRepository(config || {});
}

/**
 * Factory function to create a feedback repository.
 * Currently returns a Qdrant implementation, but can be extended
 * to support other database backends based on configuration.
 */
export function createFeedbackRepository(config?: RepositoryConfig): IFeedbackRepository {
  return new QdrantFeedbackRepository(config || {});
}

/**
 * Factory for custom integration repository
 */
export function createCustomIntegrationRepository(config?: RepositoryConfig): ICustomIntegrationRepository {
  // return qdrant implementation for now
  return new QdrantCustomIntegrationRepository(config || {});
}

/**
 * Factory for security review repository
 */
export function createSecurityReviewRepository(config?: RepositoryConfig): ISecurityReviewRepository {
  return new QdrantSecurityReviewRepository(config || {});
}

/**
 * Factory for policy template repository
 */
export function createPolicyTemplateRepository(config?: RepositoryConfig): IPolicyTemplateRepository {
  return new QdrantPolicyTemplateRepository(config || {});
}

/**
 * Factory for indexing run repository
 */
export function createIndexingRunRepository(config?: RepositoryConfig): IIndexingRunRepository {
  return new QdrantIndexingRunRepository(config || {});
}
