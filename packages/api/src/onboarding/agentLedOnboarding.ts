export function renderAgentLedOnboardingInstructions(mcpUrl: string): string {
  return `# Batta Agent-Led Onboarding Instructions

Set up this repository to use Batta for security architecture context and security reviews.

Use the Batta MCP server at:
${mcpUrl}

## Do This

1. Configure Batta MCP for this repository:
   - VS Code: .vscode/mcp.json with top-level "servers"
   - Claude Code: .claude/mcp.json with top-level "mcpServers"
   - Cursor or another agent: use the environment's MCP configuration if available, or
     show the user the manual config to apply.
2. Preserve unrelated MCP servers and existing instructions.
3. Add the standing instruction block (below) to the top of CLAUDE.md (before any other
   sections), and create or merge \`.claude/settings.json\` with the hook configuration
   (below).
4. Verify the connection with get_indexing_status.
5. If indexing is incomplete or stale, call index_repository and follow every returned
   stage instruction until indexing is complete or user input is required.
6. Treat indexing as a required onboarding step. It gives future reviews the repository's
   services, data flows, trust boundaries, threat model, and known gaps.
7. Summarize:
   - files changed
   - MCP server URL used
   - indexing status
   - any missing context
   - the exact prompt to use before future feature work

## Standing Repository Instruction

Add or merge this block into the **top** of the repository's CLAUDE.md (before any other sections):

\`\`\`md
## Batta Security Review — MANDATORY FOR EVERY FEATURE OR CHANGE

This repository uses Batta MCP for security architecture context and change security reviews.
Run the protocol below for every feature, fix, behavior change, endpoint, data flow, auth change,
storage change, infrastructure change, or dependency change.

**The MCP tools are deferred — fetch them each session before calling:**
Run ToolSearch with:
\\\`select:mcp__security-review__get_indexing_status,mcp__security-review__start_security_review,mcp__security-review__submit_security_answers,mcp__security-review__acknowledge_security_tasks,mcp__security-review__submit_security_attestations\\\`

### Mandatory workflow

The security review happens **during the planning phase** — after exploring the codebase and
understanding scope, but **before writing any code**.

\\\`\\\`\\\`
Phase 1 — Explore (read files, identify affected services, data flows, entry points)
Phase 2 — Review (run the Batta protocol with real answers based on what you found):
  1. Call get_indexing_status  — check status only, do not run index_repository during a coding session
  2. Call start_security_review immediately — pass agentName="Claude Code" and affected services list
  3. Call submit_security_answers — answer every question based on your exploration
  4. Call acknowledge_security_tasks — read every returned task
  5. Add security tasks as explicit steps in your plan before writing code
Phase 3 — Implement (write code, address each task as you go)
Phase 4 — Attest:
  6. Call submit_security_attestations — one attestation per task, citing files/symbols
\\\`\\\`\\\`

Do not include secrets, tokens, private keys, .env values, or raw source blobs in attestations.
\`\`\`

## Claude Code Hooks

Create \`.claude/settings.json\` at the repository root with the content below.
If the file already exists, merge the \`hooks\` key — preserve all existing settings.

\`\`\`json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "(?i)(implement|build|add|create|develop|refactor|write|scaffold|introduce|extend|upgrade|migrate|plan|design|propose|set.?up|wire.?up|integrate|enable|support|handle|expose)\\\\b.*(feature|endpoint|api|service|component|page|route|handler|middleware|function|class|module|integration|auth|login|permission|role|database|table|schema|migration|webhook|cron|job|queue|cache|secret|token|key|password|encrypt|hook|workflow|pipeline|script|scheduler|trigger|event|listener|command)",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'SECURITY REVIEW REQUIRED: Follow this sequence — (1) FIRST explore: read relevant files, identify affected services and data flows (2) THEN fetch MCP tools: ToolSearch select:mcp__security-review__get_indexing_status,mcp__security-review__start_security_review,mcp__security-review__submit_security_answers,mcp__security-review__acknowledge_security_tasks,mcp__security-review__submit_security_attestations (3) call get_indexing_status (4) call start_security_review with real answers from your exploration (5) call submit_security_answers (6) call acknowledge_security_tasks (7) add security tasks to your plan BEFORE writing code. After implementation call submit_security_attestations. See CLAUDE.md.'"
          }
        ]
      },
      {
        "matcher": "(?i)(feature|endpoint|api|service|component|page|route|handler|middleware|hook|workflow|pipeline|integration|auth|module|schema|migration|webhook|cron|job|queue).{0,60}(implement|build|add|create|develop|refactor|write|scaffold|introduce|extend|upgrade|migrate|plan|design|propose|set.?up|wire.?up|enable|support|handle|expose)",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'SECURITY REVIEW REQUIRED: Follow this sequence — (1) FIRST explore: read relevant files, identify affected services and data flows (2) THEN fetch MCP tools: ToolSearch select:mcp__security-review__get_indexing_status,mcp__security-review__start_security_review,mcp__security-review__submit_security_answers,mcp__security-review__acknowledge_security_tasks,mcp__security-review__submit_security_attestations (3) call get_indexing_status (4) call start_security_review with real answers from your exploration (5) call submit_security_answers (6) call acknowledge_security_tasks (7) add security tasks to your plan BEFORE writing code. After implementation call submit_security_attestations. See CLAUDE.md.'"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo \\"$CLAUDE_TOOL_INPUT\\" | grep -qiE '\\"command\\"[[:space:]]*:[[:space:]]*\\"[^\\"]*git (commit|push|merge)|gh pr (create|merge)' && echo 'ATTESTATION REMINDER: Before committing/pushing, ensure submit_security_attestations has been called for every security review started this session. See CLAUDE.md.' || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'COMPLETION CHECK: If you used Edit or Write tools this session and have not yet called submit_security_attestations, do not stop — complete the attestation first. If no code was changed or attestation is already done, you may stop.'"
          }
        ]
      }
    ]
  }
}
\`\`\`

## Future Feature Work Prompt

\`\`\`text
Start a Batta security review for: <feature description>
\`\`\`

## Constraints

- Ask before overwriting any existing MCP config or instruction file.
- Preserve unrelated MCP servers and unrelated instructions.
- Do not commit changes.
- Do not send secrets, tokens, private keys, .env values, or raw source blobs to Batta.
- Do not change production authentication or deployment settings.
- After this onboarding document is fetched, use MCP tools for Batta operations instead of
  calling Batta HTTP endpoints directly.
`;
}
