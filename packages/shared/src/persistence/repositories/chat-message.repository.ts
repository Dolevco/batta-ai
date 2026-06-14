import { Pool } from 'pg';
import type { ChatMessage, ConversationSummary } from '../../types';
import type { IChatMessageRepository, ChatMessageFilters, RepositoryConfig } from '../interfaces';
import { getPool } from '../client';

export class PostgresChatMessageRepository implements IChatMessageRepository {
  private readonly pool: Pool;

  constructor(_config: RepositoryConfig = {}) {
    this.pool = getPool();
  }

  async initialize(): Promise<void> {
    // Table created by schema.sql
  }

  async create(message: ChatMessage): Promise<ChatMessage> {
    await this.pool.query(
      `INSERT INTO chat_messages (id, tenant_id, conversation_id, task_id, role, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET payload = EXCLUDED.payload`,
      [
        message.id,
        (message as any).tenantId ?? '',
        message.conversationId,
        message.taskId ?? null,
        message.role,
        JSON.stringify(message),
      ]
    );
    return message;
  }

  async getByConversationId(conversationId: string, filters?: Omit<ChatMessageFilters, 'conversationId'>): Promise<ChatMessage[]> {
    const params: any[] = [conversationId];
    let sql = `SELECT payload FROM chat_messages WHERE conversation_id = $1`;
    let idx = 2;

    if (filters?.tenantId) {
      sql += ` AND tenant_id = $${idx++}`;
      params.push(filters.tenantId);
    }
    if (filters?.role) {
      sql += ` AND role = $${idx++}`;
      params.push(filters.role);
    }
    if (filters?.createdAfter) {
      sql += ` AND created_at >= $${idx++}`;
      params.push(filters.createdAfter);
    }
    if (filters?.createdBefore) {
      sql += ` AND created_at <= $${idx++}`;
      params.push(filters.createdBefore);
    }

    sql += ' ORDER BY created_at ASC';
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => r.payload as ChatMessage);
  }

  async getByTaskId(taskId: string, filters?: Omit<ChatMessageFilters, 'taskId'>): Promise<ChatMessage[]> {
    const params: any[] = [taskId];
    let sql = `SELECT payload FROM chat_messages WHERE task_id = $1`;
    let idx = 2;

    if (filters?.tenantId) {
      sql += ` AND tenant_id = $${idx++}`;
      params.push(filters.tenantId);
    }

    sql += ' ORDER BY created_at ASC';
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => r.payload as ChatMessage);
  }

  async getAllConversations(): Promise<ConversationSummary[]> {
    const res = await this.pool.query(
      `SELECT conversation_id,
              count(*) AS message_count,
              max(created_at) AS last_message_at
       FROM chat_messages
       GROUP BY conversation_id
       ORDER BY last_message_at DESC`
    );
    return res.rows.map(r => ({
      conversationId: r.conversation_id,
      messageCount: parseInt(r.message_count, 10),
      lastMessageAt: r.last_message_at,
    })) as ConversationSummary[];
  }

  async deleteByConversationId(conversationId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM chat_messages WHERE conversation_id = $1',
      [conversationId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async deleteByTaskId(taskId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM chat_messages WHERE task_id = $1',
      [taskId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
