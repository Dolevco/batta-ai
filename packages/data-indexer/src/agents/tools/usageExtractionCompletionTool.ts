/**
 * UsageExtractionCompletionTool
 *
 * Completion tool for the UsageExtractor agent.
 * The LLM calls this tool to submit all extracted usage relationships for a
 * single service: HTTP consumer calls, queue bindings, internal symbol
 * references, and data access patterns.
 *
 * Validation enforced here:
 *   - Every APIConsumerCall must have at least one of baseUrlValue / baseUrlEnvVar.
 *   - Every QueueBinding must have a queueName.
 *   - SymbolReferences with usageKind="runtime" must have a lineRange.
 *   - No field may contain a raw secret value (containsSecrets() check).
 *   - String fields are length-capped; arrays are count-capped.
 *
 * Security:
 *   - containsSecrets() is applied to all free-text string fields.
 *   - No actual file content is stored — only file paths, line numbers, and
 *     structured metadata extracted from source code.
 *   - Classification: INTERNAL — contains code structure metadata only.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import { containsSecrets } from '../../utils/secret-sanitizer';

// ── Output types ──────────────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low' | 'unresolved';

export interface APIConsumerCall {
  /** Relative path to the file containing the call */
  file: string;
  /** 1-based line number */
  line: number;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** URL path segment after the base URL (e.g. "/users/:id") */
  urlPath: string;
  /** Resolved base URL string if deterministic (e.g. "http://payment-service:3000") */
  baseUrlValue?: string;
  /** Env var name that holds the base URL (e.g. "PAYMENT_SERVICE_URL") */
  baseUrlEnvVar?: string;
  /** TypeScript response type if typed */
  responseType?: string;
  confidence: Confidence;
}

export interface QueueBinding {
  /** Queue/topic name literal or "${ENV_VAR}" placeholder */
  queueName: string;
  /** "producer" | "consumer" */
  role: 'producer' | 'consumer';
  /** Queue technology (bullmq, sqs, servicebus, kafka) */
  technology: string;
  /** Relative path to file */
  file: string;
  line: number;
  /** TypeScript payload type if typed */
  payloadType?: string;
  confidence: Confidence;
}

export interface SymbolReference {
  /** Package name being imported from (e.g. "@ai-agent/core") */
  packageName: string;
  /** Exported symbol name (e.g. "BaseTool") */
  symbolName: string;
  /** Relative path to the importing file */
  file: string;
  line: number;
  /** "runtime" = actually called; "type-only" = only used as a type import */
  usageKind: 'runtime' | 'type-only';
  /** Line range of the call site — required for usageKind="runtime" */
  lineRange?: [number, number];
}

export interface DataAccessPattern {
  /** ORM / DB technology (prisma, typeorm, mongoose, raw-sql) */
  technology: string;
  /** Table or collection name */
  tableName: string;
  /** CRUD operation */
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'other';
  /** Relative path to file */
  file: string;
  line: number;
  confidence: Confidence;
}

export interface UsageExtractionCoverage {
  httpLibraryFound: boolean;
  queueLibraryFound: boolean;
  internalPackagesFound: string[];
  ormLibraryFound: boolean;
  unresolvedCount: number;
  /** null = full run; number = incremental files scanned */
  incrementalFilesScanned: number | null;
}

export interface UsageExtractionOutput {
  serviceId: string;
  apiConsumerCalls: APIConsumerCall[];
  queueBindings: QueueBinding[];
  symbolReferences: SymbolReference[];
  dataAccessPatterns: DataAccessPattern[];
  coverage: UsageExtractionCoverage;
}

export interface UsageExtractionInput extends Record<string, unknown> {
  output: UsageExtractionOutput;
  reasoning: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ITEMS = 200;
const MAX_STRING = 1000;
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VALID_CONFIDENCE: Confidence[] = ['high', 'medium', 'low', 'unresolved'];
const VALID_OPERATIONS: DataAccessPattern['operation'][] = ['select', 'insert', 'update', 'delete', 'upsert', 'other'];

// ── Tool ──────────────────────────────────────────────────────────────────────

export class UsageExtractionCompletionTool extends BaseTool<UsageExtractionInput> {
  name = 'complete_usage_extraction';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit all extracted usage relationships for the service. Call ONLY when all extraction ' +
    'steps are complete (HTTP calls, queue bindings, symbol references, data access patterns). ' +
    'SECURITY: Do NOT include actual secret values in any field.';

  parameters: ToolParameter[] = [
    {
      name: 'output',
      description:
        'UsageExtractionOutput object with:\n' +
        '  serviceId            — service identifier string\n' +
        '  apiConsumerCalls     — APIConsumerCall[]\n' +
        '  queueBindings        — QueueBinding[]\n' +
        '  symbolReferences     — SymbolReference[]\n' +
        '  dataAccessPatterns   — DataAccessPattern[]\n' +
        '  coverage             — UsageExtractionCoverage',
      required: true,
      type: 'object',
    },
    {
      name: 'reasoning',
      description: 'Brief summary of which extraction steps ran and what was found.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: UsageExtractionInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }

      const { output } = input;
      await this.notify(
        `✅ Usage extraction complete for ${output.serviceId}: ` +
        `${output.apiConsumerCalls.length} API calls, ` +
        `${output.queueBindings.length} queue bindings, ` +
        `${output.symbolReferences.length} symbol refs, ` +
        `${output.dataAccessPatterns.length} data access patterns`,
      );

      return {
        success: true,
        message: `Usage extraction complete for ${output.serviceId}.`,
        requiredOutput: { usageExtractionOutput: output, reasoning: input.reasoning },
      };
    });
  }

  private validate(input: UsageExtractionInput): string[] {
    const errors: string[] = [];

    if (!input.output || typeof input.output !== 'object') {
      return ['`output` must be an object.'];
    }

    const o = input.output;

    // serviceId
    if (!o.serviceId?.trim()) errors.push('`output.serviceId` is required.');

    // apiConsumerCalls
    if (!Array.isArray(o.apiConsumerCalls)) {
      errors.push('`output.apiConsumerCalls` must be an array.');
    } else {
      if (o.apiConsumerCalls.length > MAX_ITEMS) {
        errors.push(`\`output.apiConsumerCalls\` exceeds max ${MAX_ITEMS} items.`);
      }
      o.apiConsumerCalls.forEach((c, i) => {
        const p = `apiConsumerCalls[${i}]`;
        if (!c.file?.trim()) errors.push(`${p}.file is required.`);
        if (!c.baseUrlValue && !c.baseUrlEnvVar)
          errors.push(`${p}: at least one of baseUrlValue or baseUrlEnvVar is required.`);
        if (c.method && !VALID_METHODS.has(c.method.toUpperCase()))
          errors.push(`${p}.method "${c.method}" is not a valid HTTP method.`);
        if (!VALID_CONFIDENCE.includes(c.confidence))
          errors.push(`${p}.confidence "${c.confidence}" must be one of: ${VALID_CONFIDENCE.join(', ')}`);
        // Security: check for secrets in URL fields
        if (c.baseUrlValue && containsSecrets(c.baseUrlValue))
          errors.push(`${p}.baseUrlValue appears to contain a secret value.`);
        if (c.urlPath && c.urlPath.length > MAX_STRING)
          errors.push(`${p}.urlPath is too long (max ${MAX_STRING} chars).`);
      });
    }

    // queueBindings
    if (!Array.isArray(o.queueBindings)) {
      errors.push('`output.queueBindings` must be an array.');
    } else {
      if (o.queueBindings.length > MAX_ITEMS) {
        errors.push(`\`output.queueBindings\` exceeds max ${MAX_ITEMS} items.`);
      }
      o.queueBindings.forEach((q, i) => {
        const p = `queueBindings[${i}]`;
        if (!q.queueName?.trim()) errors.push(`${p}.queueName is required.`);
        if (q.role !== 'producer' && q.role !== 'consumer')
          errors.push(`${p}.role must be "producer" or "consumer".`);
        if (!q.technology?.trim()) errors.push(`${p}.technology is required.`);
        if (!VALID_CONFIDENCE.includes(q.confidence))
          errors.push(`${p}.confidence "${q.confidence}" must be one of: ${VALID_CONFIDENCE.join(', ')}`);
        if (q.queueName && containsSecrets(q.queueName))
          errors.push(`${p}.queueName appears to contain a secret value.`);
      });
    }

    // symbolReferences
    if (!Array.isArray(o.symbolReferences)) {
      errors.push('`output.symbolReferences` must be an array.');
    } else {
      if (o.symbolReferences.length > MAX_ITEMS) {
        errors.push(`\`output.symbolReferences\` exceeds max ${MAX_ITEMS} items.`);
      }
      o.symbolReferences.forEach((s, i) => {
        const p = `symbolReferences[${i}]`;
        if (!s.packageName?.trim()) errors.push(`${p}.packageName is required.`);
        if (!s.symbolName?.trim()) errors.push(`${p}.symbolName is required.`);
        if (s.usageKind !== 'runtime' && s.usageKind !== 'type-only')
          errors.push(`${p}.usageKind must be "runtime" or "type-only".`);
        if (s.usageKind === 'runtime' && !s.lineRange)
          errors.push(`${p}: lineRange is required for usageKind="runtime".`);
      });
    }

    // dataAccessPatterns
    if (!Array.isArray(o.dataAccessPatterns)) {
      errors.push('`output.dataAccessPatterns` must be an array.');
    } else {
      if (o.dataAccessPatterns.length > MAX_ITEMS) {
        errors.push(`\`output.dataAccessPatterns\` exceeds max ${MAX_ITEMS} items.`);
      }
      o.dataAccessPatterns.forEach((d, i) => {
        const p = `dataAccessPatterns[${i}]`;
        if (!d.tableName?.trim()) errors.push(`${p}.tableName is required.`);
        if (!VALID_OPERATIONS.includes(d.operation))
          errors.push(`${p}.operation "${d.operation}" must be one of: ${VALID_OPERATIONS.join(', ')}`);
        if (!VALID_CONFIDENCE.includes(d.confidence))
          errors.push(`${p}.confidence "${d.confidence}" must be one of: ${VALID_CONFIDENCE.join(', ')}`);
      });
    }

    // coverage
    if (!o.coverage || typeof o.coverage !== 'object') {
      errors.push('`output.coverage` must be an object.');
    } else {
      if (typeof o.coverage.httpLibraryFound !== 'boolean')
        errors.push('`output.coverage.httpLibraryFound` must be a boolean.');
      if (typeof o.coverage.queueLibraryFound !== 'boolean')
        errors.push('`output.coverage.queueLibraryFound` must be a boolean.');
      if (!Array.isArray(o.coverage.internalPackagesFound))
        errors.push('`output.coverage.internalPackagesFound` must be an array.');
      if (typeof o.coverage.unresolvedCount !== 'number')
        errors.push('`output.coverage.unresolvedCount` must be a number.');
    }

    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    return errors;
  }
}
