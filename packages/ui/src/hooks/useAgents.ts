import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useAgents() {
  const { acquireToken } = useAuth();
  const createAgent = useCallback(async (request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/agents`, { method: 'POST', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to create agent');
    return res.json();
  }, []);

  const getAgent = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/agents/${id}`);
    if (!res.ok) throw new Error('Failed to get agent');
    return res.json();
  }, []);

  const getAllAgents = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/agents`);
    if (!res.ok) throw new Error('Failed to get agents');
    return res.json();
  }, []);

  const updateAgent = useCallback(async (id: string, request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/agents/${id}`, { method: 'PUT', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to update agent');
    return res.json();
  }, []);

  const deleteAgent = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/agents/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete agent');
  }, []);

  return { createAgent, getAgent, getAllAgents, updateAgent, deleteAgent };
}
