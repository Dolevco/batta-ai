import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';
import type { CodeIntegration, CreateCodeIntegrationRequest, UpdateCodeIntegrationRequest } from '../types/';

export type { CodeIntegration, CreateCodeIntegrationRequest, UpdateCodeIntegrationRequest };

export function useCodeIntegrations() {
  const { acquireToken } = useAuth();

  const createCodeIntegration = useCallback(
    async (request: CreateCodeIntegrationRequest): Promise<CodeIntegration> => {
      const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to create code integration');
      return res.json();
    },
    [acquireToken]
  );

  const getCodeIntegration = useCallback(async (id: string): Promise<CodeIntegration> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}`);
    if (!res.ok) throw new Error('Failed to get code integration');
    return res.json();
  }, [acquireToken]);

  const getCodeIntegrationDetails = useCallback(async (id: string): Promise<CodeIntegration> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}/details`);
    if (!res.ok) throw new Error('Failed to get code integration details');
    return res.json();
  }, [acquireToken]);

  const getAllCodeIntegrations = useCallback(async (enabledOnly = false): Promise<CodeIntegration[]> => {
    const url = enabledOnly
      ? `${API_BASE}/integrations/code?enabled=true`
      : `${API_BASE}/integrations/code`;
    const res = await fetchWithAuth(acquireToken, url);
    if (!res.ok) throw new Error('Failed to get code integrations');
    return res.json();
  }, [acquireToken]);

  const updateCodeIntegration = useCallback(
    async (id: string, request: UpdateCodeIntegrationRequest): Promise<CodeIntegration> => {
      const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}`, {
        method: 'PUT',
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to update code integration');
      return res.json();
    },
    [acquireToken]
  );

  const deleteCodeIntegration = useCallback(async (id: string): Promise<void> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete code integration');
  }, [acquireToken]);

  return {
    createCodeIntegration,
    getCodeIntegration,
    getCodeIntegrationDetails,
    getAllCodeIntegrations,
    updateCodeIntegration,
    deleteCodeIntegration,
  };
}
