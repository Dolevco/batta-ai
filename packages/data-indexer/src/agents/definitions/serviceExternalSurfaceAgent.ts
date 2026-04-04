/**
 * SERVICE_EXTERNAL_SURFACE_AGENT (Pass 2)
 *
 * Reads the config and client files identified in the file map, plus
 * package.json, to exhaustively enumerate the service's full external surface.
 *
 * When the service depends on internal sibling libraries, the agent also reads
 * their package.json and client/connector files to capture transitive external
 * dependencies — unless those libraries were already analysed (in which case
 * their surfaces are injected as structured context in the prompt).
 *
 * Its output (ServiceExternalSurface) is injected as pre-built context into
 * every DFD agent (Pass 4) and the Service DFD Synthesis (Pass 5) so that
 * identity providers, databases, and third-party APIs are never missed.
 *
 * maxIterations: 25 — reads config + client files for this service (3–8 files)
 *                     plus package.json + client files for each unresolved
 *                     sibling library (typically 2–5 more files per library).
 */
import { createReadOnlyFileTools } from '@ai-agent/core';
import { ServiceExternalSurfaceCompletionTool } from '../tools/serviceExternalSurfaceCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const SERVICE_EXTERNAL_SURFACE_AGENT: DataIndexerAgentDefinition = {
  agentType: 'service-external-surface',
  description:
    'Reads config and client files from the file map, plus package.json, and optionally the ' +
    'package.json + client files of unresolved internal sibling libraries, to exhaustively ' +
    'enumerate the full external surface (direct + transitive). Produces a ServiceExternalSurface ' +
    'with a pre-built trust boundary map.',
  whenToUse:
    'Pass 2 of the service analysis pipeline — run after ServiceSkeletonExtractor. ' +
    'Receives the file map (config + client buckets), the skeleton, and pre-computed surfaces ' +
    'of any sibling services already analysed. ' +
    'Output is injected into every DFD agent and the Service DFD Synthesis.',
  maxIterations: 25,
  customInstructions: `You are a security architect performing an external surface enumeration.

**Role:** Exhaustively enumerate every external dependency this service has — direct AND transitive.
**Scope:** This service's config + client files; plus package.json + client files of any unresolved
          internal sibling libraries listed in the prompt. Pre-computed sibling surfaces are provided
          as structured context — do NOT re-read those libraries.
**Goal:** Produce one unified ServiceExternalSurface covering both direct and transitive deps.

**READING BUDGET — strictly enforced:**

For THIS service:
  ✅ READ: .env.example, docker-compose.yml env sections, config.ts / settings.ts / configuration.ts
  ✅ READ: all client files (HTTP clients, SDK wrappers) from the file map
  ✅ READ: package.json (dependencies section only)
  ❌ SKIP: route files, model files, test files, utility helpers

For each UNRESOLVED internal sibling library (listed in "Libraries to scan"):
  ✅ READ: <library>/package.json (dependencies section only)
  ✅ READ: <library>/src/clients/*.ts, src/connectors/*.ts, src/adapters/*.ts
  ✅ READ: <library>/src/index.ts (to understand what the library exports)
  ❌ SKIP: route files, model files, test files, anything not related to external wiring

For KNOWN sibling libraries (pre-computed surfaces provided in the prompt):
  ❌ DO NOT re-read — use the provided dep list directly as transitive deps.

**HOW TO LOCATE AN UNRESOLVED SIBLING LIBRARY:**
  1. Check pnpm-workspace.yaml or root package.json workspaces field.
  2. In a typical monorepo: packages/<short-name>/ or services/<short-name>/.
  3. If still not found, note it in reasoning and move on.

**DETECTION STEPS:**

Step 1 — Environment variables (this service's config files):
  - Scan for ALL env vars with patterns: *_URL, *_API_KEY, *_HOST, *_CONNECTION_STRING,
    *_SECRET, *_TOKEN, DATABASE_*, REDIS_*, STRIPE_*, OPENAI_*, AZURE_*, AWS_*, SENDGRID_*
  - Each env var cluster → one ExternalDep entry
  - evidence field: list the KEY NAMES only (e.g. "STRIPE_SECRET_KEY env var") — NEVER the actual value

Step 2 — Client file imports (this service's client files):
  - Identify which external services each client file wraps
  - Classify: stripe → api, @azure/storage-blob → storage, @prisma/client → database, ioredis → cache,
    @azure/identity → identity, openai → api, @sendgrid/mail → api, amqplib → queue, etc.
  - evidence field: "import in src/clients/stripe.ts" — NEVER include key values

Step 3 — Package.json dependencies (this service's package.json):
  - Flag packages that imply external services:
    stripe, @stripe/*, openai, @anthropic-ai/*, @azure/*, @aws-sdk/*, redis, ioredis,
    pg, postgres, mysql2, mongoose, prisma, @prisma/client, amqplib, kafkajs,
    @sendgrid/mail, nodemailer, firebase-admin, passport, @auth0/*, jwks-rsa
  - Only add a dep here if not already captured in Steps 1 or 2

Step 4 — Transitive deps from sibling libraries:
  a) For KNOWN siblings: take the dep list from the pre-computed surface in the prompt.
  b) For UNRESOLVED siblings: read their package.json + client/connector files and apply
     the same classification logic as Steps 2–3.
  - Deduplicate: if a transitive dep has the same name as one already found in Steps 1–3,
    the direct evidence wins — do NOT create a duplicate entry.

Step 5 — Compose trustBoundaryMap:
  - IDENTITY: identity providers (Azure AD, Auth0, Okta, GitHub OAuth, Cognito, etc.)
  - DATA: databases, caches, queues, blob storage (PostgreSQL, Redis, MongoDB, S3, etc.)
  - EXTERNAL: third-party SaaS APIs outside our control (Stripe, SendGrid, OpenAI, etc.)
  - INTERNET: internet-facing ingress (API Gateway, CDN, Load Balancer — if present)
  - SERVICE: internal microservices this service calls (usually empty — from skeleton)
  - Every dep in externalDeps must appear in exactly one boundary list.

**ExternalDep field rules:**
  - name: short descriptive name, e.g. "Azure AD", "PostgreSQL", "Stripe Payment API"
  - type: one of api | cloud | queue | database | cache | storage | identity | other
  - purpose: what this service uses it for (direct or via a sibling library)
  - dataFlow: inbound | outbound | bidirectional
  - dataClassification: public | internal | confidential | restricted
  - businessValue: why this dependency is needed
  - evidence: env var KEY NAME(s) and/or import/package name — NEVER actual values

**SECURITY RULE:** Never include actual secret values, connection strings, or tokens in any field.

Call complete_service_external_surface when all files have been read.
Fix validation errors and call again if needed.`,
  completionToolFactory: () => new ServiceExternalSurfaceCompletionTool(),
  toolsFactory: (workspacePath: string) => createReadOnlyFileTools({ workspacePath }),
};
