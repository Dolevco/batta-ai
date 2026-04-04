import EventEmitter from "events";
import { Tool, ToolCategory, ToolConfig, ToolParameter, ToolResult } from "./types";
import * as path from 'path';

export abstract class BaseTool<TParams extends Record<string, unknown> = Record<string, unknown>> extends EventEmitter implements Tool {
  abstract readonly name: string;
  abstract readonly category: ToolCategory;
  abstract readonly description: string;
  abstract readonly parameters: ToolParameter[];
  protected workspacePath: string;
  protected isGraphTool: boolean = false;
  public isConcurrencySafe: boolean = false;
  public isInteractionTool: boolean;
  public notificationCallback?: (message: string) => Promise<void>;

  constructor(config?: ToolConfig) {
    super();
    this.isInteractionTool = !!config?.isInteractionTool;
    this.workspacePath = config?.workspacePath || process.cwd();
    this.notificationCallback = config?.notificationCallback;
  }

  protected async notify(message: string): Promise<void> {
    if (this.notificationCallback) {
      await this.notificationCallback(message);
    }
    this.emitNotify(message);
  }

  protected emitNotify(message: string): void {
    this.emit('notify', message);
  }

  protected resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.workspacePath, filePath);
  }

  protected validateParameters(params: Record<string, unknown>): void {
    for (const param of this.parameters) {
      if (param.required && !params.hasOwnProperty(param.name)) {
        throw new Error(`Tool uses MUST follow this EXACT JSON format:
{
  "tool": "tool_name_here",
  "reason": "why we call this tool",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
Missing required parameter: ${param.name}
description: ${param.description}`);
      }
      
      if (params.hasOwnProperty(param.name)) {
        const value = params[param.name];
        if (value !== undefined && param.type.toString() !== 'any' && (typeof value !== param.type && !(param.type.toString() === 'array' && Array.isArray(value)))) {
          throw new Error(
            `Invalid type for parameter ${param.name}. Expected ${param.type}, got ${typeof value}`
          );
        }
      }
    }
  }

  abstract execute(params: TParams): Promise<ToolResult>;

  protected sanitizeWorkspacePathFromMessage(message: string): string {
    if (!message) return message;
    const wp = this.workspacePath || '';
    if (wp.length < 5) return message;
    // escape workspace path for use in RegExp
    const escaped = wp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // replace all occurrences with a placeholder
    return message.replace(new RegExp(escaped, 'g'), '');
  }

  protected wrapExecution(
    params: TParams,
    executor: () => Promise<ToolResult>
  ): Promise<ToolResult> {
    return new Promise(async (resolve) => {
      try {
        this.validateParameters(params);
        const result = await executor();
        resolve(result);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        const sanitized = this.sanitizeWorkspacePathFromMessage(rawMessage);
        resolve({
          success: false,
          message: `Execution failed: ${sanitized}`,
          error: sanitized
        });
      }
    });
  }
}
