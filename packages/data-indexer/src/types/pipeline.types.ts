/**
 * Indexing Pipeline Architecture
 * 
 * Defines the stages and interfaces for a pipeline-style ingestion flow.
 */

import {
  CanonicalEntity,
  Relationship,
  Evidence,
  SemanticDocument,
  IndexingResult,
  TenantId,
} from '@ai-agent/shared';

// ============================================================================
// Pipeline Stages
// ============================================================================

/**
 * Stage 1: Discovery - Find code artifacts to index
 */
export interface DiscoveryStage {
  discover(tenantId: TenantId, scope: DiscoveryScope): Promise<DiscoveryOutput>;
}

export interface DiscoveryScope {
  repositories?: string[]; // Specific repos or all accessible
  branches?: string[];
  includeArchived?: boolean;
  sinceCommit?: string; // For incremental indexing
}

export interface DiscoveryOutput {
  repositories: RepositoryHandle[];
  totalArtifacts: number;
}

export interface RepositoryHandle {
  name: string;
  url: string;
  defaultBranch: string;
  lastCommitSha: string;
  clonePath?: string; // Local path if cloned
}

// ============================================================================
// Stage 2: Extraction - Parse artifacts and extract facts
// ============================================================================

/**
 * Stage 2: Extraction - Parse code and extract raw facts
 */
export interface ExtractionStage {
  extract(
    tenantId: TenantId,
    repositories: RepositoryHandle[]
  ): Promise<ExtractionOutput>;
}

export interface ExtractionOutput {
  repositories: ExtractedRepository[];
  services: ExtractedService[];
  modules: ExtractedModule[];
  buildArtifacts: ExtractedBuildArtifact[];
  deploymentArtifacts: ExtractedDeploymentArtifact[];
  dependencies: ExtractedDependency[];
  commits: ExtractedCommit[];
  errors: ExtractionError[];
  /** Set to true when incremental diff detected zero changed files — all downstream stages should be skipped. */
  skippedDueToNoChanges?: boolean;
}

/** Last git commit that touched a specific path/entity (not the repo HEAD). */
export interface EntityLastCommit {
  sha: string;
  timestamp: string; // ISO 8601
}

export interface ExtractedRepository {
  name: string;
  url: string;
  defaultBranch: string;
  lastCommitSha: string;
  clonePath?: string;

  // Source evidence
  sourceLocation: string;
  sourceType: 'git_remote' | 'local_clone';
  confidence: number;

  metadata: Record<string, any>;
}

export interface ExtractedService {
  id: string;
  name: string;
  serviceType: 'api' | 'library' | 'worker' | 'other';
  codePath: string;
  repository: string;
  branch: string;
  language: string;
  techStack?: string[];
  dependencies?: string[];

  // For LLM analysis
  entryFiles?: string[];
  configFiles?: string[];

  // Last git commit that touched this service's manifest/directory
  lastCommit?: EntityLastCommit;

  // Source evidence
  sourceLocation: string;
  sourceType: 'manifest_file' | 'directory_structure';
  confidence: number;

  metadata: Record<string, any>;
}

export interface ExtractedModule {
  name: string;
  codePath: string;
  serviceName: string;
  serviceId: string;
  repository: string;
  branch: string;
  language: string;
  imports?: string[];
  exports?: string[];
  isEntryPoint: boolean;
  entryType?: 'http' | 'queue' | 'cron' | 'cli' | 'other';

  // Last git commit that touched this file
  lastCommit?: EntityLastCommit;

  // Source evidence
  sourceLocation: string;
  sourceType: 'source_file';
  confidence: number;

  metadata: Record<string, any>;
}

export interface ExtractedBuildArtifact {
  name: string;
  buildType: 'docker' | 'npm' | 'maven' | 'gradle' | 'other';
  codePath: string;
  repository: string;
  branch: string;
  technology: 'python' | 'node' | 'go' | 'java' | 'rust' | 'other';
  serviceId: string; // Services this builds

  // Last git commit that touched this build file
  lastCommit?: EntityLastCommit;

  // Source evidence
  sourceLocation: string;
  sourceType: 'build_file';
  confidence: number;

  metadata: Record<string, any>;
}

export interface ExtractedDeploymentArtifact {
  name: string;
  deploymentType: 'kubernetes' | 'terraform' | 'cloudformation' | 'bicep' | 'docker-compose' | 'helm' | 'script' | 'other';
  codePath: string;
  repository: string;
  branch: string;
  technology: 'yaml' | 'json' | 'hcl' | 'bicep' | 'bash' | 'powershell' | 'other';

  // Last git commit that touched this deployment file
  lastCommit?: EntityLastCommit;

  // Source evidence
  sourceLocation: string;
  sourceType: 'deployment_file';
  confidence: number;

  metadata: Record<string, any>;
}

// Legacy - kept for backward compatibility
export interface ExtractedArtifact {
  type: 'repository' | 'directory' | 'file' | 'component';
  name: string;
  path: string;
  repository: string;
  branch: string;
  commitSha?: string;
  language?: string;
  contentHash?: string;
  content?: string;
  
  componentType?: 'service' | 'library' | 'module' | 'package';
  framework?: string;
  entryPoints?: string[];
  
  sourceLocation: string;
  sourceType: 'git_blob' | 'git_tree' | 'manifest_file';
  confidence: number;
  
  metadata: Record<string, any>;
}

export interface ExtractedDependency {
  name: string;
  version: string;
  versionConstraint?: string;
  packageManager: string;
  isDev: boolean;
  isTransitive: boolean;

  // Context
  declaredInFile: string;
  repository: string;
  usedByComponent?: string;

  // Last git commit that touched the manifest file declaring this dependency
  lastCommit?: EntityLastCommit;

  // Source evidence
  sourceLocation: string;
  sourceType: 'manifest_file' | 'lockfile';
  confidence: number;

  metadata: Record<string, any>;
}

export interface ExtractedCommit {
  sha: string;
  repository: string;
  branch: string;
  author: string;
  authorEmail: string;
  message: string;
  timestamp: string;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
  
  sourceLocation: string;
  metadata: Record<string, any>;
}

export interface ExtractionError {
  stage: 'discovery' | 'extraction' | 'transformation' | 'semantic';
  repository?: string;
  artifact?: string;
  message: string;
  error?: any;
  timestamp: string;
}

// ============================================================================
// Stage 3: Transformation - Convert to canonical entities
// ============================================================================

/**
 * Stage 3: Transformation - Convert extracted facts to canonical entities
 */
export interface TransformationStage {
  transform(
    tenantId: TenantId,
    extraction: ExtractionOutput
  ): Promise<TransformationOutput>;
}

export interface TransformationOutput {
  entities: CanonicalEntity[];
  relationships: Relationship[];
  evidence: Evidence[];
  errors: ExtractionError[];
}

// ============================================================================
// Stage 4: Semantic Analysis - Generate descriptions via LLM
// ============================================================================

/**
 * Stage 4: Semantic Analysis - Generate semantic documents via constrained LLM
 */
export interface SemanticAnalysisStage {
  analyze(
    tenantId: TenantId,
    artifacts: CanonicalEntity[],
    extraction: ExtractionOutput
  ): Promise<SemanticAnalysisOutput>;
}

export interface SemanticAnalysisOutput {
  documents: SemanticDocument[];
  cacheHits: number;
  cacheMisses: number;
  errors: ExtractionError[];
}

export interface SemanticAnalysisRequest {
  artifactId: string;
  language: string;
  filePath: string;
  content: string;
  context?: {
    imports?: string[];
    exports?: string[];
    dependencies?: string[];
  };
}

export interface SemanticAnalysisResponse {
  imports: string[];
  exports: string[];
  httpEntryPoints: string[];
  responsibility: string;
  dependencies: string[];
  confidence: number;
}

// ============================================================================
// Stage 5: Persistence - Project to downstream stores
// ============================================================================

/**
 * Stage 5: Persistence - Project canonical data to storage backends
 */
export interface PersistenceStage {
  persist(
    tenantId: TenantId,
    transformation: TransformationOutput,
    semantic: SemanticAnalysisOutput
  ): Promise<PersistenceOutput>;
}

export interface PersistenceOutput {
  relational: {
    entitiesWritten: number;
    relationshipsWritten: number;
    evidenceWritten: number;
  };
  graph?: {
    nodesWritten: number;
    edgesWritten: number;
  };
  vector?: {
    documentsIndexed: number;
    embeddingsCreated: number;
  };
  errors: ExtractionError[];
}

// ============================================================================
// Complete Pipeline
// ============================================================================

/**
 * IndexingPipeline - Orchestrates all stages
 */
export interface IndexingPipeline {
  run(
    tenantId: TenantId,
    scope: DiscoveryScope,
    options?: IndexingOptions
  ): Promise<IndexingResult>;
}

export interface IndexingOptions {
  runType?: 'full' | 'incremental' | 'repair';
  maxConcurrency?: number;
  continueOnError?: boolean;
}

// ============================================================================
// ID Generation (deterministic)
// ============================================================================

/**
 * EntityIdGenerator - Generates deterministic IDs for entities
 */
export interface EntityIdGenerator {
  generateEntityId(
    tenantId: TenantId,
    entityType: string,
    naturalKey: Record<string, any>
  ): string;
  
  generateRelationshipId(
    tenantId: TenantId,
    type: string,
    sourceId: string,
    targetId: string,
    validFrom: string
  ): string;
  
  generateContentHash(content: string): string;
}

// ============================================================================
// Cache (for semantic documents)
// ============================================================================

/**
 * SemanticCache - Cache semantic documents by input hash
 */
export interface SemanticCache {
  get(inputHash: string): Promise<SemanticDocument | null>;
  set(inputHash: string, document: SemanticDocument): Promise<void>;
  has(inputHash: string): Promise<boolean>;
  invalidate(inputHash: string): Promise<void>;
}
