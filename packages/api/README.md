# @batta/api

Express API service for Batta. It owns HTTP concerns: authentication, REST routes, MCP HTTP/SSE endpoints, OAuth metadata, controller wiring, and local server startup.

Domain and pipeline work should stay in the packages that own it. For example, knowledge-base scan orchestration is exposed by `@batta/data-indexer` and injected into the scan controller here.

## Development

From the repository root:

```bash
pnpm --filter @batta/api dev
pnpm --filter @batta/api typecheck
pnpm --filter @batta/api test
```

This package does not require a separate install step when the workspace is already bootstrapped.

## Environment

Copy `.env.example` from the repo or this package and set the values needed for your flow.

Common variables:

```env
PORT=3101
NODE_ENV=development
DATABASE_URL=postgres://...
CORS_ORIGIN=http://localhost:5173
HTTPS=false
```

Auth and MCP:

```env
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
MCP_ISSUER_URL=http://localhost:3101
JWT_ISSUER=
JWT_AUDIENCE=
JWKS_URI=
```

Local-only bypasses:

```env
AUTH_DISABLED=true
JWT_SKIP_VALIDATION=true
```

Those bypasses are rejected when `NODE_ENV=production`.

Chat and agentic scan steps can use Azure OpenAI or local Ollama models.
Azure remains the production-ready default when `LLM_PROVIDER` is unset and the
Azure variables are present:

```env
LLM_PROVIDER=azure-openai
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-12-01-preview
AZURE_OPENAI_AUTH=use_llm_provider_key
AZURE_OPENAI_API_KEY=
```

For local Ollama development:

```sh
ollama pull qwen2.5-coder:14b
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

Local model quality affects tool-call reliability, especially for indexing and
threat modeling. Larger coder models are recommended. Do not mix embedding
providers or embedding models against the same persisted vector data unless you
rebuild the indexes.

## Route Groups

All REST routes are mounted under `/api` and, except health/MCP OAuth metadata, pass through `authMiddleware`.

- `GET /api/health`
- `/api/integrations`, `/api/integrations/mcp`, `/api/integrations/built-in`
- `/api/oauth/slack/complete`, `/api/oauth/github/complete`
- `/api/knowledge-base/assets`, `/api/knowledge-base/asset/*`
- `/api/knowledge-base/repositories`
- `/api/knowledge-base/scan`, `/api/knowledge-base/scan/stream`
- `/api/knowledge-base/features`
- `/api/knowledge-base/data-stores`
- `/api/security-reviews`
- `/api/policies`
- `/api/chat`
- `/api/mcp`

## Scans

The scan controller validates HTTP input and delegates to `ScanOrchestrator` from `@batta/data-indexer`. Local OSS runs currently use an in-memory scan progress store inside the orchestrator, scoped by tenant. Production deployments should back this with durable job/progress storage when scan workers are split out.

## MCP

MCP endpoints are mounted separately from the REST router. OAuth metadata is exposed under both `/api` and `/` for client discovery, and `/api/mcp` uses bearer auth from the MCP handler.

## Package Shape

Important entrypoints:

- `src/index.ts`: process entrypoint only.
- `src/app/createContext.ts`: dependency graph and initialization.
- `src/app/createApp.ts`: Express app, middleware, MCP mounting, REST mounting.
- `src/app/startServer.ts`: HTTP/HTTPS listen behavior.
- `src/http/routes/*`: route binding only.
- `src/controllers/*`: HTTP request handling.
