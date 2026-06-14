import { BaseTool } from "../baseTool";
import { GraphToolResult } from "./graph.types";

/**
 * Base class for tools that return graph visualizations
 * These tools return structured graph data that can be visualized directly
 * instead of relying on LLM to format the response
 */
export abstract class GraphBaseTool<TParams extends Record<string, unknown> = Record<string, unknown>> extends BaseTool<TParams> {
  protected isGraphTool: boolean = true;
  /**
   * Execute the graph tool and return a graph tool result
   */
  abstract execute(params: TParams): Promise<GraphToolResult>;
  
  /**
   * Helper to wrap graph execution with error handling
   */
  protected wrapGraphExecution(
    params: TParams,
    executor: () => Promise<GraphToolResult>
  ): Promise<GraphToolResult> {
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
          error: sanitized,
          graph: {
            nodes: [],
            edges: [],
          }
        });
      }
    });
  }
}
