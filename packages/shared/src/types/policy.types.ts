import type { SecurityTask, SecurityReviewQuestion } from './security-review.types';

export type PolicyTemplateType = 'security_review' | 'responsible_ai' | 'privacy' | 'work_item_review';

export interface PolicyTaskRule {
  questionId: string;
  tasks: Omit<SecurityTask, 'id'>[];
}

export interface JiraActionItemsConfig {
  /** Whether to create Jira issues for generated tasks automatically on attestation */
  autoCreate: boolean;
  /** Minimum severity that triggers issue creation */
  severityThreshold: 'critical' | 'high' | 'medium' | 'low';
  /** Target Jira project key, e.g. "SEC" */
  targetProjectKey: string;
  /** Jira issue type to create, e.g. "Task" or "Bug" */
  issueType: string;
  /** Maps task severity → Jira priority name */
  priorityMap: {
    critical: string;
    high: string;
    medium: string;
    low: string;
  };
}

export interface PolicyTemplate {
  id: string;
  tenantId: string;
  type: PolicyTemplateType;
  name: string;
  description: string;
  questions: SecurityReviewQuestion[];
  taskRules: PolicyTaskRule[];
  baselineTasks: Omit<SecurityTask, 'id'>[];
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optional Jira export config. Only meaningful for work_item_review policies. */
  jiraActionItems?: JiraActionItemsConfig;
}
