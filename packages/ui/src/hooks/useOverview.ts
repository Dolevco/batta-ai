import { useState, useEffect, useCallback } from 'react';
import type { OverviewStats } from '../types';
import { API_BASE, fetchWithAuth } from '../services/api';
import { useAuth } from './useAuth';

export function useOverview() {
  const [data, setData] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(acquireToken, `${API_BASE}/overview`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setData(await resp.json());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
