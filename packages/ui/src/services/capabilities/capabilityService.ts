import { API_BASE, fetchWithAuth } from '../api';
import type { CapabilitiesResponse } from '../../types';

export async function getCapabilities(getToken: () => Promise<string | null>): Promise<CapabilitiesResponse> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/capabilities`);
  if (!response.ok) {
    throw new Error('Failed to load capabilities');
  }
  return response.json();
}
