import type { IndexingRun } from '../../types/canonical.types';
import type {
  IndexingCoverage,
  IndexingGap,
  RepositoryIndexingRunMetadata,
} from '../../types/repository-indexing.types';

export function computeCoverage(meta: RepositoryIndexingRunMetadata): IndexingCoverage {
  const serviceCount = Object.keys(meta.persistedIds?.serviceIds ?? {}).length;
  const featureCount = Object.keys(meta.persistedIds?.featureIds ?? {}).length;

  const completed = meta.completedStages ?? [];
  const hasRepository = meta.persistedIds?.repositoryId != null;
  const servicesWithDfd = (meta.persistedIds?.servicesWithDfd ?? []).length;
  const featuresWithThreatModel = (meta.persistedIds?.featuresWithThreatModel ?? []).length;

  const totalStages = 7; // excluding 'completed'
  const completedCount = Math.min(completed.filter(s => s !== 'completed').length, totalStages);
  const overallPercent = Math.round((completedCount / totalStages) * 100);

  return {
    hasRepository,
    serviceCount,
    featureCount,
    servicesWithDfd,
    featuresWithThreatModel,
    overallPercent,
  };
}

export function computeGaps(meta: RepositoryIndexingRunMetadata): IndexingGap[] {
  const gaps: IndexingGap[] = [];
  const completed = new Set(meta.completedStages ?? []);
  const ids = meta.persistedIds ?? {};

  if (!ids.repositoryId) {
    gaps.push({
      id: 'gap-no-repository',
      description: 'No repository entity has been persisted yet.',
      severity: 'high',
      followUp: 'Complete the repository_inventory stage.',
    });
  }

  if (Object.keys(ids.serviceIds ?? {}).length === 0) {
    gaps.push({
      id: 'gap-no-services',
      description: 'No services have been extracted.',
      severity: 'high',
      followUp: 'Complete the service_extraction stage.',
    });
  }

  if (ids.repositoryId && Object.keys(ids.serviceIds ?? {}).length > 0 && !completed.has('feature_extraction')) {
    gaps.push({
      id: 'gap-no-features',
      description: 'No features have been extracted. Security reviews require at least one feature with a DFD.',
      severity: 'medium',
      followUp: 'Complete the feature_extraction and dfd_creation stages.',
    });
  }

  if (completed.has('feature_extraction') && !completed.has('dfd_creation')) {
    gaps.push({
      id: 'gap-no-dfds',
      description: 'Features are extracted but no DFDs have been created.',
      severity: 'high',
      followUp: 'Complete the dfd_creation stage.',
    });
  }

  if (completed.has('dfd_creation') && !completed.has('threat_model_creation')) {
    gaps.push({
      id: 'gap-no-threat-models',
      description: 'DFDs exist but no threat models have been created.',
      severity: 'medium',
      followUp: 'Complete the threat_model_creation stage.',
    });
  }

  if (completed.has('threat_model_creation')) {
    const allServiceNames = Object.keys(ids.serviceIds ?? {});
    const servicesWithDfd = new Set(ids.servicesWithDfd ?? []);
    const missingDfd = allServiceNames.filter(n => !servicesWithDfd.has(n));
    if (missingDfd.length > 0) {
      gaps.push({
        id: 'gap-services-missing-dfd',
        description: `${missingDfd.length} service(s) have no service DFD written: ${missingDfd.join(', ')}. The serviceName in serviceThreatModels must match the indexed service name exactly.`,
        severity: 'high',
        followUp: `Re-submit the threat_model_creation stage and include a serviceThreatModels entry for each of: ${missingDfd.join(', ')}.`,
      });
    }

    const allFeatureNames = Object.keys(ids.featureIds ?? {});
    const featuresWithTM = new Set(ids.featuresWithThreatModel ?? []);
    const missingTM = allFeatureNames.filter(n => !featuresWithTM.has(n));
    if (missingTM.length > 0) {
      gaps.push({
        id: 'gap-features-missing-threat-model',
        description: `${missingTM.length} feature(s) have no threat model written: ${missingTM.join(', ')}.`,
        severity: 'medium',
        followUp: `Re-submit the threat_model_creation stage and include a threatModels entry for each of: ${missingTM.join(', ')}.`,
      });
    }
  }

  return gaps;
}

export function meetsMinimumBar(meta: RepositoryIndexingRunMetadata): boolean {
  const ids = meta.persistedIds ?? {};
  const completed = new Set(meta.completedStages ?? []);

  if (!ids.repositoryId) return false;
  if (Object.keys(ids.serviceIds ?? {}).length === 0) return false;

  // Allow library-only repos with no features
  const hasFeatures = Object.keys(ids.featureIds ?? {}).length > 0;
  if (hasFeatures && !completed.has('dfd_creation')) return false;

  // If threat_model_creation ran, every non-library service must have a DFD written
  if (completed.has('threat_model_creation')) {
    const allServiceNames = Object.keys(ids.serviceIds ?? {});
    const servicesWithDfd = new Set(ids.servicesWithDfd ?? []);
    if (allServiceNames.some(n => !servicesWithDfd.has(n))) return false;
  }

  return true;
}

export function isIndexingRun(run: IndexingRun): boolean {
  return (run.metadata as any)?.repositoryIndexing?.indexer === 'mcp_agent';
}
