import { v4 as uuidv4 } from 'uuid';
import type { IPolicyTemplateRepository } from '../persistence/interfaces';
import type { PolicyTemplate, PolicyTemplateType, SecurityTask } from '../types';
import {
  BASE_QUESTIONS,
  TASK_RULES,
  BASELINE_TASKS,
  RESPONSIBLE_AI_QUESTIONS,
  RESPONSIBLE_AI_TASK_RULES,
  RESPONSIBLE_AI_BASELINE_TASKS,
  PRIVACY_QUESTIONS,
  PRIVACY_TASK_RULES,
  PRIVACY_BASELINE_TASKS,
} from './securityReviewDefaults';

const DEFAULT_TEMPLATES: Record<
  PolicyTemplateType,
  Pick<PolicyTemplate, 'name' | 'description' | 'questions' | 'taskRules' | 'baselineTasks'>
> = {
  security_review: {
    name: 'Security Review',
    description: 'Controls the security questionnaire and task rules triggered during MCP-based code reviews.',
    questions: BASE_QUESTIONS,
    taskRules: TASK_RULES,
    baselineTasks: BASELINE_TASKS,
  },
  responsible_ai: {
    name: 'Responsible AI Review',
    description: 'Review template for features that introduce or rely on AI/ML models.',
    questions: RESPONSIBLE_AI_QUESTIONS,
    taskRules: RESPONSIBLE_AI_TASK_RULES,
    baselineTasks: RESPONSIBLE_AI_BASELINE_TASKS,
  },
  privacy: {
    name: 'Privacy Review',
    description: 'Review template for features that collect, process, or share personal data.',
    questions: PRIVACY_QUESTIONS,
    taskRules: PRIVACY_TASK_RULES,
    baselineTasks: PRIVACY_BASELINE_TASKS,
  },
};

export class PolicyService {
  constructor(private repository: IPolicyTemplateRepository) {}

  async getAll(tenantId: string): Promise<PolicyTemplate[]> {
    const existing = await this.repository.getAll(tenantId);
    if (existing.length > 0) return existing;
    // Auto-seed defaults on first access so the UI never sees an empty list
    return this.seedDefaultPolicies(tenantId);
  }

  async getById(id: string, tenantId: string): Promise<PolicyTemplate | null> {
    return this.repository.getById(id, tenantId);
  }

  async getActivePolicy(tenantId: string, type: PolicyTemplateType): Promise<PolicyTemplate | null> {
    return this.repository.getActiveByType(tenantId, type);
  }

  async updatePolicy(
    id: string,
    tenantId: string,
    updates: Partial<Pick<PolicyTemplate, 'name' | 'description' | 'questions' | 'taskRules' | 'baselineTasks' | 'isActive'>>
  ): Promise<PolicyTemplate> {
    const existing = await this.repository.getById(id, tenantId);
    if (!existing) throw new Error(`PolicyTemplate not found: ${id}`);

    return this.repository.update(id, tenantId, {
      ...updates,
      version: existing.version + 1,
    });
  }

  async resetToDefaults(tenantId: string, type: PolicyTemplateType): Promise<PolicyTemplate> {
    const existing = await this.repository.getActiveByType(tenantId, type);
    const defaults = DEFAULT_TEMPLATES[type];

    if (existing) {
      return this.repository.update(existing.id, tenantId, {
        questions: defaults.questions,
        taskRules: defaults.taskRules,
        baselineTasks: defaults.baselineTasks,
        version: existing.version + 1,
      });
    }

    // No existing template — seed it
    const [seeded] = await this.seedDefaultPolicies(tenantId);
    const all = await this.repository.getAll(tenantId);
    return all.find(t => t.type === type) ?? seeded;
  }

  async seedDefaultPolicies(tenantId: string): Promise<PolicyTemplate[]> {
    const existing = await this.repository.getAll(tenantId);
    const existingTypes = new Set(existing.map(t => t.type));

    const types: PolicyTemplateType[] = ['security_review', 'responsible_ai', 'privacy'];
    const now = new Date().toISOString();
    const created: PolicyTemplate[] = [];

    for (const type of types) {
      if (existingTypes.has(type)) continue;

      const defaults = DEFAULT_TEMPLATES[type];
      const template: PolicyTemplate = {
        id: uuidv4(),
        tenantId,
        type,
        name: defaults.name,
        description: defaults.description,
        questions: defaults.questions,
        taskRules: defaults.taskRules,
        baselineTasks: defaults.baselineTasks,
        version: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const saved = await this.repository.create(template);
      created.push(saved);
    }

    return created.length > 0 ? created : existing;
  }
}
