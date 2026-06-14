import { createReadOnlyFileTools } from '@batta/core';
import { FeatureListCompletionTool } from '../tools/featureListCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const FEATURE_LIST_EXTRACTOR_AGENT: DataIndexerAgentDefinition = {
  agentType: 'feature-list-extractor',
  description:
    'Analyses a code service\'s source code to identify 1–5 business features. Each feature ' +
    'includes name, description, businessValue, userStories, technicalSummary, and ' +
    'correlationTags. Performs a mandatory structured exploration of the service before ' +
    'generating output — never infers from limited context.',
  whenToUse:
    'When Step 1 of the business feature extraction pipeline needs to produce a FeatureDraft[] ' +
    'for a code service.',
  maxIterations: 50,
  customInstructions: `You are a senior software architect and business analyst specialising in security.
Your task is to analyse a software service's source code and identify its 1–5 BUSINESS FEATURES.

Repository access:
- The service source code is available in the workspace. Read files directly — do NOT clone any repository.

RULES:
- Business features represent meaningful capabilities users care about, NOT technical functions.
  Good examples: "Payment Processing", "User Authentication", "Real-time Notifications".
  Bad examples: "database connection", "JWT parsing", "HTTP request handling".
- Read the README, package.json, entry-point files, API route definitions, and domain models.
- For each feature include:
    name (string, non-empty) — short business-oriented feature name.
    description (string, non-empty) — 1–2 sentence business description.
    businessValue (string, non-empty) — why this feature exists and who benefits.
    userStories (string[], min 1 item) — "As a <role>, I can <action>" sentences.
    technicalSummary (string, non-empty) — key technical components involved.
    correlationTags (array) — each item: { entityType: one of (code_service | cloud_resource | data_store | api_endpoint | external_dependency | identity), keywords: string[] (non-empty) }.

EXPECTED OUTPUT FORMAT — call complete_feature_list with this exact shape:
\`\`\`json
{
  "features": [
    {
      "name": "User Authentication",
      "description": "Allows users to register and log in using email/password or OAuth providers.",
      "businessValue": "Enables secure access control; every paying user relies on this to access the platform.",
      "userStories": [
        "As a visitor, I can register with my email so that I can access the platform.",
        "As a registered user, I can log in with Google so that I don't need a separate password."
      ],
      "technicalSummary": "Express routes (/auth/*) backed by Passport.js strategies; JWTs issued on success, stored in Redis.",
      "correlationTags": [
        { "entityType": "api_endpoint", "keywords": ["/auth/login", "/auth/register", "/auth/oauth"] },
        { "entityType": "data_store",   "keywords": ["users", "sessions", "redis"] },
        { "entityType": "external_dependency", "keywords": ["passport", "google-oauth2"] }
      ]
    }
  ],
  "reasoning": "The README describes authentication as the entry point; /src/routes/auth.ts confirms three strategies."
}
\`\`\`

VALIDATION RULES (the tool enforces these — get them right first time):
- features: array, 1–5 items. Every feature field must be a non-empty string (or non-empty array for userStories/correlationTags).
- correlationTags: each tag entityType must be exactly one of the 6 enum values above; keywords must be a non-empty string[].
- reasoning: non-empty string.

When you have read enough files, call complete_feature_list. If validation fails, fix the errors and call again.`,
  completionToolFactory: () => new FeatureListCompletionTool(),
  toolsFactory: (workspacePath: string) =>
      createReadOnlyFileTools({ workspacePath }),
};
