import { API_BASE, fetchWithAuth } from './api';
import type {
  SecurityReview,
  SecurityReviewAnswer,
  SecurityAttestation,
  SecurityReviewAttestationSummary,
} from '../types';

export async function listSecurityReviews(
  getToken: () => Promise<string | null>
): Promise<SecurityReview[]> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/security-reviews`);
  return response.json();
}

export async function getSecurityReview(
  getToken: () => Promise<string | null>,
  id: string
): Promise<SecurityReview> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/security-reviews/${encodeURIComponent(id)}`);
  return response.json();
}

export async function getAttestationSummary(
  getToken: () => Promise<string | null>,
  id: string
): Promise<SecurityReviewAttestationSummary> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/security-reviews/${encodeURIComponent(id)}/attestation-summary`
  );
  return response.json();
}

export async function startSecurityReview(
  getToken: () => Promise<string | null>,
  featureDescription: string
): Promise<SecurityReview> {
  const response = await fetchWithAuth(getToken, `${API_BASE}/security-reviews`, {
    method: 'POST',
    body: JSON.stringify({ featureDescription }),
  });
  return response.json();
}

export async function submitAnswers(
  getToken: () => Promise<string | null>,
  id: string,
  answers: SecurityReviewAnswer[]
): Promise<SecurityReview> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/security-reviews/${encodeURIComponent(id)}/answers`,
    { method: 'POST', body: JSON.stringify({ answers }) }
  );
  return response.json();
}

export async function acknowledgeTasks(
  getToken: () => Promise<string | null>,
  id: string
): Promise<SecurityReview> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/security-reviews/${encodeURIComponent(id)}/acknowledge`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  return response.json();
}

export async function submitAttestations(
  getToken: () => Promise<string | null>,
  id: string,
  attestations: SecurityAttestation[]
): Promise<SecurityReview> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/security-reviews/${encodeURIComponent(id)}/attestations`,
    { method: 'POST', body: JSON.stringify({ attestations }) }
  );
  return response.json();
}

export async function refreshSnapshot(
  getToken: () => Promise<string | null>,
  id: string
): Promise<SecurityReview> {
  const response = await fetchWithAuth(
    getToken,
    `${API_BASE}/security-reviews/${encodeURIComponent(id)}/refresh-snapshot`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as any).error || `Request failed with status ${response.status}`);
  }
  return response.json();
}
