import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';
import type { CustomIntegration, CreateCustomIntegrationRequest, UpdateCustomIntegrationRequest } from '../types/';

export type { CustomIntegration, CreateCustomIntegrationRequest, UpdateCustomIntegrationRequest };

export function useCustomIntegrations() {
  const { acquireToken } = useAuth();

  const createCustomIntegration = useCallback(
    async (request: CreateCustomIntegrationRequest): Promise<CustomIntegration> => {
      const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to create custom integration');
      return res.json();
    },
    [acquireToken]
  );

  const getAllCustomIntegrations = useCallback(async (enabledOnly = false): Promise<CustomIntegration[]> => {
    const url = enabledOnly
      ? `${API_BASE}/integrations/custom?enabled=true`
      : `${API_BASE}/integrations/custom`;
    const res = await fetchWithAuth(acquireToken, url);
    if (!res.ok) throw new Error('Failed to get custom integrations');
    return res.json();
  }, [acquireToken]);

  const getCustomIntegration = useCallback(async (id: string): Promise<CustomIntegration> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom/${id}`);
    if (!res.ok) throw new Error('Failed to get custom integration');
    return res.json();
  }, [acquireToken]);

  const updateCustomIntegration = useCallback(
    async (id: string, request: UpdateCustomIntegrationRequest): Promise<CustomIntegration> => {
      const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom/${id}`, {
        method: 'PUT',
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to update custom integration');
      return res.json();
    },
    [acquireToken]
  );

  const deleteCustomIntegration = useCallback(async (id: string): Promise<void> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete custom integration');
  }, [acquireToken]);

  return {
    createCustomIntegration,
    getAllCustomIntegrations,
    getCustomIntegration,
    updateCustomIntegration,
    deleteCustomIntegration,
  };
}
