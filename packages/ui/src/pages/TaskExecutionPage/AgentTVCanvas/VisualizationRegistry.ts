import { ComponentType } from 'react';
import { SemanticAction, VisualizationComponentProps } from './types';
import ReadFileVisualization from './visualizations/ReadFileVisualization';
import WriteFileVisualization from './visualizations/WriteFileVisualization';
import ModifyFileVisualization from './visualizations/ModifyFileVisualization';
import RunCommandVisualization from './visualizations/RunCommandVisualization';
import GitCommitVisualization from './visualizations/GitCommitVisualization';
import GitHubPRVisualization from './visualizations/GitHubPRVisualization';
import DataQueryVisualization from './visualizations/DataQueryVisualization';
import PlanningVisualization from './visualizations/PlanningVisualization';
import MemoryVisualization from './visualizations/MemoryVisualization';
import ListFilesVisualization from './visualizations/ListFilesVisualization';
import SearchFilesVisualization from './visualizations/SearchFilesVisualization';
import SendMessageVisualization from './visualizations/SendMessageVisualization';

export class VisualizationRegistry {
  private registry: Map<SemanticAction, ComponentType<VisualizationComponentProps>>;

  constructor() {
    this.registry = new Map();
    this.registerDefaultVisualizations();
  }

  private registerDefaultVisualizations() {
    // File operations
    this.register('read_file', ReadFileVisualization);
    this.register('write_file', WriteFileVisualization);
    this.register('modify_file', ModifyFileVisualization);
    this.register('delete_file', ModifyFileVisualization); // Reuse modify visualization
    this.register('search_files', SearchFilesVisualization);
    this.register('list_files', ListFilesVisualization);

    // Command execution
    this.register('run_command', RunCommandVisualization);

    // Git operations
    this.register('git_commit', GitCommitVisualization);
    this.register('git_diff', ModifyFileVisualization); // Reuse diff viewer
    this.register('git_operation', GitCommitVisualization); // Generic git operations
    this.register('github_pr', GitHubPRVisualization); // GitHub pull request
    
    // Security & Data query operations (all security tools, search tools, task queries, etc.)
    this.register('query_data', DataQueryVisualization);
    
    // Communication
    this.register('send_message', SendMessageVisualization);
    
    // Memory operations
    this.register('generate_memory', MemoryVisualization);
    
    // Planning operations
    this.register('generate_plan', PlanningVisualization);
    this.register('execute_plan', PlanningVisualization); // Reuse planning visualization
    this.register('validate_plan', PlanningVisualization); // Reuse planning visualization
  }

  register(action: SemanticAction, component: ComponentType<VisualizationComponentProps>) {
    this.registry.set(action, component);
  }

  getComponent(action: SemanticAction): ComponentType<VisualizationComponentProps> | undefined {
    return this.registry.get(action);
  }

  hasVisualization(action: SemanticAction): boolean {
    return this.registry.has(action);
  }
}

export const defaultRegistry = new VisualizationRegistry();
