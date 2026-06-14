/**
 * ServiceFileMapCompletionTool
 *
 * Completion tool for the ServiceFileMapper agent (Pass 0).
 * The LLM calls this tool to submit a classified file map for a code service —
 * grouping every source file into semantic buckets (entry, routes, models,
 * types, config, clients, skip).
 *
 * The resulting ServiceFileMap becomes the reading list injected into all
 * downstream agents, replacing open-ended file exploration.
 *
 * Security:
 *   - Only file paths are accepted — no file contents, no secret values.
 *   - Paths are validated to be non-empty strings.
 *   - Maximum array sizes prevent excessively large payloads.
 *   - Classification: INTERNAL — contains only relative file paths.
 */

import { BaseTool, TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { ServiceFileMap } from '@batta/shared';

export interface ServiceFileMapInput extends Record<string, unknown> {
  fileMap: ServiceFileMap;
  reasoning: string;
}

const MAX_FILES_PER_BUCKET = 30;
const MAX_SKIP_FILES = 100;

export class ServiceFileMapCompletionTool extends BaseTool<ServiceFileMapInput> {
  name = 'complete_service_file_map';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the classified file map for this service. Call ONLY after listing the full ' +
    'file tree and classifying every file into its semantic bucket. ' +
    'SECURITY: Include only file paths — never file contents or secret values.';

  parameters: ToolParameter[] = [
    {
      name: 'fileMap',
      description:
        'ServiceFileMap object with:\n' +
        '  priorityFiles.entry   — entry point files (index.ts, main.ts, app.ts)\n' +
        '  priorityFiles.routes  — route/controller/handler files\n' +
        '  priorityFiles.models  — data model, schema, ORM entity files\n' +
        '  priorityFiles.types   — TypeScript interfaces, Zod schemas, Pydantic models\n' +
        '  priorityFiles.config  — config, settings, env-example files\n' +
        '  priorityFiles.clients — HTTP clients, SDK wrappers, external integrations\n' +
        '  skipFiles             — test files, generated code, utility helpers\n' +
        '  estimatedSignalFiles  — integer count of high-signal priority files\n' +
        '  totalFiles            — integer total file count in the service directory',
      required: true,
      type: 'object',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of how you classified the files (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceFileMapInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }

      const pf = input.fileMap.priorityFiles;
      const totalPriority =
        pf.entry.length + pf.routes.length + pf.models.length +
        pf.types.length + pf.config.length + pf.clients.length;

      await this.notify(
        `✅ File map complete: ${totalPriority} priority files, ` +
        `${input.fileMap.skipFiles.length} skip files, ` +
        `${input.fileMap.totalFiles} total`,
      );

      return {
        success: true,
        message: `File map complete: ${totalPriority} priority files identified.`,
        requiredOutput: {
          fileMap: input.fileMap,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ServiceFileMapInput): string[] {
    const errors: string[] = [];

    if (!input.fileMap || typeof input.fileMap !== 'object') {
      errors.push('`fileMap` must be an object.');
      return errors;
    }

    const fm = input.fileMap;

    if (!fm.priorityFiles || typeof fm.priorityFiles !== 'object') {
      errors.push('`fileMap.priorityFiles` must be an object.');
      return errors;
    }

    const buckets: (keyof typeof fm.priorityFiles)[] = ['entry', 'routes', 'models', 'types', 'config', 'clients'];
    for (const bucket of buckets) {
      if (!Array.isArray(fm.priorityFiles[bucket])) {
        errors.push(`\`fileMap.priorityFiles.${bucket}\` must be an array.`);
      } else if (fm.priorityFiles[bucket].length > MAX_FILES_PER_BUCKET) {
        errors.push(`\`fileMap.priorityFiles.${bucket}\` has too many items (max ${MAX_FILES_PER_BUCKET}).`);
      } else {
        fm.priorityFiles[bucket].forEach((f, i) => {
          if (typeof f !== 'string' || !f.trim()) {
            errors.push(`\`fileMap.priorityFiles.${bucket}[${i}]\` must be a non-empty string path.`);
          }
        });
      }
    }

    if (!Array.isArray(fm.skipFiles)) {
      errors.push('`fileMap.skipFiles` must be an array.');
    } else if (fm.skipFiles.length > MAX_SKIP_FILES) {
      errors.push(`\`fileMap.skipFiles\` has too many items (max ${MAX_SKIP_FILES}).`);
    }

    if (typeof fm.estimatedSignalFiles !== 'number' || fm.estimatedSignalFiles < 0) {
      errors.push('`fileMap.estimatedSignalFiles` must be a non-negative number.');
    }

    if (typeof fm.totalFiles !== 'number' || fm.totalFiles < 0) {
      errors.push('`fileMap.totalFiles` must be a non-negative number.');
    }

    if (!input.reasoning?.trim()) {
      errors.push('`reasoning` is required.');
    }

    return errors;
  }
}
