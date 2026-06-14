/**
 * Canonical Contract for Code Indexing
 * 
 * This defines the DB-agnostic schema that serves as the source of truth.
 * All downstream stores (relational, graph, vector) project from this contract.
 */

// ============================================================================
// Core Primitives
// ============================================================================

export type EntityId = string; // Deterministic hash-based ID
export type TenantId = string;
export type Timestamp = string; // ISO 8601
export type Confidence = 'deterministic' | 'manual' | 'heuristic';

/**
 * Base entity interface - all entities extend this
 */
export interface BaseEntity {
  id: EntityId; // Deterministic: hash(tenantId + entityType + naturalKey)
  tenantId: TenantId;
  entityType: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  confidence: Confidence;
  metadata: Record<string, any>;
  lastIndexedAt?: Timestamp;      // When this entity was last successfully indexed
  lastIndexedCommit?: string;     // Git HEAD SHA at time of last successful indexing
}

// ============================================================================
// Code Entities
// ============================================================================

/**
 * CodeRepository - A source code repository
 */
export interface CodeRepository extends BaseEntity {
  entityType: 'code_repository';
  name: string;
  url: string;
  defaultBranch: string;
  lastCommitSha?: string;
  responsibility?: string; // LLM-generated description
  /**
   * Structured repository briefing produced before per-service analysis.
   * Passed as shared context to all downstream agents.
   * Classification: INTERNAL — no secret values.
   */
  repositoryBriefing?: RepositoryBriefing;
}

/**
 * ExternalDep - An external dependency of a service outside the internal trust boundary
 * (third-party API, cloud resource, external queue, managed service, etc.)
 */
export interface ExternalDep {
  /** Short name, e.g. "Stripe Payments API" */
  name: string;
  /**
   * Category of the dependency.
   * api        – HTTP/REST/GraphQL API called at runtime
   * cloud      – Cloud-managed resource (S3, Azure Blob, SQS, etc.)
   * queue      – Managed message queue / event bus
   * database   – External or managed database service
   * cache      – External cache (e.g. Redis Cloud, ElastiCache)
   * storage    – Blob / file storage
   * identity   – Identity provider / SSO (Auth0, Azure AD, etc.)
   * other      – Anything that doesn't fit the above
   */
  type: 'api' | 'cloud' | 'queue' | 'database' | 'cache' | 'storage' | 'identity' | 'other';
  /** Protocol or transport used to reach it, e.g. "HTTPS", "AMQP", "TCP" */
  protocol?: string;
  /** Brief description of why this service needs this dependency */
  purpose: string;
  /** Direction of the primary data flow */
  dataFlow: 'inbound' | 'outbound' | 'bidirectional';
  /** Highest data-classification label for data that crosses this boundary */
  dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  /** Business importance of this dependency */
  businessValue: string;
  /** How this dependency was identified (env var name, import, config key, etc.) */
  evidence?: string;

  // ── Correlation identifiers (Pass 2 enrichment) ────────────────────────────

  /**
   * Concrete resource name within the dependency — the join key used during
   * cross-service correlation. Examples:
   *   database  → database/schema name: "neo4j", "postgres_main"
   *   cache     → key-space prefix or logical name: "session_cache"
   *   queue     → queue/topic name(s): "indexing", "scan-results"
   *   storage   → bucket/container name: "artifacts-bucket"
   *   api       → base URL path prefix: "/api"  (NOT the hostname)
   *
   * Classification: INTERNAL — no secret values.
   */
  resourceName?: string;

  /**
   * Sample endpoint paths called on a remote API dep, used for matching against
   * the provider's exposedEndpoints. Only populated when type = 'api'.
   * Examples: ["/tasks", "/tasks/:id", "/chat", "/agents"]
   * Include parameterized forms (/:id) not concrete IDs.
   *
   * Classification: INTERNAL — path templates only, no secret values.
   */
  endpoints?: string[];

  /**
   * Specific operations performed on this dependency.
   * Examples: ["read"], ["write"], ["read", "write"], ["subscribe"], ["publish"]
   *
   * Classification: INTERNAL.
   */
  operations?: string[];
}

/**
 * ServiceAnalysis – structured LLM analysis of a single CodeService.
 *
 * Produced by the ServiceAnalyzer (SRE Step 1) before any correlation pass.
 * Contains everything a downstream agent needs to understand the service without
 * re-reading source files.
 *
 * Classification: INTERNAL — no secret values may appear in any field.
 */
export interface ServiceAnalysis {
  /** 1–3 sentence business-oriented description of what the service does */
  serviceDescription: string;
  /** Overall business value delivered by this service */
  businessValue: string;
  /** Runtime technology stack, e.g. ['express', 'typescript', 'postgresql'] */
  techStack: string[];
  /** High-level directory / module structure, e.g. 'src/routes/, src/services/, src/workers/' */
  codeStructure: string;
  /** External dependencies outside the internal trust boundary */
  externalDeps: ExternalDep[];
  /** Names of internal sibling services this service calls or depends on */
  internalDependencies: string[];
  /** Primary entry point types: 'http' | 'queue' | 'cron' | 'cli' | 'other' */
  entryPointTypes: string[];
  /** Dominant architectural patterns observed, e.g. ['REST API', 'Event-driven', 'CQRS'] */
  architecturalPatterns: string[];
}

/**
 * ServiceFileMap – compact classification of all files in a service directory.
 *
 * Produced by the ServiceFileMapper agent (Pass 0) in a single cheap scan.
 * Acts as the reading list for all downstream agents — they read only the files
 * in priorityFiles and skip those in skipFiles.
 *
 * Classification: INTERNAL — contains only file paths, no secret values.
 */
export interface ServiceFileMap {
  /** High-signal files grouped by semantic role */
  priorityFiles: {
    /** Entry point files (index.ts, main.ts, app.ts, server.ts) */
    entry: string[];
    /** Route / controller / handler files */
    routes: string[];
    /** Data model, schema, ORM entity files */
    models: string[];
    /** TypeScript interfaces / types / Zod schemas / Pydantic models */
    types: string[];
    /** Config, settings, env-example files */
    config: string[];
    /** HTTP clients, SDK wrappers, external integration files */
    clients: string[];
  };
  /** Low-signal files to skip (tests, generated code, utilities) */
  skipFiles: string[];
  /** Approximate number of high-signal files */
  estimatedSignalFiles: number;
  /** Total files in the service directory */
  totalFiles: number;
}

/**
 * ServiceSkeleton – structured high-level analysis from priority files only.
 *
 * Produced by the ServiceSkeletonExtractor agent (Pass 1) reading only the
 * entry/routes/models/types/config files identified in the ServiceFileMap.
 * Replaces the output of the old ServiceAnalyzer for the skeleton pass and
 * feeds into both surface extraction and downstream agents.
 *
 * Classification: INTERNAL — no secret values.
 */
export interface ServiceSkeleton {
  /** 1–3 sentence business-oriented description */
  serviceDescription: string;
  /** Why this service exists and who benefits */
  businessValue: string;
  /** Primary entry point types: 'http' | 'queue' | 'cron' | 'cli' | 'other' */
  entryPointTypes: string[];
  /** Dominant architectural patterns, e.g. ['REST API', 'Event-driven'] */
  architecturalPatterns: string[];
  /** Runtime technology stack, e.g. ['Node.js', 'Express', 'TypeScript', 'Prisma'] */
  techStack: string[];
  /** Exposed HTTP endpoints with method, path, and source file */
  exposedEndpoints: Array<{ method: string; path: string; file: string }>;
  /** Domain model names, e.g. ['User', 'Session', 'Payment'] */
  dataModels: string[];
  /** Names of internal sibling services this service calls or depends on */
  internalDependencies: string[];
}

/**
 * ServiceExternalSurface – exhaustive enumeration of the service's external boundary.
 *
 * Produced by the ServiceSurfaceExtractor agent (Pass 2) reading only
 * config and client files identified in the ServiceFileMap.
 * Injected as a pre-built trust boundary map into every DFD agent so they
 * do not re-discover identity providers and data stores.
 *
 * Classification: INTERNAL — no secret values, only key names and import paths.
 */
export interface ServiceExternalSurface {
  /** Exhaustively detected external dependencies with typed evidence */
  externalDeps: ExternalDep[];
  /** Pre-built trust boundary map grouping dep names by boundary type */
  trustBoundaryMap: {
    IDENTITY: string[];
    DATA: string[];
    EXTERNAL: string[];
    INTERNET: string[];
    SERVICE: string[];
  };
}

/**
 * RepositoryBriefing – a concise structured overview of the entire repository.
 *
 * Produced once per indexing run (before per-service analysis) and passed as
 * shared context to every downstream agent so they start with a consistent
 * understanding of the repository's purpose and structure.
 *
 * Classification: INTERNAL — no secret values may appear in any field.
 */
export interface RepositoryBriefing {
  /** 1–3 sentence description of what the repository delivers end-to-end */
  summary: string;
  /** Primary programming languages used, e.g. ['TypeScript', 'Python'] */
  languages: string[];
  /** Dominant frameworks and runtimes, e.g. ['Node.js', 'Express', 'React'] */
  frameworks: string[];
  /** Build / packaging tools found, e.g. ['pnpm', 'docker', 'webpack'] */
  buildTools: string[];
  /** High-level repository structure description (monorepo layout, package names, etc.) */
  structure: string;
  /** Names of services discovered in this repository */
  serviceNames: string[];
  /** Deployment targets / cloud providers detected, e.g. ['Azure Container Apps', 'Docker'] */
  deploymentTargets: string[];
  /** Notable architectural patterns at repository level, e.g. ['Monorepo', 'Microservices', 'Event-driven'] */
  architecturalPatterns: string[];
}

/**
 * ServiceDependencyMap – deterministically extracted structural dependency facts.
 *
 * Produced by the StaticDependencyExtractor (pure regex, no LLM).
 * Classification: INTERNAL — contains only names/paths, no secret values.
 */
export interface ServiceDependencyMap {
  /** HTTP routes this service exposes: { method, path, file } */
  exposedApis: Array<{ method: string; path: string; file: string }>;

  /** Outbound HTTP calls made by this service */
  calledApis: Array<{
    /** Raw host or env-var reference, e.g. "USER_SERVICE_URL", "api.stripe.com" */
    target: string;
    /** HTTP method if determinable, else null */
    method: string | null;
    /** Path template if determinable, e.g. "/users/:id" */
    path: string | null;
    /** Source file where call was found */
    file: string;
  }>;

  /** Database connections + referenced table/collection names */
  databases: Array<{
    /** DB type: 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'sqlite' | 'neo4j' | 'other' */
    type: string;
    /** How the connection was identified, e.g. env var name or import */
    connectionEvidence: string;
    /** Table or collection names referenced in queries */
    tableNames: string[];
    /** Source file */
    file: string;
  }>;

  /** Storage buckets / containers / prefixes accessed */
  storageAccess: Array<{
    /** 's3' | 'azure-blob' | 'gcs' | 'other' */
    provider: string;
    /** Bucket/container name or env-var reference */
    bucket: string;
    /** 'read' | 'write' | 'readwrite' */
    access: 'read' | 'write' | 'readwrite';
    file: string;
  }>;

  /** Message queues / topics produced or consumed */
  queues: Array<{
    /** Queue or topic name (literal string or env-var reference) */
    name: string;
    /** 'producer' | 'consumer' | 'both' */
    role: 'producer' | 'consumer' | 'both';
    /** 'sqs' | 'rabbitmq' | 'kafka' | 'azure-servicebus' | 'redis-pubsub' | 'other' */
    technology: string;
    file: string;
  }>;

  /** Confidence of this extraction */
  confidence: 'deterministic' | 'heuristic';
  /** ISO timestamp */
  extractedAt: string;
}

/**
 * CodeService - A deployable service (API, worker, library, etc.)
 */
export interface CodeService extends BaseEntity {
  entityType: 'code_service';
  serviceType: 'api' | 'library' | 'worker' | 'other';
  name: string;
  codePath: string; // Path within repository
  repositoryId: EntityId;
  language: string;
  techStack?: string[]; // e.g., ['express', 'typescript', 'postgresql']
  dependencies?: string[]; // External dependencies
  responsibility?: string; // LLM-generated description (for embedding)
  /** External dependencies outside the internal trust boundary (LLM-extracted) */
  externalDeps?: ExternalDep[];
  /**
   * Structured service analysis produced by ServiceAnalyzer (SRE Step 1).
   * Contains code structure, tech stack, external/internal deps, business value.
   * Classification: INTERNAL — no secret values.
   */
  serviceAnalysis?: ServiceAnalysis;
  /**
   * File classification map produced by ServiceFileMapper (Pass 0).
   * Acts as the reading list for all downstream agents.
   * Classification: INTERNAL — file paths only, no secrets.
   */
  serviceFileMap?: ServiceFileMap;
  /**
   * Structural skeleton produced by ServiceSkeletonExtractor (Pass 1).
   * Covers endpoints, models, patterns, tech stack from priority files only.
   * Classification: INTERNAL — no secret values.
   */
  serviceSkeleton?: ServiceSkeleton;
  /**
   * External surface enumeration produced by ServiceSurfaceExtractor (Pass 2).
   * Pre-built trust boundary map for DFD agents.
   * Classification: INTERNAL — key names and import paths only, no secrets.
   */
  serviceExternalSurface?: ServiceExternalSurface;
  // Threat model fields
  threatModel?: ThreatModelData;
  /**
   * Service-level Data Flow Diagram: merged from all feature DFDs.
   * Populated by the BusinessFeatureExtractor after all per-feature DFDs are produced.
   * Classification: INTERNAL — no secret values may appear.
   */
  serviceDfd?: import('./business-feature.types').ServiceDfd;
  /**
   * Service-level STRIDE threat model, based on the service-level DFD.
   * Replaces per-feature threat models for the holistic security posture.
   * Classification: INTERNAL — no secret values may appear.
   */
  serviceThreatModel?: import('./business-feature.types').ServiceThreatModel;
  /**
   * Exploitability analysis result for each identified threat.
   * Populated by Step 8 of the ServiceRelationshipsExtractor pipeline.
   * Severities are adjusted based on graph-traversal reachability.
   * Classification: INTERNAL — no secret values may appear.
   */
  exploitabilityAnalysis?: ServiceExploitabilityAnalysis;
  /**
   * Deterministically extracted structural dependency facts.
   * Produced by the StaticDependencyExtractor (pure regex, no LLM).
   * Classification: INTERNAL — contains only names/paths, no secret values.
   */
  serviceDependencyMap?: ServiceDependencyMap;
}

/**
 * CodeModule - A module/file within a service
 */
export interface CodeModule extends BaseEntity {
  entityType: 'code_module';
  name: string;
  codePath: string; // File path within repository
  serviceId: EntityId;
  repositoryId: EntityId;
  language: string;
  dependencies?: string[]; // Import/require statements
  responsibility?: string; // LLM-generated description
  isEntryPoint: boolean;
  entryType?: 'http' | 'queue' | 'cron' | 'cli' | 'other';
}

/**
 * BuildArtifactServiceRef – a code service that a build artifact produces.
 *
 * Security: `evidence` must only contain key names / config references — never
 * actual secret values. The BuildArtifactAnalysisCompletionTool enforces this.
 */
export interface BuildArtifactServiceRef {
  /** Name of the service this build artifact produces, as it appears in the build file */
  name: string;
  /** Output image name or package name, if visible */
  outputName?: string;
  /** Runtime technology / base image, e.g. "node:20-alpine", "python:3.11-slim" */
  runtime?: string;
  /** File location / config key that proves this ref — NO secret values */
  evidence?: string;
}

/**
 * BuildArtifactAnalysis – structured knowledge extracted from a build artifact file.
 *
 * Populated during the Build Artifact Analysis step of ServiceRelationshipsExtractor
 * and stored on the entity so downstream steps can reuse it without re-reading.
 *
 * Security classification: INTERNAL — no secret values may appear in any field.
 */
export interface BuildArtifactAnalysis {
  /** Services (code) that this build artifact produces */
  producedServices: BuildArtifactServiceRef[];
  /** Build technology / tool used, e.g. "Docker multi-stage", "pnpm build", "Maven" */
  buildTechnology: string;
  /** Target runtime / base image for the produced artifact */
  targetRuntime?: string;
  /**
   * Notable build optimizations or patterns observed, e.g.
   * "Multi-stage build", "Layer caching via COPY package.json first", "BuildKit secrets".
   */
  buildPatterns: string[];
  /** Free-text summary of what this build artifact does */
  summary: string;
}

/**
 * BuildArtifact - A build configuration (Dockerfile, etc.)
 */
export interface BuildArtifact extends BaseEntity {
  entityType: 'build_artifact';
  buildType: 'docker' | 'npm' | 'maven' | 'gradle' | 'script' | 'other';
  name: string;
  codePath: string; // Path to build file (e.g., Dockerfile)
  repositoryId: EntityId;
  serviceIds: EntityId[]; // Services this build produces
  technology: 'python' | 'node' | 'go' | 'java' | 'rust' | 'other';
  /** Script language if buildType === 'script' (e.g. 'github-actions', 'azure-pipelines', 'makefile', 'bash') */
  scriptLanguage?: string;
  responsibility?: string; // LLM-generated description
  /** Structured build artifact analysis extracted by ServiceRelationshipsExtractor */
  buildArtifactAnalysis?: BuildArtifactAnalysis;
}

/**
 * IaCResourceRef – a cloud resource that an IaC file either deploys or references.
 *
 * Security: `evidence` must only contain key names / config references — never
 * actual secret values. The IaCAnalysisCompletionTool enforces this.
 */
export interface IaCResourceRef {
  /** Logical / display name of the resource (e.g. "api-container-app", "my-redis-cache") */
  name: string;
  /**
   * Category of the resource.
   * compute   – App Service, Container App, ECS task, VM, Function App, etc.
   * database  – SQL, Cosmos DB, RDS, Firestore, etc.
   * storage   – Blob / S3 / GCS bucket
   * cache     – Redis, ElastiCache, Memorystore
   * queue     – Service Bus, SQS, Pub/Sub
   * network   – VNet, VPC, DNS, load balancer, API Gateway
   * identity  – Managed Identity, IAM role, Key Vault
   * registry  – Container / artifact registry
   * other     – Anything else
   */
  resourceType: 'compute' | 'database' | 'storage' | 'cache' | 'queue' | 'network' | 'identity' | 'registry' | 'other';
  /** Cloud provider inferred from file syntax / CLI commands */
  cloudProvider?: 'aws' | 'azure' | 'gcp' | 'other';
  /**
   * Naming-convention pattern observed for this resource class, e.g.
   * "{env}-api-ca", "myapp-{service}-db".  Useful for fuzzy-matching against
   * CloudResource names discovered from the live cloud.
   */
  namingPattern?: string;
  /** File location / config key that proves this reference — NO secret values */
  evidence?: string;
}

/**
 * IaCServiceRef – a code service that the IaC file deploys.
 */
export interface IaCServiceRef {
  /** Name matching CodeService.name or the container/service name in the file */
  name: string;
  /** Container image name or Helm release name, if visible */
  imageName?: string;
  /** File location / config key proving this — NO secret values */
  evidence?: string;
}

/**
 * IaCAnalysis – structured knowledge extracted from a deployment artifact file.
 *
 * Populated during Step 0 of ServiceRelationshipsExtractor and stored on the
 * entity so later correlation steps (2, 3, 4) can reuse it without re-reading.
 *
 * Security classification: INTERNAL — no secret values may appear in any field.
 */
export interface IaCAnalysis {
  /** Services (code) that this IaC deploys */
  deployedServices: IaCServiceRef[];
  /** Cloud resources that this IaC creates / provisions */
  deployedResources: IaCResourceRef[];
  /** Cloud resources that this IaC only references / configures (does not create) */
  usedResources: IaCResourceRef[];
  /**
   * Cross-cutting naming-convention rules observed in this file.
   * E.g. "Resources are prefixed with the environment name followed by a dash."
   */
  namingConventions: string[];
  /** Free-text summary of what this IaC file does */
  summary: string;
  /**
   * Deployment target scope extracted deterministically from the IaC/script.
   * Used by scope-resolver to filter cloud resources before LLM correlation.
   */
  deploymentTargets?: {
    resourceGroups?: string[];
    subscriptionIds?: string[];
    regions?: string[];
  };
}

/**
 * ScriptAnalysisServiceRef – a service produced or deployed by a script.
 * Security: evidence must only contain key names / config references — never actual secret values.
 */
export interface ScriptAnalysisServiceRef {
  /** Service / image name extracted from CLI flags (-t, --name, etc.) */
  name: string;
  /** Full image reference (build output), e.g. "myregistry.azurecr.io/payments-api:$VERSION" */
  outputName?: string;
  /** Build context directory path (build scripts) */
  sourceDirectory?: string;
  /** Image name from --image flag (deployment scripts) */
  imageName?: string;
  /** CLI argument or script line proving this — NO secret values */
  evidence?: string;
}

/**
 * ScriptAnalysis – structured knowledge extracted from an imperative build or deployment script.
 *
 * Produced by ScriptAnalyzerAgent (Step 0.5). After production it is normalised
 * into IaCAnalysis (for deployment scripts) and BuildArtifactAnalysis (for build scripts)
 * so that Steps 1–6 correlators work identically to declarative artifacts.
 *
 * Security classification: INTERNAL — no secret values may appear in any field.
 */
export interface ScriptAnalysis {
  // ── Build side ────────────────────────────────────────────────────────────
  /** Services produced by this script (image builds, package builds) */
  producedServices: ScriptAnalysisServiceRef[];
  /** Build technology used, e.g. "docker build", "npm run build", "cargo build" */
  buildTechnology?: string;
  /** Target runtime, e.g. "node:20-alpine" */
  targetRuntime?: string;
  /** Notable build patterns, e.g. ["multi-stage", "layer caching"] */
  buildPatterns: string[];

  // ── Deployment side ───────────────────────────────────────────────────────
  /** Services deployed by this script (az containerapp update --name …) */
  deployedServices: ScriptAnalysisServiceRef[];
  /** Cloud resources created by this script */
  deployedResources: IaCResourceRef[];
  /** Cloud resources referenced but not created */
  usedResources: IaCResourceRef[];
  /** Deployment target scope extracted from CLI arguments */
  deploymentTargets: {
    resourceGroups?: string[];
    subscriptionIds?: string[];
    regions?: string[];
  };
  /** Naming patterns across extracted names */
  namingConventions: string[];

  /** One-paragraph summary */
  summary: string;
}

/**
 * DeploymentArtifact - An IaC/deployment configuration
 */
export interface DeploymentArtifact extends BaseEntity {
  entityType: 'deployment_artifact';
  deploymentType: 'kubernetes' | 'terraform' | 'cloudformation' | 'bicep' | 'docker-compose' | 'helm' | 'script' | 'other';
  name: string;
  codePath: string; // Path to deployment file
  repositoryId: EntityId;
  technology: 'yaml' | 'json' | 'hcl' | 'bicep' | 'bash' | 'powershell' | 'other';
  serviceIds: EntityId[]; // Services this deployment deploys
  responsibility?: string; // LLM-generated description
  /** Structured IaC analysis extracted by ServiceRelationshipsExtractor Step 0 */
  iacAnalysis?: IaCAnalysis;
}

/**
 * CloudResource - A cloud infrastructure resource
 */
export interface CloudResource extends BaseEntity {
  entityType: 'cloud_resource';
  resourceType: 'compute' | 'database' | 'storage' | 'network' | 'queue' | 'cache' | 'other' | string;
  cloudProvider: 'aws' | 'azure' | 'gcp' | 'other';
  name: string;
  resourceId?: string; // Cloud provider's resource identifier
  region?: string;
  responsibility?: string; // LLM-generated description
  // ── Scope fields (populated by AzureResourceGraphConnector) ──────────────
  /** Parsed from ARM resource ID, e.g. "a1b2c3d4-…" */
  subscriptionId?: string;
  /** Resource group name (lower-cased for case-insensitive matching) */
  resourceGroup?: string;
  /** From tags["environment"] or tags["env"], e.g. "prod", "staging" */
  environment?: string;
  /** From tags["app"] or tags["application"] */
  appTag?: string;
  // Threat model fields
  threatModel?: ThreatModelData;
}

// ============================================================================
// Cloud Identity Entities
// ============================================================================

/**
 * The type of Azure managed identity or principal
 */
export type AzureIdentityKind =
  | 'system_assigned'    // System-assigned managed identity on a resource
  | 'user_assigned'      // User-assigned managed identity (standalone resource)
  | 'service_principal'  // Enterprise application / service principal
  | 'other';

/**
 * AzureIdentity - An Azure managed identity or service principal.
 *
 * System-assigned identities are synthetic entities derived from a parent
 * CloudResource. User-assigned identities correspond to a real ARM resource
 * (Microsoft.ManagedIdentity/userAssignedIdentities).
 */
export interface AzureIdentity extends BaseEntity {
  entityType: 'azure_identity';
  identityKind: AzureIdentityKind;
  /** Display name (e.g. "batta-api" for a system-assigned identity) */
  name: string;
  /** Azure Object ID (principalId) – globally unique across AAD */
  principalId?: string;
  /** Azure Application / Client ID (clientId) */
  clientId?: string;
  /** ARM resource ID of the parent resource (system-assigned) or the
   *  identity resource itself (user-assigned) */
  resourceId?: string;
  cloudProvider: 'azure';
  region?: string;
}

/**
 * IamRoleAssignment - Represents an Azure RBAC role assignment:
 * "which identity has which role on which scope".
 *
 * Persisted as a first-class entity so it can be queried independently
 * from the graph relationship. The graph relationship
 * (Identity) -[HAS_ROLE]-> (CloudResource | AzureIdentity) carries the
 * role name in metadata.
 */
export interface IamRoleAssignment extends BaseEntity {
  entityType: 'iam_role_assignment';
  /** Azure role assignment ID (ARM resource id) */
  roleAssignmentId: string;
  /** The canonical role definition name (e.g. "Contributor", "AcrPull") */
  roleName: string;
  /** Role Definition ID (/providers/Microsoft.Authorization/roleDefinitions/…) */
  roleDefinitionId?: string;
  /** ARM resource ID of the scope (subscription, resource group, or resource) */
  scope: string;
  /** principalId of the grantee */
  principalId: string;
  /** AAD principal type: User | Group | ServicePrincipal | ForeignGroup | Device */
  principalType?: string;
}

/**
 * ThreatModelData - Security and threat model information
 */
export interface ThreatModelData {
  // Exposure and boundaries
  internetExposed?: boolean; // Whether the resource is exposed to the internet
  publicEndpoint?: string; // Public endpoint URL if internet-exposed
  trustBoundaries?: TrustBoundary[]; // Trust boundaries this resource crosses
  
  // Network security
  networkAccess?: NetworkAccessInfo;
  
  // Authentication and authorization
  authenticationMethod?: string; // e.g., 'api-key', 'oauth', 'managed-identity', 'none'
  authorizationModel?: string; // e.g., 'rbac', 'abac', 'acl', 'none'
  identityProviders?: string[]; // Identity providers used
  
  // Data classification
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
  dataAtRest?: DataProtection; // Encryption at rest
  dataInTransit?: DataProtection; // Encryption in transit
  sensitiveDataTypes?: string[]; // e.g., ['PII', 'PHI', 'PCI', 'credentials']
  
  // Security controls
  securityControls?: SecurityControl[];
  
  // Entry points and attack surface
  entryPoints?: EntryPoint[];
  attackSurface?: AttackSurface;
  
  // Privileges and permissions
  privilegeLevel?: 'admin' | 'elevated' | 'user' | 'service' | 'none';
  effectivePermissions?: string[];
  
  // External connections
  externalConnections?: ExternalConnection[];
  
  // Threats
  identifiedThreats?: Threat[];
  riskScore?: number; // 0-100 risk score
  complianceRequirements?: string[]; // e.g., ['GDPR', 'HIPAA', 'PCI-DSS']
  
  // MITRE ATT&CK
  mitreAttackTactics?: string[]; // e.g., ['TA0001', 'TA0002']
  mitreAttackTechniques?: string[]; // e.g., ['T1078', 'T1190']
  
  // Metadata
  lastAssessment?: string; // ISO 8601 timestamp
  assessmentMethod?: 'manual' | 'automated' | 'llm';
}

/**
 * The five canonical trust boundary types.
 *
 * INTERNET  – boundary between public internet clients and the system.
 * IDENTITY  – boundary where authentication / identity validation occurs.
 * SERVICE   – boundary between internal microservices with separate permissions.
 * DATA      – boundary when accessing persistent storage.
 * EXTERNAL  – boundary when calling third-party / SaaS services outside our control.
 */
export type TrustBoundaryType = 'INTERNET' | 'IDENTITY' | 'SERVICE' | 'DATA' | 'EXTERNAL';

export interface TrustBoundary {
  name: string; // e.g., 'Internet', 'Corporate Network', 'VNet', 'Private Subnet'
  type: TrustBoundaryType;
  description?: string;
}

export interface NetworkAccessInfo {
  allowedSources?: string[]; // CIDRs or service tags
  allowedPorts?: number[];
  protocols?: string[]; // e.g., ['https', 'ssh', 'rdp']
  firewallEnabled?: boolean;
  nsgRules?: string[]; // Network Security Group rules
}

export interface DataProtection {
  enabled: boolean;
  method?: string; // e.g., 'AES-256', 'TLS 1.2', 'Customer Managed Keys'
  keyManagement?: string; // e.g., 'Azure Key Vault', 'AWS KMS'
}

export interface SecurityControl {
  id: string;
  type: 'preventive' | 'detective' | 'corrective' | 'deterrent';
  name: string;
  description?: string;
  implemented: boolean;
  effectiveness?: 'high' | 'medium' | 'low';
}

export interface EntryPoint {
  type: 'http' | 'queue' | 'cron' | 'cli' | 'sdk' | 'other';
  path?: string; // e.g., "/api/v1/users"
  method?: string; // e.g., "GET", "POST"
  isPublic: boolean;
  authenticationRequired: boolean;
}

export interface AttackSurface {
  publicEndpoints: number;
  privateEndpoints: number;
  externalDependencies: number;
  privilegedOperations: number;
  dataFlows: {
    inbound: number;
    outbound: number;
  };
}

export interface ExternalConnection {
  target: string; // Endpoint or service name
  protocol: string; // e.g., 'https', 'mqtt', 'amqp'
  purpose: string; // e.g., 'payment processing', 'email delivery'
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
  encrypted: boolean;
}

// ThreatSeverity lives in business-feature.types; import for local use and re-export.
import type { ThreatSeverity } from './business-feature.types';
export type { ThreatSeverity };

export interface AttackPathHop {
  entityId: string;
  entityLabel: string;
  entityType: string;
  relationshipType: string;
  isWeakLink: boolean;       // unencrypted, unauthenticated, or internet-exposed hop
  weaknessReason?: string;   // e.g. "unencrypted CONNECTS_TO", "no auth on HTTP entry"
}

export interface AttackPath {
  id: string;                // deterministic hash of hop sequence
  threatId: string;
  entryPoint: string;        // entity ID where the attacker starts
  target: string;            // entity ID where the threat is realized
  hops: AttackPathHop[];
  feasibilityScore: number;  // 0–100, higher = easier to exploit
  controlsBlocking: string[];
}

export interface MitigationRecommendation {
  id: string;               // e.g. 'MIT-1'
  title: string;            // Short action title
  description: string;      // Why this matters given the attack path
  priority: 'immediate' | 'short-term' | 'long-term';
  blocksAttackPath: boolean; // Does this directly break the attack path?
  targetComponent?: string;  // Which hop / component to fix
}

export interface ExploitabilityResult {
  threatId: string;
  isExploitable: boolean;
  confidence: 'high' | 'medium' | 'low';
  originalSeverity: ThreatSeverity;
  adjustedSeverity: ThreatSeverity;
  adjustmentReason: string;
  attackPaths: AttackPath[];
  exploitationNarrative: string;           // Markdown: step-by-step in this deployment
  prerequisites: string[];
  detectionOpportunities: string[];
  /** Actionable mitigations informed by the attack path (exploitable threats) */
  mitigationRecommendations: MitigationRecommendation[];
  /** For non-exploitable threats: which controls/topology factors block exploitation */
  notExploitableReason?: string;
  analyzedAt: string;                      // ISO 8601
}

export interface ServiceExploitabilityAnalysis {
  results: ExploitabilityResult[];
  analyzedAt: string;
  adjustedRiskScore: number;        // recomputed from adjusted severities
}

export interface Threat {
  id: string; // e.g., 'STRIDE-T1', 'OWASP-A01'
  category: 'spoofing' | 'tampering' | 'repudiation' | 'information-disclosure' | 'denial-of-service' | 'elevation-of-privilege' | 'other';
  description: string;
  severity: ThreatSeverity;
  mitigations?: string[];
  status: 'identified' | 'mitigated' | 'accepted' | 'transferred';
  exploitability?: ExploitabilityResult;
}

/**
 * Dependency - An external or internal dependency
 */
export interface Dependency extends BaseEntity {
  entityType: 'dependency';
  name: string;
  version: string;
  versionConstraint?: string; // e.g., "^1.0.0", ">=2.0.0"
  packageManager: 'npm' | 'pip' | 'maven' | 'cargo' | 'go-mod' | 'other';
  isDev: boolean;
  isTransitive: boolean;
}

// ============================================================================
// Security Entities
// ============================================================================

/**
 * Identity - A user, role, service account, or API key
 */
export interface Identity extends BaseEntity {
  entityType: 'identity';
  identityType: 'user' | 'service_account' | 'role' | 'api_key' | 'managed_identity' | 'other';
  name: string;
  provider: 'aws' | 'azure' | 'gcp' | 'github' | 'local' | 'other';
  principalId?: string; // Cloud provider's principal ID
  permissions?: string[]; // Effective permissions
  scope?: string; // Scope of permissions (subscription, resource group, etc.)
  threatModel?: ThreatModelData;
}

/**
 * Describes how a single service accesses a data store.
 */
export interface DataStoreServiceAccess {
  serviceId: EntityId;
  serviceName: string;
  /** Aggregate access direction across all features */
  accessPattern: 'read' | 'write' | 'read_write';
  /** Data types this service reads from / writes to the store */
  dataTypes: string[];
  /** Table / collection / bucket names referenced by this service */
  resourceNames?: string[];
  /** Feature IDs (of BusinessFeature) where this service-store interaction appears */
  featureIds: EntityId[];
  /** How this access was detected */
  evidence: 'dfd' | 'static_analysis' | 'both';
}

/**
 * DataStore - A database, storage, or data repository (first-class indexed entity)
 */
export interface DataStore extends BaseEntity {
  entityType: 'data_store';
  /** Logical category of the store */
  storeType: 'database' | 'cache' | 'blob_storage' | 'queue' | 'file_system' | 'other';
  /** Human-readable logical name, e.g. "Neo4j Graph DB", "Redis Session Cache" */
  name: string;
  /** Technology, e.g. "postgresql", "redis", "neo4j", "azure-blob" */
  technology?: string;
  /** Highest data-classification label across all stored data */
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
  /** Is data encrypted at rest? */
  encryptionAtRest?: boolean;
  /** Is data encrypted in transit? */
  encryptionInTransit?: boolean;
  /** Reference to a CloudResource entity if this store is a managed cloud service */
  cloudResourceId?: EntityId;
  /** Short display name of the linked cloud resource (denormalized for list views) */
  cloudResourceName?: string;
  /** All service-level access records for this store */
  serviceAccess: DataStoreServiceAccess[];
  /** Aggregate list of all distinct data types that flow through this store */
  dataTypes: string[];
  /** IDs of BusinessFeature entities that include this store in their DFD */
  featureIds: EntityId[];
  /** Short names of the linked features (denormalized) */
  featureNames?: string[];
  /** LLM-generated one-paragraph description of the store's purpose */
  responsibility?: string;
  threatModel?: ThreatModelData;
}

/**
 * APIEndpoint - A public or internal API endpoint
 */
export interface APIEndpoint extends BaseEntity {
  entityType: 'api_endpoint';
  path: string; // e.g., "/api/v1/users"
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | 'ALL';
  serviceId: EntityId; // Service that hosts this endpoint
  cloudResourceId?: EntityId; // Cloud resource (API Gateway, App Service, etc.)
  isPublic: boolean;
  authenticationRequired: boolean;
  authenticationMethod?: string;
  authorizationModel?: string;
  rateLimit?: {
    requests: number;
    window: string; // e.g., "1m", "1h"
  };
  threatModel?: ThreatModelData;
}

/**
 * ExternalDependency - An external service or API
 */
export interface ExternalDependency extends BaseEntity {
  entityType: 'external_dependency';
  name: string;
  type: 'api' | 'sdk' | 'database' | 'queue' | 'storage' | 'other';
  endpoint?: string; // URL or connection string (sanitized)
  protocol?: string; // e.g., 'https', 'mqtt', 'amqp'
  provider?: string; // e.g., 'stripe', 'sendgrid', 'aws-s3'
  isThirdParty: boolean; // External to organization
  dataFlow?: 'inbound' | 'outbound' | 'bidirectional';
  threatModel?: ThreatModelData;
}

/**
 * NetworkSegment - A network boundary or segment (VPC, VNet, subnet, etc.)
 */
export interface NetworkSegment extends BaseEntity {
  entityType: 'network_segment';
  segmentType: 'vpc' | 'vnet' | 'subnet' | 'security_group' | 'nsg' | 'firewall' | 'other';
  name: string;
  cloudProvider?: 'aws' | 'azure' | 'gcp' | 'other';
  cidr?: string; // Network CIDR block
  isPublic: boolean; // Public or private network
  allowedInbound?: string[]; // Allowed inbound rules (ports, protocols, sources)
  allowedOutbound?: string[]; // Allowed outbound rules
  threatModel?: ThreatModelData;
}

/**
 * TrustBoundary - A logical security boundary
 */
export interface TrustBoundaryEntity extends BaseEntity {
  entityType: 'trust_boundary';
  name: string;
  boundaryType: TrustBoundaryType;
  description?: string;
  controlsInPlace?: string[]; // Security controls at this boundary
  threatModel?: ThreatModelData;
}

/**
 * Commit - A git commit
 */
export interface Commit extends BaseEntity {
  entityType: 'commit';
  sha: string;
  repository: string;
  branch: string;
  author: string;
  authorEmail: string;
  message: string;
  timestamp: Timestamp;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

// Legacy types - kept for backward compatibility
export interface CodeArtifact extends BaseEntity {
  entityType: 'code_artifact';
  artifactType: 'repository' | 'directory' | 'file' | 'function' | 'class';
  name: string;
  path: string;
  repository: string;
  branch: string;
  commitSha?: string;
  language?: string;
  contentHash?: string;
}

export interface CodeComponent extends BaseEntity {
  entityType: 'code_component';
  componentType: 'service' | 'library' | 'module' | 'package';
  name: string;
  version?: string;
  language: string;
  framework?: string;
  entryPoints: string[];
  repositoryId: EntityId;
}

/**
 * Union type of all entities
 */
export type CanonicalEntity = 
  | CodeRepository 
  | CodeService 
  | CodeModule 
  | BuildArtifact 
  | DeploymentArtifact 
  | CloudResource
  | AzureIdentity
  | IamRoleAssignment
  | Dependency 
  | Identity
  | DataStore
  | APIEndpoint
  | ExternalDependency
  | NetworkSegment
  | TrustBoundaryEntity
  | Commit
  | CodeArtifact  // Legacy
  | CodeComponent; // Legacy

// ============================================================================
// Relationships
// ============================================================================

export type RelationshipType =
  | 'CONTAINS' // Repository contains service, service contains module, etc.
  | 'DEPENDS_ON' // Service/Module depends on dependency, Service depends on another Service
  | 'IMPLEMENTS' // Component implements interface/contract
  | 'CALLS' // Function calls another function
  | 'MODIFIED_BY' // Artifact modified by commit
  | 'DEPLOYED_TO' // Service deployed to CloudResource
  | 'OWNS' // Team owns component
  | 'USES' // Component uses CloudResource
  | 'BUILDS' // BuildArtifact builds Service
  | 'DEPLOYS' // DeploymentArtifact deploys Service or CloudResource
  | 'IMPORTS' // Module imports another module
  // Security-specific relationships
  | 'CONNECTS_TO' // Network connection between services
  | 'EXPOSED_TO_INTERNET' // Resource exposed to internet
  | 'ASSUMES_ROLE' // Identity assumes role/permissions
  | 'READS_FROM' // Service reads data from resource
  | 'WRITES_TO' // Service writes data to resource
  | 'TRUSTS' // Trust relationship between boundaries
  | 'AUTHENTICATES_WITH' // Authentication mechanism
  | 'AUTHORIZES_WITH' // Authorization mechanism
  | 'CROSSES_BOUNDARY' // Crosses a trust boundary
  | 'IMPLEMENTS_FEATURE' // CodeService implements a BusinessFeature
  // IAM / Identity relationships
  | 'ASSIGNED_TO'  // AzureIdentity is assigned (attached) to a CloudResource
  | 'HAS_ROLE'     // AzureIdentity has an RBAC role on a CloudResource / scope
  | 'CALLS_API'    // CodeService calls a specific endpoint on another CodeService
  // Dependency graph relationship types (from ExternalDep correlation)
  | 'CALLS_SERVICE'   // Service-level: consumer → provider (any endpoint)
  | 'SUBSCRIBES_TO'   // Queue consumer → CloudResource (queue/topic)
  | 'PUBLISHES_TO'    // Queue producer → CloudResource (queue/topic)
  | 'READS_STORAGE'   // Blob/file storage read → CloudResource
  | 'WRITES_STORAGE'  // Blob/file storage write → CloudResource
  // Cloud Graph — ingress topology (cloud-graph.types.ts)
  | 'ROUTES_TO'         // INTERNET → FrontDoorProfile; TM profile → TM endpoint
  | 'HAS_ENDPOINT'      // FrontDoorProfile → FrontDoorEndpoint
  | 'HAS_ROUTE'         // FrontDoorEndpoint → FrontDoorRoute
  | 'HAS_ORIGIN_GROUP'  // FrontDoorProfile → FrontDoorOriginGroup
  | 'HAS_ORIGIN'        // FrontDoorOriginGroup → FrontDoorOrigin
  | 'EXPOSES_API'       // APIManagementService → APIMApi
  | 'HAS_BACKEND'       // APIMApi → APIMBackend
  | 'RESOLVES_TO'       // FrontDoorOrigin / TM endpoint / APIMBackend → Compute
  // Cloud Graph — network topology
  | 'PEERED_WITH'           // VirtualNetwork ↔ VirtualNetwork
  | 'PROTECTED_BY'          // Subnet → NetworkSecurityGroup
  | 'HAS_PRIVATE_ENDPOINT'  // PaaS resource → PrivateEndpoint
  | 'HAS_SERVICE_ENDPOINT'  // Subnet → service type string
  | 'DEPLOYED_IN'           // Compute → Subnet
  | 'EXPOSED_VIA'           // Compute → PublicIpAddress
  | 'HAS_FIREWALL_RULE'     // PaaS resource → FirewallRule (inline metadata)
  | 'ACCESSIBLE_FROM'       // PaaS resource → Subnet/CIDR (heuristic)
  // Cloud Graph — identity (replaces ASSIGNED_TO for cloud graph context)
  | 'ASSIGNED_IDENTITY'  // Compute → ManagedIdentity
  // Data Store relationships
  | 'READS_FROM_STORE'    // CodeService → DataStore
  | 'WRITES_TO_STORE'     // CodeService → DataStore
  | 'ACCESSES_STORE'      // CodeService → DataStore (bidirectional shorthand)
  | 'BACKED_BY'           // DataStore → CloudResource
  | 'FEATURE_USES_STORE'  // BusinessFeature → DataStore
  ;

/**
 * Relationship - First-class directional edge between entities
 */
export interface Relationship {
  id: EntityId; // Deterministic: hash(tenantId + type + sourceId + targetId + validFrom)
  tenantId: TenantId;
  type: RelationshipType;
  sourceId: EntityId;
  targetId: EntityId;
  validFrom: Timestamp;
  validTo?: Timestamp; // null = currently valid
  confidence: Confidence;
  metadata: Record<string, any>;
}

// ============================================================================
// Evidence
// ============================================================================

export type EvidenceType =
  | 'git_commit' // Evidence from git history
  | 'manifest_file' // Evidence from package.json, requirements.txt, etc.
  | 'source_code' // Evidence from parsing source code
  | 'config_file' // Evidence from config files
  | 'api_response' // Evidence from API (GitHub, etc.)
  | 'static_analysis' // Evidence from AST/static analysis
  ;

/**
 * Evidence - Append-only fact linking entities/relationships to concrete sources
 */
export interface Evidence {
  id: EntityId; // UUID or content-addressed hash
  tenantId: TenantId;
  evidenceType: EvidenceType;
  subjectId: EntityId; // Entity or Relationship this evidence supports
  subjectType: 'entity' | 'relationship';
  source: {
    type: 'git_blob' | 'git_commit' | 'file' | 'api' | 'computed';
    location: string; // URL, file path, or API endpoint
    contentHash?: string; // Hash of the source content
    retrievedAt: Timestamp;
  };
  extractedFacts: Record<string, any>; // Raw facts extracted from source
  confidence: Confidence;
  createdAt: Timestamp;
  metadata: Record<string, any>;
}

// ============================================================================
// Semantic Documents
// ============================================================================

/**
 * Discriminator for semantic document kinds.
 * Stored as a payload field so searches can be scoped to a specific document type.
 *
 *  code_module    – LLM-generated responsibility for a source file / module
 *  service        – responsibility summary for a CodeService entity
 *  feature        – business value + description + user-stories + data-flow for a BusinessFeature
 */
export type SemanticDocumentType = 'code_module' | 'service' | 'feature';

/**
 * SemanticDocument - LLM-generated description of code intent
 * Cached by input hash, stored separately for vector embeddings
 */
export interface SemanticDocument {
  id: EntityId; // hash(inputHash)
  tenantId: TenantId;
  artifactId: EntityId; // References a CodeArtifact
  inputHash: string; // Hash of inputs (file content, context)
  language: string;
  filePath: string;

  /**
   * Discriminates the kind of semantic document (code_module | service | feature).
   * Allows chat tools to restrict vector searches to a specific domain.
   * Classification: INTERNAL — no secret values.
   */
  documentType?: SemanticDocumentType;

  // Extracted semantic information
  imports?: string[];
  exports?: string[];
  httpEntryPoints?: string[]; // e.g., ["POST /api/pay"]
  responsibility: string; // High-level description of what this code does

  // LLM metadata
  llmModel: string;
  generatedAt: Timestamp;
  
  // For vector store
  embeddingModel?: string;
  embeddingDimensions?: number;
  
  metadata: Record<string, any>;
}

// ============================================================================
// Indexing Run (for idempotency and audit)
// ============================================================================

export interface IndexingRun {
  id: string; // UUID
  tenantId: TenantId;
  runType: 'full' | 'incremental' | 'repair';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Timestamp;
  completedAt?: Timestamp;
  
  // Scope
  scope: {
    repositories?: string[];
    branches?: string[];
    sinceCommit?: string;
  };
  
  // Results
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  evidenceCreated: number;
  semanticDocumentsCreated: number;
  
  errors: Array<{
    timestamp: Timestamp;
    message: string;
    context?: Record<string, any>;
  }>;
  
  metadata: Record<string, any>;
}

// ============================================================================
// Pipeline Output Contract
// ============================================================================

/**
 * IndexingResult - The canonical output of an indexing pipeline
 */
export interface IndexingResult {
  runId: string;
  tenantId: TenantId;
  
  entities: CanonicalEntity[];
  relationships: Relationship[];
  evidence: Evidence[];
  semanticDocuments: SemanticDocument[];
  
  summary: {
    duration: number; // milliseconds
    entitiesDiscovered: number;
    relationshipsDiscovered: number;
    evidenceCreated: number;
    semanticDocumentsCreated: number;
    errors: string[];
    warnings: string[];
  };
}


export interface VulnerabilityQuery {
  packageName: string;
  version?: string; // Optional - if not provided, checks all versions
  vulnerabilityId?: string; // Optional CVE ID
}
