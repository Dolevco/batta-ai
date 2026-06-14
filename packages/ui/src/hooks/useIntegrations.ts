import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';
import { useMCPIntegrations } from './useMCPIntegrations';
import { useCodeIntegrations } from './useCodeIntegrations';
import { useCustomIntegrations } from './useCustomIntegrations';

/**
 * Aggregated integrations hook — combines MCP, code, and custom integration
 * operations plus the GitHub token helpers and the "all integrations" listing.
 * Prefer the domain-specific hooks (useMCPIntegrations, useCodeIntegrations,
 * useCustomIntegrations) for new code.
 */
export function useIntegrations() {
  const { acquireToken } = useAuth();
  const mcp = useMCPIntegrations();
  const code = useCodeIntegrations();
  const custom = useCustomIntegrations();

  const getAllIntegrations = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations`);
    if (!res.ok) throw new Error('Failed to fetch integrations');
    return res.json();
  }, [acquireToken]);

  const configureGitHubToken = useCallback(async (personalAccessToken: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/github/token`, {
      method: 'POST',
      body: JSON.stringify({ personalAccessToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || 'Failed to configure GitHub token');
    }
    return res.json();
  }, [acquireToken]);

  const revokeGitHubToken = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/integrations/github/token`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to revoke GitHub token');
    return res.json();
  }, [acquireToken]);

  return {
    ...mcp,
    ...code,
    ...custom,
    getAllIntegrations,
    configureGitHubToken,
    revokeGitHubToken,
  };
}
