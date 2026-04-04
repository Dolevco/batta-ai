export type SemanticAction =
  // File operations
  | "read_file"
  | "write_file"
  | "modify_file"
  | "delete_file"
  | "search_files"
  | "list_files"
  // Git operations
  | "git_commit"
  | "git_diff"
  | "git_operation"
  | "github_pr"
  // Command execution
  | "run_command"
  // Security & Data query operations
  | "query_data"
  // Communication
  | "send_message"
  // Memory operations
  | "generate_memory"
  // Planning operations
  | "generate_plan"
  | "execute_plan"
  | "validate_plan";

export interface ToolVisualizationEvent {
  id: string;
  semanticAction: SemanticAction;
  objectName?: string;
  data?: {
    // Complete toolUse data (the initial tool invocation)
    toolUse?: {
      name?: string;
      reason?: string;
      message?: string;
      result?: any;
      status?: string;
    };
    // Complete toolResult data (the result of tool execution)
    toolResult?: {
      name?: string;
      message?: string;
      error?: string;
      result?: any;
      status?: string;
    };
    // Extracted parameters from toolUse for convenience
    parameters?: any;
    // Extracted result from toolResult for convenience
    result?: any;
    // Additional metadata
    name?: string;
    reason?: string;
    message?: string;
    error?: string;
    success?: boolean;
    // Allow any additional properties for backwards compatibility and flexibility
    [key: string]: any;
  };
  status: "in_progress" | "completed";
}

export interface VisualizationComponentProps {
  event: ToolVisualizationEvent;
  onComplete?: () => void;
}

export interface WorkspaceArtifact {
  id: string;
  type: SemanticAction;
  component: React.ComponentType<VisualizationComponentProps>;
  event: ToolVisualizationEvent;
  timestamp: number;
}
