/**
 * DataIndexerAgentRegistry
 *
 * Centralised registry for all data-indexer agent roles.
 * Stores DataIndexerAgentDefinition objects keyed by agentType and provides
 * a createTask() factory that assembles a fully-configured Task for a given role.
 *
 * This is intentionally separate from the core AgentRegistry:
 *   – Core AgentRegistry is for sub-agent spawning at runtime via the `agent` tool.
 *   – DataIndexerAgentRegistry is for internal data-indexer pipeline roles which
 *     are never spawned via the agent tool.
 *
 * Security notes:
 *   – agentType strings are sanitized to alphanumeric + hyphen/underscore, matching
 *     the same sanitization rule used in core AgentRegistry.register().
 *   – createTask() never accepts a raw system prompt from callers; customInstructions
 *     always come from the agent definition (immutable static config).
 *   – File tools are created inside each agent definition's toolsFactory so the
 *     workspace path is controlled by the definition, not the caller.
 *   – The completionToolFactory is always called fresh per invocation so that
 *     per-task tool state is never shared across parallel calls.
 */

import { Task } from '@batta/core';
import type { ILLMApiHandler, TaskConfig, Tool } from '@batta/core';
import { AgentModel } from '@batta/core';
import type { DataIndexerAgentDefinition } from './types';

export class DataIndexerAgentRegistry {
  private readonly store = new Map<string, DataIndexerAgentDefinition>();

  /**
   * @param api      - Default (large-model) LLM API handler used for all agents.
   * @param smallApi - Optional small-model handler. Agents tagged AgentModel.Small
   *                   use this client; all others use api.
   */
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly smallApi?: ILLMApiHandler,
  ) {}

  /**
   * Register an agent definition.
   * Overwrites any existing definition with the same agentType.
   * agentType is sanitized to alphanumeric + hyphen/underscore.
   */
  register(definition: DataIndexerAgentDefinition): void {
    const safeType = definition.agentType.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.store.set(safeType, { ...definition, agentType: safeType });
  }

  /**
   * Retrieve an agent definition by type.
   * Throws if the type is not registered — fail-fast is preferable to returning
   * undefined and silently running with no mode or completion tool.
   */
  get(agentType: string): DataIndexerAgentDefinition {
    const def = this.store.get(agentType);
    if (!def) {
      // Error message contains only the sanitized agentType string — no user data,
      // no file paths, and no system internals.
      throw new Error(`Unknown data-indexer agent type: "${agentType}"`);
    }
    return def;
  }

  /**
   * Return the default (large-model) LLM API handler.
   * Used by callers that need a direct ILLMApiHandler reference (e.g. correlators
   * that do not use the agent/task abstraction).
   */
  getApi(): ILLMApiHandler {
    return this.api;
  }

  /**
   * Return all registered definitions.
   */
  getAll(): DataIndexerAgentDefinition[] {
    return Array.from(this.store.values());
  }

  /**
   * Return a new registry with the same clients and all current definitions,
   * but with the given definition registered (overriding any existing one with
   * the same agentType). Used to create short-lived registries with cloud-query
   * tool variants without mutating the shared registry.
   */
  withDefinition(definition: DataIndexerAgentDefinition): DataIndexerAgentRegistry {
    const clone = new DataIndexerAgentRegistry(this.api, this.smallApi);
    for (const def of this.store.values()) {
      clone.register(def);
    }
    clone.register(definition);
    return clone;
  }

  /**
   * Build and return a fully-configured Task for the given agent role.
   *
   * The correct LLM client is chosen automatically based on the agent definition's
   * model field: AgentModel.Small agents use the smallApi passed to the constructor;
   * all others use the default api.
   *
   * Tool assembly:
   *   1. def.toolsFactory(workspace) — file tools created by the definition
   *      (only for analysis agents that need workspace access).
   *   2. completionToolFactory() — always last so the LLM sees it as the
   *      designated "call when done" tool at the end of the tool list.
   *
   * customInstructions and maxIterations always come from the agent definition.
   * Callers may pass workspace and other non-security-relevant TaskConfig fields
   * via overrides, but customInstructions is never overridden by callers.
   *
   * @param agentType - Registered agent type string (use DataIndexerAgentType).
   * @param overrides - Optional partial TaskConfig (workspace, memory, etc.).
   *                    Do NOT pass tools — the definition owns tool creation.
   */
  createTask(
    agentType: string,
    overrides: Omit<Partial<TaskConfig>, 'tools' | 'customInstructions'> = {},
  ): Task {
    const def = this.get(agentType);
    const effectiveApi = (def.model === AgentModel.Small && this.smallApi) ? this.smallApi : this.api;
    const completionTool: Tool = def.completionToolFactory();
    const defTools: Tool[] = def.toolsFactory
      ? def.toolsFactory(overrides.workspace ?? '')
      : [];
    const tools = [...defTools, completionTool];

    return new Task(effectiveApi, {
      ...overrides,
      tools,
      maxIterations: def.maxIterations,
      customInstructions: def.customInstructions,
    });
  }
}
