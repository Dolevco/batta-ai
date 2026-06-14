# Data Indexer Architecture

`@batta/data-indexer` owns repository and cloud indexing for the API scan flow. The current OSS runtime model is in-process orchestration: the API calls the package directly, and the package writes canonical entities, relationships, evidence, and semantic documents through `@batta/shared` persistence adapters.

## Runtime Flow

```text
UI scan request
  -> API ScanController
  -> ScanOrchestrator
  -> IntegrationFetcher
  -> CodeDiscoveryStage
  -> RepositoryTaskProcessor per repository
       -> code extraction
       -> canonical transformation
       -> persistence
       -> optional cloud discovery
       -> service relationship analysis
       -> business feature extraction
       -> data-store consolidation
       -> exploitability analysis
  -> shared Postgres graph/data adapters
```

There is no Redis/BullMQ worker in the current package. Scan progress is stored in an injectable `ScanStore`; the default implementation is `InMemoryScanStore`, which is appropriate for local/API-in-process runs. Production deployments that split scans into workers should provide durable job/progress storage behind the same interface.

## Module Layout

```text
src/
  orchestration/   API-facing scan lifecycle and progress tracking
  pipeline/        repository task processor, checkpointing, stages, task types
  integrations/    integration fetching and repository checkout/setup
  cloud/           cloud providers, graph builder, resource repository
  analysis/        service relationships, features, semantic docs, repo briefing
  agents/          data-indexer-specific LLM agent definitions and tools
  utils/           deterministic IDs and sanitization helpers
  types/           compatibility re-exports for older internal imports
```

## Public Surface

The root package export is intentionally small:

- `ScanOrchestrator`
- `discoverRepositories`
- `startScan`
- `startScanStream`
- `getScan`
- `listScans`
- `ScanOptions`
- `ScanDomain`
- `ScanRecord`

Lower-level APIs are available for package-internal use and tests:

- `@batta/data-indexer/pipeline`
- `@batta/data-indexer/analysis`
- `@batta/data-indexer/cloud`
- `@batta/data-indexer/integrations`

## Scan Scopes

- `all`: run repository indexing and cloud discovery when enabled.
- `code`: run repository indexing only.
- `cloud`: run cloud discovery only, without repository discovery or checkout.

## Run Types

- `full`: re-index all discovered files.
- `incremental`: resolve the last completed indexing run and process only changed files when possible.

## Persistence Ownership

Canonical domain types live in `@batta/shared`: entities, relationships, cloud graph contracts, features, and persistence interfaces. Data-indexer owns workflow-specific contracts: scan records, task results, checkpoint payloads, extraction outputs, and stage outputs.

## Security Notes

- Tenant IDs are passed through every scan and persistence call.
- Secret-like metadata is sanitized before graph/document persistence.
- Cloud provider credentials are read through configured integrations and SDK credential providers; they are not persisted by this package.
- Client-visible scan errors are generic. Detailed errors are logged server-side.

