/**
 * ArchitectureQueryService
 *
 * Deterministic, read-only queries over indexed repository security architecture.
 * Works without embeddings — no LLM key required in local mode.
 *
 * Three MVP methods exposed as MCP tools:
 *   queryArchitecture      → query_architecture
 *   getArchitectureBaseline → get_architecture_baseline
 *   findArchitectureGaps   → find_architecture_gaps
 */

import type { PostgresDataAdapter } from '../persistence/data-adapter';
import type { IIndexingRunRepository } from '../persistence/interfaces';
import type { FeatureService } from './feature.service';
import type { BusinessFeature } from '../types/business-feature.types';
import type { Evidence } from '../types/canonical.types';
import type {
  ArchitectureQueryRequest,
  ArchitectureQueryResponse,
  ArchitectureQueryMatch,
  ArchitectureQueryFilters,
  ArchitectureGap,
  ArchitectureEvidenceRef,
  ArchitectureBaselineRequest,
  ArchitectureBaselineResponse,
  ArchitectureScope,
  FindArchitectureGapsResponse,
} from '../types/architecture-query.types';
import { computeGaps } from './repository-indexing/coverage';
import type { RepositoryIndexingRunMetadata } from '../types/repository-indexing.types';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
type Severity = typeof SEVERITY_ORDER[number];

function severityIndex(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s as Severity);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function meetsMinSeverity(threatSeverity: string, minSeverity: string): boolean {
  return severityIndex(threatSeverity) <= severityIndex(minSeverity);
}

export class ArchitectureQueryService {
  constructor(
    private readonly dataAdapter: PostgresDataAdapter,
    private readonly featureService: FeatureService,
    private readonly indexingRunRepository: IIndexingRunRepository,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────────

  async queryArchitecture(
    tenantId: string,
    repository: string | undefined,
    request: ArchitectureQueryRequest,
  ): Promise<ArchitectureQueryResponse> {
    const limit = Math.min(request.limit ?? 10, 50);
    const { filters, scope, query } = request;

    // Load candidate features using deterministic filters
    let features = await this.featureService.getFeaturesByTenant(tenantId);

    // Filter to repo scope if we have a persisted repository entity
    if (repository) {
      const repoId = await this.featureService.resolveRepositoryIdByName(tenantId, repository);
      if (repoId) {
        features = features.filter(f => f.sourceRepositoryId === repoId);
      }
    }

    const fullFeatures: BusinessFeature[] = [];

    // Resolve full features for candidates (pagination-safe: summaries first)
    for (const summary of features) {
      const full = await this.featureService.getFeatureById(tenantId, summary.id);
      if (full) fullFeatures.push(full);
    }

    // Apply deterministic filters
    let candidates = this.applyFilters(fullFeatures, scope, filters);

    // Lightweight keyword ranking if a query string is provided
    if (query) {
      candidates = this.rankByKeyword(candidates, query);
    }

    const sliced = candidates.slice(0, limit);

    const matches: ArchitectureQueryMatch[] = await Promise.all(
      sliced.map(async f => {
        const evidence = request.includeEvidence
          ? await this.getEvidenceForSubjects(tenantId, [f.id])
          : undefined;
        return this.featureToMatch(f, filters, evidence);
      }),
    );

    const gaps = request.includeGaps
      ? (await this.findArchitectureGaps(tenantId, repository, { scope, limit: 10 })).gaps
      : [];

    const confidence = this.deriveQueryConfidence(fullFeatures, matches, gaps);
    const suggestedNextAction = this.suggestNextAction(confidence, gaps, fullFeatures.length);

    const answer = this.synthesizeAnswer(matches, filters, scope, query);

    return { answer, matches, gaps, confidence, suggestedNextAction };
  }

  async getArchitectureBaseline(
    tenantId: string,
    repository: string | undefined,
    request: ArchitectureBaselineRequest,
  ): Promise<ArchitectureBaselineResponse> {
    const { scope } = request;

    switch (scope.type) {
      case 'repository':
        return this.repositoryBaseline(tenantId, repository, request);
      case 'service':
        return this.serviceBaseline(tenantId, repository, scope, request);
      case 'feature':
        return this.featureBaseline(tenantId, scope, request);
      default:
        return this.repositoryBaseline(tenantId, repository, request);
    }
  }

  async findArchitectureGaps(
    tenantId: string,
    repository: string | undefined,
    request?: { scope?: ArchitectureScope; limit?: number },
  ): Promise<FindArchitectureGapsResponse> {
    const limit = request?.limit ?? 50;
    const gaps: ArchitectureGap[] = [];

    // ── Indexing-level gaps from the latest run ───────────────────────────────
    const allRuns = await this.indexingRunRepository.getAll(tenantId);
    const runs = allRuns.filter(r => {
      const meta = (r.metadata as any)?.repositoryIndexing as RepositoryIndexingRunMetadata | undefined;
      if (!meta || meta.indexer !== 'mcp_agent') return false;
      if (repository && meta.repository !== repository) return false;
      return true;
    });

    const latestRun = runs[0] ?? null;
    if (latestRun) {
      const meta = (latestRun.metadata as any).repositoryIndexing as RepositoryIndexingRunMetadata;
      const indexingGaps = computeGaps(meta);
      for (const ig of indexingGaps) {
        gaps.push({
          id: ig.id,
          severity: ig.severity,
          category: 'missing_context',
          description: ig.description,
          followUp: ig.followUp ?? 'Re-run index_repository to resolve.',
        });
      }
    } else {
      gaps.push({
        id: 'gap-not-indexed',
        severity: 'high',
        category: 'missing_context',
        description: 'Repository has not been indexed. No architectural context is available.',
        followUp: 'Call index_repository to begin indexing.',
      });
    }

    // ── Entity-level gaps from features ───────────────────────────────────────
    let features = await this.featureService.getFeaturesByTenant(tenantId);

    if (repository) {
      const repoId = await this.featureService.resolveRepositoryIdByName(tenantId, repository);
      if (repoId) {
        features = features.filter(f => f.sourceRepositoryId === repoId);
      }
    }

    if (request?.scope?.type === 'service' && request.scope.name) {
      features = features.filter(f =>
        f.sourceServiceNames?.some(s =>
          s.toLowerCase() === request.scope!.name!.toLowerCase(),
        ),
      );
    } else if (request?.scope?.type === 'feature' && request.scope.id) {
      features = features.filter(f => f.id === request.scope!.id);
    }

    for (const summary of features) {
      const feature = await this.featureService.getFeatureById(tenantId, summary.id);
      if (!feature) continue;
      gaps.push(...this.entityGapsForFeature(feature));
    }

    const sorted = gaps.sort((a, b) => severityIndex(a.severity) - severityIndex(b.severity));
    const sliced = sorted.slice(0, limit);

    const suggestedNextAction = this.suggestNextAction(
      sliced.some(g => g.severity === 'high' || g.severity === 'critical') ? 'low' : 'medium',
      sliced,
      features.length,
    );

    return { gaps: sliced, suggestedNextAction };
  }

  // ─── Baseline builders ────────────────────────────────────────────────────────

  private async repositoryBaseline(
    tenantId: string,
    repository: string | undefined,
    request: ArchitectureBaselineRequest,
  ): Promise<ArchitectureBaselineResponse> {
    const scope: ArchitectureScope = { type: 'repository', name: repository };

    let features = await this.featureService.getFeaturesByTenant(tenantId);

    let repositoryEntity: unknown = null;
    if (repository) {
      const repoId = await this.featureService.resolveRepositoryIdByName(tenantId, repository);
      if (repoId) {
        features = features.filter(f => f.sourceRepositoryId === repoId);
        repositoryEntity = await this.dataAdapter.getEntity(tenantId, repoId);
      }
    }

    const fullFeatures: BusinessFeature[] = [];
    for (const s of features) {
      const f = await this.featureService.getFeatureById(tenantId, s.id);
      if (f) fullFeatures.push(f);
    }

    const serviceIds = [...new Set(fullFeatures.flatMap(f => f.sourceServiceIds ?? []))];
    const services = await Promise.all(
      serviceIds.map(id => this.dataAdapter.getEntity(tenantId, id).catch(() => null)),
    ).then(r => r.filter(Boolean));

    const dfds = fullFeatures
      .filter(f => (f.dataFlowDiagram?.flows?.length ?? 0) > 0)
      .map(f => ({ featureId: f.id, featureName: f.name, dfd: f.dataFlowDiagram }));

    const threatModels = request.includeThreats !== false
      ? fullFeatures
          .filter(f => (f.threatModel?.strideThreats?.length ?? 0) > 0)
          .map(f => ({ featureId: f.id, featureName: f.name, threatModel: f.threatModel }))
      : [];

    const evidence = request.includeEvidence
      ? await this.getEvidenceForSubjects(tenantId, fullFeatures.map(f => f.id))
      : [];

    const gaps = (await this.findArchitectureGaps(tenantId, repository)).gaps;
    const confidence = this.deriveBaselineConfidence(fullFeatures, gaps);

    return {
      scope,
      repository: repositoryEntity,
      services,
      features: fullFeatures,
      dataFlowDiagrams: dfds,
      threatModels,
      relationships: [],
      evidence,
      gaps,
      confidence,
    };
  }

  private async serviceBaseline(
    tenantId: string,
    repository: string | undefined,
    scope: ArchitectureScope,
    request: ArchitectureBaselineRequest,
  ): Promise<ArchitectureBaselineResponse> {
    const serviceName = scope.name ?? scope.id ?? '';

    let features = await this.featureService.getFeaturesByTenant(tenantId);
    features = features.filter(f =>
      f.sourceServiceNames?.some(s => s.toLowerCase() === serviceName.toLowerCase()),
    );

    const serviceEntities = serviceName
      ? await this.featureService.getCodeServicesByNames(tenantId, [serviceName], repository
          ? await this.featureService.resolveRepositoryIdByName(tenantId, repository)
          : undefined)
      : [];

    const fullFeatures: BusinessFeature[] = [];
    for (const s of features) {
      const f = await this.featureService.getFeatureById(tenantId, s.id);
      if (f) fullFeatures.push(f);
    }

    const dfds = fullFeatures
      .filter(f => (f.dataFlowDiagram?.flows?.length ?? 0) > 0)
      .map(f => ({ featureId: f.id, featureName: f.name, dfd: f.dataFlowDiagram }));

    const threatModels = request.includeThreats !== false
      ? fullFeatures
          .filter(f => (f.threatModel?.strideThreats?.length ?? 0) > 0)
          .map(f => ({ featureId: f.id, featureName: f.name, threatModel: f.threatModel }))
      : [];

    const subjectIds = [
      ...serviceEntities.map((s: any) => s.id as string),
      ...fullFeatures.map(f => f.id),
    ];
    const evidence = request.includeEvidence
      ? await this.getEvidenceForSubjects(tenantId, subjectIds)
      : [];

    const gaps = (await this.findArchitectureGaps(tenantId, repository, { scope })).gaps;
    const confidence = this.deriveBaselineConfidence(fullFeatures, gaps);

    return {
      scope,
      services: serviceEntities,
      features: fullFeatures,
      dataFlowDiagrams: dfds,
      threatModels,
      relationships: [],
      evidence,
      gaps,
      confidence,
    };
  }

  private async featureBaseline(
    tenantId: string,
    scope: ArchitectureScope,
    request: ArchitectureBaselineRequest,
  ): Promise<ArchitectureBaselineResponse> {
    let feature: BusinessFeature | null = null;

    if (scope.id) {
      feature = await this.featureService.getFeatureById(tenantId, scope.id);
    } else if (scope.name) {
      const summaries = await this.featureService.getFeaturesByTenant(tenantId);
      const match = summaries.find(f =>
        f.name.toLowerCase() === scope.name!.toLowerCase(),
      );
      if (match) feature = await this.featureService.getFeatureById(tenantId, match.id);
    }

    if (!feature) {
      return {
        scope,
        services: [],
        features: [],
        dataFlowDiagrams: [],
        threatModels: [],
        relationships: [],
        evidence: [],
        gaps: [{
          id: 'gap-feature-not-found',
          severity: 'high',
          category: 'missing_context',
          description: `Feature '${scope.name ?? scope.id}' was not found in the indexed context.`,
          followUp: 'Run index_repository or verify the feature name/ID.',
        }],
        confidence: 'low',
      };
    }

    const dfds = (feature.dataFlowDiagram?.flows?.length ?? 0) > 0
      ? [{ featureId: feature.id, featureName: feature.name, dfd: feature.dataFlowDiagram }]
      : [];

    const threatModels = request.includeThreats !== false && (feature.threatModel?.strideThreats?.length ?? 0) > 0
      ? [{ featureId: feature.id, featureName: feature.name, threatModel: feature.threatModel }]
      : [];

    const evidence = request.includeEvidence
      ? await this.getEvidenceForSubjects(tenantId, [feature.id])
      : [];

    const gaps = this.entityGapsForFeature(feature);
    const confidence = this.deriveBaselineConfidence([feature], gaps);

    return {
      scope,
      services: [],
      features: [feature],
      dataFlowDiagrams: dfds,
      threatModels,
      relationships: [],
      evidence,
      gaps,
      confidence,
    };
  }

  // ─── Filter helpers ───────────────────────────────────────────────────────────

  private applyFilters(
    features: BusinessFeature[],
    scope?: ArchitectureScope,
    filters?: ArchitectureQueryFilters,
  ): BusinessFeature[] {
    let result = features;

    if (scope?.type === 'feature') {
      if (scope.id) result = result.filter(f => f.id === scope.id);
      else if (scope.name) {
        result = result.filter(f =>
          f.name.toLowerCase().includes(scope.name!.toLowerCase()),
        );
      }
    }

    if (scope?.type === 'service' && scope.name) {
      result = result.filter(f =>
        f.sourceServiceNames?.some(s =>
          s.toLowerCase().includes(scope.name!.toLowerCase()),
        ),
      );
    }

    if (!filters) return result;

    if (filters.featureId) {
      result = result.filter(f => f.id === filters.featureId);
    }

    if (filters.featureName) {
      const q = filters.featureName.toLowerCase();
      result = result.filter(f => f.name.toLowerCase().includes(q));
    }

    if (filters.serviceName) {
      const sn = filters.serviceName.toLowerCase();
      result = result.filter(f =>
        f.sourceServiceNames?.some(s => s.toLowerCase().includes(sn)),
      );
    }

    if (filters.dataClassification) {
      const dc = filters.dataClassification;
      result = result.filter(f => {
        const flows = f.dataFlowDiagram?.flows ?? [];
        const stores = f.dataFlowDiagram?.dataStores ?? [];
        const tm = f.threatModel?.dataClassificationSummary ?? [];
        return (
          flows.some(fl => fl.dataClassification === dc) ||
          stores.some(ds => ds.dataClassification === dc) ||
          tm.some(c => c.classification === dc)
        );
      });
    }

    if (filters.trustBoundary) {
      const tb = filters.trustBoundary;
      result = result.filter(f =>
        f.dataFlowDiagram?.trustBoundaries?.includes(tb as any),
      );
    }

    if (filters.minSeverity) {
      result = result.filter(f => {
        const threats = f.threatModel?.strideThreats ?? [];
        return threats.some(t => meetsMinSeverity(t.severity, filters.minSeverity!));
      });
    }

    if (filters.externalOnly) {
      result = result.filter(f => {
        const actors = f.dataFlowDiagram?.actors ?? [];
        return actors.some(a => !a.trusted);
      });
    }

    if (filters.authRequired !== undefined) {
      const required = filters.authRequired;
      result = result.filter(f => {
        const flows = f.dataFlowDiagram?.flows ?? [];
        return flows.some(fl => fl.authenticationRequired === required);
      });
    }

    if (filters.encrypted !== undefined) {
      const enc = filters.encrypted;
      result = result.filter(f => {
        const flows = f.dataFlowDiagram?.flows ?? [];
        return flows.some(fl => fl.encrypted === enc);
      });
    }

    return result;
  }

  private rankByKeyword(features: BusinessFeature[], query: string): BusinessFeature[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (tokens.length === 0) return features;

    const scored = features.map(f => {
      const haystack = [
        f.name,
        f.description,
        f.businessValue,
        ...(f.sourceServiceNames ?? []),
        ...(f.dataFlowDiagram?.flows?.map(fl => fl.label ?? '') ?? []),
        ...(f.dataFlowDiagram?.flows?.flatMap(fl => fl.dataTypes) ?? []),
        ...(f.threatModel?.strideThreats?.map(t => t.title) ?? []),
        ...(f.threatModel?.strideThreats?.flatMap(t => t.mitigations) ?? []),
        ...(f.threatModel?.securityRecommendations ?? []),
      ].join(' ').toLowerCase();

      const score = tokens.filter(t => haystack.includes(t)).length;
      return { feature: f, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .filter(s => s.score > 0)
      .map(s => s.feature);
  }

  // ─── Entity gap rules ─────────────────────────────────────────────────────────

  private entityGapsForFeature(feature: BusinessFeature): ArchitectureGap[] {
    const gaps: ArchitectureGap[] = [];
    const dfd = feature.dataFlowDiagram;
    const tm = feature.threatModel;
    const flows = dfd?.flows ?? [];
    const stores = dfd?.dataStores ?? [];
    const threats = tm?.strideThreats ?? [];
    const tbs = dfd?.trustBoundaries ?? [];

    const SENSITIVE = new Set(['confidential', 'restricted']);

    if (flows.length === 0) {
      gaps.push({
        id: `gap-${feature.id}-no-dfd-flows`,
        severity: 'high',
        category: 'missing_context',
        description: `Feature '${feature.name}' has no DFD flows.`,
        affectedEntityId: feature.id,
        affectedEntityName: feature.name,
        followUp: 'Re-submit dfd_creation stage with flows for this feature.',
      });
    }

    for (const flow of flows) {
      if (SENSITIVE.has(flow.dataClassification ?? '')) {
        if (!flow.encrypted) {
          gaps.push({
            id: `gap-${feature.id}-flow-${flow.id}-no-encryption`,
            severity: 'high',
            category: 'security_control',
            description: `Flow '${flow.label ?? flow.id}' in feature '${feature.name}' carries ${flow.dataClassification} data without encryption.`,
            affectedEntityId: feature.id,
            affectedEntityName: feature.name,
            followUp: 'Enable TLS/encryption on this flow and update the DFD.',
          });
        }
        if (!flow.authenticationRequired) {
          gaps.push({
            id: `gap-${feature.id}-flow-${flow.id}-no-auth`,
            severity: 'high',
            category: 'security_control',
            description: `Flow '${flow.label ?? flow.id}' in feature '${feature.name}' carries ${flow.dataClassification} data without authentication.`,
            affectedEntityId: feature.id,
            affectedEntityName: feature.name,
            followUp: 'Add authentication requirement to this flow.',
          });
        }
      }

      // Trust boundary crossing without auth
      if (tbs.length > 0 && !flow.authenticationRequired) {
        const crossesBoundary = flow.dataClassification
          ? SENSITIVE.has(flow.dataClassification)
          : false;
        if (crossesBoundary) {
          gaps.push({
            id: `gap-${feature.id}-flow-${flow.id}-tb-no-auth`,
            severity: 'high',
            category: 'security_control',
            description: `Flow '${flow.label ?? flow.id}' crosses a trust boundary without authentication in feature '${feature.name}'.`,
            affectedEntityId: feature.id,
            affectedEntityName: feature.name,
            followUp: 'Enforce authentication for flows crossing trust boundaries.',
          });
        }
      }
    }

    for (const store of stores) {
      if (SENSITIVE.has(store.dataClassification ?? '')) {
        if (store.encryptionAtRest === false) {
          gaps.push({
            id: `gap-${feature.id}-store-${store.id}-no-encryption`,
            severity: 'high',
            category: 'security_control',
            description: `Data store '${store.label}' in feature '${feature.name}' holds ${store.dataClassification} data without encryption at rest.`,
            affectedEntityId: feature.id,
            affectedEntityName: feature.name,
            followUp: 'Enable encryption at rest on this data store.',
          });
        }
      }
    }

    if (flows.length > 0 && threats.length === 0) {
      gaps.push({
        id: `gap-${feature.id}-no-threats`,
        severity: 'medium',
        category: 'missing_context',
        description: `Feature '${feature.name}' has DFD flows but no threat model entries.`,
        affectedEntityId: feature.id,
        affectedEntityName: feature.name,
        followUp: 'Submit threat_model_creation stage for this feature.',
      });
    }

    for (const threat of threats) {
      if (
        (threat.severity === 'critical' || threat.severity === 'high') &&
        (!threat.mitigations || threat.mitigations.length === 0)
      ) {
        gaps.push({
          id: `gap-${feature.id}-threat-${threat.id}-no-mitigation`,
          severity: 'high',
          category: 'security_control',
          description: `${threat.severity.toUpperCase()} threat '${threat.title}' in feature '${feature.name}' has no mitigations.`,
          affectedEntityId: feature.id,
          affectedEntityName: feature.name,
          followUp: 'Add mitigations to this threat in the threat model.',
        });
      }
    }

    return gaps;
  }

  // ─── Evidence helper ──────────────────────────────────────────────────────────

  private async getEvidenceForSubjects(
    tenantId: string,
    subjectIds: string[],
    limitPerSubject = 5,
  ): Promise<ArchitectureEvidenceRef[]> {
    if (subjectIds.length === 0) return [];
    const records: Evidence[] = await this.dataAdapter.listEvidenceForSubjects(
      tenantId,
      subjectIds,
      limitPerSubject,
    );
    return records.map(ev => {
      const p = ev as any;
      return {
        subjectId: p.subjectId ?? p.entityId ?? '',
        filePath: p.filePath ?? p.payload?.filePath ?? '',
        lineStart: p.lineStart ?? p.payload?.lineStart,
        lineEnd: p.lineEnd ?? p.payload?.lineEnd,
        symbol: p.symbol ?? p.payload?.symbol,
        rationale: p.rationale ?? p.payload?.rationale ?? '',
      } satisfies ArchitectureEvidenceRef;
    }).filter(r => r.filePath);
  }

  // ─── Match builder ────────────────────────────────────────────────────────────

  private featureToMatch(
    feature: BusinessFeature,
    filters?: ArchitectureQueryFilters,
    evidence?: ArchitectureEvidenceRef[],
  ): ArchitectureQueryMatch {
    const flows = feature.dataFlowDiagram?.flows ?? [];
    const threats = feature.threatModel?.strideThreats ?? [];

    const matchedFacts: Record<string, unknown> = {
      flowCount: flows.length,
      threatCount: threats.length,
      overallRiskScore: feature.threatModel?.overallRiskScore ?? 0,
      sourceServices: feature.sourceServiceNames ?? [],
      trustBoundaries: feature.dataFlowDiagram?.trustBoundaries ?? [],
    };

    if (filters?.dataClassification) {
      const matchingFlows = flows
        .filter(f => f.dataClassification === filters.dataClassification)
        .map(f => ({ id: f.id, label: f.label, protocol: f.protocol, encrypted: f.encrypted, authRequired: f.authenticationRequired }));
      matchedFacts.matchingFlows = matchingFlows;
    }

    if (filters?.minSeverity) {
      matchedFacts.matchingThreats = threats
        .filter(t => meetsMinSeverity(t.severity, filters.minSeverity!))
        .map(t => ({ id: t.id, title: t.title, severity: t.severity, category: t.category }));
    }

    const summaryParts: string[] = [`Feature: ${feature.name}`];
    if (feature.description) summaryParts.push(feature.description);
    if (flows.length > 0) summaryParts.push(`${flows.length} data flow(s)`);
    if (threats.length > 0) {
      const high = threats.filter(t => t.severity === 'critical' || t.severity === 'high');
      summaryParts.push(`${threats.length} threat(s)${high.length > 0 ? `, ${high.length} high/critical` : ''}`);
    }

    return {
      entityId: feature.id,
      entityType: 'feature',
      name: feature.name,
      summary: summaryParts.join('. '),
      score: 1.0,
      matchedFacts,
      evidence,
    };
  }

  // ─── Answer synthesis ─────────────────────────────────────────────────────────

  private synthesizeAnswer(
    matches: ArchitectureQueryMatch[],
    filters?: ArchitectureQueryFilters,
    scope?: ArchitectureScope,
    query?: string,
  ): string {
    if (matches.length === 0) {
      return 'No indexed features matched the query filters. Consider running index_repository or relaxing the filters.';
    }

    const parts: string[] = [];

    if (filters?.dataClassification) {
      parts.push(`Found ${matches.length} feature(s) involving ${filters.dataClassification} data.`);
    } else if (filters?.minSeverity) {
      parts.push(`Found ${matches.length} feature(s) with ${filters.minSeverity}+ severity threats.`);
    } else if (scope?.type === 'service') {
      parts.push(`Found ${matches.length} feature(s) for service '${scope.name ?? scope.id}'.`);
    } else if (query) {
      parts.push(`Found ${matches.length} feature(s) matching '${query}'.`);
    } else {
      parts.push(`Found ${matches.length} indexed feature(s).`);
    }

    const names = matches.slice(0, 5).map(m => m.name ?? m.entityId).join(', ');
    parts.push(`Features: ${names}${matches.length > 5 ? `, and ${matches.length - 5} more` : ''}.`);

    return parts.join(' ');
  }

  // ─── Confidence helpers ───────────────────────────────────────────────────────

  private deriveQueryConfidence(
    allFeatures: BusinessFeature[],
    matches: ArchitectureQueryMatch[],
    gaps: ArchitectureGap[],
  ): 'high' | 'medium' | 'low' {
    if (allFeatures.length === 0) return 'low';
    const hasHighGaps = gaps.some(g => g.severity === 'critical' || g.severity === 'high');
    if (matches.length > 0 && !hasHighGaps) return 'high';
    if (matches.length > 0) return 'medium';
    return 'low';
  }

  private deriveBaselineConfidence(
    features: BusinessFeature[],
    gaps: ArchitectureGap[],
  ): 'high' | 'medium' | 'low' {
    if (features.length === 0) return 'low';
    const hasBlockingGaps = gaps.some(g => g.category === 'missing_context' && g.severity === 'high');
    if (hasBlockingGaps) return 'low';
    const hasDfds = features.every(f => (f.dataFlowDiagram?.flows?.length ?? 0) > 0);
    if (hasDfds && gaps.filter(g => g.severity === 'high').length === 0) return 'high';
    return 'medium';
  }

  private suggestNextAction(
    confidence: 'high' | 'medium' | 'low',
    gaps: ArchitectureGap[],
    featureCount: number,
  ): string | undefined {
    if (featureCount === 0) return 'Run index_repository to index this repository.';
    if (confidence === 'low') return 'Run index_repository to improve coverage before querying.';
    const indexingGap = gaps.find(g => g.category === 'missing_context' && (g.severity === 'high' || g.severity === 'critical'));
    if (indexingGap) return `Run index_repository: ${indexingGap.followUp}`;
    if (gaps.some(g => g.category === 'security_control')) {
      return 'Review high-severity security control gaps and start_security_review for affected features.';
    }
    return undefined;
  }
}
