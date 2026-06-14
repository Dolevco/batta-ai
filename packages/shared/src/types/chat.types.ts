export interface ChatMessage {
  id: string;
  conversationId: string;
  taskId?: string;
  tenantId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface ConversationSummary {
  conversationId: string;
  taskId?: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}
