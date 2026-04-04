import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useTaskRuns() {
  const { acquireToken } = useAuth();
  const getTaskRuns = useCallback(async (taskId: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/runs`);
    if (!res.ok) throw new Error('Failed to get task runs');
    return res.json();
  }, []);

  const getAllTaskRuns = useCallback(async () => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/runs`);
    if (!res.ok) throw new Error('Failed to get task runs');
    return res.json();
  }, []);

  const getTaskRun = useCallback(async (runId: string) => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/runs/${runId}`);
    if (!res.ok) throw new Error('Failed to get task run');
    return res.json();
  }, []);

  const streamTaskRunEvents = useCallback(
    async (runId: string, onEvent: (eventName: string, data: any) => void, signal?: AbortSignal): Promise<void> => {
      const token = await acquireToken();

      // Use fetch with SSE for proper auth header support
      const res = await fetch(`${API_BASE}/runs/${runId}/stream`, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`,
        },
        signal,
      });

      if (!res.ok) {
        throw new Error('Failed to stream task run events');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.substring(7);
            } else if (line.startsWith('data: ')) {
              const data = line.substring(6);
              try {
                const parsed = JSON.parse(data);
                onEvent(currentEvent || 'message', parsed);
                
                // Break the loop when done event is received
                if (currentEvent === 'done') {
                  reader.cancel();
                  return;
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
              currentEvent = '';
            }
          }
        }
      } catch (error: any) {
        // Ignore abort errors
        if (error.name === 'AbortError') {
          return;
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
    },
    [acquireToken]
  );

  return { getTaskRuns, getAllTaskRuns, getTaskRun, streamTaskRunEvents };
}
