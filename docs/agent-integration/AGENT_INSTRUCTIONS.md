# Batta Agent Instructions

Use this block in `CLAUDE.md`, Cursor rules, VS Code agent instructions, or any other
repository-level coding-agent instruction file.

```md
## Batta Security Review Requirement

This repository uses Batta MCP for security architecture context and change security reviews.

Before feature work:
1. Call get_indexing_status using the Batta MCP server.
2. If indexing is incomplete or stale, run repository indexing and follow every returned
   Batta stage instruction until complete.

For every new feature, behavior change, endpoint, data flow, integration, auth change, storage change, infrastructure change, or dependency change:
1. Call start_security_review before writing implementation code.
2. Answer every returned question with submit_security_answers.
3. Treat returned security tasks as required implementation work.
4. Call acknowledge_security_tasks before editing code.
5. Implement the change while addressing the returned tasks.
6. After implementation, call submit_security_attestations with one attestation per task.

Attestation evidence must reference files, symbols, routes, tests, migrations, config keys, or documentation. Do not include secrets, tokens, private keys, .env values, or raw source blobs.
```

Recommended setup order:

1. Configure the Batta MCP endpoint with `?repo=<repo-name>`.
2. Add this instruction block to the agent's repository instructions.
3. Run `/batta-index` once.
4. Run `/batta-review <feature description>` before every feature/change.
