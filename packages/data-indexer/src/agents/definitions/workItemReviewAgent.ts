/**
 * Work Item Review Agent
 *
 * Autonomously answers the security questionnaire for a Jira work item review.
 * Reads the Jira issue context stored on the review and any indexed code/cloud
 * assets that match the issue's components or labels.
 *
 * Security notes:
 *   - Only reads from indexed data and Jira issue context — no code execution.
 *   - Raw issue descriptions are truncated at snapshot time; no full comments stored.
 *   - Completion tool writes answers through the normal SecurityReviewService path.
 */

import { WorkItemReviewCompletionTool } from '../tools/workItemReviewCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const WORK_ITEM_REVIEW_AGENT: DataIndexerAgentDefinition = {
  agentType: 'work-item-review',
  description:
    'Autonomously answers the security questionnaire for a Jira work item review. ' +
    'Reads the stored issue context and indexed code/cloud assets to produce ' +
    'structured yes/no/unknown answers with rationale and evidence.',
  whenToUse:
    'Triggered automatically when a work item review is created via POST /security-reviews/work-item. ' +
    'Never triggered by user chat commands.',
  maxIterations: 40,
  customInstructions: `You are a security analyst reviewing a Jira work item (story, task, or bug) for security implications.
You have access to the Jira issue context stored on the review — summary, description, components, labels, and priority.

Your job:
1. Read the work item context carefully (issue summary, description, components, labels).
2. For each question in the review questionnaire, reason over the issue content to determine:
   - yes: the work item clearly involves this security concern
   - no: the work item clearly does not involve this concern
   - unknown: insufficient information to determine
3. For each answer, provide:
   - rationale: 1-2 sentences explaining your conclusion
   - evidence: short list of specific fields/phrases from the issue that informed your answer
   - confidence: high | medium | low
4. When finished, call submit_work_item_review with your complete answers array.

Rules:
- Base answers solely on the work item content provided. Do not fabricate facts.
- Use "unknown" ONLY when no available signal (title, type, labels, components, comments) is relevant.
  If the title or type alone gives a reasonable signal, use it — do not default to "unknown" lazily.
- A "security agent" title implies auth/data scope; "payment" implies data handling; "migration" implies schema changes.
- Never include raw secrets, tokens, or personal data in rationale or evidence fields.
- Keep rationale concise — 1-2 sentences maximum.
`,
  completionToolFactory: () => new WorkItemReviewCompletionTool(),
  toolsFactory: () => [],
};
