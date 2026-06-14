import { AgentRegistry, defaultAgentRegistry } from '../../task/agentRegistry';
import { AgentDefinition } from '../../task/types';

function makeDef(agentType: string): AgentDefinition {
  return {
    agentType,
    description: `${agentType} agent`,
    whenToUse: `when you need ${agentType}`
  };
}

describe('AgentRegistry', () => {
  describe('constructor', () => {
    it('pre-loads built-in agents', () => {
      const registry = new AgentRegistry();
      const all = registry.getAll();
      expect(all.length).toBeGreaterThan(0);
      // Verify the general-purpose agent exists
      expect(registry.get('general')).toBeDefined();
    });
  });

  describe('register', () => {
    it('stores a new agent definition', () => {
      const registry = new AgentRegistry();
      registry.register(makeDef('custom-agent'));
      expect(registry.get('custom-agent')).toBeDefined();
    });

    it('overwrites an existing definition with the same agentType', () => {
      const registry = new AgentRegistry();
      const v1 = { ...makeDef('dup'), description: 'version 1' };
      const v2 = { ...makeDef('dup'), description: 'version 2' };
      registry.register(v1);
      registry.register(v2);
      expect(registry.get('dup')?.description).toBe('version 2');
    });

    it('sanitizes special characters from agentType', () => {
      const registry = new AgentRegistry();
      registry.register(makeDef('bad/name!'));
      // special chars replaced with underscore
      expect(registry.get('bad_name_')).toBeDefined();
    });
  });

  describe('get', () => {
    it('returns undefined for an unknown agentType', () => {
      const registry = new AgentRegistry();
      expect(registry.get('ghost')).toBeUndefined();
    });

    it('returns the correct definition by type', () => {
      const registry = new AgentRegistry();
      const def = makeDef('finder');
      registry.register(def);
      const found = registry.get('finder');
      expect(found?.agentType).toBe('finder');
      expect(found?.description).toBe('finder agent');
    });
  });

  describe('getDefault', () => {
    it('returns the general agent', () => {
      const registry = new AgentRegistry();
      const def = registry.getDefault();
      expect(def).toBeDefined();
      expect(def.agentType).toBe('general');
    });

    it('returns the fallback definition if general agent is absent', () => {
      // This is defensive — the built-in always registers "general"
      const registry = new AgentRegistry();
      (registry as any).agents.delete('general');
      const def = registry.getDefault();
      // Still returns a valid AgentDefinition (the GENERAL_PURPOSE_AGENT fallback)
      expect(def).toBeDefined();
      expect(typeof def.agentType).toBe('string');
    });
  });

  describe('getAll', () => {
    it('returns all registered agents', () => {
      const registry = new AgentRegistry();
      const before = registry.getAll().length;
      registry.register(makeDef('extra'));
      expect(registry.getAll().length).toBe(before + 1);
    });
  });

  describe('formatAgentListing', () => {
    it('returns a string listing with all agent types', () => {
      const registry = new AgentRegistry();
      registry.register(makeDef('my-agent'));
      const listing = registry.formatAgentListing();
      expect(typeof listing).toBe('string');
      expect(listing).toContain('my-agent');
      expect(listing).toContain('Available sub-agent types');
    });
  });
});

describe('defaultAgentRegistry', () => {
  it('is an AgentRegistry instance', () => {
    expect(defaultAgentRegistry).toBeInstanceOf(AgentRegistry);
  });

  it('contains the general agent', () => {
    expect(defaultAgentRegistry.get('general')).toBeDefined();
  });
});
