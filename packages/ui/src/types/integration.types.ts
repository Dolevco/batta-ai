export interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface BaseIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MCPIntegration extends BaseIntegration {
  type: 'mcp';
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
}

export interface CreateMCPIntegrationRequest {
  name: string;
  description?: string;
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
  enabled?: boolean;
}

export interface UpdateMCPIntegrationRequest {
  name?: string;
  description?: string;
  config?: MCPHttpConfig | MCPStdioConfig;
  enabled?: boolean;
}

export interface DockerMCPServer {
  name: string;
  description: string;
  toolCount: number;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPIntegrationDetails extends MCPIntegration {
  tools?: MCPToolInfo[];
  connectionStatus?: 'connected' | 'disconnected' | 'error';
  error?: string;
}

export type BuiltInIntegrationCategory = 'all' | 'security' | 'communication' | 'development';

export interface CustomIntegrationField {
  key: string;
  displayName: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  type?: 'string' | 'password' | 'textarea' | 'number' | 'boolean';
}

type CustomIntegrationConfigSchema = CustomIntegrationField[];

interface BuiltInOAuthConfig {
  authorizeUrl: string;
  scopes?: string[];
  params?: Record<string, string>;
}

interface AuthMode {
  id: string;
  label: string;
  description: string;
  oauth?: BuiltInOAuthConfig;
  configSchema?: CustomIntegrationConfigSchema;
}

interface CodeIntegrationConfig {
  gitUrl: string;
  token: string;
  repositories: string[];
  webhookSecret?: string;
}

export interface BuiltInIntegration {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  uiCategory?: BuiltInIntegrationCategory;
  type: 'mcp' | 'code' | 'custom';
  config: MCPHttpConfig | MCPStdioConfig | CodeIntegrationConfig | Record<string, unknown>;
  configSchema?: CustomIntegrationConfigSchema;
  oauth?: BuiltInOAuthConfig;
  authModes?: AuthMode[];
}

// ── Code integrations ─────────────────────────────────────────────────────────

export interface CodeIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCodeIntegrationRequest {
  name: string;
  description?: string;
  gitUrl?: string;
  token?: string;
  repositories?: string[];
  webhookSecret?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateCodeIntegrationRequest {
  name?: string;
  description?: string;
  token?: string;
  repositories?: string[];
  enabled?: boolean;
}

// ── Custom integrations ───────────────────────────────────────────────────────

export interface CustomIntegration {
  id: string;
  name: string;
  type?: string;
  description?: string;
  config: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomIntegrationRequest {
  name: string;
  description?: string;
  config: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateCustomIntegrationRequest {
  name?: string;
  description?: string;
  config?: Record<string, string>;
  enabled?: boolean;
}
