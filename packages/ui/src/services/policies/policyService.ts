import { API_BASE, fetchWithAuth } from '../api';
import type { PolicyTemplate, PolicyTemplateType } from '../../types';

export async function listPolicies(
  getToken: () => Promise<string | null>
): Promise<PolicyTemplate[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/policies`);
  return response.json();
}

export async function getPolicy(
  getToken: () => Promise<string | null>,
  id: string
): Promise<PolicyTemplate> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/policies/${encodeURIComponent(id)}`);
  return response.json();
}

export async function updatePolicy(
  getToken: () => Promise<string | null>,
  id: string,
  updates: Partial<Pick<PolicyTemplate, 'name' | 'description' | 'questions' | 'taskRules' | 'baselineTasks' | 'isActive' | 'jiraActionItems'>>
): Promise<PolicyTemplate> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/policies/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return response.json();
}

export async function resetToDefaults(
  getToken: () => Promise<string | null>,
  type: PolicyTemplateType
): Promise<PolicyTemplate> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/policies/reset/${encodeURIComponent(type)}`, {
    method: 'POST',
  });
  return response.json();
}

export async function seedDefaults(
  getToken: () => Promise<string | null>
): Promise<PolicyTemplate[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/policies/seed`, {
    method: 'POST',
  });
  return response.json();
}
