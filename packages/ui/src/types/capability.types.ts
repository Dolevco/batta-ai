export type IntegrationCategory = 'code' | 'cloud' | 'work_item' | 'notification' | 'mcp' | 'custom';

export interface ProcessState {
  database: boolean;
  mcp: boolean;
  llm: boolean;
  embeddings: boolean;
}

export interface IntegrationSummary {
  id: string;
  category: IntegrationCategory;
  provider: string;
  connected: boolean;
  displayName: string;
}

export interface CapabilitySetupAction {
  kind: 'connect_integration' | 'set_env' | 'run_index';
  label: string;
  href?: string;
}

export interface Capability {
  id: string;
  available: boolean;
  reasons: string[];
  setupActions: CapabilitySetupAction[];
}

export interface CapabilitiesResponse {
  process: ProcessState;
  integrations: IntegrationSummary[];
  capabilities: Capability[];
}
