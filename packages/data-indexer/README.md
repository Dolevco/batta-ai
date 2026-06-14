# Data Indexer

`@batta/data-indexer` powers repository and cloud indexing for the Batta AI knowledge base. It discovers code repositories, extracts canonical architecture/security entities, correlates services with cloud resources, and persists results through `@batta/shared`.

## Usage Model

The supported OSS runtime model is API-driven and in-process:

```text
API ScanController -> ScanOrchestrator -> RepositoryTaskProcessor -> shared persistence
```

The package does not currently run a Redis/BullMQ worker. `ScanOrchestrator` uses an injectable scan store and defaults to in-memory progress tracking.

## Public API

```ts
import { ScanOrchestrator } from '@batta/data-indexer';

const scanOrchestrator = new ScanOrchestrator();

const repositories = await scanOrchestrator.discoverRepositories(tenantId);

await scanOrchestrator.streamScan(
  tenantId,
  {
    enableCloudDiscovery: true,
    scope: 'all',
    runType: 'incremental',
  },
  record => {
    console.log(record.status, record.stages);
  },
);
```

Root exports:

- `ScanOrchestrator`
- `discoverRepositories`
- `startScan`
- `startScanStream`
- `getScan`
- `listScans`
- `ScanOptions`
- `ScanDomain`
- `ScanRecord`

Intentional subpath exports:

- `@batta/data-indexer/pipeline`
- `@batta/data-indexer/analysis`
- `@batta/data-indexer/cloud`
- `@batta/data-indexer/integrations`

## Scan Options

`scope` controls which discovery domains run:

- `all`: code indexing plus cloud discovery when enabled.
- `code`: code indexing only.
- `cloud`: cloud discovery only.

`runType` controls file processing:

- `full`: re-index all discovered files.
- `incremental`: process changed files since the previous completed indexing run when available.

`domains` can limit analysis work:

- `iac`
- `services`
- `service_relationships`
- `features`

## Package Layout

```text
src/
  orchestration/   scan lifecycle, records, and scan storage
  pipeline/        repository task processor, checkpointing, stages, task types
  integrations/    integration fetching and repository setup
  cloud/           cloud providers, graph builder, resource repository
  analysis/        service relationships, features, semantic docs, repo briefing
  agents/          LLM agent definitions and completion tools
  utils/           IDs and sanitization
```

## Environment

Common runtime variables:

- `DATABASE_URL`
- `CLONE_DIR`
- `LLM_PROVIDER` (`azure-openai` or `ollama`)
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_SMALL_DEPLOYMENT`
- `AZURE_OPENAI_SMALL_API_VERSION`
- `AZURE_OPENAI_API_KEY` when not using managed identity
- `OLLAMA_BASE_URL`
- `OLLAMA_CHAT_MODEL`
- `OLLAMA_SMALL_CHAT_MODEL`
- `OLLAMA_NUM_CTX`
- `EMBEDDINGS_PROVIDER` (`azure-openai` or `ollama`)
- `OLLAMA_EMBEDDING_MODEL`
- `OLLAMA_EMBEDDING_DIMENSION`

For local Ollama runs, pull example models first:

```bash
ollama pull qwen2.5-coder:14b
ollama pull nomic-embed-text
```

Keep embedding dimensions explicit and rebuild vector indexes when changing
embedding provider or model.

## Development

```bash
pnpm --filter @batta/data-indexer typecheck
pnpm --filter @batta/data-indexer build
pnpm --filter @batta/data-indexer pack:dry-run
```

Before changing the directory structure, run typecheck first and then again after each move. Most internals use relative imports, so TypeScript is the fastest safety net.
