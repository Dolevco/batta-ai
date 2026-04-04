export interface DatabaseConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  taskCollectionName: string;
  chatMessageCollectionName: string;
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    taskCollectionName: process.env.TASK_COLLECTION_NAME || 'agent_tasks',
    chatMessageCollectionName: process.env.CHAT_MESSAGE_COLLECTION_NAME || 'chat_messages',
  };
}
