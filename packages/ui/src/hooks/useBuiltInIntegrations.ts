import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useBuiltInIntegrations() {
  const { acquireToken } = useAuth();
  const getBuiltInIntegrations = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/built-in`);
    if (!res.ok) throw new Error('Failed to get built-in integrations');
    return res.json();
  }, []);

  const validateBuiltInIntegration = useCallback(async (integrationId: string, config: Record<string, any>) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/built-in/validate`, { method: 'POST', body: JSON.stringify({ integrationId, config }) });
    if (!res.ok) throw new Error('Failed to validate integration');
    return res.json();
  }, []);

  return { getBuiltInIntegrations, validateBuiltInIntegration };
}
