import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useFeedback() {
  const { acquireToken } = useAuth();
  const createFeedback = useCallback(async (request: any) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/feedbacks`, { method: 'POST', body: JSON.stringify(request) });
    if (!res.ok) throw new Error('Failed to create feedback');
    return res.json();
  }, []);

  const getFeedbacksByTaskId = useCallback(async (taskId: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/feedbacks`);
    if (!res.ok) throw new Error('Failed to get feedbacks');
    return res.json();
  }, []);

  const getFeedbacksByTaskRunId = useCallback(async (taskRunId: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/runs/${taskRunId}/feedbacks`);
    if (!res.ok) throw new Error('Failed to get feedbacks');
    return res.json();
  }, []);

  const updateFeedback = useCallback(async (id: string, updates: { content?: string; rating?: 'like' | 'dislike' }) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/feedbacks/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
    if (!res.ok) throw new Error('Failed to update feedback');
    return res.json();
  }, []);

  const deleteFeedback = useCallback(async (id: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/feedbacks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete feedback');
  }, []);

  return { createFeedback, getFeedbacksByTaskId, getFeedbacksByTaskRunId, updateFeedback, deleteFeedback };
}
