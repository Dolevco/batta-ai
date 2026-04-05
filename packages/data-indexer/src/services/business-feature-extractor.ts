/**
 * BusinessFeatureExtractor
 *
 * Orchestrates the 5-step LLM Task pipeline to extract business features from
 * a CodeService and its source code:
 *
 *   Step 1 – Feature List Task         → FeatureListCompletionTool
 *   Step 2 – DFD Task (per feature)    → DataFlowCompletionTool
 *   Step 3 – Threat Model (per feature)→ FeatureThreatModelCompletionTool
 *   Step 4 – Service DFD Synthesis     → ServiceDFDCompletionTool
 *   Step 5 – Unified Service Threat Model → ServiceThreatModelCompletionTool
 *
 * Step 5 produces the SINGLE authoritative threat model for each service.
 * It receives both the synthesized DFD (business/feature context) AND the
 * cloud topology context from ServiceRelationshipsExtractor (cloud resources,
 * relationships, entry points, dependent services), replacing the separate
 * ThreatModelAnalyzer that previously ran in SRE Step 7.
 *
 * After Step 5, the unified ServiceThreatModel is also projected back onto
 * service.threatModel so that the ExploitabilityAnalyzer (Stage 6) finds
 * threats in the expected ThreatModelData shape.
 *
 * Each step uses a Task from @ai-agent/core (NOT a direct LLM call).
 * Custom completion tools validate the LLM output and retry on failure.
 *
 * Results are persisted to:
 *   - Qdrant  : `feature_analyses` collection (features)
 *             + `entities` collection (serviceDfd / serviceThreatModel on CodeService)
 *   - Neo4j   : IMPLEMENTS_FEATURE edges (feature_analysis) → (code_service)
 *
 * Security: LLM outputs are stripped of workspace paths before storage.
 *           All Qdrant writes include tenantId for tenant isolation.
 *           Validation errors contain only field-name / enum details — never
 *           raw user data, secrets, or workspace paths.
 */

import * as crypto from 'crypto';
import type { CloudResource, CodeService, Relationship, RepositoryBriefing, TenantId } from '@ai-agent/shared';
import { QdrantAdapter, Neo4jAdapter } from '@ai-agent/shared';
import type {
  BusinessFeature,
  DataFlowDiagram,
  DFDActor,
  DFDDataStore,
  DFDFlow,
  TrustBoundaryType,
  FeatureThreatModel,
  CorrelationTag,
  ServiceDfd,
  ServiceThreatModel,
  FeatureChangeLogEntry,
  ServiceExternalSurface,
  ServiceSkeleton,
  ServiceFileMap,
  ExternalDep,
} from '@ai-agent/shared';

/**
 * Cloud topology context passed from the task-processor into feature extraction.
 * Gathered by ServiceRelationshipsExtractor (Steps 0–6) and used in Step 5 so
 * the unified threat model sees both DFD structure and deployment reality.
 */
export interface CloudContext {
  cloudResources: CloudResource[];
  /** All cloud-relevant relationships for this service (DEPLOYED_TO, USES, etc.) */
  relationships: Relationship[];
  /** Services this service directly depends on */
  dependentServices: CodeService[];
}
import { sanitizeMetadata } from '../utils/secret-sanitizer';
import { buildFeatureSemanticDoc } from './semantic-indexer';
import type { FeatureDraft } from '../agents/tools/featureListCompletionTool';
import type { DataFlowInput } from '../agents/tools/dataFlowCompletionTool';
import type { ThreatModelInput } from '../agents/tools/featureThreatModelCompletionTool';
import type { ServiceDFDInput } from '../agents/tools/serviceDFDCompletionTool';
import type { ServiceThreatModelInput } from '../agents/tools/serviceThreatModelCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType } from '../agents';

export class BusinessFeatureExtractor {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
    private readonly qdrant?: QdrantAdapter,
    private readonly neo4j?: Neo4jAdapter,
  ) {}

  /**
   * Run the full 5-step pipeline for a CodeService and return the extracted
   * BusinessFeature[] (also persisted if qdrant/neo4j are provided).
   *
   * Steps 4 & 5 (service DFD + unified service threat model) run after all
   * features are processed. Step 5 receives the optional cloudContext so it
   * can produce a single threat model that covers both the DFD/business context
   * and the cloud deployment topology — replacing the separate ThreatModelAnalyzer
   * that previously ran in SRE Step 7.
   *
   * After Step 5 the unified ServiceThreatModel is projected back onto
   * service.threatModel (ThreatModelData shape) so that the ExploitabilityAnalyzer
   * finds the threat list in the field it expects.
   *
   * Pre-computed pass context (fileMap, skeleton, surface) is extracted from the
   * service entity if it was populated by the 3-pass ServiceAnalyzer, and injected
   * into feature list and DFD prompts to avoid re-discovery.
   */
  async extractFeaturesForService(
    tenantId: TenantId,
    service: CodeService,
    repositoryPath: string,
    cloudContext?: CloudContext,
    repositoryName?: string,
    repositoryBriefing?: RepositoryBriefing,
  ): Promise<BusinessFeature[]> {
    const servicePath = service.metadata?.codePath as string || service.codePath || '';

    // Extract pre-computed 3-pass context from the service entity (populated by ServiceAnalyzer)
    const fileMap: ServiceFileMap | undefined = service.serviceFileMap;
    const skeleton: ServiceSkeleton | undefined = service.serviceSkeleton;
    const surface: ServiceExternalSurface | undefined = service.serviceExternalSurface;

    const hasPrecomputedContext = !!(fileMap && skeleton && surface);

    console.log(
      `[BusinessFeatureExtractor] Extracting features for "${service.name}" (${servicePath})` +
      (hasPrecomputedContext ? ' [with pre-computed surface context]' : ' [no pre-computed context]')
    );

    // ── Step 1: Feature List ────────────────────────────────────────────────
    const featureList = await this.runFeatureListTask(
      service, servicePath, repositoryPath, repositoryBriefing, fileMap, skeleton, surface,
    );
    if (!featureList.length) {
      console.warn(`[BusinessFeatureExtractor] No features extracted for "${service.name}"`);
      return [];
    }

    // ── Steps 2 + 3: DFD + Threat Model (sequential per feature) ──────────
    const features = await Promise.all(
      featureList.map(async (draft) => {
        try {
          const dfd = await this.runDFDTask(
            draft, service, servicePath, repositoryPath, repositoryBriefing, fileMap, skeleton, surface,
          );
          const threatModel = await this.runThreatModelTask(draft, dfd, repositoryPath, repositoryBriefing);
          return this.buildFeature(tenantId, service, draft, dfd, threatModel, repositoryName);
        } catch (err) {
          console.error(
            `[BusinessFeatureExtractor] Failed to process feature "${draft.name}" for service "${service.name}":`,
            err instanceof Error ? err.message : err
          );
          return null;
        }
      })
    );

    const validFeatures = features.filter((f): f is BusinessFeature => f !== null);

    // ── Persist feature analyses ───────────────────────────────────────────
    if (validFeatures.length > 0) {
      await this.persistFeatures(tenantId, service, validFeatures);
    }

    console.log(
      `[BusinessFeatureExtractor] ✅ ${validFeatures.length} features persisted for "${service.name}"`
    );

    // ── Steps 4 + 5: Service DFD synthesis + Unified Service Threat Model ──
    // Step 5 merges DFD structure with cloud topology (if provided) into one
    // threat model, replacing the separate cloud-only ThreatModelAnalyzer pass.
    if (validFeatures.length > 0) {
      try {
        const serviceDfd = await this.runServiceDFDTask(service, validFeatures, repositoryPath, surface);
        const serviceThreatModel = await this.runServiceThreatModelTask(
          service, serviceDfd, repositoryPath, cloudContext,
        );
        await this.persistServiceSecurityData(tenantId, service, serviceDfd, serviceThreatModel);
        console.log(
          `[BusinessFeatureExtractor] ✅ Unified service DFD + threat model persisted for "${service.name}" ` +
            `(risk score ${serviceThreatModel.overallRiskScore}/100, ` +
            `${serviceThreatModel.strideThreats.length} threats, ` +
            `cloud context: ${cloudContext ? `${cloudContext.cloudResources.length} resources` : 'none'})`
        );
      } catch (err) {
        // Non-fatal: per-feature data is already persisted; log and continue.
        console.error(
          `[BusinessFeatureExtractor] Service-level DFD/threat-model step failed for "${service.name}":`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return validFeatures;
  }

  // ─── Step 1 ───────────────────────────────────────────────────────────────

  private async runFeatureListTask(
    service: CodeService,
    servicePath: string,
    repositoryPath: string,
    repositoryBriefing?: RepositoryBriefing,
    fileMap?: ServiceFileMap,
    skeleton?: ServiceSkeleton,
    surface?: ServiceExternalSurface,
  ): Promise<FeatureDraft[]> {
    const task = this.registry.createTask(DataIndexerAgentType.FeatureListExtractor, {
      workspace: repositoryPath,
    });

    const briefingSection = repositoryBriefing
      ? buildBriefingSection(repositoryBriefing)
      : '';

    // Build pre-computed context section from skeleton + surface (Passes 1–2)
    const precomputedSection = buildPrecomputedContextSection(skeleton, surface, fileMap);

    // If we have pre-computed context, use constrained route-file-only reading.
    // Otherwise fall back to the original 6-phase exploration.
    const explorationInstructions = (skeleton && surface && fileMap)
      ? buildConstrainedFeatureListInstructions(servicePath, fileMap, skeleton, surface)
      : buildLegacyFeatureListInstructions(servicePath);

    const result = await task.execute<{ features: FeatureDraft[] }>(
      (briefingSection ? `${briefingSection}\n\n` : '') +
        (precomputedSection ? `${precomputedSection}\n\n` : '') +
        `Analyse the service "${service.name}" located at "${servicePath}".\n\n` +
        explorationInstructions + `\n\n` +
        `Only call complete_feature_list when done.`
    );

    if (!result.requiredOutput) {
      console.warn(`[BusinessFeatureExtractor] Feature list task did not produce output for "${service.name}"`);
      return [];
    }

    const output = result.requiredOutput as unknown as { features: FeatureDraft[] };
    return output.features ?? [];
  }

  // ─── Step 2 ───────────────────────────────────────────────────────────────

  private async runDFDTask(
    draft: FeatureDraft,
    service: CodeService,
    servicePath: string,
    repositoryPath: string,
    repositoryBriefing?: RepositoryBriefing,
    fileMap?: ServiceFileMap,
    skeleton?: ServiceSkeleton,
    surface?: ServiceExternalSurface,
  ): Promise<DataFlowDiagram> {
    const featureContext = JSON.stringify(
      { name: draft.name, description: draft.description, technicalSummary: draft.technicalSummary,
        correlationTags: draft.correlationTags },
      null,
      2
    );

    const briefingSection = repositoryBriefing
      ? buildBriefingSection(repositoryBriefing)
      : '';

    const task = this.registry.createTask(DataIndexerAgentType.DfdExtractor, {
      workspace: repositoryPath,
    });

    // Build pre-computed surface context for this DFD agent
    const surfaceSection = surface
      ? buildSurfaceSectionForDFD(surface)
      : '';

    const skeletonSection = skeleton
      ? buildSkeletonSectionForDFD(skeleton)
      : '';

    // Build the reading list for this feature's specific files
    const featureFilesInstruction = (surface && fileMap)
      ? buildFeatureSpecificReadingInstruction(draft, fileMap)
      : buildLegacyDFDExplorationInstructions();

    const result = await task.execute<DataFlowInput>(
      (briefingSection ? `${briefingSection}\n\n` : '') +
        (skeletonSection ? `${skeletonSection}\n\n` : '') +
        (surfaceSection ? `${surfaceSection}\n\n` : '') +
        `Produce a Level-2 Data Flow Diagram for the business feature below:\n\n${featureContext}\n\n` +
        `The feature belongs to service "${service.name}" located at "${servicePath}".\n\n` +
        featureFilesInstruction + `\n\n` +
        `Only call complete_data_flow_diagram after completing all exploration steps.`
    );

    if (!result.requiredOutput) {
      throw new Error(`DFD task produced no output for feature "${draft.name}"`);
    }

    const output = result.requiredOutput as unknown as DataFlowInput;
    return output.dataFlowDiagram;
  }

  // ─── Step 3 ───────────────────────────────────────────────────────────────

  private async runThreatModelTask(
    draft: FeatureDraft,
    dfd: DataFlowDiagram,
    repositoryPath: string,
    repositoryBriefing?: RepositoryBriefing,
  ): Promise<FeatureThreatModel> {
    const context = JSON.stringify(
      {
        feature: { name: draft.name, description: draft.description, businessValue: draft.businessValue },
        dataFlowDiagram: dfd,
      },
      null,
      2
    );

    const briefingSection = repositoryBriefing
      ? buildBriefingSection(repositoryBriefing)
      : '';

    const task = this.registry.createTask(DataIndexerAgentType.FeatureThreatModel, {
      workspace: repositoryPath,
    });

    const result = await task.execute<ThreatModelInput>(
      (briefingSection ? `${briefingSection}\n\n` : '') +
        `Perform a STRIDE threat model for the following business feature and its DFD:\n\n${context}\n\n` +
        `Before writing threats, complete the Evidence Phase from your instructions:\n` +
        `  - For each INTERNET/EXTERNAL boundary-crossing flow, read the guarding middleware.\n` +
        `  - For each confidential/restricted data store, read the repository/adapter file.\n` +
        `  - For each IDENTITY boundary, read the token validation strategy.\n\n` +
        `Cite actual file+function names in your mitigations. When complete, call complete_feature_threat_model.`
    );

    if (!result.requiredOutput) {
      throw new Error(`Threat model task produced no output for feature "${draft.name}"`);
    }

    const output = result.requiredOutput as unknown as ThreatModelInput;
    return sanitizeMetadata(output.threatModel as unknown as Record<string, unknown>) as unknown as FeatureThreatModel;
  }

  // ─── Step 4: Service DFD Synthesis ────────────────────────────────────────

  /**
   * Merges all per-feature DFDs into a single service-level DFD via LLM.
   *
   * The LLM is given the full feature context (name, description, DFD JSON) so it
   * can make informed merging decisions.  The ServiceDFDCompletionTool enforces
   * strict allow-list validation before the result is accepted.
   *
   * Pass 2 surface context (if available) is injected as a validation checklist:
   * the synthesis agent must verify that every external dep in the surface map
   * appears as a node in the merged DFD.
   *
   * After the LLM produces its output, a deterministic enforcement pass scans
   * every ExternalDep in the surface and injects any missing nodes + flows.
   * This guarantees completeness regardless of LLM omissions.
   *
   * Security: the feature context JSON is sanitized before being sent to the LLM.
   *           File tools are NOT provided — this is a pure synthesis step.
   *           Injected node IDs are derived from dep names only (no secrets).
   */
  private async runServiceDFDTask(
    service: CodeService,
    features: BusinessFeature[],
    repositoryPath: string,
    surface?: ServiceExternalSurface,
  ): Promise<ServiceDfd> {
    // Build sanitized per-feature DFD summaries for the LLM context.
    const featureSummaries = features.map(f => ({
      name: f.name,
      description: f.description,
      dataFlowDiagram: sanitizeMetadata(f.dataFlowDiagram as unknown as Record<string, unknown>),
    }));

    const context = JSON.stringify(
      {
        serviceName: service.name,
        externalDeps: service.externalDeps ?? [],
        features: featureSummaries,
      },
      null,
      2
    );

    // Service DFD Synthesis is a pure merge — NO file tools provided.
    const task = this.registry.createTask(DataIndexerAgentType.ServiceDfdSynthesis);

    // Build the surface checklist (Pass 2 output) to inject as a validation anchor.
    const surfaceChecklist = surface
      ? buildSurfaceChecklist(surface)
      : '';

    const externalDepsCount = service.externalDeps?.length ?? 0;
    const result = await task.execute<ServiceDFDInput>(
      `Produce a Service-Level Architectural DFD for "${service.name}" from the ${features.length} feature DFDs below.\n` +
        `The service also has ${externalDepsCount} known external dependencies (see "externalDeps" in the context) that MUST all appear in the DFD.\n\n` +
        `${context}\n\n` +
        (surfaceChecklist ? surfaceChecklist + `\n\n` : '') +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `WHAT THIS DFD MUST SHOW\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `This is an ARCHITECTURAL GRAPH answering "how does this service fit into the world?"\n` +
        `Goal: a security reviewer should instantly see every EXTERNAL relationship\n` +
        `the service has — who calls it, what it calls, and what data crosses each boundary.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `NODE RULES\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `processes[] — DEPLOYABLE SERVICES ONLY\n` +
        `  ✅ One node per independently deployable service/microservice/container.\n` +
        `  ✅ "${service.name}" is itself ONE process node.\n` +
        `  ❌ NO controllers, route handlers, middleware, or internal class names.\n` +
        `  ❌ NO sub-components found inside a single deployable unit.\n\n` +
        `actors[] — EXTERNAL ENTITIES ONLY\n` +
        `  ✅ Human personas: end-users, admins, developers, security engineers.\n` +
        `  ✅ Identity / auth providers: Azure AD, Auth0, Okta, GitHub OAuth, etc.\n` +
        `  ✅ Observability: Datadog, Sentry, Prometheus scraper, Application Insights, etc.\n` +
        `  ✅ Infrastructure: API gateways, CDNs, load balancers in front of the service.\n` +
        `  ✅ Peer services that CALL INTO this service (type: internal_service).\n` +
        `  ❌ NO internal submodules of "${service.name}".\n\n` +
        `dataStores[] — STORAGE SYSTEMS, ONE NODE PER SYSTEM\n` +
        `  ✅ Each database engine: one node (MongoDB = 1 node, not per collection).\n` +
        `  ✅ Each cache: Redis = 1 node, Memcached = 1 node.\n` +
        `  ✅ Each queue/stream system: Azure Service Bus, Redis Streams, RabbitMQ.\n` +
        `  ✅ Each blob/object store: Azure Blob, S3, GCS.\n` +
        `  ✅ Logging/observability sinks that receive structured writes: Elastic, Splunk.\n` +
        `  ❌ NO separate nodes for individual tables, collections, or topics.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `FLOW RULES  (per DFD.MD — four required edge types)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ✅ EXACTLY ONE flow per (from, to) pair — duplicates are rejected.\n` +
        `  ✅ Merge ALL data between the same two nodes into ONE flow.\n` +
        `     flow.label = concise summary, e.g. "JWT validation, token refresh, user profile"\n` +
        `     flow.dataTypes[] = every distinct data type on that edge.\n\n` +
        `  1. REQUEST/RESPONSE CALLS — set flow.protocol to actual protocol (HTTPS, gRPC, etc.)\n` +
        `  2. EVENTS PUBLISHED/CONSUMED — set flow.topicName to exact topic/queue name.\n` +
        `     Required for every flow to/from a queue dataStore.\n` +
        `     DFD.MD: "Events published / consumed — with topic/queue name"\n` +
        `  3. DATA STORE READS/WRITES — set flow.accessPattern:\n` +
        `       "read"       → service only reads from this store\n` +
        `       "write"      → service only writes to this store\n` +
        `       "read_write" → service does both\n` +
        `     Required for every flow to/from a dataStore.\n` +
        `     DFD.MD: "Reads/writes to data stores — distinguished (read vs write vs both)"\n` +
        `  4. AUTH FLOWS — model each IdP call as a distinct flow with authenticationRequired=true.\n` +
        `     DFD.MD: "Auth flows — who authenticates whom"\n\n` +
        `  ✅ Include EVERY external communication from ALL feature DFDs:\n` +
        `     inbound requests, DB reads/writes, cache ops, queue publish/subscribe,\n` +
        `     IdP token validation, outbound HTTP to 3rd parties, log writes, webhooks.\n` +
        `  ❌ Do NOT omit any external dependency found in any feature DFD.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `EXTERNAL DEPENDENCIES (mandatory coverage)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `The context above includes an "externalDeps" array extracted directly from the\n` +
        `service entity. EVERY entry in that array MUST appear in the DFD as a node and\n` +
        `have at least one flow connecting it to the service process node.\n` +
        `  ✅ type: api | identity | other              → actors[] (type: third_party or system)\n` +
        `  ✅ type: database | cache | storage | queue  → dataStores[]\n` +
        `  ✅ type: cloud                               → dataStores[] or actors[] depending on usage\n` +
        `Use the dep's protocol field for flow.protocol and dataClassification for flow.dataClassification.\n` +
        `Do not skip any external dep — if it is listed, it crosses a trust boundary and must be visible.\n\n` +
        `Call complete_service_dfd when ready.`
    );

    if (!result.requiredOutput) {
      throw new Error(`Service DFD task produced no output for service "${service.name}"`);
    }

    const output = result.requiredOutput as unknown as ServiceDFDInput;
    const sanitized = sanitizeMetadata(output.dataFlowDiagram as unknown as Record<string, unknown>);
    const llmDfd = sanitized as unknown as DataFlowDiagram;

    // ── Deterministic enforcement pass ──────────────────────────────────────
    // Regardless of what the LLM produced, inject any ExternalDep from the
    // surface (or service.externalDeps) that is not already represented as a
    // node in the DFD.  This guarantees completeness and makes the security
    // review accurate even when the LLM omits low-salience deps.
    const allDeps = [
      ...(surface?.externalDeps ?? []),
      ...((service.externalDeps ?? []).filter(d =>
        !(surface?.externalDeps ?? []).some(s => s.name.toLowerCase() === d.name.toLowerCase())
      )),
    ];
    const enforcedDfd = enforceSurfaceCoverage(llmDfd, service.name, allDeps);

    const injectedCount =
      (enforcedDfd.actors.length - llmDfd.actors.length) +
      (enforcedDfd.dataStores.length - llmDfd.dataStores.length);
    if (injectedCount > 0) {
      console.log(
        `[BusinessFeatureExtractor] 🔒 Surface enforcement: injected ${injectedCount} missing ` +
        `node(s) into service DFD for "${service.name}"`
      );
    }

    return {
      dataFlowDiagram: enforcedDfd,
      featuresCovered: output.featuresCovered,
      reasoning: output.reasoning,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Step 5: Unified Service Threat Model ─────────────────────────────────

  /**
   * Runs a holistic STRIDE threat model using both the service-level DFD and
   * the cloud deployment topology. This is the single authoritative threat model
   * for the service — it replaces the separate ThreatModelAnalyzer (SRE Step 7).
   *
   * Security: the DFD context JSON is already sanitized (produced by runServiceDFDTask).
   *           Cloud context fields are included as plain text — no raw file content
   *           or secret values are forwarded.
   *           The ServiceThreatModelCompletionTool enforces allow-list validation.
   */
  private async runServiceThreatModelTask(
    service: CodeService,
    serviceDfd: ServiceDfd,
    repositoryPath: string,
    cloudContext?: CloudContext,
  ): Promise<ServiceThreatModel> {
    const dfdContext = JSON.stringify(
      { serviceName: service.name, dataFlowDiagram: serviceDfd.dataFlowDiagram, featuresCovered: serviceDfd.featuresCovered },
      null,
      2
    );
    const cloudSection = cloudContext ? buildCloudContextSection(service, cloudContext) : '';

    const task = this.registry.createTask(DataIndexerAgentType.ServiceThreatModel);

    const prompt =
      `Perform a holistic STRIDE threat model for service "${service.name}".\n\n` +
      `=== SERVICE-LEVEL DATA FLOW DIAGRAM ===\n${dfdContext}\n\n` +
      (cloudSection ? `=== CLOUD DEPLOYMENT TOPOLOGY ===\n${cloudSection}\n\n` : '') +
      `Cover ALL trust-boundary-crossing flows visible in both the DFD and the cloud topology. ` +
      `When complete, call complete_service_threat_model.`;

    const result = await task.execute<ServiceThreatModelInput>(prompt);

    if (!result.requiredOutput) {
      throw new Error(`Service threat model task produced no output for service "${service.name}"`);
    }

    const output = result.requiredOutput as unknown as ServiceThreatModelInput;
    const sanitizedTm = sanitizeMetadata(
      output.threatModel as unknown as Record<string, unknown>
    ) as unknown as FeatureThreatModel;

    return {
      ...sanitizedTm,
      featuresCovered: serviceDfd.featuresCovered,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Assembler ────────────────────────────────────────────────────────────

  private buildFeature(
    tenantId: TenantId,
    service: CodeService,
    draft: FeatureDraft,
    dfd: DataFlowDiagram,
    threatModel: FeatureThreatModel,
    repositoryName?: string,
  ): BusinessFeature {
    const now = new Date().toISOString();
    const id = this.generateId(tenantId, service.id, draft.name);
    const sanitizedDraft = sanitizeMetadata(draft as unknown as Record<string, unknown>) as unknown as FeatureDraft;
    const contentHash = this.computeContentHash(sanitizedDraft.name, sanitizedDraft.description, dfd, threatModel);

    return {
      id,
      tenantId,
      entityType: 'feature_analysis',
      name: sanitizedDraft.name,
      description: sanitizedDraft.description,
      businessValue: sanitizedDraft.businessValue,
      userStories: sanitizedDraft.userStories,
      technicalSummary: sanitizedDraft.technicalSummary,
      correlationTags: sanitizedDraft.correlationTags as CorrelationTag[],
      sourceServiceIds: [service.id],
      sourceServiceNames: [service.name],
      ...(service.repositoryId && { sourceRepositoryId: service.repositoryId }),
      ...(repositoryName && { sourceRepositoryName: repositoryName }),
      dataFlowDiagram: dfd,
      threatModel,
      confidence: 'heuristic' as const,
      createdAt: now,
      updatedAt: now,
      metadata: {},
      version: 1,
      status: 'active',
      changeLog: [],
      contentHash,
    };
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  /**
   * Deduplicate and persist features for a service.
   *
   * For each new feature:
   *  1. Look for an existing active feature for this service whose normalised
   *     name matches (exact or close enough).
   *  2. If found and contentHash is identical → skip (no write).
   *  3. If found and contentHash differs → create a new versioned record,
   *     deprecate the old one, carry the changeLog forward.
   *  4. If not found → persist as-is (version 1).
   *
   * At the end, any previously-active features for the service that were NOT
   * matched by the new scan are marked deprecated (they were removed / renamed).
   */
  private async persistFeatures(
    tenantId: TenantId,
    service: CodeService,
    features: BusinessFeature[]
  ): Promise<void> {
    // ── Load existing active features for this service ────────────────────
    const existingActive = await this.loadActiveFeaturesByService(tenantId, service.id);

    const matchedExistingIds = new Set<string>();
    const featuresToWrite: BusinessFeature[] = [];
    const featuresToDeprecate: BusinessFeature[] = [];

    for (const feature of features) {
      const match = this.findMatchingFeature(feature, existingActive);

      if (match) {
        matchedExistingIds.add(match.id);

        if (match.contentHash === feature.contentHash) {
          // Identical content — no change, skip write entirely
          console.log(
            `[BusinessFeatureExtractor] ⏭  No change for "${feature.name}" (v${match.version}) — skipping`
          );
          continue;
        }

        // Content changed → new version supersedes the old one
        const changedFields = this.detectChangedFields(match, feature);
        const newVersion = match.version + 1;
        const now = new Date().toISOString();

        const updatedChangeLog: FeatureChangeLogEntry[] = [
          ...match.changeLog,
          {
            timestamp: now,
            version: newVersion,
            summary: `Updated from v${match.version}: ${changedFields.join(', ')} changed`,
            changedFields,
          },
        ];

        const newRecord: BusinessFeature = {
          ...feature,
          // Keep original createdAt to preserve history
          createdAt: match.createdAt,
          updatedAt: now,
          version: newVersion,
          status: 'active',
          previousVersionId: match.id,
          changeLog: updatedChangeLog,
        };

        featuresToDeprecate.push({
          ...match,
          status: 'deprecated',
          updatedAt: now,
        });
        featuresToWrite.push(newRecord);

        console.log(
          `[BusinessFeatureExtractor] 🔄 New version v${newVersion} for "${feature.name}" ` +
          `(changed: ${changedFields.join(', ')})`
        );
      } else {
        // Brand-new feature
        const initialEntry: FeatureChangeLogEntry = {
          timestamp: feature.createdAt,
          version: 1,
          summary: 'Initial extraction',
          changedFields: [],
        };
        featuresToWrite.push({ ...feature, changeLog: [initialEntry] });
      }
    }

    // ── Deprecate active features that disappeared from the new scan ─────
    for (const existing of existingActive) {
      if (!matchedExistingIds.has(existing.id)) {
        featuresToDeprecate.push({
          ...existing,
          status: 'deprecated',
          updatedAt: new Date().toISOString(),
        });
        console.log(
          `[BusinessFeatureExtractor] 🗑  Deprecating removed feature "${existing.name}" (v${existing.version})`
        );
      }
    }

    // ── Write deprecated records first, then new/updated ones ────────────
    for (const feature of [...featuresToDeprecate, ...featuresToWrite]) {
      try {
        if (this.qdrant) {
          await this.qdrant.storeEntity({
            id: feature.id,
            tenantId,
            entityType: 'feature_analysis' as any,
            createdAt: feature.createdAt,
            updatedAt: feature.updatedAt,
            confidence: 'heuristic',
            name: feature.name,
            metadata: feature as unknown as Record<string, any>,
          } as any);
        }

        // Neo4j edge: only for active features (deprecated ones keep their existing edges)
        if (this.neo4j && feature.status === 'active') {
          await this.neo4j.storeRelationship({
            id: `rel:${this.generateId(tenantId, service.id, feature.name + ':IMPLEMENTS_FEATURE')}`,
            tenantId,
            type: 'IMPLEMENTS_FEATURE',
            sourceId: feature.id,
            targetId: service.id,
            validFrom: feature.createdAt,
            confidence: 'heuristic',
            metadata: { featureName: feature.name, riskScore: feature.threatModel.overallRiskScore },
          });
        }
      } catch (err) {
        console.error(
          `[BusinessFeatureExtractor] Failed to persist feature "${feature.name}":`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // ── Semantic documents: only index active features ────────────────────
    const activeFeaturesForSemanticIndex = featuresToWrite.filter(f => f.status === 'active');
    if (this.qdrant && activeFeaturesForSemanticIndex.length > 0) {
      try {
        const semanticDocs = activeFeaturesForSemanticIndex.map(f => buildFeatureSemanticDoc(tenantId, f));
        await this.qdrant.storeSemanticDocuments(semanticDocs);
        console.log(
          `[BusinessFeatureExtractor] ✅ ${semanticDocs.length} feature semantic doc(s) indexed for vector search`
        );
      } catch (err) {
        console.error(
          `[BusinessFeatureExtractor] Failed to index feature semantic documents:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // ─── Deduplication helpers ────────────────────────────────────────────────

  /**
   * Load all 'active' feature_analysis entities for a given serviceId.
   * Filters in-memory since Qdrant doesn't support nested payload filters here.
   */
  private async loadActiveFeaturesByService(
    tenantId: TenantId,
    serviceId: string
  ): Promise<BusinessFeature[]> {
    if (!this.qdrant) return [];
    try {
      const all = await this.qdrant.listEntities(tenantId, 'feature_analysis' as any, 500);
      return all
        .map(e => e.metadata as unknown as BusinessFeature)
        .filter(
          f => f.status === 'active' && Array.isArray(f.sourceServiceIds) && f.sourceServiceIds.includes(serviceId)
        );
    } catch {
      return [];
    }
  }

  /**
   * Find the best match for a new feature among existing active features.
   * Matches on normalised name (case-insensitive, punctuation stripped).
   */
  private findMatchingFeature(
    newFeature: BusinessFeature,
    existingFeatures: BusinessFeature[]
  ): BusinessFeature | undefined {
    const normNew = this.normaliseName(newFeature.name);
    return existingFeatures.find(e => this.normaliseName(e.name) === normNew);
  }

  /** Strip punctuation, collapse whitespace, lowercase. */
  private normaliseName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  /** Detect which top-level fields changed between old and new feature. */
  private detectChangedFields(old: BusinessFeature, next: BusinessFeature): string[] {
    const changed: string[] = [];
    if (this.normaliseName(old.name) !== this.normaliseName(next.name)) changed.push('name');
    if (old.description !== next.description) changed.push('description');
    if (JSON.stringify(old.dataFlowDiagram) !== JSON.stringify(next.dataFlowDiagram)) changed.push('dfd');
    if (JSON.stringify(old.threatModel) !== JSON.stringify(next.threatModel)) changed.push('threatModel');
    return changed.length > 0 ? changed : ['other'];
  }

  /**
   * Compute a SHA-256 content hash over the fields used for change detection:
   * name, description, DFD, and threat model.
   */
  private computeContentHash(
    name: string,
    description: string,
    dfd: DataFlowDiagram,
    threatModel: FeatureThreatModel
  ): string {
    const key = JSON.stringify({ name: name.toLowerCase().trim(), description, dfd, threatModel });
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
   * Patches the CodeService entity in Qdrant with the service-level DFD,
   * the unified threat model, and a projection of that threat model onto the
   * ThreatModelData shape expected by ExploitabilityAnalyzer.
   *
   * Projection: serviceThreatModel.strideThreats → threatModel.identifiedThreats
   * This ensures Stage 6 (exploitability) finds threats in the right field
   * without requiring any changes to ExploitabilityAnalyzer.
   *
   * Security:
   *  - serviceDfd and serviceThreatModel are sanitized before this call.
   *  - Writes are scoped to tenantId (enforced by QdrantAdapter).
   *  - Only schema-level errors are logged; no raw LLM output is emitted.
   *  - The service-level risk score is written to Neo4j only as a numeric
   *    metadata field on the existing relationship edge (no PII involved).
   */
  private async persistServiceSecurityData(
    tenantId: TenantId,
    service: CodeService,
    serviceDfd: ServiceDfd,
    serviceThreatModel: ServiceThreatModel
  ): Promise<void> {
    if (!this.qdrant) return;

    try {
      // Fetch the current CodeService entity so we can merge into it.
      const existing = await this.qdrant.getEntity(tenantId, service.id);
      const base = (existing ?? service) as CodeService;

      // Project unified strideThreats → threatModel.identifiedThreats so that
      // ExploitabilityAnalyzer (which reads service.threatModel.identifiedThreats)
      // operates on the single, merged threat list.
      const projectedThreats = serviceThreatModel.strideThreats.map(t => ({
        id: t.id,
        category: t.category.toLowerCase().replace('informationdisclosure', 'information-disclosure').replace('elevationofprivilege', 'elevation-of-privilege').replace('denialofservice', 'denial-of-service') as any,
        description: t.description ?? t.title,
        severity: t.severity as any,
        mitigations: t.mitigations ?? [],
        status: t.status as any,
      }));

      const now = new Date().toISOString();
      const updated: CodeService = {
        ...base,
        serviceDfd,
        serviceThreatModel,
        // Merge projected threats into threatModel, preserving existing fields
        // (entry points, auth, data classification) from cloud analysis in Stage 4.
        threatModel: {
          ...base.threatModel,
          identifiedThreats: projectedThreats,
          riskScore: serviceThreatModel.overallRiskScore,
          lastAssessment: serviceThreatModel.generatedAt,
          assessmentMethod: 'llm' as any,
        },
        updatedAt: now,
        lastIndexedAt: now,
      };

      await this.qdrant.storeEntity(updated as any);

      // Also update the service node in Neo4j so risk score and threat model are in sync (best-effort).
      if (this.neo4j) {
        try {
          await this.neo4j.storeEntity(updated as any);
        } catch (neo4jErr) {
          // Non-fatal: Neo4j enrichment is best-effort
          console.warn(
            `[BusinessFeatureExtractor] Neo4j service node update failed for "${service.name}":`,
            neo4jErr instanceof Error ? neo4jErr.message : neo4jErr
          );
        }
      }
    } catch (err) {
      // Re-throw so the caller can log it as a non-fatal step failure.
      throw new Error(
        `Failed to persist service security data for "${service.name}": ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  /**
   * Deterministic ID: sha256(tenantId|feature_analysis|serviceId|featureName).slice(0,36)
   * Ensures idempotent re-indexing.
   */
  private generateId(tenantId: string, serviceId: string, featureName: string): string {
    const key = `${tenantId}|feature_analysis|${serviceId}|${featureName.toLowerCase().trim()}`;
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 36);
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────────

/**
 * Renders the repository briefing as a concise orientation block to inject at
 * the top of agent prompts. Gives every feature-extraction agent an immediate
 * understanding of the repository structure so it can plan its exploration
 * efficiently — without needing to re-discover the monorepo layout from scratch.
 *
 * Security: the briefing was sanitized by RepositoryBriefingService before being
 *           passed here — no secret values, API keys, or workspace paths appear.
 *           Only structural metadata (names, types, patterns) is included.
 */
function buildBriefingSection(briefing: RepositoryBriefing): string {
  const lines: string[] = [
    '════════════════════════════════════════════════════════════════',
    'REPOSITORY BRIEFING  (use this to plan your exploration)',
    '════════════════════════════════════════════════════════════════',
    `Summary : ${briefing.summary}`,
    `Structure: ${briefing.structure}`,
    `Languages: ${briefing.languages.join(', ')}`,
    `Frameworks: ${briefing.frameworks.join(', ')}`,
    `Build tools: ${briefing.buildTools.join(', ')}`,
    `Services: ${briefing.serviceNames.join(', ')}`,
    `Deployment: ${briefing.deploymentTargets.join(', ')}`,
    `Patterns: ${briefing.architecturalPatterns.join(', ')}`,
    '════════════════════════════════════════════════════════════════',
  ];
  return lines.join('\n');
}

/**
 * Build a plain-text section describing the cloud deployment topology for a
 * service. Included in the Step 5 threat-model prompt so the LLM can reason
 * about both DFD structure and runtime deployment reality in a single pass.
 *
 * Security: only structural metadata (names, types, relationship types) is
 * included — no secret values, no raw file content, no workspace paths.
 */
function buildCloudContextSection(service: CodeService, ctx: CloudContext): string {
  const lines: string[] = [];

  // Service-level metadata already on the entity
  if (service.responsibility) {
    lines.push(`Service description: ${service.responsibility}`);
  }
  if (service.externalDeps?.length) {
    lines.push('External dependencies (crosses trust boundary):');
    service.externalDeps.forEach(d =>
      lines.push(`  - ${d.name} (${d.type}, ${d.dataFlow}) — ${d.purpose}`)
    );
  }

  // Cloud resources this service is deployed to or uses
  const relatedResources = ctx.relationships
    .filter(r => r.sourceId === service.id && (r.type === 'DEPLOYED_TO' || r.type === 'USES'))
    .map(r => ctx.cloudResources.find(cr => cr.id === r.targetId))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  if (relatedResources.length > 0) {
    lines.push('Cloud resources:');
    relatedResources.forEach(r => {
      const rels = ctx.relationships.filter(
        rel => (rel.sourceId === service.id && rel.targetId === r.id) ||
               (rel.targetId === service.id && rel.sourceId === r.id)
      );
      lines.push(`  - ${r.name} (${r.resourceType}, ${r.cloudProvider}) via ${rels.map(rel => rel.type).join(', ')}`);
      if (r.threatModel?.internetExposed !== undefined) lines.push(`    Internet exposed: ${r.threatModel.internetExposed}`);
      if (r.threatModel?.dataClassification) lines.push(`    Data classification: ${r.threatModel.dataClassification}`);
      if (r.threatModel?.dataAtRest) lines.push(`    Encryption at rest: ${r.threatModel.dataAtRest.enabled}`);
    });
  }

  // All cloud relationships (topology summary)
  if (ctx.relationships.length > 0) {
    lines.push('Relationships:');
    ctx.relationships.forEach(r => {
      const dir = r.sourceId === service.id ? '→' : '←';
      const other = r.sourceId === service.id ? r.targetId : r.sourceId;
      const otherName = ctx.cloudResources.find(cr => cr.id === other)?.name ?? other;
      lines.push(`  ${r.type} ${dir} ${otherName}`);
    });
  }

  // Services this service depends on
  if (ctx.dependentServices.length > 0) {
    lines.push('Dependent services (called by this service):');
    ctx.dependentServices.forEach(s => {
      lines.push(`  - ${s.name} (${s.serviceType})`);
      if (s.responsibility) lines.push(`    ${s.responsibility}`);
    });
  }

  // Internet-exposure summary from existing static analysis
  const tm = service.threatModel;
  if (tm) {
    if (tm.internetExposed !== undefined) lines.push(`Internet exposed: ${tm.internetExposed}`);
    if (tm.entryPoints?.length) {
      lines.push('Entry points:');
      tm.entryPoints.forEach(ep =>
        lines.push(`  - ${ep.type} ${ep.path ?? ''} | public: ${ep.isPublic} | auth required: ${ep.authenticationRequired}`)
      );
    }
    if (tm.authenticationMethod) lines.push(`Authentication: ${tm.authenticationMethod}`);
    if (tm.dataClassification) lines.push(`Data classification: ${tm.dataClassification}`);
  }

  return lines.join('\n');
}

// ── Pre-computed context helpers (3-pass pipeline) ────────────────────────────

/**
 * Builds a combined orientation block from the skeleton and surface produced by
 * the 3-pass ServiceAnalyzer. Injected at the top of FeatureList and DFD prompts
 * so those agents start with full structural context rather than discovering it.
 *
 * Security: skeleton and surface are already sanitized by their respective
 *   extractors — no secret values or raw file content is forwarded here.
 */
function buildPrecomputedContextSection(
  skeleton?: ServiceSkeleton,
  surface?: ServiceExternalSurface,
  fileMap?: ServiceFileMap,
): string {
  if (!skeleton && !surface && !fileMap) return '';

  const lines: string[] = [
    '════════════════════════════════════════════════════════════════',
    'PRE-COMPUTED SERVICE CONTEXT  (from 3-pass analysis — do not re-derive)',
    '════════════════════════════════════════════════════════════════',
  ];

  if (skeleton) {
    lines.push(`Service description : ${skeleton.serviceDescription}`);
    lines.push(`Business value      : ${skeleton.businessValue}`);
    lines.push(`Tech stack          : ${skeleton.techStack.join(', ')}`);
    lines.push(`Entry point types   : ${skeleton.entryPointTypes.join(', ')}`);
    lines.push(`Arch patterns       : ${skeleton.architecturalPatterns.join(', ') || 'none'}`);
    if (skeleton.dataModels.length > 0) {
      lines.push(`Data models         : ${skeleton.dataModels.join(', ')}`);
    }
    if (skeleton.exposedEndpoints.length > 0) {
      lines.push(`Exposed endpoints   :`);
      skeleton.exposedEndpoints.slice(0, 20).forEach(ep =>
        lines.push(`  ${ep.method ?? '?'} ${ep.path}  [${ep.file}]`)
      );
      if (skeleton.exposedEndpoints.length > 20) {
        lines.push(`  …and ${skeleton.exposedEndpoints.length - 20} more`);
      }
    }
    if (skeleton.internalDependencies.length > 0) {
      lines.push(`Internal deps       : ${skeleton.internalDependencies.join(', ')}`);
    }
  }

  if (surface) {
    if (surface.externalDeps.length > 0) {
      lines.push('');
      lines.push('External surface (trust boundaries + deps):');
      surface.externalDeps.forEach(dep => {
        const boundary = findDepBoundary(dep.name, surface.trustBoundaryMap);
        lines.push(
          `  [${dep.type.toUpperCase()}] ${dep.name}` +
          (boundary ? ` — boundary: ${boundary}` : '') +
          (dep.dataFlow ? ` — flow: ${dep.dataFlow}` : '') +
          (dep.purpose ? ` — ${dep.purpose}` : ''),
        );
      });
    }
    const boundaryEntries = Object.entries(surface.trustBoundaryMap).filter(([, names]) => names.length > 0);
    if (boundaryEntries.length > 0) {
      lines.push('Trust boundary map  :');
      boundaryEntries.forEach(([zone, names]) => lines.push(`  ${zone}: ${names.join(', ')}`));
    }
  }

  if (fileMap) {
    const pf = fileMap.priorityFiles;
    const routeCount = pf.routes.length;
    const clientCount = pf.clients.length;
    lines.push('');
    lines.push(
      `File map summary    : ${fileMap.estimatedSignalFiles} signal files, ` +
      `${fileMap.totalFiles} total, ` +
      `${routeCount} route file(s), ` +
      `${clientCount} client file(s)`,
    );
  }

  lines.push('════════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

/** Return the trust boundary zone that contains this dep name, or undefined. */
function findDepBoundary(
  depName: string,
  map: ServiceExternalSurface['trustBoundaryMap'],
): string | undefined {
  const lower = depName.toLowerCase();
  for (const [zone, names] of Object.entries(map)) {
    if (names.some(n => n.toLowerCase() === lower)) return zone;
  }
  return undefined;
}

/**
 * Feature list exploration instructions for the constrained path (3-pass context available).
 *
 * The agent already has the skeleton and surface; it only needs to read the
 * route/controller files to identify features. Config, models, and env files
 * are already captured in the pre-computed context.
 *
 * Security: only file paths from the sanitized fileMap are forwarded.
 */
function buildConstrainedFeatureListInstructions(
  servicePath: string,
  fileMap: ServiceFileMap,
  skeleton: ServiceSkeleton,
  surface: ServiceExternalSurface,
): string {
  const { routes, entry } = fileMap.priorityFiles;
  const readList = [...routes, ...entry].slice(0, 20);

  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'FEATURE EXTRACTION INSTRUCTIONS (constrained reading mode)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'The external surface and data layer are pre-computed above.',
    'You do NOT need to re-read config, env, model, or client files.',
    '',
    'Read ONLY the following route/controller/handler files to identify business features:',
  ];

  if (readList.length > 0) {
    readList.forEach(f => lines.push(`  - ${f}`));
  } else {
    lines.push(`  - (no route files found — read ${servicePath}/src/index.ts or equivalent entry point)`);
  }

  lines.push('');
  lines.push('For each identified feature:');
  lines.push('  1. Name it from the user/business perspective (not technical).');
  lines.push('  2. Write correlationTags with the file paths that implement this feature.');
  lines.push('  3. Use the endpoints from the skeleton above to populate technicalSummary.');
  lines.push(`  4. External deps (databases, identity providers, APIs) are in the context above.`);
  lines.push('');
  lines.push(`Tech stack: ${skeleton.techStack.slice(0, 5).join(', ')}`);
  lines.push(`Known external deps: ${surface.externalDeps.map(d => d.name).slice(0, 5).join(', ') || 'none'}`);

  return lines.join('\n');
}

/**
 * Feature list exploration instructions for the legacy path (no pre-computed context).
 * Mimics the original open-ended 6-phase exploration prompt.
 */
function buildLegacyFeatureListInstructions(servicePath: string): string {
  return (
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `FEATURE EXTRACTION INSTRUCTIONS (legacy exploration mode)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Perform a structured 6-phase exploration of "${servicePath}":\n\n` +
    `Phase 1 — File tree: list the directory structure to understand layout.\n` +
    `Phase 2 — Entry point: read the main entry file (index.ts, main.ts, app.ts).\n` +
    `Phase 3 — Routes/handlers: read each route/controller/handler file found.\n` +
    `Phase 4 — Data models: read key model and schema files.\n` +
    `Phase 5 — Config: read package.json and .env.example to infer external deps.\n` +
    `Phase 6 — Synthesise: identify 1–5 business features from what you read.\n\n` +
    `For each feature, populate correlationTags with the files that implement it.\n` +
    `Identify all external dependencies (databases, identity providers, APIs) from config/client files.`
  );
}

// ── DFD context helpers ───────────────────────────────────────────────────────

/**
 * Build a DFD-oriented surface context block.
 * Instructs the DFD agent to use the pre-mapped external deps as nodes
 * rather than discovering them from scratch.
 *
 * Security: surface is already sanitized — only dep names, types, and
 *   boundary classification are forwarded (no secret values).
 */
function buildSurfaceSectionForDFD(surface: ServiceExternalSurface): string {
  if (surface.externalDeps.length === 0 &&
      Object.values(surface.trustBoundaryMap).every(a => a.length === 0)) {
    return '';
  }

  const lines: string[] = [
    '════════════════════════════════════════════════════════════════',
    'EXTERNAL SURFACE  (pre-mapped — use these as DFD nodes)',
    '════════════════════════════════════════════════════════════════',
    'The following external dependencies have already been systematically',
    'extracted. Use them directly as actors/dataStores in the DFD.',
    'Do NOT re-discover external deps from config or package.json.',
    '',
  ];

  // Group by trust boundary zone
  const byZone: Record<string, Array<{ name: string; type: string; dataFlow: string }>> = {};
  for (const dep of surface.externalDeps) {
    const zone = findDepBoundary(dep.name, surface.trustBoundaryMap) ?? 'EXTERNAL';
    if (!byZone[zone]) byZone[zone] = [];
    byZone[zone].push({ name: dep.name, type: dep.type, dataFlow: dep.dataFlow });
  }

  const zoneOrder = ['IDENTITY', 'DATA', 'SERVICE', 'EXTERNAL', 'INTERNET'] as const;
  for (const zone of zoneOrder) {
    const deps = byZone[zone];
    if (!deps || deps.length === 0) continue;
    lines.push(`${zone} boundary:`);
    deps.forEach(d => {
      const nodeType = ['database', 'cache', 'storage', 'queue'].includes(d.type)
        ? 'dataStore'
        : 'actor';
      lines.push(`  [${nodeType}] ${d.name}  (type: ${d.type}, flow: ${d.dataFlow})`);
    });
    lines.push('');
  }

  // Remaining deps not in any zone
  const allZonedNames = new Set(
    Object.values(surface.trustBoundaryMap).flat().map(n => n.toLowerCase()),
  );
  const unzoned = surface.externalDeps.filter(d => !allZonedNames.has(d.name.toLowerCase()));
  if (unzoned.length > 0) {
    lines.push('Other:');
    unzoned.forEach(d => lines.push(`  ${d.name}  (type: ${d.type}, flow: ${d.dataFlow})`));
    lines.push('');
  }

  lines.push('════════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

/**
 * Build a DFD-oriented skeleton context block.
 * Provides the data models and endpoints so the DFD agent has structural
 * anchors without needing to re-read entry or model files.
 *
 * Security: skeleton is already sanitized — only structural metadata.
 */
function buildSkeletonSectionForDFD(skeleton: ServiceSkeleton): string {
  const lines: string[] = [
    '════════════════════════════════════════════════════════════════',
    'SERVICE SKELETON  (pre-computed — use these as DFD anchors)',
    '════════════════════════════════════════════════════════════════',
    `Description : ${skeleton.serviceDescription}`,
    `Tech stack  : ${skeleton.techStack.join(', ')}`,
    `Entry types : ${skeleton.entryPointTypes.join(', ')}`,
  ];

  if (skeleton.dataModels.length > 0) {
    lines.push(`Data models : ${skeleton.dataModels.join(', ')}`);
  }

  if (skeleton.exposedEndpoints.length > 0) {
    lines.push('Exposed endpoints:');
    skeleton.exposedEndpoints.slice(0, 15).forEach(ep =>
      lines.push(`  ${ep.method ?? '?'} ${ep.path}  [${ep.file}]`)
    );
    if (skeleton.exposedEndpoints.length > 15) {
      lines.push(`  …and ${skeleton.exposedEndpoints.length - 15} more`);
    }
  }

  if (skeleton.internalDependencies.length > 0) {
    lines.push(`Internal deps (sibling services): ${skeleton.internalDependencies.join(', ')}`);
  }

  lines.push('════════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

/**
 * Build a per-feature reading instruction using the feature's correlationTags
 * to select only the files that implement this specific feature, cross-referenced
 * with the file map.
 *
 * Falls back to the route files from the file map if no tags match.
 *
 * Security: only sanitized file paths from the fileMap are forwarded.
 */
function buildFeatureSpecificReadingInstruction(
  draft: FeatureDraft,
  fileMap: ServiceFileMap,
): string {
  // Collect file paths hinted by correlationTags (keywords may contain file path fragments)
  const tagKeywords: string[] = draft.correlationTags.flatMap(t => t.keywords ?? []);

  const allPriorityFiles = [
    ...fileMap.priorityFiles.routes,
    ...fileMap.priorityFiles.entry,
    ...fileMap.priorityFiles.models,
  ];

  // Match files whose path includes any of the tag keywords (case-insensitive)
  const featureFiles = allPriorityFiles.filter(f => {
    const lower = f.toLowerCase();
    return tagKeywords.some(kw => lower.includes(kw.toLowerCase()));
  });

  // If no matches, fall back to route + entry files (bounded to 10)
  const readList =
    featureFiles.length > 0
      ? featureFiles.slice(0, 10)
      : allPriorityFiles.slice(0, 10);

  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `DFD READING INSTRUCTIONS  (constrained to this feature)`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'The service skeleton and external surface are pre-provided above.',
    'You do NOT need to re-read config, env, or client files.',
    'Use the provided external deps as the data stores and actors in your DFD.',
    '',
    `Read ONLY the following files to trace the "${draft.name}" feature flow:`,
  ];

  readList.forEach(f => lines.push(`  - ${f}`));

  lines.push('');
  lines.push('After reading, produce the Level-2 DFD for this feature:');
  lines.push('  - Map the exact data flows between this service and external systems.');
  lines.push('  - For auth/identity flows, cite the specific middleware or validator function.');
  lines.push('  - For DB flows, cite the specific model/repository function.');
  lines.push('  - Assign trust boundaries from the surface context above — do not invent new ones.');

  return lines.join('\n');
}

/**
 * DFD exploration instructions for the legacy path (no file map / no surface context).
 */
function buildLegacyDFDExplorationInstructions(): string {
  return (
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `DFD EXPLORATION INSTRUCTIONS (legacy mode)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `To produce the DFD for this feature:\n\n` +
    `1. Read the route/controller file that implements this feature.\n` +
    `2. Follow imports to identify the data layer (DB, cache, queue).\n` +
    `3. Read config/env files to identify identity providers and third-party APIs.\n` +
    `4. Read any middleware for auth/validation on this route.\n` +
    `5. Classify all external interactions by trust boundary.\n\n` +
    `Identify all data stores (databases, caches, queues) and external actors\n` +
    `(identity providers, third-party APIs, upstream services) that this feature touches.`
  );
}

/**
 * Build a surface validation checklist for the ServiceDFD synthesis step.
 *
 * The synthesis agent uses this to verify that every dep from the surface map
 * is represented as a node in the merged DFD, catching omissions before the
 * ServiceThreatModel step.
 *
 * Security: only dep names and boundary zones are forwarded — no secret values.
 */
function buildSurfaceChecklist(surface: ServiceExternalSurface): string {
  if (surface.externalDeps.length === 0) return '';

  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'SURFACE VALIDATION CHECKLIST',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'The following external dependencies were detected in Pass 2.',
    'EVERY entry below MUST appear as an actor or dataStore node in the DFD.',
    'If any are missing from the merged DFD, add them now.',
    '',
  ];

  surface.externalDeps.forEach(dep => {
    const zone = findDepBoundary(dep.name, surface.trustBoundaryMap) ?? 'EXTERNAL';
    const nodeType = ['database', 'cache', 'storage', 'queue'].includes(dep.type)
      ? 'dataStore'
      : 'actor';
    lines.push(`  ☐  ${dep.name}  →  ${nodeType}  [boundary: ${zone}]`);
  });

  lines.push('');
  lines.push('Do not call complete_service_dfd until all boxes above are checked.');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

// ── Surface enforcement (deterministic post-LLM pass) ──────────────────────────

/**
 * Map an ExternalDep type onto the correct DFD node category.
 *
 * Storage-type deps (database, cache, storage, queue) become `dataStores`.
 * All other deps (api, cloud, identity, other) become `actors`.
 *
 * Security: only dep type enum values flow through here — no secrets.
 */
function depToNodeCategory(dep: ExternalDep): 'dataStore' | 'actor' {
  return ['database', 'cache', 'storage', 'queue'].includes(dep.type) ? 'dataStore' : 'actor';
}

/** Derive a stable, URL-safe node ID from a dep name. */
function depToNodeId(depName: string): string {
  return 'enforced-' + depName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Derive the correct trust boundary type from an ExternalDep. */
function depToTrustBoundary(dep: ExternalDep): TrustBoundaryType {
  if (dep.type === 'identity') return 'IDENTITY';
  if (['database', 'cache', 'storage', 'queue'].includes(dep.type)) return 'DATA';
  return 'EXTERNAL';
}

/**
 * Check whether a dep name is already represented in the DFD.
 *
 * A dep is considered covered if ANY actor or dataStore label contains the dep
 * name as a case-insensitive substring (or vice-versa).  This handles naming
 * variations like "Azure OpenAI" vs "Azure OpenAI API".
 *
 * Security: only normalised label strings are compared — no external calls.
 */
function isDepCoveredByDfd(depName: string, dfd: Pick<DataFlowDiagram, 'actors' | 'dataStores'>): boolean {
  const needle = depName.toLowerCase();
  const allLabels = [
    ...dfd.actors.map(a => a.label.toLowerCase()),
    ...dfd.dataStores.map(d => d.label.toLowerCase()),
  ];
  return allLabels.some(label => label.includes(needle) || needle.includes(label));
}

/**
 * Deterministic enforcement pass: inject any ExternalDep that the LLM omitted
 * from the service-level DFD.
 *
 * For every dep in `allDeps`:
 *   1. Skip if already covered (name substring match on actor/dataStore labels).
 *   2. Create an appropriate actor or dataStore node.
 *   3. Create a single flow from/to the service's own process node.
 *   4. Ensure the corresponding TrustBoundaryType is in `trustBoundaries[]`.
 *
 * The function is pure and returns a new DataFlowDiagram object (no mutation).
 *
 * Security:
 *   - IDs are derived from dep names only — no workspace paths or secret values.
 *   - `encryptionAtRest` defaults to `false` (unknown — conservative assumption).
 *   - `authenticationRequired` defaults to `true` for all external connections.
 *   - `encrypted` defaults to `true` when protocol hints at HTTPS/TLS, else `false`.
 *   - `crossesTrustBoundary` is always `true` for injected nodes (they are external).
 *   - No existing LLM-produced nodes or flows are modified or removed.
 */
export function enforceSurfaceCoverage(
  dfd: DataFlowDiagram,
  serviceName: string,
  allDeps: ExternalDep[],
): DataFlowDiagram {
  if (!allDeps.length) return dfd;

  // Find the primary process node for this service (used as flow endpoint).
  // Prefer an exact name match; fall back to the first process node.
  const serviceProcessNode =
    dfd.processes.find(p => p.label.toLowerCase() === serviceName.toLowerCase()) ??
    dfd.processes[0];

  if (!serviceProcessNode) {
    // No process node to connect to — return unchanged to avoid orphan flows.
    return dfd;
  }

  const newActors: DFDActor[] = [...dfd.actors];
  const newDataStores: DFDDataStore[] = [...dfd.dataStores];
  const newFlows: DFDFlow[] = [...dfd.flows];
  const newBoundaries: Set<TrustBoundaryType> = new Set(dfd.trustBoundaries);
  let flowCounter = dfd.flows.length;

  // Track (from, to) pairs already present to avoid duplicate flows.
  const existingFlowPairs = new Set<string>(
    dfd.flows.map(f => `${f.from}→${f.to}`)
  );

  for (const dep of allDeps) {
    // Re-check coverage against the growing set of nodes built so far.
    if (isDepCoveredByDfd(dep.name, { actors: newActors, dataStores: newDataStores })) {
      continue;
    }

    const nodeId = depToNodeId(dep.name);
    const boundary = depToTrustBoundary(dep);
    newBoundaries.add(boundary);

    if (depToNodeCategory(dep) === 'dataStore') {
      // Map ExternalDep type → DFDDataStore type
      const storeType: DFDDataStore['type'] =
        dep.type === 'database' ? 'database' :
        dep.type === 'cache'    ? 'cache' :
        dep.type === 'storage'  ? 'blob_storage' :
        dep.type === 'queue'    ? 'queue' :
        'other';

      newDataStores.push({
        id: nodeId,
        label: dep.name,
        type: storeType,
        dataClassification: dep.dataClassification,
        encryptionAtRest: false, // conservative unknown default
        trustBoundary: boundary,
        correlationTags: [{
          entityType: 'data_store',
          keywords: [dep.name.toLowerCase().replace(/\s+/g, '_')],
        }],
      });
    } else {
      newActors.push({
        id: nodeId,
        label: dep.name,
        type: 'third_party',
        trusted: false,
        trustBoundary: boundary,
        correlationTags: [{
          entityType: dep.type === 'identity' ? 'identity' : 'external_dependency',
          keywords: [dep.name.toLowerCase().replace(/\s+/g, '_')],
        }],
      });
    }

    // Add a flow connecting the service process to the injected node.
    // Direction is derived from the dep's dataFlow field.
    const isHttps =
      (dep.protocol ?? '').toUpperCase().includes('HTTPS') ||
      (dep.protocol ?? '').toUpperCase().includes('TLS');

    const direction: DFDFlow['direction'] =
      dep.dataFlow === 'inbound'  ? 'inbound' :
      dep.dataFlow === 'outbound' ? 'outbound' :
      'bidirectional';

    // For inbound deps the external entity sends data to the service; for all
    // others (outbound / bidirectional) the service initiates the connection.
    const [flowFrom, flowTo] =
      direction === 'inbound'
        ? [nodeId, serviceProcessNode.id]
        : [serviceProcessNode.id, nodeId];

    const pairKey = `${flowFrom}→${flowTo}`;
    if (!existingFlowPairs.has(pairKey)) {
      existingFlowPairs.add(pairKey);
      flowCounter += 1;
      newFlows.push({
        id: `enforced-flow-${flowCounter}`,
        from: flowFrom,
        to: flowTo,
        label: dep.purpose || `${dep.dataFlow} communication with ${dep.name}`,
        dataTypes: ['data'],
        dataClassification: dep.dataClassification,
        direction,
        protocol: dep.protocol ?? 'HTTPS',
        encrypted: isHttps,
        authenticationRequired: true,
        crossesTrustBoundary: true,
      });
    }
  }

  return {
    actors: newActors,
    processes: dfd.processes,
    dataStores: newDataStores,
    flows: newFlows,
    trustBoundaries: Array.from(newBoundaries) as TrustBoundaryType[],
  };
}
