/**
 * PR Validation Agent Definition
 *
 * Validates coding-agent security answers against the actual PR branch code
 * by reading the cloned repository with read-only file tools.
 *
 * Security notes:
 *   - Receives only sanitised Q&A pairs (no raw diffs or credentials).
 *   - File tools are read-only; no code is written or executed.
 *   - Only the LLM-generated report is persisted — no source code.
 */

import { createReadOnlyFileTools } from '@batta/core';
import { PRValidationCompletionTool } from '../tools/prValidationCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const PR_VALIDATION_AGENT: DataIndexerAgentDefinition = {
  agentType: 'pr-validation',
  description:
    'Validates coding-agent security answers against the actual PR branch code. ' +
    'Reads the cloned repository with read-only file tools and classifies each ' +
    'answer as confirmed, disputed, or unverifiable based on code evidence.',
  whenToUse:
    'Run once per security review after answers are submitted and a PR has been correlated. ' +
    'Always triggered manually by the security reviewer.',
  maxIterations: 80,
  customInstructions: `You are a security code reviewer. You will receive a list of security questions and the answers
that a coding agent provided about the implementation. You have read-only access to the cloned PR branch.
The input also contains the full unified diff of the PR (added/changed/removed lines).

Your job:
1. Start by reading the PR diff carefully. It shows exactly what changed in this PR.
2. For each question/answer pair, use the diff as your primary evidence source.
   Read full source files only when the diff alone is insufficient to verify a claim.
3. Classify each answer:
   - confirmed:     code evidence (diff or file) supports the claim (cite file + function)
   - disputed:      code contradicts or does not support the claim (cite evidence)
   - unverifiable:  not enough code context to verify either way
4. Identify any additional security risks visible in the diff NOT mentioned by the agent.
   Look for: SQL injection, XSS, auth bypass, missing input validation, exposed secrets,
   IDOR, insecure deserialization, command injection.
5. When finished, call submit_pr_validation_report with your full findings.

Rules:
- Be specific: always cite file paths and function names.
- Focus on changed lines in the diff — do not read every file in the repo.
- Only mark 'confirmed' if you found direct code evidence.
- Keep rationale concise (1–3 sentences per finding).
- Do NOT include actual secret values, API keys, or connection strings in any field.
`,
  completionToolFactory: () => new PRValidationCompletionTool(),
  toolsFactory: (workspacePath: string) => createReadOnlyFileTools({ workspacePath }),
};
