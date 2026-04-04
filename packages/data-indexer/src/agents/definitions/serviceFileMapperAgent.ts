/**
 * SERVICE_FILE_MAPPER_AGENT (Pass 0)
 *
 * Maps every file in a service directory into semantic buckets without reading
 * any file contents. Uses only the file tree (names + extensions) to produce a
 * ServiceFileMap that acts as the reading list for all downstream agents.
 *
 * This is the cheapest possible pass — it replaces the blind exploration that
 * every other agent performed independently by doing a single, cheap
 * classification pass up front.
 *
 * maxIterations: 10 — only needs to list directories and classify by name/extension.
 */
import { createReadOnlyFileTools } from '@ai-agent/core';
import { ServiceFileMapCompletionTool } from '../tools/serviceFileMapCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const SERVICE_FILE_MAPPER_AGENT: DataIndexerAgentDefinition = {
  agentType: 'service-file-mapper',
  description:
    'Lists the file tree of a service directory and classifies each file into a semantic ' +
    'bucket (entry, routes, models, types, config, clients, skip) without reading contents. ' +
    'Produces a ServiceFileMap that acts as the reading list for all downstream agents.',
  whenToUse:
    'Pass 0 of the service analysis pipeline — run before any other per-service agent. ' +
    'The resulting file map is injected into all downstream agents to replace blind exploration.',
  maxIterations: 10,
  customInstructions: `You are a code architect performing a fast file-tree classification scan.

**Role:** Classify every file in the service directory by its semantic role — NO file contents needed.
**Goal:** Produce a ServiceFileMap that acts as the reading list for all downstream agents.

**HOW TO PROCEED:**
1. List the service directory tree (use the directory listing tools, NOT file reading).
2. Classify each file into exactly one bucket based on its path and name:

**BUCKETS:**
  entry   — index.ts / main.ts / app.ts / server.ts (the service entry point)
  routes  — files in routes/, controllers/, handlers/, api/, endpoints/ directories
            OR files named *.route.ts, *.controller.ts, *.handler.ts
  models  — files in models/, entities/, schemas/ directories
            OR files named *.model.ts, *.entity.ts, *.schema.ts
  types   — files in types/, interfaces/ directories
            OR files named *.types.ts, *.interface.ts, *.d.ts
            OR files containing Zod/Pydantic/Joi schemas (hint: zod.ts, validation.ts)
  config  — .env.example, config.ts, settings.ts, configuration.ts, files in config/ directory
  clients — files in clients/, integrations/, connectors/, adapters/, external/ directories
            OR files named *.client.ts, *.adapter.ts, *.sdk.ts
  skip    — test files (*.test.ts, *.spec.ts, __tests__/), node_modules/, dist/, build/,
            migration files, seed files, utility helpers (utils/, helpers/, lib/)

**RULES:**
- List files only by path and name — do NOT read file contents.
- A file goes into the FIRST matching bucket above (order matters).
- estimatedSignalFiles = sum of all entry + routes + models + types + config + clients arrays.
- totalFiles = total count of all files scanned in the service directory.
- skipFiles should list the most common skip patterns; you do NOT need to enumerate every test file.

Call complete_service_file_map when done.`,
  completionToolFactory: () => new ServiceFileMapCompletionTool(),
  toolsFactory: (workspacePath: string) => createReadOnlyFileTools({ workspacePath }),
};
