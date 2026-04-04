import { 
  AzureOpenAIClient, 
  AzureOpenAIEmbeddingClient, 
  PlannedTask, 
  PlanMemory, 
  LongTermMemory, 
  TaskStepLongTermMemory, 
  ILLMApiHandler, 
  createChatInteractionTools, 
  MODES,
  Tool, 
  ToolConfig, 
  MCPToolRegistry,
  DockerMCPLoader, 
  CodeIntegrationProvider,
  TaskEventMap
} from '@ai-agent/core';
import { v4 as uuidv4 } from 'uuid';
import type { 
  MCPIntegration, 
  MCPHttpConfig, 
  MCPStdioConfig, 
  CodeIntegrationHandler,
  CustomIntegration,
  ChainThoughtEvent
} from '../types';
import type { ICustomIntegrationRepository } from '../persistence/interfaces';
import { MicrosoftDefenderIntegration } from '../integrations/microsoftDefenderIntegration';
import { SlackIntegration, type SlackConfig } from '../integrations/slackIntegration';
import { GitHubIntegration, type GitHubConfig } from '../integrations/githubIntegration';
import { RedisEventPublisher } from '../events';

export interface PlannedTaskConfig {
  usePlanningAssistantMode?: boolean;
  mcpIntegrations?: MCPIntegration[];
  customIntegrationRepository?: ICustomIntegrationRepository;
  tenantId: string;
  toolsFilter?: string[]; // Array of integration IDs to filter by
  extraCustomInstructions?: string; // optional prebuilt instructions (e.g. enriched feedback summaries)
  highReasoningEffort?: boolean;
  // Redis configuration for event publishing
  redisUrl?: string;
  redisChannel?: string;
  // Enable/disable chain of thoughts tracking
  enableChainOfThoughts?: boolean;
}

export interface PlannedTaskResult {
  plannedTask: PlannedTask;
  longTermMemory: LongTermMemory;
  apiClient: ILLMApiHandler;
  redisPublisher?: RedisEventPublisher;
  chainOfThoughts?: ChainThoughtEvent[];
  eventListeners?: Array<{ event: string; fn: (...args: any[]) => void }>;
}

/**
 * Initialize a PlannedTask with all necessary dependencies
 * This factory is used by both API and Worker packages
 */
export async function initializePlannedTask(
  config: PlannedTaskConfig
): Promise<PlannedTaskResult> {
  const {
    usePlanningAssistantMode = false,
    mcpIntegrations = [],
    customIntegrationRepository,
    tenantId,
    toolsFilter,
    extraCustomInstructions,
    highReasoningEffort = false,
    redisUrl,
    redisChannel,
    enableChainOfThoughts = false,
  } = config;

  // Validate required environment variables
  if (!process.env.AZURE_OPENAI_ENDPOINT || 
      !process.env.AZURE_OPENAI_API_KEY || 
      !process.env.AZURE_OPENAI_DEPLOYMENT) {
    throw new Error('Missing required Azure OpenAI environment variables');
  }

  // Create API clients
  const apiClient = new AzureOpenAIClient({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    highReasoningEffort
  });

  const embeddingClient = new AzureOpenAIEmbeddingClient({
    endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY,
    deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-ada-002',
    apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
  });

  // Create tool configuration
  const toolConfig: ToolConfig = {
    notificationCallback: async (msg: string) => {
      console.log('📢 Notification:', msg);
    }
  };

  // Create tools
  const allTools: Tool[] = [
    ...createChatInteractionTools(toolConfig),
  ];

  // Load MCP tools (if any) and custom integration tools
  await loadMCPTools(allTools, mcpIntegrations);
  const codeIntegrationProvider = await loadCustomIntegrationTools(
    allTools, 
    customIntegrationRepository, 
    tenantId, 
    toolsFilter
  );

  console.log(`📦 Initialized ${allTools.length} tools for planning`);

  // Initialize long-term memory for plan caching
  const longTermMemory = new LongTermMemory(embeddingClient, {
    collectionName: 'task_memories',
    minSimilarityScore: 0.8,
  }, apiClient);
  await longTermMemory.initialize();
  console.log('💾 Long-term memory initialized for plan caching');

  // Create plan memory
  const planMemory = new PlanMemory(longTermMemory);
  
  // Create task step memory for step-level learning
  const taskStepMemory = await createTaskStepMemory(longTermMemory, apiClient);

  // Create PlannedTask with task run memory and task step memory
  const plannedTask = new PlannedTask(
    apiClient,
    {
      tools: allTools,
      mode: usePlanningAssistantMode ? MODES.PLANNING_ASSISTANT : MODES.PLANNING,
      maxSubAgentIterations: 10,
      planner: {
        temperature: 0,
        similarityThreshold: 0.85,
        maxSubTasks: 8,
      },
      codeIntegrationProvider,
      customInstructions: extraCustomInstructions, // inject feedback-guided instructions into planner
      taskStepMemory, // Pass task step memory for step-level learning
    },
    planMemory,
    embeddingClient
  );

  // Set up Redis publisher for streaming if configured
  let redisPublisher: RedisEventPublisher | undefined;
  const chainOfThoughts: ChainThoughtEvent[] = [];
  
  if (redisUrl && redisChannel) {
    redisPublisher = new RedisEventPublisher(redisChannel, redisUrl);
    await redisPublisher.connect();
    console.log(`📡 Redis publisher connected: ${redisChannel}`);
    
    // Hook up Redis publisher to task events
    const eventsToPublish: Array<keyof TaskEventMap> = [
      'toolUse', 'toolResult', 'memorySummary', 'memoryStored', 
      'stepMemoryRetrieved', 'error', 'planStepStart', 'planStepResult', 'message', 'streamChunk'
    ];
    
    for (const eventName of eventsToPublish) {
      plannedTask.events.on(eventName, (payload: any) => {
        // Store in chain of thoughts if enabled
        if (enableChainOfThoughts) {
          const chainEvent: ChainThoughtEvent = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            type: eventName as any,
            data: payload,
          };
          chainOfThoughts.push(chainEvent);
        }
        
        // Publish to Redis
        redisPublisher!.publish(eventName as string, payload).catch((err: any) => {
          console.error(`Failed to publish ${String(eventName)} to Redis:`, err);
        });
      });
    }
  }

  return { 
    plannedTask, 
    longTermMemory, 
    apiClient,
    redisPublisher,
    chainOfThoughts: enableChainOfThoughts ? chainOfThoughts : undefined,
  };
}

/**
 * Create a TaskStepLongTermMemory instance for storing step-level execution memories
 */
export async function createTaskStepMemory(longTermMemory: LongTermMemory, apiClient: ILLMApiHandler): Promise<TaskStepLongTermMemory> {
  const taskStepMemory = new TaskStepLongTermMemory(longTermMemory, apiClient);
  await taskStepMemory.initialize();
  console.log('💾 Task step memory initialized');
  return taskStepMemory;
}

/**
 * Attach progress listeners to a PlannedTask
 * Used primarily by the API for streaming responses
 */
export function attachProgressListeners(
  plannedTask: PlannedTask, 
  onProgress?: (eventName: string, payload: unknown) => void
): Array<{ event: string; fn: (...args: any[]) => void }> {
  const listeners: { event: string; fn: (...args: any[]) => void }[] = [];
  if (!onProgress || !plannedTask) return listeners;

  const forward = (eventName: string) => (...args: any[]) => {
    try {
      const payload = args.length === 1 ? args[0] : args;
      onProgress(eventName, payload);
    } catch (e) {
      // ignore streaming errors but log for visibility
      console.error('Streaming callback error', e);
    }
  };

  const EventsToForward = ['toolUse', 'toolResult', 'memorySummary', 'memoryStored', 'stepMemoryRetrieved', 'error', 'planStepStart', 'planStepResult'];

  for (const ev of EventsToForward) {
    const fn = forward(ev);
    plannedTask.events.on(ev as any, fn);
    listeners.push({ event: ev, fn });
  }

  return listeners;
}

/**
 * Detach progress listeners from a PlannedTask
 */
export function detachProgressListeners(
  plannedTask: PlannedTask, 
  listeners: Array<{ event: string; fn: (...args: any[]) => void }>
): void {
  if (!plannedTask || listeners.length === 0) return;
  for (const l of listeners) {
    try {
      if (plannedTask.events && typeof plannedTask.events.removeListener === 'function') {
        plannedTask.events.removeListener(l.event as any, l.fn);
      }
    } catch (e) {
      // ignore detach errors
      console.error('Error detaching listener', e);
    }
  }
}

/**
 * Cleanup resources associated with a PlannedTask
 */
export async function cleanupPlannedTask(result: PlannedTaskResult): Promise<void> {
  if (result.redisPublisher) {
    await result.redisPublisher.close();
    console.log('📡 Redis publisher closed');
  }
  
  if (result.eventListeners && result.eventListeners.length > 0) {
    detachProgressListeners(result.plannedTask, result.eventListeners);
  }
}

// Helper: load MCP integration tools into the provided allTools array
async function loadMCPTools(allTools: Tool[], mcpIntegrations?: MCPIntegration[]): Promise<void> {
  if (!mcpIntegrations || mcpIntegrations.length === 0) return;
  console.log(`🔌 Loading ${mcpIntegrations.length} MCP integrations...`);
  const mcpRegistry = new MCPToolRegistry();

  for (const integration of mcpIntegrations) {
    if (!integration.enabled) {
      console.log(`⏭️  Skipping disabled integration: ${integration.name}`);
      continue;
    }

    try {
      let mcpTools: Tool[] = [];

      if (integration.transport === 'http') {
        const config = integration.config as MCPHttpConfig;
        const serverConfig = {
          name: integration.name,
          transport: 'http' as const,
          url: config.url,
          headers: config.headers,
        };
        mcpTools = await mcpRegistry.addServer(serverConfig);
      } else {
        const config = integration.config as MCPStdioConfig;
        if (config.command.toLowerCase().includes('docker')) {
          mcpTools = await new DockerMCPLoader().loadDockerMCPServers();
        }
        else {
          const serverConfig = {
            name: integration.name,
            transport: 'stdio' as const,
            command: config.command,
            args: config.args,
            env: config.env,
          };
          mcpTools = await mcpRegistry.addServer(serverConfig)
        }
      }

      allTools.push(...mcpTools);
      console.log(`✅ Loaded ${mcpTools.length} tools from ${integration.name}`);
    } catch (error) {
      console.error(`❌ Failed to load MCP integration ${integration.name}:`, error);
    }
  }
}

// Helper: load custom integration tools (e.g., built-in handlers like Microsoft Defender)
async function loadCustomIntegrationTools(
  allTools: Tool[], 
  customIntegrationRepository?: ICustomIntegrationRepository, 
  tenantId?: string, 
  toolsFilter?: string[]
): Promise<CodeIntegrationProvider | undefined> {
  if (!customIntegrationRepository || !tenantId) return;

  try {
    let customIntegrations = await customIntegrationRepository.getAll(tenantId, true); // enabled only

    // Apply toolsFilter if provided
    if (toolsFilter && toolsFilter.length > 0) {
      customIntegrations = customIntegrations.filter((ci: CustomIntegration) => toolsFilter.includes(ci.id));
    }

    console.log(`🔌 Loading ${customIntegrations.length} custom integrations...`);
    const codeHandlers: CodeIntegrationHandler[] = [];

    for (const integration of customIntegrations) {
      if (!integration.enabled) {
        console.log(`⏭️  Skipping disabled custom integration: ${integration.name}`);
        continue;
      }

      try {
        // Map known custom integration IDs to handler implementations
        // Extend this switch as more handlers are added
        let handlerTools: Tool[] = [];
        switch (integration.name) {
          case 'Microsoft Defender for Cloud': {
            // integration.config is Record<string,string>
            const cfg = integration.config as Record<string,string>;
            const defender = new MicrosoftDefenderIntegration({
              tenantId: cfg.tenantId || '',
              clientId: cfg.clientId || '',
              clientSecret: cfg.clientSecret || '',
              subscriptionId: cfg.subscriptionId || '',
            });
            handlerTools = defender.getTools();
            break;
          }
          case 'Slack': {
            // Slack OAuth integration
            const cfg = integration.config as Record<string,string>;
            const slackConfig: SlackConfig = {
              tenantId: cfg.tenantId || '',
              workspaceId: cfg.workspaceId || '',
              botToken: cfg.botToken || '',
              workspaceName: cfg.workspaceName || undefined,
            };
            const slack = new SlackIntegration(slackConfig);
            handlerTools = slack.getTools();
            break;
          }
          case 'GitHub': {
            // GitHub App installation integration
            const cfg = integration.config as Record<string,string>;
            const githubConfig: GitHubConfig = {
              tenantId: cfg.tenantId || '',
              installationId: cfg.installationId || '',
              appId: cfg.appId || process.env.GITHUB_APP_ID,
            };
            const github = new GitHubIntegration(githubConfig);
            handlerTools = github.getTools();
            codeHandlers.push(github);
            break;
          }
          // unknown custom integrations are currently ignored (could be extended to dynamic loaders)
          default: {
            console.log(`⚠️  No handler registered for custom integration id=${integration.id}, skipping`);
            break;
          }
        }

        if (handlerTools.length > 0) {
          allTools.push(...handlerTools);
          console.log(`✅ Loaded ${handlerTools.length} tools from custom integration ${integration.name}`);
        }
      } catch (err) {
        console.error(`❌ Failed to initialize custom integration ${integration.name}:`, err);
      }
    }
    return await createCodeIntegrationProvider(codeHandlers, toolsFilter);
  } catch (err) {
    console.error('❌ Failed to load custom integrations:', err);
  }
}

// Helper to initialize and return a CodeIntegrationProvider from stored custom integrations
async function createCodeIntegrationProvider(
  handlers?: CodeIntegrationHandler[], 
  toolsFilter?: string[]
): Promise<CodeIntegrationProvider | undefined> {
  try {
    if (!handlers || handlers.length === 0) return undefined;

    const handlerInfos = await Promise.all(handlers.map(async (h) => {
      let repositories: any[] | undefined = undefined;
      try {
        if (typeof h.getRepositories === 'function') {
          repositories = await h.getRepositories();
        }
      } catch (err) {
        console.error(`Failed to fetch repositories for handler ${h.id}:`, err);
      }

      return {
        id: h.id,
        name: h.name,
        description: `Code integration: ${h.name}`,
        getCodingTools: h.getCodingTools.bind(h),
        getAccessToken: h.getAccessToken.bind(h),
        repositories,
      };
    }));

    return new CodeIntegrationProvider(handlerInfos);
  } catch (err) {
    console.error('❌ Failed to load code integrations:', err);
    return undefined;
  }
}
