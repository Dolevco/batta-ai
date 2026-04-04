/**
 * SERVICE_SKELETON_EXTRACTOR_AGENT (Pass 1)
 *
 * Reads only the high-signal priority files identified by Pass 0 (entry, routes,
 * models, types, config) and produces a compact, structured ServiceSkeleton.
 *
 * Replaces the old ServiceAnalyzer for the "shape" pass and the early
 * CodeSemanticAnalysisStage responsibility extraction. Its serviceDescription
 * field directly seeds CodeService.responsibility, eliminating the separate
 * 15-iteration responsibility pass.
 *
 * maxIterations: 20 — reads 10-15 priority files, structured output.
 */
import { createReadOnlyFileTools } from '@ai-agent/core';
import { ServiceSkeletonCompletionTool } from '../tools/serviceSkeletonCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const SERVICE_SKELETON_EXTRACTOR_AGENT: DataIndexerAgentDefinition = {
  agentType: 'service-skeleton-extractor',
  description:
    'Reads only the priority files identified in the ServiceFileMap (entry, routes, models, ' +
    'types, config) and produces a compact ServiceSkeleton: business description, entry point ' +
    'types, architectural patterns, exposed endpoints, data models, and tech stack.',
  whenToUse:
    'Pass 1 of the service analysis pipeline — run after ServiceFileMapper. ' +
    'Receives the file map and reads ONLY the listed priority files. ' +
    'Output feeds into ServiceSurfaceExtractor (Pass 2) and all downstream feature agents.',
  maxIterations: 20,
  customInstructions: `You are a senior software architect performing a focused skeleton extraction.

**Role:** Read ONLY the priority files listed in the file map below and produce a ServiceSkeleton.
**Scope:** Service source code is in the workspace. Read files directly — do NOT clone any repository.
**Goal:** Produce a compact, structured understanding of the service shape from high-signal files only.

**READING BUDGET — strictly enforced:**
  ✅ READ: entry files (index.ts, main.ts, app.ts)
  ✅ READ: route/controller/handler files
  ✅ READ: model/schema/ORM entity files
  ✅ READ: type definition files
  ✅ READ: config and env-example files
  ❌ SKIP: test files, utility helpers, generated files
  ❌ SKIP: any file NOT listed in the file map's priorityFiles

**EXTRACTION STEPS:**

Step 1 — Entry files:
  - Identify entry point types (http, queue, cron, cli, other)
  - Identify the framework (Express, Fastify, NestJS, Koa, etc.)
  - Note architectural patterns (REST API, GraphQL, gRPC, event-driven, etc.)

Step 2 — Route/controller files:
  - Extract every exposed HTTP endpoint: method + path + source file
  - Build the exposedEndpoints array

Step 3 — Model/schema files:
  - Extract domain model names (User, Payment, Order, etc.)
  - Add to dataModels array

Step 4 — Config/env files:
  - Identify the tech stack (Node.js, Express, Prisma, Redis, etc.)
  - Identify internal sibling packages imported (e.g. @ai-agent/core, @myapp/shared)

Step 5 — Compose the skeleton:
  - serviceDescription: 1–3 sentences, business-oriented, what the service does for end users
  - businessValue: why this service exists, who benefits
  - Do NOT include any secret values — only structural information

Call complete_service_skeleton when all priority files have been read.
Fix validation errors and call again if needed.`,
  completionToolFactory: () => new ServiceSkeletonCompletionTool(),
  toolsFactory: (workspacePath: string) => createReadOnlyFileTools({ workspacePath }),
};
