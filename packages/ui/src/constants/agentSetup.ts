export const MCP_URL_TEMPLATE = 'http://localhost:3101/api/mcp?repo=<repo-name>';
export const AGENT_LED_ONBOARDING_URL_TEMPLATE = 'http://localhost:3101/api/onboarding/agent-led?repo=<repo-name>';

export const DEFAULT_REPO_KEY_PLACEHOLDER = '<repo-name>';

export function normalizeRepoKey(repoKey: string): string {
  const trimmed = repoKey.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_REPO_KEY_PLACEHOLDER;
}

export function buildMcpUrl(repoKey: string): string {
  const normalized = normalizeRepoKey(repoKey);
  const encodedRepoKey = normalized === DEFAULT_REPO_KEY_PLACEHOLDER
    ? normalized
    : encodeURIComponent(normalized);
  return MCP_URL_TEMPLATE.replace(DEFAULT_REPO_KEY_PLACEHOLDER, encodedRepoKey);
}

export function buildAgentLedOnboardingUrl(repoKey: string): string {
  const normalized = normalizeRepoKey(repoKey);
  const encodedRepoKey = normalized === DEFAULT_REPO_KEY_PLACEHOLDER
    ? normalized
    : encodeURIComponent(normalized);
  return AGENT_LED_ONBOARDING_URL_TEMPLATE.replace(DEFAULT_REPO_KEY_PLACEHOLDER, encodedRepoKey);
}

export function buildVsCodeMcpConfig(repoKey: string): string {
  return JSON.stringify({
    servers: {
      batta: {
        type: 'http',
        url: buildMcpUrl(repoKey),
      },
    },
  }, null, 2);
}

export function buildClaudeMcpConfig(repoKey: string): string {
  return JSON.stringify({
    mcpServers: {
      batta: {
        type: 'http',
        url: buildMcpUrl(repoKey),
      },
    },
  }, null, 2);
}

export function buildAgentLedBootstrapPrompt(repoKey: string): string {
  return `Fetch Batta onboarding instructions from:
${buildAgentLedOnboardingUrl(repoKey)}

Then follow those instructions in this repository. Configure MCP, verify the connection, and index this repository before considering onboarding complete so future reviews have architecture context. preserve unrelated MCP servers and instructions.`;
}

export const VSCODE_MCP_CONFIG_TEMPLATE = buildVsCodeMcpConfig(DEFAULT_REPO_KEY_PLACEHOLDER);
export const CLAUDE_MCP_CONFIG_TEMPLATE = buildClaudeMcpConfig(DEFAULT_REPO_KEY_PLACEHOLDER);
export const MCP_CONFIG_TEMPLATE = CLAUDE_MCP_CONFIG_TEMPLATE;
export const AGENT_LED_BOOTSTRAP_PROMPT = buildAgentLedBootstrapPrompt(DEFAULT_REPO_KEY_PLACEHOLDER);

export const AGENT_SECURITY_REVIEW_INSTRUCTIONS = `## Batta Security Review Requirement

This repository uses Batta MCP for security architecture context and change security reviews.

For every new feature, behavior change, endpoint, data flow, integration, auth change, storage change, infrastructure change, or dependency change:
1. Call start_security_review before writing implementation code.
2. Answer every returned question with submit_security_answers.
3. Treat returned security tasks as required implementation work.
4. Call acknowledge_security_tasks before editing code.
5. Implement the change while addressing the returned tasks.
6. After implementation, call submit_security_attestations with one attestation per task.

Attestation evidence must reference files, symbols, routes, tests, migrations, config keys, or documentation. Do not include secrets, tokens, private keys, .env values, or raw source blobs.`;
