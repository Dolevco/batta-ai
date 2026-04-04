import type { Thought } from '../../../types';
import { ToolVisualizationEvent, SemanticAction } from './types';

// Map tool names to semantic actions
const toolToSemanticActionMap: Record<string, SemanticAction> = {
  // File operations
  'read_file': 'read_file',
  'write_to_file': 'write_file',
  'write_file': 'write_file',
  'create_file': 'write_file',
  'delete_file': 'delete_file',
  'insert_content': 'modify_file',
  'replace_content': 'modify_file',
  'replace_content_in_range': 'modify_file',
  'replace_in_file': 'modify_file',
  'search_and_replace': 'modify_file',
  'edit_file': 'modify_file',
  'search_files_content': 'search_files',
  'search_files': 'search_files',
  'list_files': 'list_files',
  
  // Command execution
  'execute_command': 'run_command',
  'run_command': 'run_command',
  
  // Git operations
  'git_commit': 'git_commit',
  'git_stage_commit_push': 'git_commit',
  'git_diff': 'git_diff',
  'git_status': 'git_diff',
  'git_add': 'git_operation',
  'git_checkout': 'git_operation',
  'git_push': 'git_operation',
  
  // GitHub operations
  'githubCreatePullRequest': 'github_pr',
  'github_create_pr': 'github_pr',
  'create_pull_request': 'github_pr',
  
  // Security & Data query operations
  'get_entities_by_type': 'query_data',
  'search_entities': 'query_data',
  'search_semantic': 'query_data',
  'get_relationship_graph': 'query_data',
  'get_threat_model': 'query_data',
  'get_internet_exposed_resources': 'query_data',
  'get_trust_boundary_analysis': 'query_data',
  'get_high_risk_resources': 'query_data',
  'analyze_vulnerability_impact': 'query_data',
  
  // Microsoft Defender for Cloud operations
  'listMDCAssessments': 'query_data',
  'getMDCAssessmentDetails': 'query_data',
  'getMDCSubAssessments': 'query_data',
  
  // Task query operations
  'search_tasks': 'query_data',
  'get_task_details': 'query_data',
  'search_task_runs': 'query_data',
  'get_task_run_details': 'query_data',
  
  
  // Communication
  'send_message': 'send_message',
  'send_slack_message': 'send_message',
  'slackSendMessage': 'send_message',
  'slackSearchUsers': 'query_data',
  
  // Memory operations
  'stepMemoryRetrieved': 'generate_memory',
  'generate_memory': 'generate_memory',
};

export function convertThoughtsToVisualizationEvents(thoughts: Thought[]): ToolVisualizationEvent[] {
  const events: ToolVisualizationEvent[] = [];
  
  // Create a map of toolUse to toolResult for merging data
  const toolResultMap = new Map<string, Thought>();
  
  // First pass: index all toolResults by finding their corresponding toolUse
  for (let i = 0; i < thoughts.length; i++) {
    const thought = thoughts[i];
    if (thought.type === 'toolResult' && thought.name) {
      // Find the preceding toolUse with the same name
      for (let j = i - 1; j >= 0; j--) {
        const prevThought = thoughts[j];
        if (prevThought.type === 'toolUse' && prevThought.name === thought.name) {
          toolResultMap.set(prevThought.id, thought);
          break;
        }
      }
    }
  }
  
  for (const thought of thoughts) {
    // Only process toolUse thoughts
    if (thought.type !== 'toolUse' || !thought.name) {
      continue;
    }

    // Skip task completion, delegation, and correlation completion tools (no visualization needed)
    if (thought.name === 'task_complete' || 
        thought.name === 'delegate_task' || 
        thought.name === 'complete_correlation_task') {
      continue;
    }

    // Map to semantic action
    const semanticAction = toolToSemanticActionMap[thought.name];
    if (!semanticAction) {
      // Intelligent fallback matching for unmapped tools
      const toolName = thought.name.toLowerCase();
      
      // File operations
      if (toolName.includes('read') || toolName.includes('get') || toolName.includes('fetch')) {
        events.push(createEvent(thought, 'read_file', toolResultMap));
      } else if (toolName.includes('write') || toolName.includes('create') || toolName.includes('save')) {
        events.push(createEvent(thought, 'write_file', toolResultMap));
      } else if (toolName.includes('edit') || toolName.includes('modify') || toolName.includes('replace') || 
                 toolName.includes('insert') || toolName.includes('update') || toolName.includes('patch')) {
        events.push(createEvent(thought, 'modify_file', toolResultMap));
      } else if (toolName.includes('delete') || toolName.includes('remove')) {
        events.push(createEvent(thought, 'delete_file', toolResultMap));
      } else if (toolName.includes('search') && toolName.includes('file')) {
        events.push(createEvent(thought, 'search_files', toolResultMap));
      } else if (toolName.includes('list') && toolName.includes('file')) {
        events.push(createEvent(thought, 'list_files', toolResultMap));
      }
      // Git operations
      else if (toolName.includes('git')) {
        if (toolName.includes('commit')) {
          events.push(createEvent(thought, 'git_commit', toolResultMap));
        } else if (toolName.includes('diff') || toolName.includes('status')) {
          events.push(createEvent(thought, 'git_diff', toolResultMap));
        } else {
          events.push(createEvent(thought, 'git_operation', toolResultMap));
        }
      }
      // GitHub operations
      else if ((toolName.includes('github') || toolName.includes('pullrequest') || toolName.includes('pull_request')) && 
               (toolName.includes('create') || toolName.includes('pr'))) {
        events.push(createEvent(thought, 'github_pr', toolResultMap));
      }
      // Command/execution
      else if (toolName.includes('command') || toolName.includes('execute') || toolName.includes('run')) {
        events.push(createEvent(thought, 'run_command', toolResultMap));
      }
      // Query/search/data operations
      else if (toolName.includes('query') || toolName.includes('search') || toolName.includes('find') || 
               toolName.includes('entities') || toolName.includes('analyze') || toolName.includes('scan') ||
               toolName.includes('vulnerability') || toolName.includes('security') || toolName.includes('threat') ||
               toolName.includes('risk') || toolName.includes('task') || toolName.includes('details')) {
        events.push(createEvent(thought, 'query_data', toolResultMap));
      }
      // Planning
      else if (toolName.includes('plan')) {
        if (toolName.includes('generate')) {
          events.push(createEvent(thought, 'generate_plan', toolResultMap));
        } else if (toolName.includes('execute')) {
          events.push(createEvent(thought, 'execute_plan', toolResultMap));
        } else if (toolName.includes('validate')) {
          events.push(createEvent(thought, 'validate_plan', toolResultMap));
        } else {
          events.push(createEvent(thought, 'generate_plan', toolResultMap));
        }
      }
      // Memory
      else if (toolName.includes('memory')) {
        events.push(createEvent(thought, 'generate_memory', toolResultMap));
      }
      // Communication
      else if (toolName.includes('message') || toolName.includes('send') || toolName.includes('chat')) {
        events.push(createEvent(thought, 'send_message', toolResultMap));
      }
      // If no match found, skip (no visualization)
      else {
        console.debug(`No visualization mapping for tool: ${thought.name}`);
      }
      continue;
    }

    events.push(createEvent(thought, semanticAction, toolResultMap));
  }

  return events;
}

function createEvent(thought: Thought, semanticAction: SemanticAction, toolResultMap: Map<string, Thought>): ToolVisualizationEvent {
  // Get the corresponding toolResult if it exists
  const toolResult = toolResultMap.get(thought.id);
  
  return {
    id: thought.id,
    semanticAction,
    objectName: extractObjectName(thought, toolResult),
    data: extractData(thought, toolResult),
    status: toolResult?.status === 'success' ? 'completed' : 
            toolResult?.status === 'failed' ? 'completed' :
            thought.status === 'success' ? 'completed' :
            thought.status === 'failed' ? 'completed' :
            'in_progress',
  };
}

function extractObjectName(thought: Thought, toolResult?: Thought): string | undefined {
  // For MDC assessment tools, use a descriptive name
  if (thought.name === 'listMDCAssessments') {
    return 'List Security Assessments';
  }
  if (thought.name === 'getMDCAssessmentDetails') {
    const assessmentId = thought.result?.parameters?.assessmentId || thought.result?.assessmentId;
    return assessmentId ? `Assessment ${assessmentId.substring(0, 8)}...` : 'Assessment Details';
  }
  
  // Try result first (more accurate)
  if (toolResult?.result?.path) return toolResult.result.path;
  if (toolResult?.result?.file) return toolResult.result.file;
  if (toolResult?.result?.filename) return toolResult.result.filename;
  
  // Then try thought result
  if (thought.result?.path) return thought.result.path;
  if (thought.result?.file) return thought.result.file;
  if (thought.result?.filename) return thought.result.filename;
  
  // Try parameters
  if (thought.result?.parameters?.path) return thought.result.parameters.path;
  if (thought.result?.parameters?.file) return thought.result.parameters.file;
  if (thought.result?.parameters?.filename) return thought.result.parameters.filename;
  
  // Try to extract from reason or message
  if (thought.reason && thought.reason.includes('file')) {
    const match = thought.reason.match(/(?:file|File)\s+([^\s,]+)/);
    if (match) return match[1];
  }
  if (thought.message && thought.message.includes('file')) {
    // Extract filename from message like "Reading file package.json"
    const match = thought.message.match(/(?:file|File)\s+([^\s,]+)/);
    if (match) return match[1];
  }
  
  return thought.name;
}

function extractData(thought: Thought, toolResult?: Thought): any {
  const data: any = {};
  
  // Store the complete toolUse thought data
  data.toolUse = {
    name: thought.name,
    reason: thought.reason,
    message: thought.message,
    result: thought.result,
    status: thought.status,
  };
  
  // Extract metadata and preview from toolUse result if available
  if (thought.result && typeof thought.result === 'object') {
    if ((thought.result as any).metadata) {
      data.toolUse.metadata = (thought.result as any).metadata;
    }
    if ((thought.result as any).preview) {
      data.toolUse.preview = (thought.result as any).preview;
    }
  }
  
  // Extract parameters - prioritize direct thought.parameters field first (most reliable)
  if (thought.parameters) {
    data.parameters = { ...thought.parameters };
  }
  
  // Merge parameters from thought.result if they exist
  if (thought.result && typeof thought.result === 'object') {
    // Sometimes parameters are stored in result.parameters
    if (thought.result.parameters) {
      data.parameters = { ...data.parameters, ...thought.result.parameters };
    }
    // Also check for direct parameter fields (but not result/parameters/metadata/preview keys)
    Object.keys(thought.result).forEach(key => {
      if (key !== 'parameters' && key !== 'result' && key !== 'metadata' && key !== 'preview') {
        if (!data.parameters) data.parameters = {};
        // Don't overwrite if already exists from thought.parameters
        if (!(key in data.parameters)) {
          data.parameters[key] = thought.result[key];
        }
      }
    });
  }
  
  // Try to extract parameters from thought message if it contains JSON (lowest priority)
  if (thought.message && typeof thought.message === 'string') {
    try {
      const jsonMatch = thought.message.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.parameters) {
          data.parameters = { ...data.parameters, ...parsed.parameters };
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }
  
  // Store the complete toolResult thought data (if available)
  if (toolResult) {
    data.toolResult = {
      name: toolResult.name,
      message: toolResult.message,
      error: toolResult.error,
      result: toolResult.result,
      status: toolResult.status,
      metadata: (toolResult.result as any)?.metadata || (toolResult as any)?.metadata, // Include metadata if available
      preview: (toolResult.result as any)?.preview || (toolResult as any)?.preview, // Include preview if available
    };
    
    // Also store the result data in a convenient location for backwards compatibility
    if (toolResult.result) {
      if (typeof toolResult.result === 'object') {
        // Store the actual result data separately from parameters
        data.result = toolResult.result;
      } else {
        data.result = toolResult.result;
      }
    }
    if (toolResult.message) data.message = toolResult.message;
    if (toolResult.error) data.error = toolResult.error;
    if (toolResult.status) data.success = toolResult.status === 'success';
  }

  // Include message or reason as additional context (for backwards compatibility)
  if (thought.message && !data.message) data.message = thought.message;
  if (thought.reason) data.reason = thought.reason;
  if (thought.error && !data.error) data.error = thought.error;
  
  // Store the tool name for reference
  if (thought.name) data.name = thought.name;

  return data;
}
