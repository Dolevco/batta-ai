/**
 * Agent Definition System
 *
 * Provides typed agent definitions with scoped memory and tool allowlists
 *
 * Security note:
 *  - Tool allowlists are enforced in SubAgentExecutor when resolving delegate_task parameters.
 *  - Memory scope paths must be under the project root or user home; validated by callers.
 */

import { AgentDefinition } from './types';
import { DEFAULT_SUB_AGENT_PROMPT } from '../context/prompts/system';

export { AgentDefinition };

// ─────────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_AGENT_GUIDELINES = `Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analysing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- Search broadly when you don't know where something lives. Use read_file when you know the specific path.
- Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless absolutely necessary. ALWAYS prefer editing an existing file.
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested.
- Use absolute file paths in your final report. Include code snippets only when the exact text is load-bearing.`;

// ─────────────────────────────────────────────────────────────────────────────
// Built-in agent definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * General-purpose sub-agent: all tools, no restrictions.
 */
export const GENERAL_PURPOSE_AGENT: AgentDefinition = {
  agentType: 'general',
  description: 'A general-purpose sub-agent for researching complex questions, searching for code, and executing multi-step tasks.',
  whenToUse: 'Use for any task that does not match a more specialised agent type. Prefer this when you need to search for a keyword or file and are not confident you will find the right match in the first few tries.',
  customInstructions: `${DEFAULT_SUB_AGENT_PROMPT}

${SHARED_AGENT_GUIDELINES}`,
};

/**
 * Code-review sub-agent: read-only analysis, no write or execution.
 */
export const CODE_REVIEW_AGENT: AgentDefinition = {
  agentType: 'code-reviewer',
  description: 'Reviews code for correctness, security, and style without making changes.',
  whenToUse: 'Use after code changes are applied to get an independent validation of the result. Also use to get a second opinion on a design or implementation decision.',
  tools: ['read_file', 'list_files', 'search_files_content', 'task_complete'],
  memory: {
    scope: 'project',
    collectionName: 'agent-code-reviewer'
  },
  maxIterations: 20,
  customInstructions:
    '=== READ-ONLY MODE — NO FILE MODIFICATIONS ===\n' +
    'You are STRICTLY PROHIBITED from creating, modifying, or deleting any files.\n\n' +
    'Focus on:\n' +
    '- Bugs and logic errors\n' +
    '- Security vulnerabilities (injection, auth bypass, insecure data handling)\n' +
    '- Style violations and maintainability issues\n\n' +
    'Report findings with exact file paths and line numbers. Be specific — vague findings are not actionable.',
};

/**
 * Exploration sub-agent: read-only, safe to parallelize.
 */
export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  description: 'Fast, read-only exploration of a codebase or directory.',
  whenToUse: 'Use to quickly find files by pattern, search code for keywords, or answer questions about the codebase without modifying anything. Specify the desired thoroughness: "quick" for basic searches, "medium" for moderate exploration, "very thorough" for comprehensive analysis.',
  tools: ['read_file', 'list_files', 'search_files_content', 'task_complete'],
  maxIterations: 15,
  customInstructions:
    '=== READ-ONLY MODE — NO FILE MODIFICATIONS ===\n' +
    'You are STRICTLY PROHIBITED from creating, modifying, or deleting any files.\n\n' +
    'Explore systematically:\n' +
    '- Search broadly using patterns first, then narrow to specific files.\n' +
    '- Make parallel search calls wherever possible to maximise speed.\n' +
    '- Adapt thoroughness to the level specified by the caller.\n\n' +
    'Report findings clearly with absolute file paths. Never fabricate results.',
};

/**
 * Planner sub-agent: creates structured plans without executing them.
 */
export const PLAN_AGENT: AgentDefinition = {
  agentType: 'planner',
  description: 'Creates a numbered, step-by-step execution plan for a complex multi-step task.',
  whenToUse: 'Use when the task requires upfront planning before execution, especially for multi-repository or multi-step workflows. The plan can be reviewed before any changes are made.',
  maxIterations: 10,
  customInstructions:
    'Produce a numbered plan. For each step include:\n' +
    '  - What needs to be done (specific, not generic)\n' +
    '  - Which tools or capabilities are required\n' +
    '  - Expected output / what "done" looks like\n' +
    '  - Dependencies (which previous steps must complete first)\n\n' +
    'Identify which steps are independent and can run in parallel.\n' +
    'Do NOT execute any step — only plan.',
};
