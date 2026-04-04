import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useIntegrations() {
  const { acquireToken } = useAuth();
  const createMCPIntegration = useCallback(async (request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp`, { method: 'POST', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to create MCP integration');
    return res.json();
  }, []);

  const getMCPIntegration = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}`);
    if (!res.ok) throw new Error('Failed to get MCP integration');
    return res.json();
  }, []);

  const getMCPIntegrationDetails = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}/details`);
    if (!res.ok) throw new Error('Failed to get MCP integration details');
    return res.json();
  }, []);

  const getAllMCPIntegrations = useCallback(async (enabledOnly = false) => {
    const url = enabledOnly ? `${API_BASE}/integrations/mcp?enabled=true` : `${API_BASE}/integrations/mcp`;
    const res = await fetchWithAuth(acquireToken, url);
    if (!res.ok) throw new Error('Failed to get MCP integrations');
    return res.json();
  }, []);

  const updateMCPIntegration = useCallback(async (id: string, request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}`, { method: 'PUT', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to update MCP integration');
    return res.json();
  }, []);

  const deleteMCPIntegration = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete MCP integration');
  }, []);

  const listDockerMCPServers = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/docker/servers`);
    if (!res.ok) throw new Error('Failed to list Docker MCP servers');
    return res.json();
  }, []);

  const addDockerMCPIntegration = useCallback(async (serverName: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/docker/add`, { method: 'POST', body: JSON.stringify({ serverName }) });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to add Docker MCP integration');
    }
    return res.json();
  }, []);

  // Code integrations
  const createCodeIntegration = useCallback(async (request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code`, { method: 'POST', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to create code integration');
    return res.json();
  }, []);

  const getCodeIntegration = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}`);
    if (!res.ok) throw new Error('Failed to get code integration');
    return res.json();
  }, []);

  const getCodeIntegrationDetails = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}/details`);
    if (!res.ok) throw new Error('Failed to get code integration details');
    return res.json();
  }, []);

  const getAllCodeIntegrations = useCallback(async (enabledOnly = false) => {
    const url = enabledOnly ? `${API_BASE}/integrations/code?enabled=true` : `${API_BASE}/integrations/code`;
    const res = await fetchWithAuth(acquireToken, url);
    if (!res.ok) throw new Error('Failed to get code integrations');
    return res.json();
  }, []);

  const updateCodeIntegration = useCallback(async (id: string, request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}`, { method: 'PUT', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to update code integration');
    return res.json();
  }, []);

  const deleteCodeIntegration = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/code/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete code integration');
  }, []);

  // Custom integration endpoints
  const createCustomIntegration = useCallback(async (request: { name: string; description?: string; config: Record<string,string>; enabled?: boolean; }) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom`, { method: 'POST', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to create custom integration');
    return res.json();
  }, []);

  const getAllCustomIntegrations = useCallback(async (enabledOnly = false) => {
    const url = enabledOnly ? `${API_BASE}/integrations/custom?enabled=true` : `${API_BASE}/integrations/custom`;
    const res = await fetchWithAuth(acquireToken, url);
    if (!res.ok) throw new Error('Failed to get custom integrations');
    return res.json();
  }, []);

  const getCustomIntegration = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom/${id}`);
    if (!res.ok) throw new Error('Failed to get custom integration');
    return res.json();
  }, []);

  const updateCustomIntegration = useCallback(async (id: string, request: { name?: string; description?: string; config?: Record<string,string>; enabled?: boolean; }) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom/${id}`, { method: 'PUT', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to update custom integration');
    return res.json();
  }, []);

  const deleteCustomIntegration = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/custom/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete custom integration');
  }, []);

  const getAllIntegrations = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations`);
    if (!res.ok) throw new Error('Failed to fetch integrations');
    return res.json();
  }, []);

  return {
    createMCPIntegration,
    getMCPIntegration,
    getMCPIntegrationDetails,
    getAllMCPIntegrations,
    updateMCPIntegration,
    deleteMCPIntegration,
    listDockerMCPServers,
    addDockerMCPIntegration,
    createCodeIntegration,
    getCodeIntegration,
    getCodeIntegrationDetails,
    getAllCodeIntegrations,
    updateCodeIntegration,
    deleteCodeIntegration,
    createCustomIntegration,
    getAllCustomIntegrations,
    getCustomIntegration,
    updateCustomIntegration,
    deleteCustomIntegration,
    getAllIntegrations,
  };
}
