import { API_BASE, fetchWithAuth } from '../api';
import type { Asset, AssetCategory, AssetDetail, RelationshipGraph, RepositoryArtifacts, ScanRecord, ScanOptions, ScanRepositoryInfo, ServiceExploitabilityAnalysis } from '../../types';

export async function getAssetCategories(getToken: () => Promise<string | null>): Promise<AssetCategory[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/assets/categories`);
  return response.json();
}

export async function getAssetsByCategory(getToken: () => Promise<string | null>, category: string): Promise<Asset[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/assets/${encodeURIComponent(category)}`);
  return response.json();
}

export async function getAssetById(getToken: () => Promise<string | null>, id: string): Promise<AssetDetail> {
  // Encode ID to handle special characters (e.g., URLs with slashes)
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/asset/${encodeURIComponent(id)}`);
  return response.json();
}

export async function getAssetRelationships(getToken: () => Promise<string | null>, id: string): Promise<RelationshipGraph> {
  // Encode ID to handle special characters (e.g., URLs with slashes)
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/asset/${encodeURIComponent(id)}/relationships`);
  return response.json();
}

export async function getAssetExploitability(getToken: () => Promise<string | null>, id: string): Promise<ServiceExploitabilityAnalysis | null> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/asset/${encodeURIComponent(id)}/exploitability`);
  if (!response.ok) return null;
  return response.json();
}

export async function getRepositoryArtifacts(getToken: () => Promise<string | null>, repositoryId: string): Promise<RepositoryArtifacts> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/asset/${encodeURIComponent(repositoryId)}/artifacts`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to get repository artifacts');
  }
  return response.json();
}

export async function deleteAllAssets(getToken: () => Promise<string | null>): Promise<void> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/assets`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to delete assets');
  }
}

export async function triggerScan(getToken: () => Promise<string | null>, options: ScanOptions): Promise<{ scanId: string; status: string; message: string }> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/scan`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to start scan');
  }
  return response.json();
}

export async function getScanStatus(getToken: () => Promise<string | null>, scanId: string): Promise<ScanRecord> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/scan/${encodeURIComponent(scanId)}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to fetch scan status');
  }
  return response.json();
}

export async function listScans(getToken: () => Promise<string | null>): Promise<ScanRecord[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/scan`);
  if (!response.ok) {
    throw new Error('Failed to fetch scan history');
  }
  return response.json();
}

export async function listRepositories(getToken: () => Promise<string | null>): Promise<ScanRepositoryInfo[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/repositories`);
  if (!response.ok) {
    throw new Error('Failed to list repositories');
  }
  return response.json();
}

/**
 * Start a scan that streams ScanRecord snapshots via Server-Sent Events.
 * Calls `onUpdate` for each SSE event and resolves when the stream closes.
 * Returns a cleanup function that aborts the request if called.
 *
 * Resilience: if the SSE stream closes before the scan reaches a terminal
 * state (completed / failed), this function automatically falls back to
 * polling GET /knowledge-base/scan/:scanId every 2 s until the scan is done
 * or the returned abort function is called.
 */
export function streamScan(
  getToken: () => Promise<string | null>,
  options: ScanOptions,
  onUpdate: (record: ScanRecord) => void,
  onError: (message: string) => void
): () => void {
  const controller = new AbortController();
  let aborted = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    aborted = true;
    controller.abort();
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  /**
   * Poll the scan status endpoint until the scan reaches a terminal state.
   * This is the fallback when the SSE stream closes prematurely.
   */
  const pollUntilDone = async (scanId: string) => {
    if (aborted) return;
    try {
      const record = await getScanStatus(getToken, scanId);
      onUpdate(record);
      if (record.status !== 'completed' && record.status !== 'failed') {
        // Still running – schedule the next poll
        pollTimer = setTimeout(() => pollUntilDone(scanId), 2_000);
      }
    } catch {
      // Transient network error – retry after a longer backoff
      if (!aborted) {
        pollTimer = setTimeout(() => pollUntilDone(scanId), 5_000);
      }
    }
  };

  (async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/knowledge-base/scan/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(options),
        signal: controller.signal,
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok || !response.body) {
        onError('Failed to start scan stream');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastRecord: ScanRecord | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE lines are separated by \n\n; each event is "data: <json>\n"
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line || line.startsWith(':')) continue; // keep-alive comment
          const dataLine = line.startsWith('data: ') ? line.slice(6) : line;
          try {
            const record = JSON.parse(dataLine);
            if (record.error) {
              onError(record.error);
            } else {
              lastRecord = record as ScanRecord;
              onUpdate(lastRecord);
            }
          } catch {
            // Malformed SSE line – ignore
          }
        }
      }

      // Stream closed. If the scan hasn't reached a terminal state, fall back
      // to polling so the UI doesn't get stuck on an intermediate stage.
      if (
        !aborted &&
        lastRecord !== null &&
        lastRecord.status !== 'completed' &&
        lastRecord.status !== 'failed'
      ) {
        pollUntilDone(lastRecord.scanId);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        onError(err.message ?? 'Stream connection failed');
      }
    }
  })();

  return cleanup;
}

/**
 * Poll an existing scan to completion and call `onUpdate` on each tick.
 * Used by the UI when the page is loaded while a scan is already in progress
 * (e.g. after a page refresh).
 * Returns a cleanup function that stops polling.
 */
export function pollScanUntilDone(
  getToken: () => Promise<string | null>,
  scanId: string,
  onUpdate: (record: ScanRecord) => void
): () => void {
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    aborted = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const tick = async () => {
    if (aborted) return;
    try {
      const record = await getScanStatus(getToken, scanId);
      onUpdate(record);
      if (record.status !== 'completed' && record.status !== 'failed') {
        timer = setTimeout(tick, 2_000);
      }
    } catch {
      if (!aborted) {
        timer = setTimeout(tick, 5_000);
      }
    }
  };

  tick();
  return stop;
}
