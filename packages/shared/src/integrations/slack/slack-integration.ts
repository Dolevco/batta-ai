import { WebClient } from '@slack/web-api';
import { CustomIntegrationHandler } from '../../types';
import { Tool, ToolResult, ToolCategory } from '@batta/core';

export const SlackCategory: ToolCategory = {
  name: 'slack',
  description: 'Slack workspace communication and collaboration tools',
  keywords: ['communication', 'slack', 'message', 'channel', 'collaboration', 'chat'],
};

/**
 * Multi-Tenant Slack Integration for Enterprise Security Application
 * 
 * ARCHITECTURE OVERVIEW:
 * This integration supports a multi-tenant SaaS model where a single Slack app
 * is installed across multiple customer workspaces. Each tenant is isolated by:
 * 
 * 1. TENANT ISOLATION:
 *    - Each tenant has a unique tenantId for internal data segregation
 *    - Each tenant is mapped to a specific Slack workspaceId (team_id)
 *    - All API calls include tenant context headers for audit trails
 *    - Tool results include tenant metadata for traceability
 * 
 * 2. AUTHENTICATION MODEL:
 *    - Single Slack App with app-level bot token (xoxb-*)
 *    - Bot token is scoped to a specific workspace via OAuth installation
 *    - Optional user token (xoxp-*) for user-scoped operations like search
 *    - Workspace ID validation ensures operations stay within tenant boundaries
 * 
 * 3. DATA ISOLATION:
 *    - All Slack API calls are automatically scoped to the workspace in the token
 *    - Additional validation checks ensure responses match expected workspace
 *    - Results include tenant and workspace IDs for downstream filtering
 *    - Bot must be invited to channels to access their data (principle of least privilege)
 * 
 * 4. SECURITY CONSIDERATIONS:
 *    - Bot tokens should be stored securely per tenant (encrypted at rest)
 *    - Workspace ID mismatch triggers immediate error to prevent cross-tenant data leakage
 *    - All operations include metadata for security audit trails
 *    - Active users only (filters out deleted users and bots)
 * 
 * SLACK APP SETUP:
 * Required OAuth Scopes (Bot Token):
 * - channels:read, groups:read - List public/private channels
 * - channels:history, groups:history - Read channel messages
 * - chat:write - Send messages
 * - users:read - Get user information
 * - canvases:read, canvases:write - Canvas operations (optional)
 * 
 * Required OAuth Scopes (User Token - optional):
 * - search:read - Search messages across workspace
 * 
 * DEPLOYMENT MODEL:
 * - Slack App distributed via App Directory or custom OAuth flow
 * - Each workspace installation generates unique bot token
 * - Backend maps workspace_id -> tenant_id -> bot_token
 * - SlackIntegration instance created per tenant per request
 * 
 * @example
 * const config: SlackConfig = {
 *   tenantId: 'acme-corp-001',
 *   workspaceId: 'T1234567890',
 *   botToken: 'xoxb-...',
 *   userToken: 'xoxp-...', // optional
 *   workspaceName: 'ACME Corp Workspace' // optional for display
 * };
 * const integration = new SlackIntegration(config);
 * const tools = integration.getTools();
 */

/**
 * Multi-tenant Slack configuration for enterprise security app
 * Assumes a single Slack app installed across multiple workspaces
 */
export interface SlackConfig {
  /**
   * Internal tenant identifier for data isolation
   */
  tenantId: string;
  
  /**
   * Slack workspace/team ID this tenant is associated with
   */
  workspaceId: string;
  
  /**
   * Bot token for the Slack app (app-level, works across workspaces)
   * Format: xoxb-*
   */
  botToken: string;
  
  /**
   * Optional workspace name for display purposes
   */
  workspaceName?: string;
}

export class SlackIntegration implements CustomIntegrationHandler {
  id = 'slack';
  name = 'Slack';

  constructor(private config: SlackConfig) {}

  /**
   * Validates the Slack configuration for a specific tenant
   * Verifies bot token, workspace access, and tenant isolation
   */
  static async validate(config: SlackConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!config.tenantId) {
        return { valid: false, error: 'Tenant ID is required' };
      }
      
      if (!config.workspaceId) {
        return { valid: false, error: 'Workspace ID is required' };
      }
      
      if (!config.botToken || !config.botToken.startsWith('xoxb-')) {
        return { valid: false, error: 'Valid bot token is required (must start with xoxb-)' };
      }
      
      const inst = new SlackIntegration(config);
      const authData = await inst.testAuth();
      
      // Verify the workspace ID matches the authenticated team
      if (authData.team_id !== config.workspaceId) {
        return { 
          valid: false, 
          error: `Workspace ID mismatch. Expected ${config.workspaceId}, got ${authData.team_id}` 
        };
      }
      
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err?.message ?? String(err) };
    }
  }

  /**
   * Returns all available tools for this tenant's Slack workspace
   * All operations are scoped to the configured workspace for data isolation
   */
  getTools(): Tool[] {
    const workspaceInfo = this.config.workspaceName 
      ? ` (Workspace: ${this.config.workspaceName})` 
      : '';
    
    return [
      //this.createSearchMessagesTool(workspaceInfo),
      this.createSearchUsersTool(workspaceInfo),
      this.createSearchChannelsTool(workspaceInfo),
      this.createSendMessageTool(workspaceInfo),
      this.createReadChannelTool(workspaceInfo),
      this.createReadThreadTool(workspaceInfo),
      this.createCreateCanvasTool(workspaceInfo),
      this.createReadCanvasTool(workspaceInfo),
      this.createGetUserProfileTool(workspaceInfo),
    ];
  }

  private createSearchUsersTool(workspaceInfo: string): Tool {
    return {
      name: 'slackSearchUsers',
      category: SlackCategory,
      description: `Search for users in tenant's Slack workspace by name, email, or ID${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'query', description: 'Search query (name, email, or user ID)', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.searchUsers(params.query);
          return { 
            success: true, 
            message: `Users searched successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private createSearchChannelsTool(workspaceInfo: string): Tool {
    return {
      name: 'slackSearchChannels',
      category: SlackCategory,
      description: `Search for public and private channels by name in tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'query', description: 'Channel name to search for', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.searchChannels(params.query);
          return { 
            success: true, 
            message: `Channels searched successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private createSendMessageTool(workspaceInfo: string): Tool {
    return {
      name: 'slackSendMessage',
      category: SlackCategory,
      description: `Send a message to a channel or conversation in tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'channel', description: 'Channel ID or name', required: true, type: 'string' },
        { name: 'text', description: 'Message text', required: true, type: 'string' },
        { name: 'threadTs', description: 'Thread timestamp to reply to (optional)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.sendMessage(params.channel, params.text, params.threadTs);
          return { 
            success: true, 
            message: `Message sent successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          let errorMessage = err?.message ?? String(err);
          return { success: false, message: 'Failed to send slack message. make sure the channel ID is correct', error: errorMessage };
        }
      },
    };
  }

  private createReadChannelTool(workspaceInfo: string): Tool {
    return {
      name: 'slackReadChannel',
      category: SlackCategory,
      description: `Read message history from a channel in tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'channel', description: 'Channel ID', required: true, type: 'string' },
        { name: 'limit', description: 'Number of messages to retrieve (default 100)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.readChannel(params.channel, params.limit);
          return { 
            success: true, 
            message: `Channel history retrieved successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private createReadThreadTool(workspaceInfo: string): Tool {
    return {
      name: 'slackReadThread',
      category: SlackCategory,
      description: `Read complete thread conversation from a channel in tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'channel', description: 'Channel ID', required: true, type: 'string' },
        { name: 'threadTs', description: 'Thread timestamp', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.readThread(params.channel, params.threadTs);
          return { 
            success: true, 
            message: `Thread retrieved successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private createCreateCanvasTool(workspaceInfo: string): Tool {
    return {
      name: 'slackCreateCanvas',
      category: SlackCategory,
      description: `Create a new Slack canvas in tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'title', description: 'Canvas title', required: true, type: 'string' },
        { name: 'content', description: 'Canvas content in markdown', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.createCanvas(params.title, params.content);
          return { 
            success: true, 
            message: `Canvas created successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private createReadCanvasTool(workspaceInfo: string): Tool {
    return {
      name: 'slackReadCanvas',
      category: SlackCategory,
      description: `Read and export a Slack canvas as markdown from tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'canvasId', description: 'Canvas ID', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.readCanvas(params.canvasId);
          return { 
            success: true, 
            message: `Canvas retrieved successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private createGetUserProfileTool(workspaceInfo: string): Tool {
    return {
      name: 'slackGetUserProfile',
      category: SlackCategory,
      description: `Fetch complete user profile information from tenant's workspace${workspaceInfo}. Scoped to tenant ID: ${this.config.tenantId}`,
      parameters: [
        { name: 'userId', description: 'User ID', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.getUserProfile(params.userId);
          return { 
            success: true, 
            message: `User profile retrieved successfully for tenant ${this.config.tenantId}`, 
            result: { ...data, tenantId: this.config.tenantId, workspaceId: this.config.workspaceId }
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  // Lazy-initialized WebClient instances for bot and optional user tokens
  private botClient?: WebClient;

  private getClient(): WebClient {
    const token = this.config.botToken;

    if (!this.botClient) {
      this.botClient = new WebClient(token, { headers: { 'X-Tenant-ID': this.config.tenantId, 'X-Workspace-ID': this.config.workspaceId } });
    }
    return this.botClient;
  }

  /**
   * Makes an authenticated API call to Slack with tenant context
   * All calls are isolated to the tenant's workspace
   */
  private async callSlackAPI(method: string, params: Record<string, any> = {}): Promise<any> {
    const client = this.getClient();

    // Enrich params for metadata/auditing where appropriate. team_id is implicit in the token.
    const enrichedParams = { ...params };

    try {
      // Use the WebClient's apiCall which maps directly to Slack methods like 'chat.postMessage'
      const response: any = await client.apiCall(method, enrichedParams);

      if (!response || response.ok === false) {
        const error = response?.error || 'Slack API error';
        throw new Error(`[Tenant: ${this.config.tenantId}] ${error}`);
      }

      // Verify response is from the correct workspace (additional safety check)
      if (response.team_id && response.team_id !== this.config.workspaceId) {
        throw new Error(
          `Workspace ID mismatch in response. Expected ${this.config.workspaceId}, got ${response.team_id}`
        );
      }

      return response;
    } catch (err: any) {
      // Preserve previous behavior of returning structured error info when available
      const msg = err?.data || err?.response?.data ? (err.data ?? err.response.data) : err?.message ?? String(err);
      const body = typeof msg === 'string' ? msg : JSON.stringify(msg);
      throw new Error(`[Tenant: ${this.config.tenantId}] Slack API call failed: ${body}`);
    }
  }

  /**
   * Tests authentication and returns workspace information
   * Used for validation and tenant verification
   */
  private async testAuth(): Promise<any> {
    return await this.callSlackAPI('auth.test');
  }

  /**
   * Returns tenant configuration information
   * Useful for logging and debugging multi-tenant scenarios
   */
  getTenantInfo(): { tenantId: string; workspaceId: string; workspaceName?: string } {
    return {
      tenantId: this.config.tenantId,
      workspaceId: this.config.workspaceId,
      workspaceName: this.config.workspaceName,
    };
  }

  /**
   * Search users in the tenant's workspace
   * Fetches all users and filters locally to ensure proper tenant isolation
   */
  private async searchUsers(query: string): Promise<any> {
    // Fetch users from the tenant's workspace only
    const usersData = await this.callSlackAPI('users.list');
    const users = usersData.members || [];
    
    // Filter deleted users and bots for security purposes
    const activeUsers = users.filter((user: any) => !user.deleted && !user.is_bot);
    
    const filtered = activeUsers.filter((user: any) => {
      const name = user.name?.toLowerCase() || '';
      const realName = user.real_name?.toLowerCase() || '';
      const email = user.profile?.email?.toLowerCase() || '';
      const searchQuery = query.toLowerCase();
      
      return user.id === query || 
             name.includes(searchQuery) || 
             realName.includes(searchQuery) || 
             email.includes(searchQuery);
    });

    return { 
      users: filtered,
      totalUsers: activeUsers.length,
      matchedUsers: filtered.length 
    };
  }

  /**
   * Search channels in the tenant's workspace
   * Includes both public and private channels the bot has access to
   */
  private async searchChannels(query: string): Promise<any> {
    // Fetch channels from tenant's workspace only - bot must be a member or have appropriate scopes
    const [publicChannels, privateChannels] = await Promise.all([
      this.callSlackAPI('conversations.list', { 
        types: 'public_channel',
        exclude_archived: true,
        limit: 1000 
      }),
      this.callSlackAPI('conversations.list', { 
        types: 'private_channel',
        exclude_archived: true,
        limit: 1000 
      }),
    ]);

    const allChannels = [
      ...(publicChannels.channels || []),
      ...(privateChannels.channels || []),
    ];

    const filtered = allChannels.filter((channel: any) => {
      const name = channel.name?.toLowerCase() || '';
      const topic = channel.topic?.value?.toLowerCase() || '';
      const purpose = channel.purpose?.value?.toLowerCase() || '';
      const searchQuery = query.toLowerCase();
      
      return name.includes(searchQuery) || 
             topic.includes(searchQuery) || 
             purpose.includes(searchQuery);
    });

    return { 
      channels: filtered,
      totalChannels: allChannels.length,
      matchedChannels: filtered.length 
    };
  }

  /**
   * Send a message to a channel in the tenant's workspace
   * Bot must be a member of the channel
   */
  private async sendMessage(channel: string, text: string, threadTs?: string): Promise<any> {
    const params: Record<string, any> = { 
      channel, 
      text,
      // Add metadata for enterprise security tracking
      metadata: {
        event_type: 'security_bot_message',
        event_payload: {
          tenant_id: this.config.tenantId,
          workspace_id: this.config.workspaceId,
        }
      }
    };
    if (threadTs) params.thread_ts = threadTs;

    return await this.callSlackAPI('chat.postMessage', params);
  }

  /**
   * Read message history from a channel in the tenant's workspace
   * Bot must be a member of the channel or have appropriate permissions
   */
  private async readChannel(channel: string, limit?: string): Promise<any> {
    const params: Record<string, any> = { 
      channel,
      limit: limit ? parseInt(limit, 10) : 100,
      inclusive: true
    };

    return await this.callSlackAPI('conversations.history', params);
  }

  /**
   * Read a complete thread conversation from the tenant's workspace
   */
  private async readThread(channel: string, threadTs: string): Promise<any> {
    return await this.callSlackAPI('conversations.replies', { 
      channel, 
      ts: threadTs,
      inclusive: true 
    });
  }

  /**
   * Create a new canvas in the tenant's workspace
   * Requires canvases:write scope
   */
  private async createCanvas(title: string, content: string): Promise<any> {
    return await this.callSlackAPI('canvases.create', {
      title,
      document_content: {
        type: 'markdown',
        markdown: content,
      },
      // Add metadata for tenant tracking
      metadata: {
        tenant_id: this.config.tenantId,
        workspace_id: this.config.workspaceId,
      }
    });
  }

  /**
   * Read a canvas from the tenant's workspace
   * Requires canvases:read scope
   */
  private async readCanvas(canvasId: string): Promise<any> {
    return await this.callSlackAPI('canvases.access', { canvas_id: canvasId });
  }

  /**
   * Get user profile information from the tenant's workspace
   * User must belong to the workspace
   */
  private async getUserProfile(userId: string): Promise<any> {
    return await this.callSlackAPI('users.info', { user: userId });
  }
}
