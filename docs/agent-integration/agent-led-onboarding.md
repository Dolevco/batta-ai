# Agent-Led Onboarding

Use this path when your repository is open in a coding agent such as Claude Code, Cursor,
Codex, Copilot Agent, or another MCP-capable agent.

Start Batta, choose a stable repo key, and paste one prompt into the agent. The agent will
fetch the current onboarding instructions from your local Batta server and do the setup in
the repository.

## Start Batta

```bash
cp packages/api/.env.example packages/api/.env
docker compose up
```

Batta should be reachable at:

```text
http://localhost:3101
```

## Choose A Repo Key

Use a short, stable name for the repository:

```text
payments-service
customer-portal
batta-ai
```

Use the same value every time. Batta uses `?repo=<repo-name>` to scope indexing data and
security review sessions.

## Paste This Prompt

Replace `<repo-name>` with your repo key, then paste this into your coding agent while the
target repository is open:

```text
Fetch Batta onboarding instructions from:
http://localhost:3101/api/onboarding/agent-led?repo=<repo-name>

Then follow those instructions in this repository. Configure MCP, verify the connection, and index this repository before considering onboarding complete so future reviews have architecture context. Review proposed file edits with me before applying them, preserve unrelated MCP servers and instructions, do not commit changes.
```

That is the whole onboarding flow.
Indexing is what gives Batta the service map, data flows, trust boundaries, and threat
model context that make future reviews specific to this repository.

For cloud graph context, also connect an LLM/embeddings provider and a cloud integration.
That lets Batta map live cloud resources into the knowledge graph and link code, services,
identities, and infrastructure for richer impact analysis and cloud-aware reviews.

## What The Agent Does

- Adds or updates the repository MCP config without removing unrelated MCP servers.
- Adds standing agent instructions so Batta indexing runs first and security reviews run
  before feature work.
- Verifies the MCP connection with `get_indexing_status`.
- Indexes the repository through Batta MCP until indexing is complete or user input is
  needed.
- Summarizes changed files, indexing status, and the prompt to use before future work.

## Future Work Prompt

After onboarding, start feature work with:

```text
Start a Batta security review for: <feature description>
```

## Safety

- Review MCP config and instruction edits before accepting them.
- Do not send secrets, tokens, private keys, `.env` values, or raw source blobs to Batta.
- Do not let onboarding edits change production auth, deployment settings, or application
  code.

Manual configuration details are available in [mcp-config.md](./mcp-config.md).
