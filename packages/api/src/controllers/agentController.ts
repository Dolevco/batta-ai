import { Request, Response } from 'express';
import { AgentService } from '../services/agentService';
import type { CreateAgentRequest, UpdateAgentRequest } from '../types';

export class AgentController {
  private agentService: AgentService;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  async createAgent(req: Request, res: Response): Promise<void> {
    try {
      const request: CreateAgentRequest = req.body;
      const tenantId = req.auth!.tenantId;

      if (!request.name || !request.role) {
        res.status(400).json({ error: 'Name and role are required' });
        return;
      }

      const agent = await this.agentService.createAgent(request, tenantId);
      res.status(201).json(agent);
    } catch (error) {
      console.error('Error creating agent:', error);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  }

  async getAgent(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const agent = await this.agentService.getAgent(id, tenantId);
      
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      
      res.json(agent);
    } catch (error) {
      console.error('Error getting agent:', error);
      res.status(500).json({ error: 'Failed to get agent' });
    }
  }

  async getAllAgents(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const agents = await this.agentService.getAllAgents(tenantId);
      res.json(agents);
    } catch (error) {
      console.error('Error getting agents:', error);
      res.status(500).json({ error: 'Failed to get agents' });
    }
  }

  async updateAgent(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const request: UpdateAgentRequest = req.body;
      const tenantId = req.auth!.tenantId;

      const agent = await this.agentService.updateAgent(id, request, tenantId);
      res.json(agent);
    } catch (error) {
      console.error('Error updating agent:', error);
      res.status(500).json({ error: 'Failed to update agent' });
    }
  }

  async deleteAgent(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const deleted = await this.agentService.deleteAgent(id, tenantId);
      
      if (!deleted) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting agent:', error);
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  }
}
