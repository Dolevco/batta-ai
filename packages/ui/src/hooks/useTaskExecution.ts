import { useCallback } from 'react';
import type { TaskExecution, StepExecution } from '../types';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useTaskExecution() {
  const { acquireToken } = useAuth();
  const getTaskExecution = useCallback(async (taskId: string): Promise<TaskExecution> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/execution`);
    if (!res.ok) throw new Error('Failed to get task execution');
    return res.json();
  }, []);

  const startTaskExecution = useCallback(async (taskId: string): Promise<TaskExecution> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/execution/start`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to start task execution');
    return res.json();
  }, []);

  const pauseTaskExecution = useCallback(async (taskId: string): Promise<TaskExecution> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/execution/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to pause task execution');
    return res.json();
  }, []);

  const stopTaskExecution = useCallback(async (taskId: string): Promise<TaskExecution> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/execution/stop`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to stop task execution');
    return res.json();
  }, []);

  const getStepExecution = useCallback(async (taskId: string, stepId: string): Promise<StepExecution> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/execution/steps/${stepId}`);
    if (!res.ok) throw new Error('Failed to get step execution');
    return res.json();
  }, []);

  const executeTaskStream = useCallback(async (
    taskId: string,
    onEvent: (eventName: string, data: any) => void,
    runId?: string
  ): Promise<any> => {
    const response = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${encodeURIComponent(taskId)}/execute?stream=1`, {
      method: 'POST',
      headers: { 
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json'
      },
      body: runId ? JSON.stringify({ runId }) : undefined,
    });

    if (!response.ok) throw new Error('Failed to execute task');
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);

        if (!chunk) continue;

        const lines = chunk.split('\n');
        let eventName = 'message';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            data += line.replace('data:', '').trim();
          }
        }

        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (eventName === 'done') {
              finalResult = parsed;
            } else {
              onEvent(eventName, parsed);
            }
          } catch (e) {
            console.warn('Failed to parse SSE data:', data);
          }
        }
      }
    }

    if (!finalResult) throw new Error('No result returned from execution');
    return finalResult;
  }, []);

  return { getTaskExecution, startTaskExecution, pauseTaskExecution, stopTaskExecution, getStepExecution, executeTaskStream };
}
