interface BaseIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

// MCP Integration Types
export interface MCPIntegration extends BaseIntegration {
  type: 'mcp';
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
}

interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
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

export interface MCPIntegrationDetails extends MCPIntegration {
  tools?: MCPToolInfo[];
  connectionStatus?: 'connected' | 'disconnected' | 'error';
  error?: string;
}

interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

// Built-in Integration Types
interface MdcIntegrationConfig {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  subscriptionId?: string;
}

interface CustomIntegrationField {
  /**
   * Key name used in the integration config object (e.g. tenantId)
   */
  key: string;

  /**
   * Human friendly label to show in the UI
   */
  displayName: string;

  /**
   * Short description/help text shown under the field
   */
  description?: string;

  /**
   * Placeholder/example value to show in the input
   */
  placeholder?: string;

  /**
   * Whether the field is required
   */
  required?: boolean;

  /**
   * Whether the field contains secrets and should be masked
   */
  secret?: boolean;

  /**
   * Field input type for rendering (string, password, textarea, number, boolean)
   */
  type?: 'string' | 'password' | 'textarea' | 'number' | 'boolean';
}

type CustomIntegrationConfigSchema = CustomIntegrationField[];

// New OAuth metadata that built-in integrations can optionally expose to the UI
interface BuiltInOAuthConfig {
  /**
   * URL (absolute or relative) to start the OAuth consent flow. If relative it will be resolved against the current origin.
   */
  authorizeUrl: string;

  /**
   * Optional default scopes to request
   */
  scopes?: string[];

  /**
   * Optional additional query params to include when building the consent URL
   */
  params?: Record<string, string>;
}

interface AuthMode {
  id: string;
  label: string;
  description: string;
  oauth?: BuiltInOAuthConfig;
  configSchema?: CustomIntegrationConfigSchema;
}

export interface BuiltInIntegration {
  id: string;
  name: string;
  description: string;
  category: string;
  uiCategory?: string;
  type: 'mcp' | 'code' | 'custom';
  config: MCPHttpConfig | MCPStdioConfig | MdcIntegrationConfig | Record<string, string>;
  configSchema?: CustomIntegrationConfigSchema;
  oauth?: BuiltInOAuthConfig;
  authModes?: AuthMode[];
}

export interface CustomIntegration extends BaseIntegration {
  type: 'custom' | 'code';
  // dynamic key/value config for custom integrations
  config: Record<string, string>;
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
  config?: Partial<Record<string, string>>;
  enabled?: boolean;
}
