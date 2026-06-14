# Contributing to batta-ai

Thanks for your interest in contributing!

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating,
you agree to abide by its terms.

## Local development

```bash
git clone <your-fork>
cd batta-ai
pnpm install
docker compose up -d postgres redis
cp packages/api/.env.example packages/api/.env
pnpm --filter @batta/api dev            # API on :3101
pnpm --filter @batta/ui dev             # UI on :3100
pnpm doctor
```

## Repository layout

- `packages/ui` — React frontend (Vite).
- `packages/api` — Express REST + MCP server.
- `packages/core` — LLM task runtime, tools, memory.
- `packages/shared` — Persistence (Postgres + pgvector), services, integrations.
- `packages/data-indexer` — Background scanner that ingests code + cloud into Postgres.
- `docs/` — User-facing docs. Internal/historical planning lives in `docs/archive/`.

## UI development (`packages/ui`)

See [packages/ui/README.md](packages/ui/README.md) for full setup.

```bash
cp packages/ui/.env.example packages/ui/.env
# Set VITE_AUTH_DISABLED=true for local dev without an auth provider
pnpm --filter @batta/ui dev
```

Key conventions:
- Import types from `src/types/<domain>.types.ts`, not the root `src/types.ts` shim.
- Use `useAPICall` from `hooks/useAPICall.ts` for authenticated API calls; don't repeat the loading/error boilerplate.
- Prefer domain-specific hooks (`useMCPIntegrations`, `useCodeIntegrations`) over the `useIntegrations` facade for new code.
- Page components live in `src/pages/<domain>/`; shared UI lives in `src/components/<domain>/`.

---

## Quality gates

Before opening a PR, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Branching and commits

- Branch from `master`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) where reasonable
  (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Keep PRs focused: one feature or fix per PR.
- All commits must be signed off (`git commit -s`) to certify the
  [DCO](https://developercertificate.org/).

## Bugs and feature proposals

- **Bugs**: open an issue with reproduction steps and environment details.
- **Features**: open an issue with the proposed change and rationale before opening a
  PR for non-trivial work — saves churn if direction needs to be discussed.

## Security

Do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).
