/**
 * Business Feature Threat Modeling Types
 *
 * Defines the schema for business-level feature analysis,
 * data flow diagrams, and STRIDE threat models.
 * Every DFD element carries correlationTags so they can later
 * be resolved to canonical CanonicalEntity IDs in Qdrant / Neo4j.
 */

// ─── Correlation Tags ──────────────────────────────────────────────────────────

/**
 * Allows future automated correlation between DFD nodes and actual
 * CanonicalEntity records indexed in the knowledge base.
 */
export interface CorrelationTag {
  /** The category of entity this tag targets */
  entityType:
    | 'code_service'
    | 'cloud_resource'
    | 'data_store'
    | 'api_endpoint'
    | 'external_dependency'
    | 'identity';
  /** Human-readable keywords used for fuzzy matching (e.g. ['payments-api', 'stripe']) */
  keywords: string[];
  /** Filled-in once a correlation pass resolves this tag to a real entity */
  resolvedEntityId?: string;
}

// ─── Classification & Enum Types ──────────────────────────────────────────────

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * The five canonical trust boundary types.
 *
 * INTERNET  – boundary between public internet clients and the system (e.g. browser → API).
 * IDENTITY  – boundary where authentication / identity validation occurs (e.g. OAuth, SSO, token verification).
 * SERVICE   – boundary between internal microservices with separate permissions or responsibilities.
 * DATA      – boundary when accessing persistent storage (e.g. database, vector DB, object storage).
 * EXTERNAL  – boundary when calling third-party / SaaS services outside our control.
 */
export type TrustBoundaryType = 'INTERNET' | 'IDENTITY' | 'SERVICE' | 'DATA' | 'EXTERNAL';

/** All valid trust boundary type values, used for allow-list validation. */
export const VALID_TRUST_BOUNDARY_TYPES: readonly TrustBoundaryType[] = [
  'INTERNET',
  'IDENTITY',
  'SERVICE',
  'DATA',
  'EXTERNAL',
] as const;

export type ActorType =
  | 'external_user'
  | 'internal_service'
  | 'admin'
  | 'system'
  | 'third_party';

/**
 * Process types for the SERVICE-LEVEL DFD.
 * These represent independently deployable units — never internal modules.
 */
export type ProcessType =
  | 'api_gateway'
  | 'backend_service'
  | 'worker'
  | 'queue'
  | 'scheduler'
  | 'other';

/**
 * Process types for the FEATURE-LEVEL DFD.
 *
 * Per DFD.MD: internal processing stages must be modelled at responsibility level,
 * not at function/implementation level. Each value maps to a distinct responsibility:
 *
 *   entry_point       – the API endpoint, event trigger, or queue consumer that starts the flow.
 *   input_validation  – schema validation, type coercion, sanitisation of incoming data.
 *   authorization     – permission check, policy evaluation, scope/role validation.
 *   business_logic    – the core domain rule applied to the request.
 *   data_access       – reading from or writing to a persistent store (abstracted).
 *   external_call     – an outbound call to an external service or API.
 *   response_builder  – assembles and returns the output (success or error shape).
 *   event_publisher   – publishes a domain event to a queue or stream.
 *   other             – any processing stage that does not fit the above.
 */
export type FeatureProcessType =
  | 'entry_point'
  | 'input_validation'
  | 'authorization'
  | 'business_logic'
  | 'data_access'
  | 'external_call'
  | 'response_builder'
  | 'event_publisher'
  | 'other';

/** All valid feature-level process type values, used for allow-list validation. */
export const VALID_FEATURE_PROCESS_TYPES: readonly FeatureProcessType[] = [
  'entry_point',
  'input_validation',
  'authorization',
  'business_logic',
  'data_access',
  'external_call',
  'response_builder',
  'event_publisher',
  'other',
] as const;

export type DataStoreNodeType =
  | 'database'
  | 'cache'
  | 'blob_storage'
  | 'queue'
  | 'file_system'
  | 'other';

// ─── Data Flow Diagram ────────────────────────────────────────────────────────

export interface DFDActor {
  id: string;
  label: string;
  type: ActorType;
  /** Whether this actor is inside the trust boundary of the system */
  trusted: boolean;
  /**
   * Optional: trust boundary zone this actor lives in.
   * When present, the actor is rendered inside that boundary container in the DFD.
   */
  trustBoundary?: TrustBoundaryType;
  correlationTags: CorrelationTag[];
}

export interface DFDProcess {
  id: string;
  label: string;
  /**
   * For service-level DFDs: use ProcessType (deployable service granularity).
   * For feature-level DFDs: use FeatureProcessType (responsibility-level stages).
   * Both union types are accepted here so a single DataFlowDiagram interface serves both DFD kinds.
   */
  type: ProcessType | FeatureProcessType;
  /** Trust boundary zone this process lives in */
  trustBoundary?: TrustBoundaryType;
  correlationTags: CorrelationTag[];
}

export interface DFDDataStore {
  id: string;
  label: string;
  type: DataStoreNodeType;
  dataClassification: DataClassification;
  /** Whether data is encrypted at rest */
  encryptionAtRest: boolean;
  /**
   * Optional: trust boundary zone this data store lives in.
   * When present, the store is rendered inside that boundary container in the DFD.
   */
  trustBoundary?: TrustBoundaryType;
  correlationTags: CorrelationTag[];
}

export interface DFDFlow {
  id: string;
  /** ID of the source DFD node (actor, process, or data store) */
  from: string;
  /** ID of the target DFD node */
  to: string;
  /**
   * Human-readable label for this flow.
   *
   * Service-level DFDs: concise summary of all data on the edge
   *   (e.g. "auth tokens, user profiles, audit events").
   * Feature-level DFDs: a transformation description that explains what changes
   *   about the data as it moves between stages
   *   (e.g. "enriched with user profile", "filtered by permissions", "validated and normalised").
   */
  label: string;
  /** Human-readable data type names flowing on this edge */
  dataTypes: string[];
  dataClassification: DataClassification;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  protocol: string;
  encrypted: boolean;
  authenticationRequired: boolean;
  /** True when this flow crosses a trust boundary */
  crossesTrustBoundary: boolean;

  // ── Feature-level DFD fields ─────────────────────────────────────────────

  /**
   * Whether this flow is asynchronous (hands off to a queue / event broker and
   * does NOT wait for a response) or synchronous (awaits a response before
   * continuing). Omitted for service-level DFDs where this is less relevant.
   *
   * DFD.MD: "distinguish if a step hands off to a queue vs waits for a response"
   */
  async?: boolean;

  /**
   * Which execution path this flow belongs to.
   *   happy_path – the normal, successful flow.
   *   error_path – an exception, validation failure, or downstream error branch.
   *   both       – the same flow carries both outcomes (e.g. a response that may be
   *                success or error depending on upstream result).
   *
   * Omit for service-level DFDs where conditional branching is not modelled.
   *
   * DFD.MD: "Conditional branches — happy path vs error path"
   */
  branch?: 'happy_path' | 'error_path' | 'both';

  // ── Service-level DFD fields ─────────────────────────────────────────────

  /**
   * For event-driven flows to/from a queue or message broker: the topic, queue,
   * or stream name (e.g. "task-events", "payment.completed", "audit-log").
   *
   * DFD.MD: "Events published / consumed — with topic/queue name"
   */
  topicName?: string;

  /**
   * For data store flows: whether the service reads from, writes to, or does both
   * on this data store. Provides the read-vs-write-vs-both distinction required
   * by DFD.MD: "Reads/writes to data stores — distinguished (read vs write vs both)".
   * Omit for non-data-store flows.
   */
  accessPattern?: 'read' | 'write' | 'read_write';
}

export interface DataFlowDiagram {
  actors: DFDActor[];
  processes: DFDProcess[];
  dataStores: DFDDataStore[];
  flows: DFDFlow[];
  /** Canonical trust boundary types referenced by nodes (actors / processes / dataStores) */
  trustBoundaries: TrustBoundaryType[];
}

// ─── STRIDE Threat Model ──────────────────────────────────────────────────────

export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'InformationDisclosure'
  | 'DenialOfService'
  | 'ElevationOfPrivilege';

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface STRIDEThreat {
  /** Unique ID, format: T-{FEATURE_SHORT}-{001} */
  id: string;
  title: string;
  category: StrideCategory;
  description: string;
  /** IDs of DFD nodes (actor / process / store) affected */
  affectedComponents: string[];
  /** IDs of DFD flows affected */
  affectedFlows: string[];
  severity: ThreatSeverity;
  /** 1–5 scale */
  likelihoodScore: number;
  /** 1–5 scale */
  impactScore: number;
  mitigations: string[];
  status: 'identified' | 'mitigated' | 'accepted' | 'transferred';
  cvssVector?: string;
  /** Original STRIDE-assigned severity, before exploitability adjustment */
  originalSeverity?: ThreatSeverity;
  /** Reason severity was adjusted by exploitability analysis */
  adjustmentReason?: string;
}

export interface TrustBoundaryAnalysis {
  name: string;
  /** IDs of DFD flows that cross this boundary */
  crossingFlows: string[];
  controlsRequired: string[];
  controlsInPlace: string[];
  riskRating: ThreatSeverity;
}

export interface DataClassificationSummary {
  classification: DataClassification;
  dataTypes: string[];
  storageLocations: string[];
  transmissionPaths: string[];
  protectionMechanisms: string[];
}

export interface FeatureThreatModel {
  strideThreats: STRIDEThreat[];
  trustBoundaryAnalysis: TrustBoundaryAnalysis[];
  dataClassificationSummary: DataClassificationSummary[];
  /** Aggregate risk score 0–100 derived from threat severities */
  overallRiskScore: number;
  complianceConsiderations: string[];
  attackVectors: string[];
  securityRecommendations: string[];
}

// ─── Top-level Business Feature ───────────────────────────────────────────────

// ─── Feature Changelog ───────────────────────────────────────────────────────

/**
 * A single entry in a feature's change log, recording what changed between
 * one version and the next.
 */
export interface FeatureChangeLogEntry {
  /** ISO 8601 timestamp of when this version was created */
  timestamp: string;
  /** Version number this entry was created at (matches BusinessFeature.version) */
  version: number;
  /** Human-readable summary of what changed */
  summary: string;
  /** Which top-level fields changed: 'name' | 'description' | 'dfd' | 'threatModel' | 'other' */
  changedFields: string[];
}

/**
 * A business-level feature extracted from one or more code services.
 * Stored as an entity in the `feature_analyses` Qdrant collection and
 * connected via IMPLEMENTS_FEATURE edges in Neo4j.
 */
export interface BusinessFeature {
  /** Deterministic: sha256(tenantId | 'feature_analysis' | serviceId | featureName).slice(0,36) */
  id: string;
  tenantId: string;
  entityType: 'feature_analysis';
  /** Short business name (e.g. "Payment Processing") */
  name: string;
  /** One-paragraph business-value oriented description */
  description: string;
  /** Why this feature exists and who benefits */
  businessValue: string;
  userStories: string[];
  /** Technical summary of how it is implemented */
  technicalSummary: string;
  /** Feature-level correlation tags for entity matching */
  correlationTags: CorrelationTag[];
  /** Canonical CodeService entity IDs this feature spans */
  sourceServiceIds: string[];
  /** Human-readable service names (e.g. ["api", "worker"]) — parallel to sourceServiceIds */
  sourceServiceNames?: string[];
  /** Canonical CodeRepository entity ID the source services belong to */
  sourceRepositoryId?: string;
  /** Human-readable repository name (e.g. "org/my-repo") for display and filtering */
  sourceRepositoryName?: string;
  dataFlowDiagram: DataFlowDiagram;
  /** @deprecated Replaced by service-level threat model on the CodeService entity */
  threatModel: FeatureThreatModel;
  confidence: 'llm' | 'heuristic';
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;

  // ── Versioning & lifecycle ────────────────────────────────────────────────

  /**
   * Monotonically increasing version number. Starts at 1 for new features.
   * Incremented each time the content (DFD, threat model, name, description)
   * meaningfully changes on a rescan.
   */
  version: number;
  /**
   * Lifecycle status of this feature record.
   * - 'active'     → the current, authoritative version; shown in the UI.
   * - 'deprecated' → superseded by a newer version; hidden from the default list.
   */
  status: 'active' | 'deprecated';
  /**
   * ID of the feature record this version supersedes.
   * Null / absent for the first version.
   */
  previousVersionId?: string;
  /**
   * Ordered list (oldest first) of changes that produced this and prior versions.
   * Only the *latest* active record carries the full log; deprecated records keep
   * their own partial log up to the point they were superseded.
   */
  changeLog: FeatureChangeLogEntry[];
  /**
   * SHA-256 content hash of the fields that drive change detection
   * (name + description + DFD + threatModel).  Used to skip re-writes
   * when a rescan produces identical output.
   */
  contentHash: string;
}

// ─── Service-Level DFD & Threat Model ────────────────────────────────────────

/**
 * A merged, service-level Data Flow Diagram aggregated from all feature DFDs.
 * Stored on the CodeService entity in Qdrant as `serviceDfd`.
 */
export interface ServiceDfd {
  /** The synthesized DFD covering the entire service */
  dataFlowDiagram: DataFlowDiagram;
  /** Names of features whose DFDs were merged to produce this */
  featuresCovered: string[];
  /** LLM reasoning about key merge decisions */
  reasoning: string;
  /** ISO 8601 timestamp of when this was generated */
  generatedAt: string;
}

/**
 * The service-level STRIDE threat model, based on the service-level DFD.
 * Stored on the CodeService entity in Qdrant as `serviceThreatModel`.
 */
export interface ServiceThreatModel extends FeatureThreatModel {
  /** Names of features covered by this service-level threat model */
  featuresCovered: string[];
  /** ISO 8601 timestamp of when this was generated */
  generatedAt: string;
}

// ─── Summary type (for list endpoints) ───────────────────────────────────────

export interface BusinessFeatureSummary {
  id: string;
  name: string;
  description: string;
  sourceServiceIds: string[];
  sourceServiceNames?: string[];
  sourceRepositoryId?: string;
  sourceRepositoryName?: string;
  overallRiskScore: number;
  threatCount: number;
  complianceConsiderations: string[];
  highestSeverity: ThreatSeverity | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: 'active' | 'deprecated';
  previousVersionId?: string;
  changeLog: FeatureChangeLogEntry[];
}
