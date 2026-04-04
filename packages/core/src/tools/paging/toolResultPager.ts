const PAYLOAD_THRESHOLD = 30000;

/**
 * Preview size in bytes for text-type paged results.
 */
const TEXT_PREVIEW_SIZE = 2000;

export interface StoredData {
  id: string;
  content: any;
  type: 'json-array' | 'json-object' | 'text';
  totalItems?: number;
}

/**
 * OData-style query options for data access
 */
export interface ODataQueryOptions {
  /** Number of items to skip (pagination) */
  $skip?: number;
  /** Number of items to return */
  $top?: number;
  /** OData filter expression. E.g., "status eq 'active'", "price gt 100", "contains(name, 'test')" */
  $filter?: string;
  /** Comma-separated list of fields to select. E.g., "id,name,email" */
  $select?: string;
  /** Sort expression. E.g., "name asc", "createdAt desc" */
  $orderby?: string;
  /** Free text search across all fields using regex */
  $search?: string;
  /** Retrieve all data at once (WARNING: Use only when complete dataset is needed) */
  $all?: boolean;
}

/** @deprecated Use ODataQueryOptions instead */
export type QueryOptions = ODataQueryOptions;

export class ToolResultPager {
  private dataStore: Map<string, StoredData> = new Map();

  /**
   * Process result with a per-tool budget override.
   * If result exceeds maxChars, paging is applied.
   */
  processResultWithBudget(result: string, maxChars: number): { needsPaging: boolean; output: string; dataId?: string } {
    // Empty-result normalisation — prevent premature turn termination
    if (!result || result.trim() === '') {
      return { needsPaging: false, output: '(tool completed with no output)' };
    }

    if (result.length <= maxChars) {
      return { needsPaging: false, output: result };
    }
    // Reuse standard paging logic but with the tool-specific threshold
    return this.pageResult(result);
  }

  /**
   * Process result with the global payload threshold.
   */
  processResult(result: string): { needsPaging: boolean; output: string; dataId?: string } {
    // Empty-result normalisation — prevent premature turn termination
    if (!result || result.trim() === '') {
      return { needsPaging: false, output: '(tool completed with no output)' };
    }

    if (result.length <= PAYLOAD_THRESHOLD) {
      return { needsPaging: false, output: result };
    }

    return this.pageResult(result);
  }

  /**
   * Shared paging implementation used by both processResult and processResultWithBudget.
   * Parses the payload, stores it, and returns a typed preview.
   */
  private pageResult(result: string): { needsPaging: boolean; output: string; dataId?: string } {
    const dataId = this.generateId();
    const parsed = this.tryParseJson(result);
    if (parsed.success && Array.isArray(parsed.data)) {
      this.dataStore.set(dataId, { id: dataId, content: parsed.data, type: 'json-array', totalItems: parsed.data.length });
      return { needsPaging: true, output: this.createArrayPreview(parsed.data, dataId), dataId };
    } else if (parsed.success && typeof parsed.data === 'object') {
      this.dataStore.set(dataId, { id: dataId, content: parsed.data, type: 'json-object' });
      return { needsPaging: true, output: this.createObjectPreview(parsed.data, dataId), dataId };
    } else {
      this.dataStore.set(dataId, { id: dataId, content: result, type: 'text' });
      return { needsPaging: true, output: this.createTextPreview(result, dataId), dataId };
    }
  }

  getData(dataId: string, options: ODataQueryOptions = {}): string | null {
    const stored = this.dataStore.get(dataId);
    if (!stored) return null;

    if (stored.type === 'json-array') {
      return this.queryArray(stored.content, options);
    }

    if (stored.type === 'json-object') {
      return this.queryObject(stored.content, options);
    }

    // Text - just paginate
    const skip = options.$skip ?? 0;
    const top = options.$top ?? 2000;
    const slice = stored.content.slice(skip, skip + top);
    return JSON.stringify({
      content: slice,
      showing: `chars ${skip + 1}-${skip + slice.length} of ${stored.content.length}`,
      hasMore: skip + top < stored.content.length
    }, null, 2);
  }

  private queryArray(data: any[], options: ODataQueryOptions): string {
    let result = data;

    // Apply $search (free text search)
    if (options.$search) {
      result = this.applySearch(result, options.$search);
    }

    // Apply $filter
    if (options.$filter) {
      result = this.applyODataFilter(result, options.$filter);
    }

    // Apply $orderby
    if (options.$orderby) {
      result = this.applyOrderBy(result, options.$orderby);
    }

    // Apply $select (projection)
    if (options.$select) {
      result = this.applyODataSelect(result, options.$select);
    }

    // If $all is true, return all data without pagination
    if (options.$all) {
      return JSON.stringify({
        items: result,
        query: { $search: options.$search, $filter: options.$filter, $select: options.$select, $orderby: options.$orderby, $all: true },
        showing: `All ${result.length} items${result.length !== data.length ? ` (filtered from ${data.length})` : ''}`,
        hasMore: false
      }, null, 2);
    }

    // Apply pagination ($skip and $top)
    const skip = options.$skip ?? 0;
    const top = options.$top ?? 100;
    const paged = result.slice(skip, skip + top);

    return JSON.stringify({
      items: paged,
      query: { $search: options.$search, $filter: options.$filter, $select: options.$select, $orderby: options.$orderby },
      showing: `${skip + 1}-${Math.min(skip + top, result.length)} of ${result.length}${result.length !== data.length ? ` (filtered from ${data.length})` : ''}`,
      hasMore: skip + top < result.length
    }, null, 2);
  }

  private queryObject(data: object, options: ODataQueryOptions): string {
    let keys = Object.keys(data);

    // Filter keys if $filter provided (for objects, filter on key/value)
    if (options.$filter) {
      keys = keys.filter(key => {
        try {
          const value = (data as any)[key];
          return this.evaluateODataFilterForKeyValue(options.$filter!, key, value);
        } catch {
          return true;
        }
      });
    }

    // Select specific keys using $select
    if (options.$select) {
      const selectKeys = options.$select.split(',').map((k: string) => k.trim());
      keys = keys.filter(k => selectKeys.includes(k));
    }

    const skip = options.$skip ?? 0;
    const top = options.$top ?? 20;
    const pagedKeys = keys.slice(skip, skip + top);
    const result = pagedKeys.reduce((acc, key) => ({ ...acc, [key]: (data as any)[key] }), {});

    return JSON.stringify({
      data: result,
      showing: `${pagedKeys.length} of ${keys.length} keys`,
      hasMore: skip + top < keys.length
    }, null, 2);
  }

  /**
   * Apply free text search across all fields using regex
   */
  private applySearch(data: any[], searchTerm: string): any[] {
    try {
      const regex = new RegExp(searchTerm, 'i');
      return data.filter(item => this.matchesSearch(item, regex));
    } catch (e) {
      console.error('Search regex error:', e);
      return data;
    }
  }

  /**
   * Check if item matches search regex in any field
   */
  private matchesSearch(item: any, regex: RegExp): boolean {
    if (item === null || item === undefined) return false;
    
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      return regex.test(String(item));
    }
    
    if (typeof item === 'object') {
      return Object.values(item).some(value => this.matchesSearch(value, regex));
    }
    
    return false;
  }

  /**
   * Parse and apply OData $filter expression
   * Supports: eq, ne, gt, ge, lt, le, and, or, not, contains(), startswith(), endswith()
   */
  private applyODataFilter(data: any[], filterExpr: string): any[] {
    try {
      return data.filter(item => this.evaluateODataFilter(filterExpr, item));
    } catch (e) {
      console.error('OData filter error:', e);
      return data;
    }
  }

  /**
   * Evaluate an OData filter expression against an item
   */
  private evaluateODataFilter(expr: string, item: any): boolean {
    // Handle logical operators (and, or)
    if (/ and /i.test(expr)) {
      const parts = expr.split(/ and /i);
      return parts.every(part => this.evaluateODataFilter(part.trim(), item));
    }
    if (/ or /i.test(expr)) {
      const parts = expr.split(/ or /i);
      return parts.some(part => this.evaluateODataFilter(part.trim(), item));
    }

    // Handle not
    if (/^not /i.test(expr)) {
      return !this.evaluateODataFilter(expr.replace(/^not /i, '').trim(), item);
    }

    // Handle functions: contains(), startswith(), endswith()
    const containsMatch = expr.match(/^contains\((\w+),\s*'([^']+)'\)$/i);
    if (containsMatch) {
      const [, field, value] = containsMatch;
      const fieldValue = this.getNestedValue(item, field);
      return typeof fieldValue === 'string' && fieldValue.toLowerCase().includes(value.toLowerCase());
    }

    const startsWithMatch = expr.match(/^startswith\((\w+),\s*'([^']+)'\)$/i);
    if (startsWithMatch) {
      const [, field, value] = startsWithMatch;
      const fieldValue = this.getNestedValue(item, field);
      return typeof fieldValue === 'string' && fieldValue.toLowerCase().startsWith(value.toLowerCase());
    }

    const endsWithMatch = expr.match(/^endswith\((\w+),\s*'([^']+)'\)$/i);
    if (endsWithMatch) {
      const [, field, value] = endsWithMatch;
      const fieldValue = this.getNestedValue(item, field);
      return typeof fieldValue === 'string' && fieldValue.toLowerCase().endsWith(value.toLowerCase());
    }

    // Handle comparison operators: eq, ne, gt, ge, lt, le
    const comparisonMatch = expr.match(/^(\w+(?:\.\w+)*)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
    if (comparisonMatch) {
      const [, field, operator, rawValue] = comparisonMatch;
      const fieldValue = this.getNestedValue(item, field);
      const compareValue = this.parseODataValue(rawValue.trim());
      
      switch (operator.toLowerCase()) {
        case 'eq': return fieldValue === compareValue;
        case 'ne': return fieldValue !== compareValue;
        case 'gt': return fieldValue > compareValue;
        case 'ge': return fieldValue >= compareValue;
        case 'lt': return fieldValue < compareValue;
        case 'le': return fieldValue <= compareValue;
      }
    }

    // If we can't parse, return true (don't filter out)
    console.warn('Could not parse OData filter:', expr);
    return true;
  }

  /**
   * Evaluate filter for object key/value pairs
   */
  private evaluateODataFilterForKeyValue(expr: string, key: string, value: any): boolean {
    // For objects, support filtering by key name or value properties
    const containsMatch = expr.match(/^contains\(key,\s*'([^']+)'\)$/i);
    if (containsMatch) {
      return key.toLowerCase().includes(containsMatch[1].toLowerCase());
    }

    const keyEqMatch = expr.match(/^key\s+eq\s+'([^']+)'$/i);
    if (keyEqMatch) {
      return key === keyEqMatch[1];
    }

    // Default: try to evaluate as if 'value' is the item
    return this.evaluateODataFilter(expr, value);
  }

  /**
   * Get nested value from an object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Parse OData value (string, number, boolean, null)
   */
  private parseODataValue(value: string): any {
    // String (single quotes)
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1);
    }
    // Boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    // Null
    if (value.toLowerCase() === 'null') return null;
    // Number
    const num = Number(value);
    if (!isNaN(num)) return num;
    // Default to string
    return value;
  }

  /**
   * Apply $orderby to sort results
   */
  private applyOrderBy(data: any[], orderbyExpr: string): any[] {
    const parts = orderbyExpr.split(',').map(p => p.trim());
    
    return [...data].sort((a, b) => {
      for (const part of parts) {
        const [field, direction = 'asc'] = part.split(/\s+/);
        const aVal = this.getNestedValue(a, field);
        const bVal = this.getNestedValue(b, field);
        
        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        else if (aVal > bVal) comparison = 1;
        
        if (comparison !== 0) {
          return direction.toLowerCase() === 'desc' ? -comparison : comparison;
        }
      }
      return 0;
    });
  }

  /**
   * Apply $select to project specific fields
   */
  private applyODataSelect(data: any[], selectExpr: string): any[] {
    const fields = selectExpr.split(',').map((f: string) => f.trim());
    
    return data.map(item => {
      const projected: Record<string, any> = {};
      for (const field of fields) {
        projected[field] = this.getNestedValue(item, field);
      }
      return projected;
    });
  }

  private createArrayPreview(data: any[], dataId: string): string {
    const preview = data.slice(0, 2).map(item => this.createItemPreview(item));
    const keys = data.length > 0 && typeof data[0] === 'object' ? Object.keys(data[0]) : [];
    return JSON.stringify({
      _preview: true,
      _dataId: dataId,
      _totalItems: data.length,
      _availableFields: keys.slice(0, 15),
      _hint: "Use 'data_access' tool with OData query. Examples: $search: \"term\", $filter: \"status eq 'active'\", $select: \"id,name\", $orderby: \"name asc\"",
      items: preview
    }, null, 2);
  }

  private createObjectPreview(data: object, dataId: string): string {
    // Analyze each key to find where the bulk of data is
    const keyAnalysis = this.analyzeObjectKeys(data);
    
    // Build a smart preview: include small keys fully, summarize large ones
    const preview: Record<string, any> = {};
    
    for (const analysis of keyAnalysis) {
      if (analysis.size < 500) {
        // Small value - include fully
        preview[analysis.key] = (data as any)[analysis.key];
      } else if (analysis.isArray) {
        // Large array - show count and sample
        const arr = (data as any)[analysis.key] as any[];
        preview[analysis.key] = {
          _arrayLength: arr.length,
          _sample: arr.slice(0, 2).map(item => this.createItemPreview(item)),
          _hint: `Use data_access with $select: "${analysis.key}" and $search: "term" to filter / fetch matching array items`
        };
      } else if (analysis.isObject) {
        // Large object - show keys
        const obj = (data as any)[analysis.key];
        const objKeys = Object.keys(obj);
        preview[analysis.key] = {
          _objectKeys: objKeys.slice(0, 10),
          _totalKeys: objKeys.length,
          _hint: `Use data_access with $select: "${analysis.key}" and $search: "term" to fetch or search within this nested object`
        };
      } else {
        // Large primitive (long string) - truncate
        const val = (data as any)[analysis.key];
        preview[analysis.key] = typeof val === 'string' 
          ? val.slice(0, 200) + `... [${val.length} chars total]`
          : val;
      }
    }

    return JSON.stringify({
      _preview: true,
      _dataId: dataId,
      _structure: keyAnalysis.map(k => ({ 
        key: k.key, 
        type: k.isArray ? `array[${k.arrayLength}]` : k.isObject ? 'object' : typeof (data as any)[k.key],
        size: k.size 
      })),
      _hint: "Use 'data_access' tool with $select: 'key1,key2' and $search: 'term' to target specific keys or perform free-text filtering",
      data: preview
    }, null, 2);
  }

  /**
   * Analyze object keys to understand where bulk of payload is
   */
  private analyzeObjectKeys(data: object): Array<{
    key: string;
    size: number;
    isArray: boolean;
    isObject: boolean;
    arrayLength?: number;
  }> {
    const analysis = Object.keys(data).map(key => {
      const value = (data as any)[key];
      const serialized = JSON.stringify(value);
      return {
        key,
        size: serialized.length,
        isArray: Array.isArray(value),
        isObject: typeof value === 'object' && value !== null && !Array.isArray(value),
        arrayLength: Array.isArray(value) ? value.length : undefined
      };
    });

    // Sort by size descending to show what's taking up space
    return analysis.sort((a, b) => b.size - a.size);
  }

  /**
   * Create a compact preview of an item (for array items)
   */
  private createItemPreview(item: any, maxSize: number = 500): any {
    if (typeof item !== 'object' || item === null) {
      return item;
    }

    const serialized = JSON.stringify(item);
    if (serialized.length <= maxSize) {
      return item;
    }

    // Item is too large - create a compact version
    const preview: Record<string, any> = {};
    const keys = Object.keys(item);
    
    for (const key of keys) {
      const value = item[key];
      const valueSize = JSON.stringify(value).length;
      
      if (valueSize < 100) {
        preview[key] = value;
      } else if (Array.isArray(value)) {
        preview[key] = `[Array: ${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        preview[key] = `{Object: ${Object.keys(value).length} keys}`;
      } else if (typeof value === 'string') {
        preview[key] = value.slice(0, 50) + '...';
      } else {
        preview[key] = value;
      }
    }
    
    return preview;
  }

  private createTextPreview(text: string, dataId: string): string {
    /**
     * Newline-aware truncation — avoid cutting mid-line.
     * Find the last newline within TEXT_PREVIEW_SIZE; if it is past the 50% mark
     * of the preview window use it as the cut point, otherwise fall back to the
     */
    const raw = text.slice(0, TEXT_PREVIEW_SIZE);
    const lastNewline = raw.lastIndexOf('\n');
    const cutPoint = lastNewline > TEXT_PREVIEW_SIZE * 0.5 ? lastNewline : TEXT_PREVIEW_SIZE;
    const preview = text.slice(0, cutPoint);
    const hasMore = text.length > cutPoint;

    return JSON.stringify({
      _preview: true,
      _dataId: dataId,
      _totalLength: text.length,
      _hint: "Use 'data_access' tool with $skip/$top to paginate, or $search to filter",
      _hasMore: hasMore,
      content: preview
    }, null, 2);
  }

  private tryParseJson(str: string): { success: boolean; data?: any } {
    try {
      return { success: true, data: JSON.parse(str) };
    } catch {
      return { success: false };
    }
  }

  /**
   * Generate a stable-enough ID for a paged result.
   * Uses crypto.randomUUID when available (Node 14.17+) for better uniqueness,
   * falling back to the Math.random approach.
   * Unlike the previous Date.now()-based ID, this avoids collisions when two
   * results are paged within the same millisecond (e.g. parallel tool execution).
   * as the filename — inherently idempotent. We don't have toolUseId here, so we
   * generate a random ID instead.
   */
  private generateId(): string {
    const rand = typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function'
      ? (crypto as any).randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return `data_${rand}`;
  }

  clear(dataId?: string): void {
    if (dataId) {
      this.dataStore.delete(dataId);
    } else {
      this.dataStore.clear();
    }
  }
}
