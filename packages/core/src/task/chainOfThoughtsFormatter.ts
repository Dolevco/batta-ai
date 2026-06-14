/**
 * Utility for formatting chain of thoughts from task execution events
 */

export interface ChainThoughtEvent {
  id: string;
  timestamp: string;
  type: 'toolUse' | 'planStepStart' | 'planStepResult' | 'other';
  name?: string;
  intent?: string;
  reason?: string;
  message?: string;
  error?: string;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'failed';
  data?: any;
}

/**
 * Formats chain of thoughts events into a human-readable execution flow summary
 * @param chainOfThoughts Array of execution events
 * @returns Formatted string describing the execution flow
 */
export function formatChainOfThoughts(chainOfThoughts: ChainThoughtEvent[]): string {
  if (!chainOfThoughts || chainOfThoughts.length === 0) {
    return '';
  }

  let result = '';
  let currentStep: string | null = null;

  for (let i = 0; i < chainOfThoughts.length; i++) {
    const event = chainOfThoughts[i];
    const eventData = (event as any).data || {};

    // Track step start
    if (event.type === 'planStepStart') {
      currentStep = event.name || eventData.name || eventData.id || 'unnamed_step';
      result += `\n**Step: ${currentStep}**\n`;
    }
    // Track step completion
    else if (event.type === 'planStepResult') {
      const stepName = event.name || eventData.name || eventData.id || currentStep || 'unnamed_step';
      const success = event.error ? '✗' : '✓';
      const status = event.error ? ` (Failed: ${event.error})` : ' (Completed)';
      result += `Step "${stepName}" ${success}${status}\n`;
      currentStep = null;
    }
    // Track tool use with its result
    else if (event.type === 'toolUse') {
      const toolName = event.name || eventData.name || eventData.tool || 'unknown_tool';

      // Prefer explicit following toolResult event for success/message when available
      let resultInfo = '';
      for (let j = i + 1; j < Math.min(i + 6, chainOfThoughts.length); j++) {
        const nextEvent = chainOfThoughts[j] as any;
        if (nextEvent && nextEvent.type === 'toolResult') {
          const resultData = nextEvent.data || {};
          const success = resultData.success !== false; // default true
          const msg = resultData.message || resultData.error || nextEvent.message || '';
          resultInfo = ` → ${success ? '✓' : '✗'}${msg ? `: ${msg}` : ''}`;
          break;
        }
      }

      // Fallback to any inline info on the toolUse event itself
      if (!resultInfo) {
        if ((event as any).error) {
          resultInfo = ` → ✗: ${(event as any).error}`;
        } else if ((event as any).message) {
          resultInfo = ` → ✓: ${(event as any).message}`;
        } else if (eventData.success !== undefined) {
          const success = eventData.success;
          const msg = eventData.message || eventData.error || '';
          resultInfo = ` → ${success ? '✓' : '✗'}${msg ? `: ${msg}` : ''}`;
        }
      }

      result += `  - Tool: ${toolName}${resultInfo}\n`;
    }
  }

  return result;
}
