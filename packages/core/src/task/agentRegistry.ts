/**
 * AgentRegistry — stores and retrieves AgentDefinition objects by agentType.
 *
 * Agent Definition System with Persistent Per-Agent Memory.
 *
 * Usage:
 *   const registry = new AgentRegistry();
 *   registry.register(CODE_REVIEW_AGENT);
 *   const def = registry.get('code-reviewer');
 *
 * Security note:
 *  - Agent types are simple string keys; no special characters are required or enforced at
 *    this layer. Callers using agentType to derive file paths must sanitize the value.
 *  - Tool allowlists (definition.tools) are enforced in SubAgentExecutor when building the
 *    effective tool set for a delegation request.
 */

import { AgentDefinition } from './types';
import {
  GENERAL_PURPOSE_AGENT,
  CODE_REVIEW_AGENT,
  EXPLORE_AGENT,
  PLAN_AGENT
} from './agentDefinition';

export class AgentRegistry {
  private readonly agents: Map<string, AgentDefinition> = new Map();

  constructor() {
    // Register built-in agents by default
    this.register(GENERAL_PURPOSE_AGENT);
    this.register(CODE_REVIEW_AGENT);
    this.register(EXPLORE_AGENT);
    this.register(PLAN_AGENT);
  }

  /**
   * Register an agent definition. Overwrites any existing definition with the same agentType.
   */
  register(definition: AgentDefinition): void {
    // Sanitize agentType to alphanumeric + hyphen/underscore for safe use as a map key or path segment
    const safeType = definition.agentType.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.agents.set(safeType, { ...definition, agentType: safeType });
  }

  /**
   * Get an agent definition by type. Returns undefined if not found.
   */
  get(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType);
  }

  /**
   * Return the default (general-purpose) agent definition.
   */
  getDefault(): AgentDefinition {
    return this.agents.get('general') ?? GENERAL_PURPOSE_AGENT;
  }

  /**
   * Return all registered definitions.
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Format a human-readable listing of all agents suitable for injection into a system prompt.
   *
   * Example output:
   *   Available sub-agent types:
   *   - general: A general-purpose sub-agent that can use any available tool. Use when: ...
   *   - code-reviewer: Reviews code for correctness, security, and style. Use when: ...
   */
  formatAgentListing(): string {
    const lines = ['Available sub-agent types:'];
    for (const def of this.getAll()) {
      lines.push(`- ${def.agentType}: ${def.description} Use when: ${def.whenToUse}`);
    }
    return lines.join('\n');
  }
}

/** Singleton default registry — pre-loaded with built-in agents. */
export const defaultAgentRegistry = new AgentRegistry();
