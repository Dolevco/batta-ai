/**
 * SERVICE_CALL_CORRELATOR_AGENT (Step 2.6 disambiguation)
 *
 * Used as a fallback by ServiceCallCorrelator when deterministic path-matching
 * produces a tie, a low-confidence score (score < 2), or no matches at all but
 * an ExternalDep with type='api' is still present (dep.resourceName is set but
 * endpoints[] is empty).
 *
 * The agent receives only structured data — no file reading is needed. It
 * reasons over the candidate providers' entry-point types, exposed endpoints,
 * and the consumer's dep metadata to resolve which provider is being called.
 *
 * Security:
 *   - No workspace file tools — context is entirely injected by the caller.
 *   - Input is INTERNAL-classified structured metadata: service names, IDs, paths.
 *   - No secret values appear in the prompt (enforced by caller sanitization).
 *   - Classification: INTERNAL.
 */

import { ServiceCallCorrelatorCompletionTool } from '../tools/serviceCallCorrelatorCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const SERVICE_CALL_CORRELATOR_AGENT: DataIndexerAgentDefinition = {
  agentType: 'service-call-correlator',
  description:
    'Disambiguates service-to-service call relationships when deterministic endpoint matching ' +
    'is inconclusive. Receives structured service metadata and endpoint lists — no file access needed.',
  whenToUse:
    'Step 2.6 of the SRE pipeline — called by ServiceCallCorrelator for ambiguous or ' +
    'zero-match cases where deterministic path-matching could not confidently identify the provider.',
  maxIterations: 5,
  customInstructions: 'You are a software architect disambiguating service call relationships.\n\n' +
    '**Context you will receive (no file reading needed):**\n' +
    '  - Consumer service name, ID, tech stack, and the ExternalDep metadata\n' +
    '    (name, type, resourceName, endpoints[], evidence, purpose)\n' +
    '  - A list of candidate provider services, each with: name, ID, entry-point types,\n' +
    '    exposed endpoints, and tech stack\n\n' +
    '**Your task:**\n' +
    '  Determine which candidate provider the consumer is calling for this dep.\n\n' +
    '**Decision rules (in order of priority):**\n' +
    '  1. If only one candidate has an HTTP entry point (http in entryPointTypes), choose it.\n' +
    '  2. If endpoints[] is non-empty, count how many of the consumer\'s paths appear in each\n' +
    '     candidate\'s exposedEndpoints (normalise /:id to /:param before comparing).\n' +
    '     Choose the candidate with the highest overlap.\n' +
    '  3. If dep.resourceName is set (e.g. "/api"), prefer the candidate whose codePath or\n' +
    '     name most closely matches that prefix.\n' +
    '  4. Reason over the service descriptions and tech stacks: a React frontend calling a\n' +
    '     "Backend API" dep almost certainly calls the Express HTTP service, not a queue worker.\n' +
    '  5. If confidence is genuinely too low (no signals at all), set confidence to "low" and\n' +
    '     pick the most structurally plausible candidate — never refuse to answer.\n\n' +
    '**Output:**\n' +
    '  Call complete_service_call_correlation with:\n' +
    '    consumerId   — the consumer\'s EntityId (provided in the prompt)\n' +
    '    providerId   — the chosen provider\'s EntityId (from the candidate list)\n' +
    '    matchedPaths — the paths that matched (empty array if resolved by reasoning alone)\n' +
    '    confidence   — "high" | "medium" | "low"\n' +
    '    reasoning    — 1–3 sentences explaining the choice',
  completionToolFactory: () => new ServiceCallCorrelatorCompletionTool(),
  // No toolsFactory — this agent works entirely from injected context.
};
