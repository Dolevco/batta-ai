# batta-ai

Open security platform. TypeScript + pnpm monorepo.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/api` | Express REST + MCP endpoint (port 3101) |
| `packages/ui` | React/Vite frontend (port 3100) |
| `packages/shared` | Services, persistence, integrations, types |
| `packages/core` | LLM task runtime |
| `packages/data-indexer` | Background scan pipeline |

## Commands

```bash
docker compose up -d postgres redis   # start backing services
pnpm install                          # install dependencies
pnpm --filter @batta/api dev          # API on :3101
pnpm --filter @batta/ui dev           # UI on :3100
pnpm test                             # all tests
pnpm --filter @batta/shared test      # shared service tests
pnpm --filter @batta/api test         # MCP/API handler tests
pnpm typecheck                        # type-check all packages
pnpm lint                             # lint all packages
```

## Key files

| File | Purpose |
| --- | --- |
| `packages/api/src/mcp/handler.ts` | All MCP tool definitions and routing |
| `packages/api/src/app/createContext.ts` | Service composition root |
| `packages/shared/src/services/repository-indexing.service.ts` | Indexing state machine |
| `packages/shared/src/services/repository-indexing/stage-definitions.ts` | Per-stage instructions, questions, schemas |
| `packages/shared/src/services/security-review.service.ts` | Security review logic |
| `packages/shared/src/types/repository-indexing.types.ts` | Indexing types |
| `packages/shared/src/types/canonical.types.ts` | Canonical entity types |

## Coding conventions

- Cross-package imports use `@batta/shared` / `@batta/core`, not relative paths.
- All service methods take `tenantId` as their first argument.
- No secrets in evidence fields — file paths, symbol names, config key names, and rationale only.
- Deterministic IDs: `sha256(\`${tenantId}|${entityType}|...\`).slice(0, 36)`.
- New DB columns are not needed for `SecurityReview` — it is stored as a JSON payload.

## Batta Security Review Requirement

This repository uses Batta MCP for security architecture context and change security reviews.
The MCP server is pre-configured in `.vscode/mcp.json` and `.claude/mcp.json`.

Before feature work:
1. Call get_indexing_status using the Batta MCP server.
2. If indexing is incomplete or stale, run repository indexing and follow every returned
   Batta stage instruction until complete.

For every new feature, behavior change, endpoint, data flow, integration, auth change,
storage change, infrastructure change, or dependency change:
1. Call start_security_review before writing implementation code.
2. Answer every returned question with submit_security_answers.
3. Treat returned security tasks as required implementation work.
4. Call acknowledge_security_tasks before editing code.
5. Implement the change while addressing the returned tasks.
6. After implementation, call submit_security_attestations with one attestation per task.

Attestation evidence must reference files, symbols, routes, tests, migrations, config keys,
or documentation. Do not include secrets, tokens, private keys, .env values, or raw source
blobs.

Use the `/batta-review` slash command (see `.claude/commands/batta-review.md`) or follow
the protocol in `docs/archive/copilot-instructions.md` using `agentName="Claude Code"`.
