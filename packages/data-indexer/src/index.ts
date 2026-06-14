/**
 * Data Indexer Package
 * 
 * Agent-native data indexing layer for cybersecurity platform.
 * 
 * @packageDocumentation
 */

// Public scan orchestration API
export {
  ScanOrchestrator,
  discoverRepositories,
  getScan,
  listScans,
  startScan,
  startScanStream,
} from './orchestration/scan-orchestrator';
export type { ScanDomain, ScanOptions, ScanRecord } from './orchestration/scan-orchestrator';

// Lower-level pipeline API used by the API package and tests
export { CheckpointManager, RepositoryTaskProcessor } from './pipeline';
export { IntegrationFetcher } from './integrations';
export { CodeDiscoveryStage } from './pipeline/stages';

export { TaskType, TaskStage } from './pipeline/indexing-task.types';
export type { IndexRepositoryTask, TaskResult } from './pipeline/indexing-task.types';

export { WORK_ITEM_REVIEW_AGENT, createDataIndexerRegistry, DataIndexerAgentType } from './agents';
