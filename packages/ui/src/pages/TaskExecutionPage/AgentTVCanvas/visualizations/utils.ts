/**
 * Utility functions for extracting data from merged tool event structures
 */

export interface MergedToolData {
  toolUse?: {
    name?: string;
    reason?: string;
    message?: string;
    result?: any;
    status?: string;
  };
  message?: string;
  reason?: string;
  name?: string;
  parameters?: any;
  result?: any;
}

/**
 * Extract the tool name from the merged event data
 */
export function getToolName(data?: MergedToolData): string {
  return data?.toolUse?.name || data?.name || '';
}

/**
 * Extract the reason from the merged event data
 */
export function getReason(data?: MergedToolData): string {
  return data?.toolUse?.reason || data?.reason || '';
}

/**
 * Extract the message from the merged event data
 */
export function getMessage(data?: MergedToolData): string {
  return data?.toolUse?.message || data?.message || '';
}

/**
 * Extract the result from the merged event data
 */
export function getResult(data?: MergedToolData): any {
  return data?.toolUse?.result || data?.result;
}

/**
 * Extract the status from the merged event data
 */
export function getStatus(data?: MergedToolData): string {
  return data?.toolUse?.status || 'unknown';
}

/**
 * Extract parameters from the merged event data
 */
export function getParameters(data?: MergedToolData): any {
  return data?.parameters || {};
}

/**
 * Check if the tool execution was successful
 */
export function isSuccess(data?: MergedToolData): boolean {
  const status = getStatus(data);
  return status === 'success';
}
