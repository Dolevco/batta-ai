# Contributing to @batta/shared

This guide covers package-level contributions. For repo-wide setup and workflow see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Adding a new integration

1. Create a sub-folder under `src/integrations/<provider>/`.
2. Add the implementation file (e.g. `src/integrations/myservice/myservice-integration.ts`).
3. Re-export from `src/integrations/index.ts`.
4. Add any required environment variables to the table in `README.md` and to `.env.example` at the repo root.
5. If the integration introduces new npm dependencies that are heavy (SDKs, etc.), verify that it is only reachable via the `@batta/shared/integrations` sub-path export so the main entry point remains lean.

## Adding a repository

Repositories live in `src/persistence/repositories/`. Each repository:

1. Implements the relevant interface from `src/persistence/interfaces.ts`.
2. Named `<domain>.repository.ts` (kebab-case).
3. Exported from `src/persistence/index.ts` and accompanied by a `create<Domain>Repository` factory function.

### Running the persistence tests

```bash
pnpm --filter @batta/shared test
```

Tests use `pg-mem` for in-process Postgres emulation — no real database required.

## Adding a service

Services live in `src/services/`. Follow the naming convention `<domain>.service.ts`. Export the class from `src/services/index.ts` and from the package root `src/index.ts`.

## Adding a domain type

Types live in `src/types/`. Choose or create the appropriate domain file:

| File | Domain |
|---|---|
| `asset.types.ts` | Asset inventory |
| `chat.types.ts` | Chat messages, conversations |
| `integration.types.ts` | MCP, custom, code integrations |
| `policy.types.ts` | Policy templates |
| `threat-model.types.ts` | Threat model graphs and diffs |
| `feature.types.ts` | Feature context, DFD, architecture diffs |
| `security-review.types.ts` | Security reviews, PR correlation, validation |
| `overview.types.ts` | Dashboard / overview stats |
| `canonical.types.ts` | Code indexing contract — do not change |
| `business-feature.types.ts` | Business feature entities — stable |
| `cloud-graph.types.ts` | Cloud infrastructure graph |

Export your new type from `src/types/index.ts`.

## Database migrations

DDL changes go in a new numbered file under `src/persistence/migrations/` (e.g. `004_add_column.sql`). Then add the filename to the `MIGRATION_FILES` array in `src/persistence/schema.ts`. All migrations must be idempotent (`IF NOT EXISTS` / `IF EXISTS` guards).

## Code style

- File names: kebab-case (`my-service.ts`)
- No `export *` in barrel files — use explicit named exports
- No comments that describe what the code does; only explain non-obvious *why*
- TypeScript strict mode is on; no `any` escapes without justification
