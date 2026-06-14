type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ScanDomain = 'iac' | 'services' | 'service_relationships' | 'features';

export interface ScanOptions {
  enableCloudDiscovery: boolean;
  scope?: 'all' | 'code' | 'cloud';
  /** Optional allow-list of repository names to index; undefined means all. */
  repositories?: string[];
  /**
   * Whether to run a full or incremental index.
   * 'full' re-indexes every file. 'incremental' processes changes since the
   * last completed run and falls back to full when no prior run exists.
   */
  runType?: 'full' | 'incremental';
  /**
   * Optional allow-list of analysis domains to run.
   * undefined means all domains are run.
   */
  domains?: ScanDomain[];
}

export interface ScanStageInfo {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  itemsProcessed?: number;
  error?: string;
}

export interface ScanRecord {
  scanId: string;
  tenantId: string;
  status: ScanStatus;
  options: ScanOptions;
  startedAt: string;
  completedAt?: string;
  repositoriesDiscovered?: number;
  tasksEnqueued?: number;
  stages: ScanStageInfo[];
  /** Generic error message safe to return to the client. */
  error?: string;
}

const DEFAULT_SCAN_STAGES: ScanStageInfo[] = [
  { name: 'Code Discovery', status: 'pending' },
  { name: 'Cloud Discovery', status: 'pending' },
  { name: 'Correlation', status: 'pending' },
  { name: 'Security Analysis', status: 'pending' },
];

export function cloneScanRecord(record: ScanRecord): ScanRecord {
  return {
    ...record,
    stages: record.stages.map(stage => ({ ...stage })),
  };
}

export function createScanRecord(
  tenantId: string,
  scanId: string,
  options: ScanOptions,
): ScanRecord {
  return {
    scanId,
    tenantId,
    status: 'queued',
    options,
    startedAt: new Date().toISOString(),
    stages: DEFAULT_SCAN_STAGES.map(stage => ({ ...stage })),
  };
}

