/**
 * DataIndexerAgentDefinition
 *
 * Extends the core AgentDefinition with factories so that data-indexer agent
 * roles carry their own complete Task configuration in one place.
 *
 * Each registered agent definition owns:
 *   – customInstructions → the full system-prompt for this role (moved from modes.ts)
 *   – maxIterations      → the iteration cap appropriate for this role
 *   – completionToolFactory → factory that returns a fresh completion-tool
 *                            instance per Task invocation (tools are stateful)
 *   – toolsFactory (optional) → factory that returns workspace-aware file tools
 *                               given the repository path; omit for context-only agents
 *
 * Security notes:
 *   – Definitions contain no secrets or user-supplied data; they are static
 *     configuration objects assembled at module-load time.
 *   – The completionToolFactory always returns a fresh instance so that
 *     per-task state (e.g. validation caches) is never shared across invocations.
 *   – toolsFactory receives the workspace path from the caller and creates
 *     read-only file tools scoped to that path — the caller controls the path,
 *     the definition controls which tool types are created.
 */

import type { AgentDefinition } from '@batta/core';
import type { Tool } from '@batta/core';

export interface DataIndexerAgentDefinition extends AgentDefinition {
  /**
   * Returns a fresh completion-tool instance for each Task invocation.
   * Completion tools are stateful (they capture the task-complete signal),
   * so a new instance must be created per Task — never share across calls.
   */
  completionToolFactory: () => Tool;

  /**
   * Optional factory that creates workspace-aware file tools for this agent.
   * Analysis agents (IaC, build artifact, external deps) need read-only file
   * access; feature-extraction and threat-model agents work from injected context
   * only and do NOT set this field.
   *
   * @param workspacePath - Absolute path to the repository root.
   * @returns Array of read-only file Tool instances scoped to workspacePath.
   */
  toolsFactory?: (workspacePath: string) => Tool[];
}
