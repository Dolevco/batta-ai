/**
 * Queue-based Indexing Types
 * 
 * Defines types for distributed task processing via Redis queues
 */

import { TenantId, CanonicalEntity, Relationship, Evidence, SemanticDocument } from '@ai-agent/shared';
import { RepositoryHandle, ExtractionOutput } from './pipeline.types';

/**
 * Task types for queue processing
 */
export enum TaskType {
  INDEX_REPOSITORY = 'index_repository',
}

/**
 * Base task data
 */
export interface BaseTaskData {
  tenantId: TenantId;
  taskId: string;
  createdAt: string;
}

/**
 * Repository indexing task
 */
export type IndexingDomain = 'iac' | 'services' | 'service_relationships' | 'features';

export interface IndexRepositoryTask extends BaseTaskData {
  type: TaskType.INDEX_REPOSITORY;
  repository: RepositoryHandle;
  options: {
    enableCloudDiscovery?: boolean;
    /** 'full' (default) re-indexes everything; 'incremental' only processes changed files */
    runType?: 'full' | 'incremental';
    /**
     * Git commit SHA to diff from when runType='incremental'.
     * Resolved by the task-processor from the last completed IndexingRun at execution time.
     * Security: must match /^[0-9a-f]{40}$/i before being passed to simple-git.
     */
    sinceCommit?: string;
    /**
     * Optional allow-list of analysis domains to run.
     * undefined means all domains are enabled (default behaviour).
     */
    domains?: IndexingDomain[];
  };
}

/**
 * Task progress stages
 */
export enum TaskStage {
  EXTRACT_TRANSFORM = 'extract_transform', // Merged: extraction + transformation + persist entities
  CLOUD_DISCOVERY = 'cloud_discovery',
  SEMANTIC_ANALYSIS = 'semantic_analysis', // Includes persist semantic docs
  LLM_CORRELATION = 'llm_correlation', // Includes persist relationships
  FEATURE_EXTRACTION = 'feature_extraction', // Business feature + DFD + STRIDE threat model
  EXPLOITABILITY_ANALYSIS = 'exploitability_analysis', // Graph-based exploitability with unified DFD + cloud context
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Task checkpoint for resumability
 */
export interface TaskCheckpoint {
  taskId: string;
  tenantId: TenantId;
  stage: TaskStage;
  timestamp: string;
  data: {
    // After extract_transform
    entities?: CanonicalEntity[];
    relationships?: Relationship[];
    evidence?: Evidence[];
    // After semantic_analysis
    semanticDocuments?: SemanticDocument[];
    errors?: string[];
  };
}

/**
 * Task result
 */
export interface TaskResult {
  taskId: string;
  tenantId: TenantId;
  repositoryName: string;
  success: boolean;
  duration: number;
  stages: {
    [K in TaskStage]?: {
      completed: boolean;
      duration: number;
      itemsProcessed: number;
      errors?: string[];
    };
  };
  summary: {
    entitiesCreated: number;
    relationshipsCreated: number;
    evidenceCreated: number;
    semanticDocumentsCreated: number;
    errors: string[];
    /** True when the run detected no file changes and skipped all extraction */
    skippedDueToNoChanges?: boolean;
    /** The run type that was actually executed */
    runType?: 'full' | 'incremental';
  };
}
