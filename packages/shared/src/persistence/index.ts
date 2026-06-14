export * from './data-adapter';
export * from './graph-adapter';
export * from './interfaces';
export * from './schema';
export * from './postgres-adapter-factory';
export * from './repositories/chat-message.repository';
export * from './repositories/mcp-integration.repository';
export * from './repositories/custom-integration.repository';
export * from './repositories/security-review.repository';
export * from './repositories/policy-template.repository';
export * from './repositories/indexing-run.repository';
export { getPool } from './client';
export { getDatabaseConfig, type DatabaseConfig } from './config';

import type {
  IChatMessageRepository,
  IMCPIntegrationRepository,
  ICustomIntegrationRepository,
  ISecurityReviewRepository,
  IPolicyTemplateRepository,
  IIndexingRunRepository,
  RepositoryConfig,
} from './interfaces';
import { PostgresChatMessageRepository } from './repositories/chat-message.repository';
import { PostgresMCPIntegrationRepository } from './repositories/mcp-integration.repository';
import { PostgresCustomIntegrationRepository } from './repositories/custom-integration.repository';
import { PostgresSecurityReviewRepository } from './repositories/security-review.repository';
import { PostgresPolicyTemplateRepository } from './repositories/policy-template.repository';
import { PostgresIndexingRunRepository } from './repositories/indexing-run.repository';

export function createChatMessageRepository(_config?: RepositoryConfig): IChatMessageRepository {
  return new PostgresChatMessageRepository(_config);
}

export function createMCPIntegrationRepository(_config?: RepositoryConfig): IMCPIntegrationRepository {
  return new PostgresMCPIntegrationRepository(_config);
}

export function createCustomIntegrationRepository(_config?: RepositoryConfig): ICustomIntegrationRepository {
  return new PostgresCustomIntegrationRepository(_config);
}

export function createSecurityReviewRepository(_config?: RepositoryConfig): ISecurityReviewRepository {
  return new PostgresSecurityReviewRepository(_config);
}

export function createPolicyTemplateRepository(_config?: RepositoryConfig): IPolicyTemplateRepository {
  return new PostgresPolicyTemplateRepository(_config);
}

export function createIndexingRunRepository(_config?: RepositoryConfig): IIndexingRunRepository {
  return new PostgresIndexingRunRepository(_config);
}
