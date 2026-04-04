import type { Agent, CreateAgentRequest, UpdateAgentRequest } from '../types';
import type { IAgentRepository } from '@ai-agent/shared';
import { v4 as uuidv4 } from 'uuid';

export class AgentService {
  constructor(private repository: IAgentRepository) {}

  async createAgent(request: CreateAgentRequest, tenantId: string): Promise<Agent> {
    const agent: Agent = {
      id: uuidv4(),
      name: request.name,
      role: request.role,
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return await this.repository.create(agent);
  }

  async getAgent(id: string, tenantId: string): Promise<Agent | null> {
    return await this.repository.getById(id, tenantId);
  }

  async getAllAgents(tenantId: string): Promise<Agent[]> {
    return await this.repository.getAll(tenantId);
  }

  async updateAgent(id: string, request: UpdateAgentRequest, tenantId: string): Promise<Agent> {
    return await this.repository.update(id, request);
  }

  async deleteAgent(id: string, tenantId: string): Promise<boolean> {
    return await this.repository.delete(id, tenantId);
  }
}
