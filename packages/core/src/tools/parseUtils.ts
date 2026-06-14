import { jsonrepair } from "jsonrepair";
import { ParseToolUseResult } from "../task/types";
import { ParsedAssistantTurn, ToolUse } from "./types";

/**
 * Utilities for parsing tool use JSON from LLM assistant messages.
 * Extended to support parsing multiple tool uses from a single assistant turn.
 */
export class ToolParseUtils {
    static ToolFormatMessage = `Tool uses MUST follow this EXACT JSON format:
{
  "tool": "tool_name_here",
  "reason": "why we call this tool",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}`;

    /**
     * Legacy single-tool parse. Kept for backwards compatibility.
     * Prefer parseAssistantTurn for new code.
     */
    public static tryParseToolUse(message: string): ParseToolUseResult {
        try {
        const parsed = this.isCompleteToolUse(message);

        if (!parsed) {
            return { success: false, error: `invalid JSON.\n${this.ToolFormatMessage}` };
        }

        if (!parsed.tool) {
            return { success: false, error: `tool is missing.\n${this.ToolFormatMessage}` };
        }

        if (parsed.parameters === undefined || parsed.parameters === null) {
            return { success: false, error: `parameters is missing.\n${this.ToolFormatMessage}` };
        }

        if (!parsed.reason) {
            return { success: false, error: `reason is missing.\n${this.ToolFormatMessage}` };
        }

        return {
            success: true,
            toolUse: {
            name: parsed.tool,
            reason: parsed.reason,
            parameters: parsed.parameters
            }
        };
        } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `parse error: ${message}` };
        }
    }

    /**
     * Parse an assistant message into a structured turn with one or more tool uses.
     *
     * The model is instructed to respond with ONLY valid JSON:
     *  - A single tool call: a JSON object `{ "tool": ..., "reason": ..., "parameters": ... }`
     *  - Parallel tool calls: a JSON array `[{ "tool": ... }, { "tool": ... }, ...]`
     *
     * Parallel execution is opt-in and safe-by-default:
     *  - If the message contains exactly ONE tool call, it is always returned as-is.
     *  - If the message contains MULTIPLE tool calls (via array or adjacent objects),
     *    they are only ALL returned when every one of them is declared concurrency-safe
     *    (i.e. their name appears in `concurrencySafeToolNames`). This prevents a
     *    completion/write tool from being silently bundled with read tools.
     *  - If ANY tool in a multi-call batch is NOT concurrency-safe, only the FIRST
     *    tool call is returned and a warning is logged.
     *
     * Garbage-byte sanitization: stray multi-byte noise (CJK, Thai, etc.) between
     * JSON blocks is stripped before parsing.
     *
     * Security note: All extracted tool names and parameters are validated
     * against the tool registry before execution in Task.executeTools().
     *
     * @param message              Raw assistant message content.
     * @param concurrencySafeToolNames  Set of tool names that declared isConcurrencySafe=true.
     *                             Defaults to empty set (all multi-calls rejected).
     */
    public static parseAssistantTurn(
        message: string,
        concurrencySafeToolNames: ReadonlySet<string> = new Set()
    ): ParsedAssistantTurn {
        // Sanitize: strip C0/C1 control characters that are never valid outside a
        // JSON string but sometimes appear as junk between tool call JSON blocks.
        const sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Primary path: try to parse the entire response as a JSON array (parallel calls)
        // or a single JSON object (single call).
        const topLevel = this.tryParseTopLevel(sanitized);
        let rawBlocks: any[] = [];

        if (Array.isArray(topLevel)) {
            // Model responded with a JSON array — extract each element as a potential tool call
            rawBlocks = topLevel;
        } else if (topLevel && typeof topLevel === 'object') {
            // Model responded with a single JSON object
            rawBlocks = [topLevel];
        } else {
            // Fallback: extract all JSON objects scattered in the text (legacy behaviour)
            rawBlocks = this.extractAllJsonBlocks(sanitized);
        }

        // Validate and normalise each block into a ToolUse
        const toolUses: ToolUse[] = [];
        for (const block of rawBlocks) {
            if (block && block.tool && block.parameters !== undefined && block.reason) {
                const toolName = String(block.tool).trim();
                const params = typeof block.parameters === 'object' && block.parameters !== null
                    ? block.parameters
                    : {};
                if (toolName.length > 0 && toolName.length < 128) {
                    toolUses.push({
                        name: toolName,
                        reason: String(block.reason ?? '').substring(0, 1024),
                        parameters: params as Record<string, unknown>
                    });
                }
            }
        }

        if (toolUses.length === 0) {
            // Fallback: try legacy single-tool parse on sanitized message
            const single = this.tryParseToolUse(sanitized);
            if (single.success) {
                return { toolUses: [single.toolUse] };
            }
            return { text: message, toolUses: [] };
        }

        if (toolUses.length === 1) {
            return { toolUses };
        }

        // Multiple tool calls: run safe ones in parallel, mark unsafe ones for rejection
        const unsafeTools = toolUses.filter(tu => !concurrencySafeToolNames.has(tu.name));
        if (unsafeTools.length > 0) {
            const unsafeNames = unsafeTools.map(tu => tu.name).join(', ');
            const allNames = toolUses.map(tu => tu.name).join(', ');
            console.warn(
                `[ToolParseUtils] LLM emitted ${toolUses.length} tool calls in one turn [${allNames}] ` +
                `but ${unsafeNames} is not concurrency-safe. ` +
                `Safe tools will run in parallel; unsafe tools will be rejected with an error. ` +
                `Only tools marked "✓ Concurrency-safe" may be batched.`
            );
        }

        // Return all tool uses — executeTools() will run safe ones in parallel
        // and return synthetic failure results for unsafe ones.
        return { toolUses, concurrencySafeToolNames };
    }

    /**
     * Attempt to parse the entire sanitized message as a top-level JSON value
     * (object or array). Strips optional markdown code fences first.
     * Returns the parsed value, or null if parsing fails.
     */
    private static tryParseTopLevel(message: string): any {
        // Strip markdown code fences (```json ... ``` or ``` ... ```)
        const stripped = message.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

        // Try the stripped version first, then the original trimmed message
        for (const candidate of [stripped, message.trim()]) {
            if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
            try {
                return JSON.parse(candidate);
            } catch {
                try {
                    return JSON.parse(jsonrepair(candidate));
                } catch {
                    // continue
                }
            }
        }
        return null;
    }

    /**
     * Extract all JSON objects from a message string (fallback for legacy/mixed responses).
     * Handles multiple JSON blocks separated by text.
     */
    private static extractAllJsonBlocks(message: string): any[] {
        const results: any[] = [];
        let remaining = message;

        while (remaining.length > 0) {
            const start = remaining.indexOf('{');
            if (start === -1) break;

            // Try to find matching closing brace
            let depth = 0;
            let end = -1;
            for (let i = start; i < remaining.length; i++) {
                if (remaining[i] === '{') depth++;
                else if (remaining[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }

            if (end === -1) break;

            const candidate = remaining.slice(start, end + 1);
            try {
                const parsed = JSON.parse(candidate);
                results.push(parsed);
            } catch {
                // Try repair
                try {
                    const repaired = jsonrepair(candidate);
                    const parsed = JSON.parse(repaired);
                    results.push(parsed);
                } catch {
                    // Skip unparseable block
                }
            }

            remaining = remaining.slice(end + 1);
        }

        return results;
    }

    private static isCompleteToolUse(message: string): any {
        // Extract potential JSON content
        let jsonContent;
        const match = message.match(/\{[\s\S]*\}/);
        if (match) {
        try {
            jsonContent = JSON.parse(match[0]);  
        } catch  {
        }
        }
        if (!jsonContent) {
        // If it's a complete message but no JSON found, it might be an error or incomplete tool use
        jsonContent = this.tryRepairToolJson(message);
        }

        return jsonContent;
    }

    private static tryRepairToolJson(message: string): object | undefined {
        if (message && message.startsWith(`{"tool":`)) {
        try {
            const fixedJson = jsonrepair(message);
            return JSON.parse(fixedJson);
        } catch (err) {
            console.error("Failed to repair/parse JSON:", err);
        }
        }

        return undefined;
    }
}

