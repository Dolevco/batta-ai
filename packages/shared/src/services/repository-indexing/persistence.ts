import type { PostgresDataAdapter } from '../../persistence/data-adapter';
import type { PostgresGraphAdapter } from '../../persistence/graph-adapter';
import type {
  CodeRepository,
  CodeService,
  CodeModule,
  Evidence,
  Relationship,
  RelationshipType,
} from '../../types/canonical.types';
import type {
  RepositoryInventorySubmission,
  ServiceContextSubmission,
  FeatureContextSubmission,
  DfdContextSubmission,
  ThreatModelContextSubmission,
  EvidenceRef,
} from '../../types/repository-indexing.types';
import type { BusinessFeature } from '../../types/business-feature.types';
import {
  repositoryId,
  serviceId,
  featureId,
  moduleId,
  relationshipId,
  evidenceId,
  contentHash,
  normalizeServiceType,
  now,
} from './normalizers';
import type { DataFlowDiagram, FeatureThreatModel } from '../../types/business-feature.types';
import { VALID_TRUST_BOUNDARY_TYPES } from '../../types/business-feature.types';

function coerceTrustBoundaries(raw: unknown[]): typeof VALID_TRUST_BOUNDARY_TYPES[number][] {
  return raw
    .map((tb: unknown) => {
      if (typeof tb === 'string') return tb;
      if (tb && typeof tb === 'object') {
        const o = tb as Record<string, unknown>;
        return String(o.type ?? o.name ?? '');
      }
      return '';
    })
    .filter((tb): tb is typeof VALID_TRUST_BOUNDARY_TYPES[number] =>
      VALID_TRUST_BOUNDARY_TYPES.includes(tb as typeof VALID_TRUST_BOUNDARY_TYPES[number])
    );
}

// Coerce and fill-in defaults for a DFD coming from an LLM that may have omitted optional-but-
// UI-required fields, or serialized trust boundaries as objects instead of strings.
function sanitizeDfd(dfd: DataFlowDiagram): DataFlowDiagram {
  return {
    ...dfd,
    actors: (dfd.actors ?? []).map(a => ({
      ...a,
      trusted: a.trusted ?? false,
      correlationTags: a.correlationTags ?? [],
    })),
    processes: (dfd.processes ?? []).map(p => ({
      ...p,
      correlationTags: p.correlationTags ?? [],
    })),
    dataStores: (dfd.dataStores ?? []).map(ds => ({
      ...ds,
      dataClassification: ds.dataClassification ?? 'internal',
      encryptionAtRest: ds.encryptionAtRest ?? false,
      correlationTags: ds.correlationTags ?? [],
    })),
    flows: (dfd.flows ?? []).map(f => ({
      ...f,
      label: f.label ?? `${f.from} → ${f.to}`,
      dataTypes: f.dataTypes ?? [],
      dataClassification: f.dataClassification ?? 'internal',
      direction: f.direction ?? 'outbound',
      protocol: f.protocol ?? 'unknown',
      encrypted: f.encrypted ?? false,
      authenticationRequired: f.authenticationRequired ?? false,
      crossesTrustBoundary: f.crossesTrustBoundary ?? false,
      branch: f.branch ?? 'both',
      async: f.async ?? false,
    })),
    trustBoundaries: coerceTrustBoundaries(dfd.trustBoundaries ?? []),
  };
}

function sanitizeThreatModel(tm: FeatureThreatModel): FeatureThreatModel {
  return {
    strideThreats: (tm.strideThreats ?? []).map(t => ({
      ...t,
      affectedComponents: t.affectedComponents ?? [],
      affectedFlows: t.affectedFlows ?? [],
      mitigations: t.mitigations ?? [],
      likelihoodScore: t.likelihoodScore ?? 1,
      impactScore: t.impactScore ?? 1,
      status: t.status ?? 'identified',
    })),
    trustBoundaryAnalysis: (tm.trustBoundaryAnalysis ?? []).map(tba => ({
      ...tba,
      crossingFlows: tba.crossingFlows ?? [],
      controlsRequired: tba.controlsRequired ?? [],
      controlsInPlace: tba.controlsInPlace ?? [],
    })),
    dataClassificationSummary: (tm.dataClassificationSummary ?? []).map(dc => ({
      ...dc,
      dataTypes: dc.dataTypes ?? [],
      storageLocations: dc.storageLocations ?? [],
      transmissionPaths: dc.transmissionPaths ?? [],
      protectionMechanisms: dc.protectionMechanisms ?? [],
    })),
    overallRiskScore: tm.overallRiskScore ?? 0,
    complianceConsiderations: tm.complianceConsiderations ?? [],
    attackVectors: tm.attackVectors ?? [],
    securityRecommendations: tm.securityRecommendations ?? [],
  };
}

function makeEvidence(
  tenantId: string,
  subjectId: string,
  ref: EvidenceRef,
): Evidence {
  return {
    id: evidenceId(tenantId, subjectId, ref.filePath, ref.lineStart, ref.rationale),
    tenantId,
    evidenceType: 'source_code',
    subjectId,
    subjectType: 'entity',
    source: {
      type: 'file',
      location: ref.filePath,
      retrievedAt: now(),
    },
    extractedFacts: {
      filePath: ref.filePath,
      lineStart: ref.lineStart,
      lineEnd: ref.lineEnd,
      symbol: ref.symbol,
      rationale: ref.rationale,
    },
    confidence: 'manual',
    createdAt: now(),
    metadata: {},
  };
}

function makeRelationship(
  tenantId: string,
  sourceId: string,
  targetId: string,
  type: RelationshipType,
): Relationship {
  return {
    id: relationshipId(tenantId, sourceId, type, targetId),
    tenantId,
    type,
    sourceId,
    targetId,
    validFrom: now(),
    confidence: 'manual',
    metadata: {},
  };
}

export async function persistInventory(
  tenantId: string,
  inventory: RepositoryInventorySubmission,
  dataAdapter: PostgresDataAdapter,
  graphAdapter: PostgresGraphAdapter,
): Promise<string> {
  const repoName = inventory.url ?? inventory.name;
  const repoId = repositoryId(tenantId, repoName);
  const ts = now();

  const repoEntity: CodeRepository = {
    id: repoId,
    tenantId,
    entityType: 'code_repository',
    name: inventory.name,
    url: inventory.url ?? inventory.name,
    defaultBranch: inventory.defaultBranch ?? 'main',
    confidence: 'manual',
    createdAt: ts,
    updatedAt: ts,
    lastIndexedAt: ts,
    metadata: {
      indexer: 'mcp_agent',
    },
    repositoryBriefing: {
      summary: inventory.summary,
      languages: inventory.languages,
      frameworks: inventory.frameworks,
      buildTools: [...(inventory.buildTools ?? []), ...(inventory.packageManagers ?? [])],
      structure: inventory.importantDirectories.join(', '),
      serviceNames: inventory.serviceCandidates,
      deploymentTargets: inventory.deploymentTargets,
      architecturalPatterns: inventory.architecturalPatterns,
    },
  };

  await dataAdapter.storeEntity(repoEntity);
  await graphAdapter.storeEntity(repoEntity);

  for (const ref of inventory.evidence ?? []) {
    await dataAdapter.storeEvidence(makeEvidence(tenantId, repoId, ref));
  }

  return repoId;
}

export async function persistServices(
  tenantId: string,
  repoId: string,
  services: ServiceContextSubmission[],
  dataAdapter: PostgresDataAdapter,
  graphAdapter: PostgresGraphAdapter,
): Promise<Record<string, string>> {
  const serviceIds: Record<string, string> = {};
  const ts = now();

  for (const svc of services) {
    const svcId = serviceId(tenantId, repoId, svc.name);
    serviceIds[svc.name] = svcId;

    const serviceEntity: CodeService = {
      id: svcId,
      tenantId,
      entityType: 'code_service',
      name: svc.name,
      serviceType: normalizeServiceType(svc.serviceType),
      codePath: svc.codePath,
      repositoryId: repoId,
      language: svc.language,
      techStack: svc.techStack,
      responsibility: svc.responsibility,
      confidence: 'manual',
      createdAt: ts,
      updatedAt: ts,
      lastIndexedAt: ts,
      metadata: { indexer: 'mcp_agent' },
      serviceAnalysis: {
        serviceDescription: svc.responsibility,
        businessValue: svc.businessValue,
        techStack: svc.techStack,
        codeStructure: svc.codePath,
        externalDeps: (svc.externalDependencies ?? []).map(dep => ({
          name: dep.name,
          type: dep.type,
          protocol: dep.protocol,
          purpose: dep.purpose,
          dataFlow: dep.dataFlow,
          dataClassification: dep.dataClassification,
          businessValue: dep.businessValue,
          resourceName: dep.resourceName,
          endpoints: dep.endpoints,
          operations: dep.operations,
        })),
        internalDependencies: svc.internalDependencies ?? [],
        entryPointTypes: svc.entryPointTypes ?? [],
        architecturalPatterns: [],
      },
      serviceSkeleton: {
        serviceDescription: svc.responsibility,
        businessValue: svc.businessValue,
        entryPointTypes: svc.entryPointTypes ?? [],
        architecturalPatterns: [],
        techStack: svc.techStack,
        exposedEndpoints: svc.exposedEndpoints ?? [],
        dataModels: [],
        internalDependencies: svc.internalDependencies ?? [],
      },
      serviceFileMap: {
        priorityFiles: {
          entry: [],
          routes: [],
          models: [],
          types: [],
          config: [],
          clients: [],
        },
        skipFiles: [],
        estimatedSignalFiles: svc.priorityFiles?.length ?? 0,
        totalFiles: svc.priorityFiles?.length ?? 0,
      },
    };

    await dataAdapter.storeEntity(serviceEntity);
    await graphAdapter.storeEntity(serviceEntity);

    // repository CONTAINS service
    const containsRel = makeRelationship(tenantId, repoId, svcId, 'CONTAINS');
    await graphAdapter.storeRelationship(containsRel);

    // Evidence
    for (const ref of svc.evidence ?? []) {
      await dataAdapter.storeEvidence(makeEvidence(tenantId, svcId, ref));
    }

    // Priority files as CodeModule entities
    for (const filePath of svc.priorityFiles ?? []) {
      const modId = moduleId(tenantId, repoId, filePath);
      const modEntity: CodeModule = {
        id: modId,
        tenantId,
        entityType: 'code_module',
        name: filePath.split('/').pop() ?? filePath,
        codePath: filePath,
        serviceId: svcId,
        repositoryId: repoId,
        language: svc.language,
        confidence: 'manual',
        createdAt: ts,
        updatedAt: ts,
        isEntryPoint: false,
        metadata: {},
      };
      await dataAdapter.storeEntity(modEntity);
      await graphAdapter.storeEntity(modEntity);

      const moduleContainsRel = makeRelationship(tenantId, svcId, modId, 'CONTAINS');
      await graphAdapter.storeRelationship(moduleContainsRel);
    }
  }

  // Internal dependency relationships
  for (const svc of services) {
    const srcId = serviceIds[svc.name];
    if (!srcId) continue;
    for (const depName of svc.internalDependencies ?? []) {
      const targetId = serviceIds[depName];
      if (targetId) {
        const depRel = makeRelationship(tenantId, srcId, targetId, 'DEPENDS_ON');
        await graphAdapter.storeRelationship(depRel);
      }
    }
  }

  return serviceIds;
}

export async function persistFeatureWithDfd(
  tenantId: string,
  repoId: string,
  repoName: string,
  feature: FeatureContextSubmission,
  dfd: DfdContextSubmission,
  serviceIdMap: Record<string, string>,
  dataAdapter: PostgresDataAdapter,
  graphAdapter: PostgresGraphAdapter,
): Promise<string> {
  const ts = now();
  const sourceServiceIds = feature.sourceServiceNames.map(n => serviceIdMap[n]).filter(Boolean);
  const featId = featureId(tenantId, repoId, feature.sourceServiceNames, feature.name);

  const featureEntity: BusinessFeature = {
    id: featId,
    tenantId,
    entityType: 'feature_analysis',
    name: feature.name,
    description: feature.description,
    businessValue: feature.businessValue,
    userStories: feature.userStories ?? [],
    technicalSummary: feature.technicalSummary,
    correlationTags: (feature.correlationTags ?? []).map(kw => ({
      entityType: 'code_service',
      keywords: [kw],
    })),
    sourceServiceIds,
    sourceServiceNames: feature.sourceServiceNames,
    sourceRepositoryId: repoId,
    sourceRepositoryName: repoName,
    dataFlowDiagram: sanitizeDfd(dfd.dataFlowDiagram),
    threatModel: {
      strideThreats: [],
      trustBoundaryAnalysis: [],
      dataClassificationSummary: [],
      overallRiskScore: 0,
      complianceConsiderations: [],
      attackVectors: [],
      securityRecommendations: [],
    },
    confidence: 'heuristic',
    createdAt: ts,
    updatedAt: ts,
    version: 1,
    status: 'active',
    changeLog: [{
      timestamp: ts,
      version: 1,
      summary: 'Initial MCP agent indexing',
      changedFields: ['name', 'description', 'dfd'],
    }],
    contentHash: contentHash({ name: feature.name, description: feature.description, dataFlowDiagram: dfd.dataFlowDiagram }),
    metadata: { indexer: 'mcp_agent' },
  };

  // Store as canonical entity (FeatureService expects entity with metadata=BusinessFeature)
  await dataAdapter.storeEntity({
    id: featId,
    tenantId,
    entityType: 'feature_analysis',
    createdAt: ts,
    updatedAt: ts,
    confidence: 'manual',
    metadata: featureEntity,
  } as unknown as import('../../types/canonical.types').CanonicalEntity);

  await graphAdapter.storeEntity({
    id: featId,
    tenantId,
    entityType: 'feature_analysis',
    createdAt: ts,
    updatedAt: ts,
    confidence: 'manual',
    metadata: featureEntity,
  } as unknown as import('../../types/canonical.types').CanonicalEntity);

  // service IMPLEMENTS_FEATURE feature
  for (const svcId of sourceServiceIds) {
    const rel = makeRelationship(tenantId, svcId, featId, 'IMPLEMENTS_FEATURE');
    await graphAdapter.storeRelationship(rel);
  }

  // Evidence from DFD
  for (const ref of dfd.evidence ?? []) {
    await dataAdapter.storeEvidence(makeEvidence(tenantId, featId, ref));
  }

  return featId;
}

export interface ThreatModelPersistenceResult {
  featuresWritten: string[];
  servicesWithDfdWritten: string[];
}

export async function persistThreatModels(
  tenantId: string,
  threatModels: ThreatModelContextSubmission[],
  featureIdMap: Record<string, string>,
  serviceIdMap: Record<string, string>,
  dataAdapter: PostgresDataAdapter,
  graphAdapter: PostgresGraphAdapter,
): Promise<ThreatModelPersistenceResult> {
  const featuresWritten: string[] = [];
  const servicesWithDfdWritten: string[] = [];

  for (const tm of threatModels) {
    const featId = featureIdMap[tm.featureName];
    if (!featId) continue;

    const ts = now();
    const existing = await dataAdapter.getEntity(tenantId, featId);
    if (existing) {
      const meta = (existing.metadata as BusinessFeature);
      const updated = {
        ...existing,
        updatedAt: ts,
        metadata: {
          ...meta,
          threatModel: sanitizeThreatModel(tm.featureThreatModel),
          updatedAt: ts,
        },
      };
      await dataAdapter.storeEntity(updated as unknown as import('../../types/canonical.types').CanonicalEntity);
      await graphAdapter.storeEntity(updated as unknown as import('../../types/canonical.types').CanonicalEntity);
      featuresWritten.push(tm.featureName);
    }

    for (const stm of tm.serviceThreatModels ?? []) {
      const svcId = serviceIdMap[stm.serviceName];
      if (!svcId) continue;
      const svcEntity = await dataAdapter.getEntity(tenantId, svcId);
      if (svcEntity) {
        const updatedSvc = {
          ...svcEntity,
          updatedAt: ts,
          serviceThreatModel: stm.threatModel,
          serviceDfd: stm.serviceDfd,
        };
        await dataAdapter.storeEntity(updatedSvc as unknown as import('../../types/canonical.types').CanonicalEntity);
        await graphAdapter.storeEntity(updatedSvc as unknown as import('../../types/canonical.types').CanonicalEntity);
        if (!servicesWithDfdWritten.includes(stm.serviceName)) {
          servicesWithDfdWritten.push(stm.serviceName);
        }
      }
    }
  }

  return { featuresWritten, servicesWithDfdWritten };
}

export async function persistRelationships(
  tenantId: string,
  relationships: Array<{
    sourceKey: string;
    targetKey: string;
    relationshipType: string;
    confidence: 'deterministic' | 'manual' | 'heuristic';
    rationale: string;
    evidence: EvidenceRef[];
  }>,
  serviceIdMap: Record<string, string>,
  featureIdMap: Record<string, string>,
  dataAdapter: PostgresDataAdapter,
  graphAdapter: PostgresGraphAdapter,
): Promise<void> {
  for (const rel of relationships) {
    const sourceId = serviceIdMap[rel.sourceKey] ?? featureIdMap[rel.sourceKey] ?? rel.sourceKey;
    const targetId = serviceIdMap[rel.targetKey] ?? featureIdMap[rel.targetKey] ?? rel.targetKey;

    if (!sourceId || !targetId) continue;

    const relType = rel.relationshipType as RelationshipType;
    const relationship: Relationship = {
      id: relationshipId(tenantId, sourceId, relType, targetId),
      tenantId,
      type: relType,
      sourceId,
      targetId,
      validFrom: now(),
      confidence: rel.confidence,
      metadata: { rationale: rel.rationale },
    };

    await graphAdapter.storeRelationship(relationship);

    for (const ref of rel.evidence ?? []) {
      await dataAdapter.storeEvidence(makeEvidence(tenantId, relationship.id, ref));
    }
  }
}
