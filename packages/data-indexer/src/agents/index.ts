/**
 * Data-Indexer Agent Registry
 *
 * Single source of truth for all data-indexer pipeline agent roles.
 *
 * Usage:
 *   import { dataIndexerAgentRegistry, DataIndexerAgentType } from '../agents';
 *   const task = dataIndexerAgentRegistry.createTask(DataIndexerAgentType.IacAnalyzer, api, { workspace });
 *
 * Or inject the registry into a class constructor for testability:
 *   constructor(private readonly registry: DataIndexerAgentRegistry) {}
 */

export { DataIndexerAgentRegistry } from './registry';
export type { DataIndexerAgentDefinition } from './types';

// ── Agent type constants ──────────────────────────────────────────────────────

/**
 * Enum of all registered data-indexer agent types.
 * Always use these constants instead of raw strings when calling createTask().
 */
export enum DataIndexerAgentType {
  RepositoryBriefing    = 'repository-briefing',
  IacAnalyzer           = 'iac-analyzer',
  BuildArtifactAnalyzer = 'build-artifact-analyzer',
  ScriptAnalyzer        = 'script-analyzer',
  // ── 3-pass pre-analysis pipeline ──────────────────────────────────────────
  ServiceFileMapper        = 'service-file-mapper',
  ServiceSkeletonExtractor = 'service-skeleton-extractor',
  ServiceExternalSurface   = 'service-external-surface',
  // ── Legacy (kept for backward compat; orchestration now uses 3-pass) ──────
  ServiceAnalyzer       = 'service-analyzer',
  FeatureListExtractor  = 'feature-list-extractor',
  DfdExtractor          = 'dfd-extractor',
  FeatureThreatModel    = 'feature-threat-model',
  ServiceDfdSynthesis   = 'service-dfd-synthesis',
  ServiceThreatModel    = 'service-threat-model',
  ExploitabilityAnalyzer = 'exploitability-analyzer',
}

// ── Definition re-exports ─────────────────────────────────────────────────────

export { REPOSITORY_BRIEFING_AGENT } from './definitions/repositoryBriefingAgent';
export { IAC_ANALYZER_AGENT, createIaCAnalyzerAgentWithRepository } from './definitions/iacAnalyzerAgent';
export { BUILD_ARTIFACT_ANALYZER_AGENT } from './definitions/buildArtifactAnalyzerAgent';
export { SCRIPT_ANALYZER_AGENT, createScriptAnalyzerAgentWithRepository } from './definitions/scriptAnalyzerAgent';
export { SERVICE_FILE_MAPPER_AGENT } from './definitions/serviceFileMapperAgent';
export { SERVICE_SKELETON_EXTRACTOR_AGENT } from './definitions/serviceSkeletonExtractorAgent';
export { SERVICE_EXTERNAL_SURFACE_AGENT } from './definitions/serviceExternalSurfaceAgent';
export { SERVICE_ANALYZER_AGENT } from './definitions/serviceAnalyzerAgent';
export { FEATURE_LIST_EXTRACTOR_AGENT } from './definitions/featureListExtractorAgent';
export { DFD_EXTRACTOR_AGENT } from './definitions/dfdExtractorAgent';
export { FEATURE_THREAT_MODEL_AGENT } from './definitions/featureThreatModelAgent';
export { SERVICE_DFD_SYNTHESIS_AGENT } from './definitions/serviceDfdSynthesisAgent';
export { SERVICE_THREAT_MODEL_AGENT } from './definitions/serviceThreatModelAgent';
export { EXPLOITABILITY_ANALYZER_AGENT } from './definitions/exploitabilityAnalyzerAgent';

// ── Singleton registry ────────────────────────────────────────────────────────

import { DataIndexerAgentRegistry } from './registry';
import { REPOSITORY_BRIEFING_AGENT } from './definitions/repositoryBriefingAgent';
import { IAC_ANALYZER_AGENT } from './definitions/iacAnalyzerAgent';
import { BUILD_ARTIFACT_ANALYZER_AGENT } from './definitions/buildArtifactAnalyzerAgent';
import { SCRIPT_ANALYZER_AGENT } from './definitions/scriptAnalyzerAgent';
import { SERVICE_FILE_MAPPER_AGENT } from './definitions/serviceFileMapperAgent';
import { SERVICE_SKELETON_EXTRACTOR_AGENT } from './definitions/serviceSkeletonExtractorAgent';
import { SERVICE_EXTERNAL_SURFACE_AGENT } from './definitions/serviceExternalSurfaceAgent';
import { SERVICE_ANALYZER_AGENT } from './definitions/serviceAnalyzerAgent';
import { FEATURE_LIST_EXTRACTOR_AGENT } from './definitions/featureListExtractorAgent';
import { DFD_EXTRACTOR_AGENT } from './definitions/dfdExtractorAgent';
import { FEATURE_THREAT_MODEL_AGENT } from './definitions/featureThreatModelAgent';
import { SERVICE_DFD_SYNTHESIS_AGENT } from './definitions/serviceDfdSynthesisAgent';
import { SERVICE_THREAT_MODEL_AGENT } from './definitions/serviceThreatModelAgent';
import { EXPLOITABILITY_ANALYZER_AGENT } from './definitions/exploitabilityAnalyzerAgent';

/**
 * Pre-populated singleton registry for all data-indexer pipeline agent roles.
 * Import this instance rather than constructing a new registry.
 */
export const dataIndexerAgentRegistry = new DataIndexerAgentRegistry();

dataIndexerAgentRegistry.register(REPOSITORY_BRIEFING_AGENT);
dataIndexerAgentRegistry.register(IAC_ANALYZER_AGENT);
dataIndexerAgentRegistry.register(BUILD_ARTIFACT_ANALYZER_AGENT);
dataIndexerAgentRegistry.register(SCRIPT_ANALYZER_AGENT);
dataIndexerAgentRegistry.register(SERVICE_FILE_MAPPER_AGENT);
dataIndexerAgentRegistry.register(SERVICE_SKELETON_EXTRACTOR_AGENT);
dataIndexerAgentRegistry.register(SERVICE_EXTERNAL_SURFACE_AGENT);
dataIndexerAgentRegistry.register(SERVICE_ANALYZER_AGENT);
dataIndexerAgentRegistry.register(FEATURE_LIST_EXTRACTOR_AGENT);
dataIndexerAgentRegistry.register(DFD_EXTRACTOR_AGENT);
dataIndexerAgentRegistry.register(FEATURE_THREAT_MODEL_AGENT);
dataIndexerAgentRegistry.register(SERVICE_DFD_SYNTHESIS_AGENT);
dataIndexerAgentRegistry.register(SERVICE_THREAT_MODEL_AGENT);
dataIndexerAgentRegistry.register(EXPLOITABILITY_ANALYZER_AGENT);
