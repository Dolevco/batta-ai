import type { StoredPlan } from '@ai-agent/core';
import { RedisEventPublisher } from '@ai-agent/shared';

export interface TaskData {
  id: string;
  description: string;
  tenantId: string;
  tools?: string[];
  plan?: StoredPlan;
  status: 'pending' | 'planning' | 'completed' | 'failed';
}

export interface TaskRunData {
  id: string;
  taskId: string;
  taskName?: string;
  tenantId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  chainOfThoughts: ChainThoughtEvent[];
  workerId?: string; // Container ID (Docker) or execution name (Azure) for cancellation
  environment?: 'local' | 'azure' | 'debug'; // Execution environment
}

export interface ChainThoughtEvent {
  id: string;
  timestamp: string;
  type: 'toolUse' | 'planStepStart' | 'planStepResult' | 'other';
  name?: string;
  reason?: string;
  message?: string;
  error?: string;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'failed';
  data?: any;
}

export interface TaskExecutionContext {
  task: TaskData;
  taskRun: TaskRunData;
  tenantId: string;
  redisPublisher?: RedisEventPublisher;
  chainOfThoughts?: ChainThoughtEvent[];
}

export interface MCPIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tenantId: string;
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
}

export interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CustomIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tenantId: string;
  type: 'custom' | 'code';
  config: Record<string, string>;
}
