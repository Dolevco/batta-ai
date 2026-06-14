/**
 * useChatHistory — React Context that persists chat conversation state across
 * client-side navigation.
 *
 * WHY: ChatPage is unmounted every time the user navigates away (e.g. to a
 * detail page opened from the chat table). By lifting the message list into a
 * context that lives above the router, the conversation is preserved and
 * restored when the user navigates back.
 *
 * SECURITY: The context is in-memory only — nothing is written to
 * localStorage, sessionStorage, or any server beyond the existing chat API.
 * The data is scoped to the authenticated session and clears when the tab
 * closes or the user logs out (via clearHistory()).
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import type { TableProjection } from '../components/chat/ChatEntityTable';

// ── Types (duplicated here to keep the context self-contained) ────────────────

export interface DfdPayload {
  actors: any[];
  processes: any[];
  dataStores: any[];
  flows: any[];
  trustBoundaries: string[];
  featureName: string;
}

export interface GraphProjection {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    severity?: string;
    metadata?: Record<string, any>;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    type: string;
    confidence: string;
    label?: string;
  }>;
  focusNodeId?: string;
  explanation?: string;
  graphType?: 'relationship' | 'dfd';
  dfd?: DfdPayload;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  graph?: GraphProjection;
  /** Table visualization — mutually exclusive with graph */
  table?: TableProjection;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface ChatHistoryContextType {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  clearHistory: () => void;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <ChatHistoryContext.Provider value={{ messages, setMessages, clearHistory }}>
      {children}
    </ChatHistoryContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChatHistory(): ChatHistoryContextType {
  const ctx = useContext(ChatHistoryContext);
  if (!ctx) {
    throw new Error('useChatHistory must be used inside <ChatHistoryProvider>');
  }
  return ctx;
}
