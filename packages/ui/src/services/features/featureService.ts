import { API_BASE, fetchWithAuth } from '../api';
import type { BusinessFeatureSummary, BusinessFeature } from '../../types';

export async function listFeatures(
  getToken: () => Promise<string | null>
): Promise<BusinessFeatureSummary[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/knowledge-base/features`);
  if (!response.ok) {
    throw new Error('Failed to fetch business features');
  }
  return response.json();
}

export async function getFeatureById(
  getToken: () => Promise<string | null>,
  id: string
): Promise<BusinessFeature> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/knowledge-base/features/${encodeURIComponent(id)}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch business feature');
  }
  return response.json();
}

export async function getArchitectureDoc(
  getToken: () => Promise<string | null>
): Promise<{ markdown: string; featureCount: number }> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/knowledge-base/features/architecture-doc`
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No features found — run a scan with Feature Extraction enabled first.');
    }
    throw new Error('Failed to fetch architecture document');
  }
  return response.json();
}
