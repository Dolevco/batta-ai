import { BaseTool } from '../baseTool';
import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { ToolResultPager, ODataQueryOptions } from './toolResultPager';

export const DataAccessToolName = 'data_access';

const DATA_ACCESS_CATEGORY: ToolCategory = {
  name: 'data',
  description: 'Data access and querying tools',
  keywords: ['data', 'query', 'filter', 'paginate']
};

type DataAccessParams = ODataQueryOptions & {
  dataId: string;
  [key: string]: unknown;
};

export class DataAccessTool extends BaseTool<DataAccessParams> {
  readonly name = DataAccessToolName;
  readonly category = DATA_ACCESS_CATEGORY;
  readonly isConcurrencySafe = true;
  readonly description = `Access and query paginated data using OData query syntax.

Use when you see _dataId in a preview response.

OData Query Options:
- $search: Free text search across all fields using regex (case-insensitive)
- $filter: Filter items. Supports: eq, ne, gt, ge, lt, le, and, or, not, contains(), startswith(), endswith()
- $select: Select specific fields (comma-separated)
- $orderby: Sort results (field asc/desc)
- $top: Number of items to retrieve (default: 100)
- $skip: Number of items to skip for pagination (default: 0)
- $all: Retrieve ALL data at once (WARNING: Use ONLY when you need the complete dataset. For large datasets, use pagination instead)

Examples:
1. Get next page: { "dataId": "data_xxx", "$skip": 100, "$top": 100 }
2. Search text: { "dataId": "data_xxx", "$search": "error" }
3. Filter by status: { "dataId": "data_xxx", "$filter": "status eq 'active'" }
4. Filter with comparison: { "dataId": "data_xxx", "$filter": "price gt 100" }
5. Filter with contains: { "dataId": "data_xxx", "$filter": "contains(name, 'test')" }
6. Select fields: { "dataId": "data_xxx", "$select": "id,name,email" }
7. Sort results: { "dataId": "data_xxx", "$orderby": "createdAt desc" }
8. Combined: { "dataId": "data_xxx", "$search": "error", "$filter": "severity eq 'high'", "$select": "id,message", "$orderby": "timestamp desc" }
9. Get all data: { "dataId": "data_xxx", "$all": true } (Use only when complete dataset is required)`;

  readonly parameters: ToolParameter[] = [
    {
      name: 'dataId',
      type: 'string',
      description: 'The dataId from the preview response',
      required: true
    },
    {
      name: '$search',
      type: 'string',
      description: 'Free text search across all fields using regex (case-insensitive). E.g., "error", "user.*admin"',
      required: false
    },
    {
      name: '$filter',
      type: 'string',
      description: "OData filter expression. E.g., \"status eq 'active'\", \"price gt 100\", \"contains(name, 'test')\"",
      required: false
    },
    {
      name: '$select',
      type: 'string',
      description: 'Comma-separated list of fields to select. E.g., "id,name,email"',
      required: false
    },
    {
      name: '$orderby',
      type: 'string',
      description: 'Sort expression. E.g., "name asc", "createdAt desc"',
      required: false
    },
    {
      name: '$skip',
      type: 'number',
      description: 'Number of items to skip for pagination (default: 0)',
      required: false
    },
    {
      name: '$top',
      type: 'number',
      description: 'Number of items to retrieve (default: 100)',
      required: false
    },
    {
      name: '$all',
      type: 'boolean',
      description: 'Retrieve ALL data at once. WARNING: Use ONLY when you need the complete dataset. For large datasets, prefer pagination.',
      required: false
    }
  ];

  constructor(private pager: ToolResultPager) {
    super();
  }

  async execute(params: DataAccessParams): Promise<ToolResult> {
    const { dataId, ...options } = params;
    const data = this.pager.getData(dataId, options);

    if (!data) {
      return {
        success: false,
        message: 'Data not found',
        error: 'Data not found or expired. The data may have been cleared from the session.'
      };
    }

    return { success: true, message: 'Data retrieved successfully', result: data };
  }
}
