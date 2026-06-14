import type { ScanRecord } from './scan-types';

export interface ScanStore {
  getActiveScan(tenantId: string): ScanRecord | undefined;
  setRecord(tenantId: string, record: ScanRecord): void;
  getRecord(tenantId: string, scanId: string): ScanRecord | undefined;
  listRecords(tenantId: string): ScanRecord[];
}

export class InMemoryScanStore implements ScanStore {
  private readonly scansByTenant = new Map<string, Map<string, ScanRecord>>();

  getActiveScan(tenantId: string): ScanRecord | undefined {
    const tenantScans = this.scansByTenant.get(tenantId);
    if (!tenantScans) return undefined;

    for (const scan of tenantScans.values()) {
      if (scan.status === 'queued' || scan.status === 'running') {
        return scan;
      }
    }

    return undefined;
  }

  setRecord(tenantId: string, record: ScanRecord): void {
    if (!this.scansByTenant.has(tenantId)) {
      this.scansByTenant.set(tenantId, new Map());
    }

    this.scansByTenant.get(tenantId)!.set(record.scanId, record);
  }

  getRecord(tenantId: string, scanId: string): ScanRecord | undefined {
    return this.scansByTenant.get(tenantId)?.get(scanId);
  }

  listRecords(tenantId: string): ScanRecord[] {
    const tenantScans = this.scansByTenant.get(tenantId);
    if (!tenantScans) return [];

    return Array.from(tenantScans.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 20);
  }
}

