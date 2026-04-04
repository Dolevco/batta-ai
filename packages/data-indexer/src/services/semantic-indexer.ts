/**
 * SemanticIndexer
 *
 * Builds `SemanticDocument` records for two entity kinds that benefit from
 * vector search in the chat experience:
 *
 *   service  – one document per CodeService, text = responsibility summary.
 *              Enables "semantic search for service responsibility".
 *
 *   feature  – one document per BusinessFeature, text = businessValue +
 *              description + userStories + dataFlow + dataClassification.
 *              Enables "semantic search for features and their flows".
 *
 * Each document is tagged with `documentType` so the Qdrant adapter can
 * restrict vector searches to the correct corpus.
 *
 * Security:
 *  - Inputs are sanitized via sanitizeMetadata before this helper is called
 *    (callers' responsibility, enforced at the extractor level).
 *  - Only architecture text is embedded — no secrets, paths, or user data.
 *  - All documents include tenantId for tenant isolation in Qdrant.
 */

import * as crypto from 'crypto';
import type { CodeService, SemanticDocument, TenantId } from '@ai-agent/shared';
import type { BusinessFeature } from '@ai-agent/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function deterministicId(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 36);
}

/**
 * Build a compact, prose representation of the data-flow summary for a feature.
 * Returns an empty string when no flows exist.
 * Classification: INTERNAL — only carries protocol / data-type names, never
 * actual secret values or workspace paths.
 */
function buildDataFlowText(feature: BusinessFeature): string {
  const dfd = feature.dataFlowDiagram;
  if (!dfd) return '';

  const nodeMap: Record<string, string> = {};
  (dfd.actors ?? []).forEach(a => (nodeMap[a.id] = a.label));
  (dfd.processes ?? []).forEach(p => (nodeMap[p.id] = p.label));
  (dfd.dataStores ?? []).forEach(d => (nodeMap[d.id] = d.label));

  const flowLines = (dfd.flows ?? []).map(f =>
    `${nodeMap[f.from] ?? f.from} → ${nodeMap[f.to] ?? f.to} [${f.dataTypes.join(', ')}] via ${f.protocol}${f.encrypted ? ' (encrypted)' : ''}`
  );

  return flowLines.join('; ');
}

/**
 * Build a compact text summary of data classification for a feature.
 */
function buildDataClassificationText(feature: BusinessFeature): string {
  const summaries = feature.threatModel?.dataClassificationSummary ?? [];
  return summaries
    .map(c => `${c.classification}: ${c.dataTypes.join(', ')} protected by ${c.protectionMechanisms.join(', ') || 'no controls listed'}`)
    .join('; ');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a SemanticDocument for a CodeService.
 * Text = responsibility (the LLM-generated service summary).
 * Returns null when the service has no responsibility text yet.
 */
export function buildServiceSemanticDoc(
  tenantId: TenantId,
  service: CodeService
): SemanticDocument | null {
  if (!service.responsibility) return null;

  const id = deterministicId([tenantId, 'service', service.id]);

  return {
    id,
    tenantId,
    artifactId: service.id,
    inputHash: deterministicId([service.responsibility, service.id]),
    language: service.language ?? 'unknown',
    filePath: service.codePath ?? '',
    documentType: 'service',
    responsibility: service.responsibility,
    llmModel: 'service-relationships-extractor',
    generatedAt: new Date().toISOString(),
    metadata: {
      serviceName: service.name,
      serviceType: service.serviceType,
      // Data classification: INTERNAL — no secret values
    },
  };
}

/**
 * Build a SemanticDocument for a BusinessFeature.
 * Text (for embedding) = businessValue + description + userStories +
 *                         dataFlow summary + dataClassification summary.
 * Threat model details (STRIDE threats, recommendations) are intentionally
 * excluded — they are not useful for chat discovery and may be verbose.
 */
export function buildFeatureSemanticDoc(
  tenantId: TenantId,
  feature: BusinessFeature
): SemanticDocument {
  const dataFlowSummary = buildDataFlowText(feature);
  const dataClassificationSummary = buildDataClassificationText(feature);

  // Compose the responsibility field that drives the embedding
  const responsibilityParts = [
    `${feature.name}: ${feature.description}`,
    feature.businessValue ? `Business value: ${feature.businessValue}` : '',
    (feature.userStories ?? []).length
      ? `User stories: ${feature.userStories.join(' | ')}`
      : '',
    dataFlowSummary ? `Data flows: ${dataFlowSummary}` : '',
    dataClassificationSummary ? `Data classification: ${dataClassificationSummary}` : '',
  ].filter(Boolean);

  const id = deterministicId([tenantId, 'feature', feature.id]);

  return {
    id,
    tenantId,
    artifactId: feature.id,
    inputHash: deterministicId([feature.id, feature.updatedAt]),
    language: 'n/a',
    filePath: '',
    documentType: 'feature',
    responsibility: responsibilityParts.join('. '),
    llmModel: 'business-feature-extractor',
    generatedAt: new Date().toISOString(),
    metadata: {
      featureName: feature.name,
      businessValue: feature.businessValue,
      description: feature.description,
      userStories: feature.userStories ?? [],
      sourceServiceIds: feature.sourceServiceIds ?? [],
      dataFlowSummary,
      dataClassificationSummary,
      complianceConsiderations: feature.threatModel?.complianceConsiderations ?? [],
      overallRiskScore: feature.threatModel?.overallRiskScore ?? 0,
      // Data classification: INTERNAL — architecture text only, no secret values
    },
  };
}
