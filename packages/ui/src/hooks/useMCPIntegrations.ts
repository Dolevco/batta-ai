import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';
import type {
  MCPIntegration,
  MCPIntegrationDetails,
  CreateMCPIntegrationRequest,
  UpdateMCPIntegrationRequest,
  DockerMCPServer,
} from '../types/';

export function useMCPIntegrations() {
  const { acquireToken } = useAuth();

  const createMCPIntegration = useCallback(async (request: CreateMCPIntegrationRequest): Promise<MCPIntegration> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to create MCP integration');
    return res.json();
  }, [acquireToken]);

  const getMCPIntegration = useCallback(async (id: string): Promise<MCPIntegration> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}`);
    if (!res.ok) throw new Error('Failed to get MCP integration');
    return res.json();
  }, [acquireToken]);

  const getMCPIntegrationDetails = useCallback(async (id: string): Promise<MCPIntegrationDetails> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}/details`);
    if (!res.ok) throw new Error('Failed to get MCP integration details');
    return res.json();
  }, [acquireToken]);

  const getAllMCPIntegrations = useCallback(async (enabledOnly = false): Promise<MCPIntegration[]> => {
    const url = enabledOnly
      ? `${API_BASE}/integrations/mcp?enabled=true`
      : `${API_BASE}/integrations/mcp`;
    const res = await fetchWithAuth(acquireToken, url);
    if (!res.ok) throw new Error('Failed to get MCP integrations');
    return res.json();
  }, [acquireToken]);

  const updateMCPIntegration = useCallback(
    async (id: string, request: UpdateMCPIntegrationRequest): Promise<MCPIntegration> => {
      const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}`, {
        method: 'PUT',
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to update MCP integration');
      return res.json();
    },
    [acquireToken]
  );

  const deleteMCPIntegration = useCallback(async (id: string): Promise<void> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete MCP integration');
  }, [acquireToken]);

  const listDockerMCPServers = useCallback(async (): Promise<DockerMCPServer[]> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/docker/servers`);
    if (!res.ok) throw new Error('Failed to list Docker MCP servers');
    return res.json();
  }, [acquireToken]);

  const addDockerMCPIntegration = useCallback(async (serverName: string): Promise<MCPIntegration> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/mcp/docker/add`, {
      method: 'POST',
      body: JSON.stringify({ serverName }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to add Docker MCP integration');
    }
    return res.json();
  }, [acquireToken]);

  return {
    createMCPIntegration,
    getMCPIntegration,
    getMCPIntegrationDetails,
    getAllMCPIntegrations,
    updateMCPIntegration,
    deleteMCPIntegration,
    listDockerMCPServers,
    addDockerMCPIntegration,
  };
}
