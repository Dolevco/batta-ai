import { useState, useCallback } from 'react';
import type { DataStoreSummary, DataStoreDetail, RelationshipGraph } from '../types/';
import * as dataStoreService from '../services/data-stores/dataStoreService';
import { useAuth } from './useAuth';
import { useAPICall } from './useAPICall';

export function useDataStores(): {
  stores: DataStoreSummary[];
  loading: boolean;
  error: string | null;
  fetchStores: () => Promise<DataStoreSummary[]>;
} {
  const [stores, setStores] = useState<DataStoreSummary[]>([]);
  const { loading, error, execute } = useAPICall(dataStoreService.listDataStores);

  const fetchStores = useCallback(async (): Promise<DataStoreSummary[]> => {
    const data = await execute();
    setStores(data);
    return data;
  }, [execute]);

  return { stores, loading, error, fetchStores };
}

export function useDataStoreDetail(id: string): {
  store: DataStoreDetail | null;
  relationships: RelationshipGraph | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [store, setStore] = useState<DataStoreDetail | null>(null);
  const [relationships, setRelationships] = useState<RelationshipGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const refetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, graph] = await Promise.all([
        dataStoreService.getDataStoreById(acquireToken, id),
        dataStoreService.getDataStoreRelationships(acquireToken, id).catch(() => null),
      ]);
      setStore(detail);
      setRelationships(graph);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data store');
    } finally {
      setLoading(false);
    }
  }, [id, acquireToken]);

  return { store, relationships, loading, error, refetch };
}
