import { API_BASE, fetchWithAuth } from '../api';
import type { DataStoreSummary, DataStoreDetail } from '../../types';
import type { RelationshipGraph } from '../../types';

export async function listDataStores(
  getToken: () => Promise<string | null>
): Promise<DataStoreSummary[]> {
  const res = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/data-stores`);
  if (!res.ok) throw new Error('Failed to fetch data stores');
  return res.json();
}

export async function getDataStoreById(
  getToken: () => Promise<string | null>,
  id: string
): Promise<DataStoreDetail> {
  const res = await fetchWithAuth(
    getToken,
    `${API_BASE}/knowledge-base/data-stores/${encodeURIComponent(id)}`
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error('Data store not found');
    throw new Error('Failed to fetch data store');
  }
  return res.json();
}

export async function getDataStoreRelationships(
  getToken: () => Promise<string | null>,
  id: string
): Promise<RelationshipGraph> {
  const res = await fetchWithAuth(
    getToken,
    `${API_BASE}/knowledge-base/data-stores/${encodeURIComponent(id)}/relationships`
  );
  if (!res.ok) throw new Error('Failed to fetch data store relationships');
  return res.json();
}
