import { BaseTool } from '../baseTool';
import { TableToolResult, TableProjection } from './graph.types';

const EMPTY_TABLE: TableProjection = {
  entityType: 'service',
  title: '',
  columns: [],
  rows: [],
};

/**
 * Base class for tools that return table visualizations.
 * The table payload is built server-side from structured tool results — the LLM
 * only receives a boolean flag indicating whether a table is available.
 */
export abstract class TableBaseTool<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> extends BaseTool<TParams> {
  protected isTableTool: boolean = true;

  abstract execute(params: TParams): Promise<TableToolResult>;

  /** Convenience factory for an empty-table error result */
  protected tableError(message: string, error = 'Internal error'): TableToolResult {
    return {
      success: false,
      message,
      error,
      table: { ...EMPTY_TABLE },
    };
  }
}
