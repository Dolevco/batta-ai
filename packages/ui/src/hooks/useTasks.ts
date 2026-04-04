import { useCallback } from 'react';
import type { CreateTaskRequest, TaskResponse } from '../types';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useTasks() {
  const { acquireToken } = useAuth();
  const createTask = useCallback(async (req: CreateTaskRequest): Promise<TaskResponse> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks`, { method: 'POST', body: JSON.stringify(req) });
    if (!res.ok) throw new Error('Failed to create task');
    return res.json();
  }, []);

  const createTaskStream = useCallback(async (
    req: CreateTaskRequest,
    onEvent: (eventName: string, data: any) => void
  ): Promise<TaskResponse> => {
    const response = await fetchWithAuth(acquireToken, `${API_BASE}/tasks?stream=1`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
      body: JSON.stringify(req),
    });

    if (!response.ok) throw new Error('Failed to create task');
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalTask: TaskResponse | null = null;

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
              finalTask = parsed as TaskResponse;
            }
            onEvent(eventName, parsed);
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    }

    if (!finalTask) throw new Error('No final task received');
    return finalTask;
  }, []);

  const getTask = useCallback(async (id: string): Promise<TaskResponse> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${id}`);
    if (!res.ok) throw new Error('Failed to get task');
    return res.json();
  }, []);

  const getAllTasks = useCallback(async (): Promise<TaskResponse[]> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks`);
    if (!res.ok) throw new Error('Failed to get tasks');
    return res.json();
  }, []);

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete task');
  }, []);

  const cancelTask = useCallback(async (runId: string): Promise<void> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to cancel task run');
    }
  }, []);

  const sendTaskMessage = useCallback(async (taskId: string, message: string): Promise<TaskResponse> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/message`, { method: 'POST', body: JSON.stringify({ message }) });
    if (!res.ok) throw new Error('Failed to send task message');
    return res.json();
  }, []);

  const sendTaskMessageStream = useCallback(async (
    taskId: string,
    message: string,
    onEvent: (eventName: string, data: any) => void
  ): Promise<TaskResponse> => {
    const response = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/message?stream=1`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) throw new Error('Failed to send task message');
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalTask: TaskResponse | null = null;

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
              finalTask = parsed;
            } else {
              onEvent(eventName, parsed);
            }
          } catch (e) {
            console.warn('Failed to parse SSE data:', data);
          }
        }
      }
    }

    if (!finalTask) {
      throw new Error('No task returned from stream');
    }

    return finalTask;
  }, []);

  const updateTask = useCallback(async (id: string, updates: Partial<TaskResponse>): Promise<TaskResponse> => {
    const res = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${id}`, { method: 'POST', body: JSON.stringify(updates) });
    if (!res.ok) throw new Error('Failed to update task');
    return res.json();
  }, []);

  const refinePlanFromRun = useCallback(async (
    taskId: string,
    runId: string,
    onEvent: (eventName: string, data: any) => void
  ): Promise<TaskResponse> => {
    const response = await fetchWithAuth(acquireToken, `${API_BASE}/tasks/${taskId}/runs/${runId}/refine-plan?stream=1`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
    });

    if (!response.ok) throw new Error('Failed to refine plan from run');
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalTask: TaskResponse | null = null;

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
              finalTask = parsed;
            } else {
              onEvent(eventName, parsed);
            }
          } catch (e) {
            console.warn('Failed to parse SSE data:', data);
          }
        }
      }
    }

    if (!finalTask) {
      throw new Error('No task returned from stream');
    }

    return finalTask;
  }, []);

  return { createTask, createTaskStream, getTask, getAllTasks, deleteTask, cancelTask, sendTaskMessage, sendTaskMessageStream, updateTask, refinePlanFromRun };
}
