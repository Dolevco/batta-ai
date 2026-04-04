/**
 * Example: Using PlannedTask for Consistent Task Decomposition
 * 
 * This example demonstrates:
 * 1. Creating a PlannedTask that extends Task with planning capabilities
 * 2. Using PlanMemory to cache and reuse plans via semantic similarity
 * 3. Executing tasks with automatic sub-task delegation
 * 
 * PlannedTask provides:
 * - list_tool_details: to discover available tools
 * - delegate_task: to execute sub-tasks via sub-agents
 * - Plan caching via long-term memory for consistency
 * 
 * Dynamic Code Integration:
 * - Use codeIntegrationId: "dynamic" when a repository isn't known upfront
 * - The dependency step must return metadata with repositoryName (e.g., "owner/repo")
 * - Use task_complete tool's metadata parameter: { repositoryName: "owner/repo" }
 * - Example: Step 1 scans for vulnerabilities → returns repo in metadata
 *           Step 2 uses codeIntegrationId: "dynamic" → gets repo from Step 1
 */

import { config as dotenvConfig } from 'dotenv';
import { AzureOpenAIClient } from '../src/api/providers/azureOpenAIClient';
import { AzureOpenAIEmbeddingClient } from '../src/api/providers/azureOpenAIEmbeddingClient';
import { 
  createFileTools, 
  createCommandTools, 
  createChatInteractionTools,
  Tool
} from '../src/tools';
import { ToolConfig } from '../src/tools/types';
import { PlannedTask, PlanMemory, StoredPlan, PlanResult } from '../src/task/planner';
import { LongTermMemory } from '../src/context/memory/longTerm/longTermMemory';
import { Message } from '../src/task/types';
import { ToolUse, ToolResult } from '../src/tools/types';
import { MODES } from '../src/context/prompts/modes';
import { DockerMCPLoader } from '../src/tools/mcp/dockerMCPLoader';
import { TaskCompletionTool } from '../dist/tools/task/taskCompletionTool';

dotenvConfig();

// Validate required environment variables
const requiredEnvVars = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT'
] as const;
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('\nPlease create a .env file based on .env.example');
  process.exit(1);
}

// Create API clients
const apiClient = new AzureOpenAIClient({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT!,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
});

const embeddingClient = new AzureOpenAIEmbeddingClient({
  endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY!,
  deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-ada-002',
  apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
});

function printPlan(plan: StoredPlan) {
  console.log('\n📋 Generated Plan:');
  console.log('─'.repeat(50));
  
  for (let i = 0; i < plan.subTasks.length; i++) {
    const task = plan.subTasks[i];
    const deps = task.dependsOn.length > 0 
      ? ` (depends on: ${task.dependsOn.join(', ')})` 
      : '';
    
    console.log(`\n  [${i}] ${task.intent}${deps}`);
    console.log(`      Tools: ${task.tools.join(', ')}`);
    console.log(`      Expected: ${task.expectedOutput}`);
  }
  
  console.log('─'.repeat(50));
}

function printResults(result: PlanResult) {
  console.log('\n📊 Execution Results:');
  console.log('─'.repeat(50));
  
  for (const r of result.results) {
    const status = r.success ? '✅' : '❌';
    console.log(`\n  ${status} Task ${r.index}:`);
    if (r.result) {
      const preview = r.result.length > 100 
        ? r.result.substring(0, 100) + '...' 
        : r.result;
      console.log(`     Result: ${preview}`);
    }
    if (r.error) {
      console.log(`     Error: ${r.error}`);
    }
  }
  
  console.log('─'.repeat(50));
  console.log(`\n${result.success ? '✅ Plan completed successfully' : '❌ Plan failed: ' + result.error}`);
}

async function main() {
  try {
    const toolConfig: ToolConfig = {
      workspacePath: process.cwd(),
      notificationCallback: async (msg: string) => {
        console.log('📢 Notification:', msg);
      }
    };

    // Create tools
    const mcpTools = await new DockerMCPLoader().loadDockerMCPServers();
    const allTools: Tool[] = [
      ...createFileTools(toolConfig),
      ...createCommandTools(toolConfig),
      ...createChatInteractionTools(toolConfig),
      new TaskCompletionTool(),
      ...mcpTools
    ];

    console.log(`\n📦 Available tools: ${allTools.length}`);
    console.log(`   ${allTools.map(t => t.name).join(', ')}`);

    // Initialize long-term memory for plan caching
    const longTermMemory = new LongTermMemory(embeddingClient, {
      collectionName: 'task_plans',
      minSimilarityScore: 0.8,
    });
    await longTermMemory.initialize();
    console.log('\n💾 Long-term memory initialized for plan caching');

    // Create plan memory
    const planMemory = new PlanMemory(longTermMemory);

    // Create PlannedTask - extends Task with planning capabilities
    const plannedTask = new PlannedTask(
      apiClient,
      {
        tools: allTools,
        mode: MODES.CODE_ASSISTANT,
        workspace: process.cwd(),
        maxSubAgentIterations: 10,
        planner: {
          temperature: 0,           // Low for consistency
          similarityThreshold: 0.85,  // Reuse plans for similar tasks
          maxSubTasks: 8,
        },
      },
      planMemory,
      embeddingClient
    );

    // Set up event handlers (PlannedTask extends Task)
    plannedTask.events.on('message', (message: Message) => {
      const preview = message.content.length > 200 
        ? message.content.substring(0, 200) + '...' 
        : message.content;
      console.log(`\n💬 ${message.role}: ${preview}`);
    });

    plannedTask.events.on('toolUse', (toolUse: ToolUse) => {
      console.log(`\n🔧 Tool: ${toolUse.name}`);
      console.log(`   Reason: ${toolUse.reason}`);
    });

    plannedTask.events.on('toolResult', (result: ToolResult) => {
      const status = result.success ? '✅' : '❌';
      const preview = result.message && result.message.length > 100
        ? result.message.substring(0, 100) + '...'
        : result.message;
      console.log(`\n${status} Result: ${preview}`);
    });

    // Example task
    const taskDescription = 'Search the web for updated weather tomorrow in Tel Aviv, and then create a directory in this repo called "forecasts" with a text file contains the forecast for Tel Aviv';

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 Task: ${taskDescription}`);
    console.log('='.repeat(60));

    // Option 1: Generate a plan without executing
    console.log('\n🔍 Generating plan...');
    const plan = await plannedTask.generatePlan(taskDescription);
    printPlan(plan.result!);

    // Option 2: Execute using the cached plan
    console.log('\n🚀 Executing with cached plan...');
    const result = await plannedTask.executeWithPlanCache(taskDescription);
    printResults(result);

    // Option 3: Execute directly (uses Task.execute with delegate_task)
    console.log('\n\n' + '='.repeat(60));
    console.log('🔄 Running another task directly via execute()...');
    console.log('='.repeat(60));

    const directTask = 'What is the project name from package.json?';
    console.log(`\n📝 Direct Task: ${directTask}`);
    
    const directResult = await plannedTask.execute(directTask);
    console.log(`\n✅ Completed: ${directResult.summary}`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
