# batta-ai

[![Website](https://img.shields.io/badge/website-batta.ai-blue)](https://batta.ai)

> Secure agent work, by design.

Batta gives agents the right security and compliance context — so every decision is
informed before code is written. It is the security architect running at machine speed:
grounded in your actual code, cloud config, and org policies, not generic checklists.

The core value is not another chat prompt. It is the indexed security model of your system:
services, entry points, identities, cloud resources, data flows, trust boundaries, data
classifications, threats, mitigations, and known gaps. When an agent starts new work, Batta
compares the proposed change against that model and returns concrete questions, risks,
required tasks, and evidence-backed attestations for human review.

![Batta demo — agent-driven security review in the plan phase](docs/demo.gif)

## Why Batta

- **Plan-phase reviews** run security review before code is written — catching design flaws
  when they are cheapest to fix, not during PR or after deploy.
- **Full context, always** grounds every review in your actual code, cloud config, and org
  policies — not generic checklists. Every review reflects what your system really does.
- **System of record for humans** logs every decision, finding, and attestation. Humans
  stay in control of what matters — with a complete audit trail when it counts.
- **Agent-native workflow** exposes indexing and reviews over MCP so Claude Code, Cursor,
  Codex, Copilot Agent, and other coding agents can use Batta from inside the repo.
- **Local-first OSS setup** works without an LLM key for MCP indexing and review loops.

## Quick Start

Start Batta:

```bash
cp packages/api/.env.example packages/api/.env
docker compose up
```

Open <http://localhost:3100/onboarding>, choose a stable repo key such as
`payments-service`, then paste this prompt into your coding agent while the target
repository is open:

```text
Fetch Batta onboarding instructions from:
http://localhost:3101/api/onboarding/agent-led?repo=<repo-name>

Then follow those instructions in this repository. Configure MCP, verify the connection, and index this repository before considering onboarding complete so future reviews have architecture context.
```

That is the recommended onboarding path. The agent fetches current setup instructions from
your local Batta server, configures MCP for the repository, verifies the connection, indexes
the repo, and adds standing instructions to run Batta reviews before future feature work.
Indexing is the step that makes reviews architecture-aware instead of generic.

Manual setup and production OAuth details live in
[docs/agent-integration](docs/agent-integration/).

## How It Works

```text
coding agent
    |
    | MCP
    v
batta API  ---->  Postgres + pgvector  ---->  indexed architecture context
    |
    v
security review loop
```

1. The coding agent indexes the repository through Batta MCP.
2. Batta stores structured architecture context: services, features, DFDs, threat models,
   relationships, and review gaps.
3. Before a feature or meaningful code change, the agent starts a security review.
4. Batta compares the change to the indexed architecture and returns missing context,
   risks, and required security tasks.
5. The agent implements the change and submits evidence-backed attestations for review.

## Local Development

```bash
pnpm install
cp packages/api/.env.example packages/api/.env
docker compose up -d postgres redis
pnpm --filter @batta/api dev
pnpm --filter @batta/ui dev
```

The API runs on <http://localhost:3101> and the UI runs on
<http://localhost:3100>. Check local readiness with:

```bash
pnpm doctor
```

The default local `.env` disables auth and embeddings so the first run does not require
OAuth, certificates, or model keys.

### Local Ollama Models

Batta can use Ollama for local chat, indexing agents, work-item review agents, and
semantic embeddings. Example setup:

```bash
ollama pull qwen2.5-coder:14b
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text
```

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5-coder:14b
OLLAMA_SMALL_CHAT_MODEL=qwen2.5-coder:7b

EMBEDDINGS_ENABLED=true
EMBEDDINGS_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_EMBEDDING_DIMENSION=768
```

Local model quality varies; larger coder models tend to be more reliable for
the text-formatted tool calls Batta agents use. Embeddings from different
providers or models should not be mixed in the same persisted vector data unless
the indexes are rebuilt.

## Architecture

```text
                 ┌─────────────┐
   Browser ─────▶│     UI      │ (React + Vite)
                 └──────┬──────┘
                        │ REST + SSE
                 ┌──────▼──────┐
   Coding agent ─▶│     API     │ (Express + MCP)
   (MCP/OAuth)   └──┬───────┬──┘
                    │       │
                    ▼       ▼
              Postgres    Redis
              + pgvector  (cache / pubsub)
```

| Package | Purpose |
| --- | --- |
| `@batta/ui` | React frontend for onboarding, reviews, knowledge base, chat, and integrations. |
| `@batta/api` | Express REST API and MCP endpoint. |
| `@batta/core` | LLM task runtime, tools, and memory primitives. |
| `@batta/shared` | Persistence, services, integrations, and shared types. |
| `@batta/data-indexer` | Background scanner for code and cloud indexing. |

## Documentation

- [Docs index](docs/README.md)
- [Agent onboarding](docs/agent-integration/agent-led-onboarding.md)
- [Manual MCP configuration](docs/agent-integration/mcp-config.md)
- [Security review loop design](docs/loops.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Apache-2.0 — see [LICENSE](LICENSE).
