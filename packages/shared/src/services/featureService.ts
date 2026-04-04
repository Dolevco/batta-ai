/**
 * FeatureService — read/query BusinessFeature entities from Qdrant + Neo4j.
 * Also provides composeArchitectureDoc() to generate ARCHITECTURE.md-style
 * Markdown from stored features.
 */

import type { TenantId } from '../types/canonical.types';
import type { CodeService } from '../types/canonical.types';
import type {
  BusinessFeature,
  BusinessFeatureSummary,
  ThreatSeverity,
} from '../types/business-feature.types';
import { QdrantAdapter } from '../persistence/qdrantDataAdapter';

/** Collection name used for all feature analysis documents */
export const FEATURE_ANALYSES_COLLECTION = 'feature_analyses';

/** A semantic search result for a business feature */
export interface FeatureSemanticSearchResult {
  feature: BusinessFeature;
  score: number;
}

export class FeatureService {
  constructor(
    private readonly qdrant: QdrantAdapter,
    private readonly neo4j?: any
  ) {}

  // ─── Read helpers ────────────────────────────────────────────────────────────

  async getFeaturesByTenant(tenantId: TenantId): Promise<BusinessFeatureSummary[]> {
    const entities = await this.qdrant.listEntities(tenantId, 'feature_analysis', 500);
    return entities
      .map(e => e.metadata as unknown as BusinessFeature)
      // Only surface the current, authoritative version of each feature.
      // Deprecated records (superseded by a newer scan) are excluded from the
      // default list; callers that need history can use getFeatureHistory().
      .filter(f => !f.status || f.status === 'active')
      .map(f => this.toSummary(f));
  }

  /**
   * Return all versions (active + deprecated) for a feature lineage, ordered
   * newest first.  The lineage is resolved by walking previousVersionId links
   * starting from the given featureId (which may be any version in the chain).
   */
  async getFeatureHistory(
    tenantId: TenantId,
    featureId: string
  ): Promise<BusinessFeature[]> {
    // Load the starting record
    const start = await this.getFeatureById(tenantId, featureId);
    if (!start) return [];

    // Collect the full changelog from the start record (active version carries
    // the cumulative log), then walk backwards to fetch each prior version.
    const history: BusinessFeature[] = [start];

    let current = start;
    while (current.previousVersionId) {
      const prev = await this.getFeatureById(tenantId, current.previousVersionId);
      if (!prev) break;
      history.push(prev);
      current = prev;
    }

    // Newest first
    return history;
  }

  async getFeatureById(
    tenantId: TenantId,
    id: string
  ): Promise<BusinessFeature | null> {
    const entity = await this.qdrant.getEntity(tenantId, id);
    if (!entity) return null;
    // Feature analyses are stored with entityType 'feature_analysis' which is
    // not in the CanonicalEntity union — cast through unknown first.
    const raw = entity as unknown as { entityType: string; metadata: Record<string, unknown> };
    if (raw.entityType !== 'feature_analysis') return null;
    return raw.metadata as unknown as BusinessFeature;
  }

  /**
   * Semantically search business features using natural language.
   * Uses vector similarity on the feature semantic documents (documentType='feature')
   * which embed businessValue + description + userStories + dataFlow text.
   *
   * Security: query is trimmed and length-capped by the caller (chat tools).
   * Results are scoped to the tenant via the Qdrant documentType+tenantId filter.
   */
  async searchFeaturesSemantic(
    tenantId: TenantId,
    query: string,
    limit: number = 10
  ): Promise<FeatureSemanticSearchResult[]> {
    const semanticResults = await this.qdrant.searchSemanticDocumentsByType(
      tenantId,
      query,
      'feature',
      limit
    );

    const results: FeatureSemanticSearchResult[] = [];

    for (const sr of semanticResults) {
      try {
        // artifactId is the BusinessFeature entity id
        const feature = await this.getFeatureById(tenantId, sr.document.artifactId);
        if (feature) {
          results.push({ feature, score: sr.score });
        }
      } catch {
        // skip unresolvable documents silently
      }
    }

    return results;
  }

  /**
   * Fetch code_service entities whose names match any of the provided service
   * name terms.  Both scoped names (e.g. "@ai-agent/api") and bare names
   * (e.g. "api") are matched exactly in the DB via Qdrant's `match.any` filter
   * — no in-memory scan of all services.
   *
   * If `repositoryId` is provided it is added as an additional Qdrant filter to
   * scope results to that repository only.
   *
   * Security (input_validation / injection): names are capped in count (20) and
   * length (100 chars) before use; repositoryId is capped at 200 chars. All
   * values are passed as a structured array/value to the Qdrant client library,
   * never interpolated into any query string.
   */
  async getCodeServicesByNames(
    tenantId: TenantId,
    serviceNames: string[],
    repositoryId?: string,
  ): Promise<CodeService[]> {
    // [security: input_validation] Cap list and individual name lengths before use
    const terms = serviceNames
      .slice(0, 20)
      .map(s => s.slice(0, 100).trim())
      .filter(s => s.length > 0);

    // [security: input_validation] Cap repositoryId length; passed as structured filter value only
    const repoId = repositoryId ? repositoryId.slice(0, 200).trim() : undefined;

    const entities = await this.qdrant.listEntitiesByNames(tenantId, 'code_service', terms, 50, repoId || undefined);
    return entities as unknown as CodeService[];
  }

  /**
   * Resolve a repository entity ID from its name.  Returns undefined if not found.
   *
   * Security: repositoryName is capped at 200 chars and passed as a structured
   * Qdrant filter value, never interpolated into any query string.
   */
  async resolveRepositoryIdByName(
    tenantId: TenantId,
    repositoryName: string,
  ): Promise<string | undefined> {
    const name = repositoryName.slice(0, 200).trim();
    if (!name) return undefined;
    const entities = await this.qdrant.listEntitiesByNames(tenantId, 'code_repository', [name], 1);
    return entities[0]?.id;
  }

  // ─── Architecture doc composer ───────────────────────────────────────────────

  /**
   * Generates an ARCHITECTURE.md-compatible Markdown document from stored
   * BusinessFeature records.  Groups features by sourceServiceIds.
   */
  composeArchitectureDoc(features: BusinessFeature[]): string {
    const now = new Date().toISOString().split('T')[0];
    const lines: string[] = [
      `# Architecture Overview`,
      ``,
      `> **Generated:** ${now}  `,
      `> **Scope:** ${features.length} business feature${features.length !== 1 ? 's' : ''} across ${this.uniqueServiceCount(features)} service${this.uniqueServiceCount(features) !== 1 ? 's' : ''}  `,
      `> **Method:** Automated LLM-driven business feature extraction + STRIDE threat modelling`,
      ``,
      `---`,
      ``,
      `## Table of Contents`,
      ``,
    ];

    // Group by first sourceServiceId
    const byService = this.groupByService(features);
    let sectionIdx = 1;
    for (const [serviceId, svcFeatures] of Object.entries(byService)) {
      const serviceName = svcFeatures[0]?.sourceServiceIds[0] ?? serviceId;
      lines.push(`${sectionIdx}. [Service: ${serviceName}](#service-${this.slug(serviceName)})`);
      svcFeatures.forEach((f, i) => {
        lines.push(`   - [Feature ${i + 1} – ${f.name}](#feature-${this.slug(f.name)})`);
      });
      sectionIdx++;
    }

    lines.push(``, `---`, ``);

    sectionIdx = 1;
    for (const [, svcFeatures] of Object.entries(byService)) {
      const serviceName = svcFeatures[0]?.sourceServiceIds[0] ?? 'Unknown Service';
      lines.push(`## ${sectionIdx}. Service: ${serviceName}`, ``);

      svcFeatures.forEach((feature, fi) => {
        lines.push(
          `### Feature ${fi + 1} – ${feature.name}`,
          ``,
          `**Business Value:** ${feature.businessValue}`,
          ``,
          `**Description:** ${feature.description}`,
          ``
        );

        // User stories
        if (feature.userStories?.length) {
          lines.push(`**User Stories:**`);
          feature.userStories.forEach(s => lines.push(`- ${s}`));
          lines.push(``);
        }

        // Compliance
        if (feature.threatModel?.complianceConsiderations?.length) {
          lines.push(
            `**Compliance:** ${feature.threatModel.complianceConsiderations.join(', ')}`,
            ``
          );
        }

        // Data classification summary table
        const classificationLevels = feature.threatModel?.dataClassificationSummary ?? [];
        if (classificationLevels.length) {
          lines.push(
            `**Data Classification:**`,
            ``,
            `| Classification | Data Types | Protection Mechanisms |`,
            `|----------------|------------|----------------------|`
          );
          classificationLevels.forEach(c =>
            lines.push(
              `| ${c.classification.toUpperCase()} | ${c.dataTypes.join(', ')} | ${c.protectionMechanisms.join(', ') || '—'} |`
            )
          );
          lines.push(``);
        }

        // Data flow summary table
        const flows = feature.dataFlowDiagram?.flows ?? [];
        if (flows.length) {
          const nodeMap = this.buildNodeMap(feature);
          lines.push(
            `**Data Flow Summary:**`,
            ``,
            `| From | To | Data | Protocol | Encrypted | Auth Required |`,
            `|------|----|------|----------|-----------|---------------|`
          );
          flows.forEach(f =>
            lines.push(
              `| ${nodeMap[f.from] ?? f.from} | ${nodeMap[f.to] ?? f.to} | ${f.dataTypes.join(', ')} | ${f.protocol} | ${f.encrypted ? '✅' : '⚠️'} | ${f.authenticationRequired ? '✅' : '—'} |`
            )
          );
          lines.push(``);
        }

        // Threat model table
        const threats = feature.threatModel?.strideThreats ?? [];
        if (threats.length) {
          lines.push(
            `**Threat Model:**`,
            ``,
            `| # | Threat (STRIDE) | Severity | Mitigations | Status |`,
            `|---|----------------|----------|-------------|--------|`
          );
          threats.forEach(t =>
            lines.push(
              `| ${t.id} | **${t.category}** – ${t.title} | ${t.severity.toUpperCase()} | ${t.mitigations.slice(0, 2).join('; ')} | ${t.status} |`
            )
          );
          lines.push(``);
        }

        // Recommendations
        const recs = feature.threatModel?.securityRecommendations ?? [];
        if (recs.length) {
          lines.push(`**Security Recommendations:**`, ``);
          recs.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
          lines.push(``);
        }

        lines.push(`**Overall Risk Score:** ${feature.threatModel?.overallRiskScore ?? 'N/A'} / 100`, ``, `---`, ``);
      });

      sectionIdx++;
    }

    return lines.join('\n');
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private toSummary(f: BusinessFeature): BusinessFeatureSummary {
    const threats = f.threatModel?.strideThreats ?? [];
    const highestSeverity = this.highestSeverity(threats.map(t => t.severity));
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      sourceServiceIds: f.sourceServiceIds ?? [],
      ...(f.sourceServiceNames?.length && { sourceServiceNames: f.sourceServiceNames }),
      ...(f.sourceRepositoryId && { sourceRepositoryId: f.sourceRepositoryId }),
      ...(f.sourceRepositoryName && { sourceRepositoryName: f.sourceRepositoryName }),
      overallRiskScore: f.threatModel?.overallRiskScore ?? 0,
      threatCount: threats.length,
      complianceConsiderations: f.threatModel?.complianceConsiderations ?? [],
      highestSeverity,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      version: f.version ?? 1,
      status: f.status ?? 'active',
      ...(f.previousVersionId && { previousVersionId: f.previousVersionId }),
      changeLog: f.changeLog ?? [],
    };
  }

  private highestSeverity(severities: ThreatSeverity[]): ThreatSeverity | null {
    const order: ThreatSeverity[] = ['critical', 'high', 'medium', 'low'];
    for (const s of order) {
      if (severities.includes(s)) return s;
    }
    return null;
  }

  private groupByService(features: BusinessFeature[]): Record<string, BusinessFeature[]> {
    const out: Record<string, BusinessFeature[]> = {};
    for (const f of features) {
      const key = f.sourceServiceIds?.[0] ?? 'unknown';
      (out[key] ??= []).push(f);
    }
    return out;
  }

  private uniqueServiceCount(features: BusinessFeature[]): number {
    return new Set(features.flatMap(f => f.sourceServiceIds ?? [])).size;
  }

  private slug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private buildNodeMap(feature: BusinessFeature): Record<string, string> {
    const map: Record<string, string> = {};
    const dfd = feature.dataFlowDiagram;
    [...(dfd?.actors ?? [])].forEach(a => (map[a.id] = a.label));
    [...(dfd?.processes ?? [])].forEach(p => (map[p.id] = p.label));
    [...(dfd?.dataStores ?? [])].forEach(d => (map[d.id] = d.label));
    return map;
  }
}
