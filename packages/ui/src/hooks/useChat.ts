import { useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../services/api';
import { useAuth } from './useAuth';

export function useChat() {
  const { acquireToken } = useAuth();
  const sendChat = useCallback(async (message: string, conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>, onEvent: (eventName: string, data: any) => void): Promise<void> => {
    const response = await fetchWithAuth(acquireToken, `${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
      body: JSON.stringify({ message, conversationHistory }),
    });

    if (!response.ok) throw new Error('Failed to send chat message');
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            onEvent(eventName, parsed);
          } catch (e) {
            console.warn('Failed to parse SSE data:', data);
          }
        }
      }
    }
  }, []);

  return { sendChat };
}
