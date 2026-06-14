import type { CustomIntegration, MCPIntegration } from '../types';
import type { ICustomIntegrationRepository, IMCPIntegrationRepository } from '../persistence/interfaces';

export type IntegrationCategory =
  | 'code'
  | 'cloud'
  | 'work_item'
  | 'notification'
  | 'mcp'
  | 'custom';

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

interface CapabilityRequirement {
  id: string;
  requirements: Array<'database' | 'mcp' | 'llm' | 'embeddings' | 'code' | 'cloud' | 'work_item'>;
}

const CAPABILITY_REQUIREMENTS: CapabilityRequirement[] = [
  { id: 'securityReviewLoop', requirements: ['database', 'mcp'] },
  { id: 'localAgentIndexing', requirements: ['database', 'mcp'] },
  { id: 'deterministicBrowse', requirements: ['database'] },
  { id: 'portalCodeScan', requirements: ['database', 'llm', 'embeddings', 'code'] },
  { id: 'portalCloudScan', requirements: ['database', 'llm', 'embeddings', 'cloud'] },
  { id: 'portalChat', requirements: ['database', 'llm', 'embeddings'] },
  { id: 'semanticSearch', requirements: ['database', 'embeddings'] },
  { id: 'workItemImport', requirements: ['database', 'work_item'] },
  { id: 'autonomousWorkItemReview', requirements: ['database', 'llm', 'work_item'] },
];

export class CapabilityService {
  constructor(
    private readonly process: ProcessState,
    private readonly customIntegrationRepository: ICustomIntegrationRepository,
    private readonly mcpIntegrationRepository: IMCPIntegrationRepository,
  ) {}

  async getCapabilities(tenantId: string): Promise<CapabilitiesResponse> {
    const [customIntegrations, mcpIntegrations] = await Promise.all([
      this.customIntegrationRepository.getAll(tenantId, false),
      this.mcpIntegrationRepository.getAll(tenantId, false),
    ]);
    const integrations = summarizeIntegrations(customIntegrations, mcpIntegrations);

    return deriveCapabilities(this.process, integrations);
  }
}

export function deriveCapabilities(
  process: ProcessState,
  integrations: IntegrationSummary[],
): CapabilitiesResponse {
  const connectedCategories = new Set(
    integrations.filter(integration => integration.connected).map(integration => integration.category),
  );

  return {
    process,
    integrations,
    capabilities: CAPABILITY_REQUIREMENTS.map(capability =>
      buildCapability(capability, process, connectedCategories),
    ),
  };
}

export function summarizeIntegrations(
  customIntegrations: CustomIntegration[],
  mcpIntegrations: MCPIntegration[],
): IntegrationSummary[] {
  return [
    ...customIntegrations.map(integration => ({
      id: integration.id,
      category: resolveCustomIntegrationCategory(integration),
      provider: resolveProvider(integration),
      connected: integration.enabled,
      displayName: integration.name,
    })),
    ...mcpIntegrations.map(integration => ({
      id: integration.id,
      category: 'mcp' as const,
      provider: 'mcp',
      connected: integration.enabled,
      displayName: integration.name,
    })),
  ];
}

function buildCapability(
  capability: CapabilityRequirement,
  process: ProcessState,
  connectedCategories: Set<IntegrationCategory>,
): Capability {
  const reasons: string[] = [];
  const setupActions = new Map<string, CapabilitySetupAction>();

  for (const requirement of capability.requirements) {
    if (requirement === 'database' && !process.database) {
      reasons.push('Database is not available');
      setupActions.set('database', { kind: 'set_env', label: 'Configure database' });
    }
    if (requirement === 'mcp' && !process.mcp) {
      reasons.push('MCP endpoint is not available');
      setupActions.set('mcp', { kind: 'set_env', label: 'Enable MCP endpoint' });
    }
    if (requirement === 'llm' && !process.llm) {
      reasons.push('LLM provider is not configured');
      setupActions.set('ai', { kind: 'set_env', label: 'Configure LLM and embeddings' });
    }
    if (requirement === 'embeddings' && !process.embeddings) {
      reasons.push('Embeddings are disabled or not configured');
      setupActions.set('ai', { kind: 'set_env', label: 'Configure LLM and embeddings' });
    }
    if (requirement === 'code' && !connectedCategories.has('code')) {
      reasons.push('No code integration connected');
      setupActions.set('code', { kind: 'connect_integration', label: 'Connect GitHub or GitLab', href: '/integrations' });
    }
    if (requirement === 'cloud' && !connectedCategories.has('cloud')) {
      reasons.push('No cloud integration connected');
      setupActions.set('cloud', { kind: 'connect_integration', label: 'Connect AWS or Azure', href: '/integrations' });
    }
    if (requirement === 'work_item' && !connectedCategories.has('work_item')) {
      reasons.push('No work item integration connected');
      setupActions.set('work_item', { kind: 'connect_integration', label: 'Connect Jira', href: '/integrations' });
    }
  }

  return {
    id: capability.id,
    available: reasons.length === 0,
    reasons,
    setupActions: Array.from(setupActions.values()),
  };
}

function resolveCustomIntegrationCategory(integration: CustomIntegration): IntegrationCategory {
  if (integration.type === 'code') return 'code';

  const provider = resolveProvider(integration);
  if (provider === 'amazon-aws' || provider === 'aws' || provider === 'microsoft-defender-cloud' || provider === 'microsoft-azure' || provider === 'azure') {
    return 'cloud';
  }
  if (provider === 'jira') return 'work_item';
  if (provider === 'slack') return 'notification';
  return 'custom';
}

function resolveProvider(integration: CustomIntegration): string {
  const candidate = integration.config?.provider || integration.config?.integrationId || integration.name;
  return candidate.trim().toLowerCase().replace(/\s+/g, '-');
}
