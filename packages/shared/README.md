# @batta/shared

The central shared library for the Batta AI monorepo. Provides persistence, services, integrations, events, tools, and all canonical domain types used across `api`, `data-indexer`, and `ui`.

---

## Installation

This is a private workspace package. Add it to a package in this monorepo:

```json
"dependencies": {
  "@batta/shared": "workspace:*"
}
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/app`) |
| `REDIS_URL` | Yes | Redis connection string (e.g. `redis://localhost:6379`) |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM encryption of sensitive fields |
| `AZURE_OPENAI_ENDPOINT` | Yes* | Azure OpenAI endpoint URL (*when using AzureOpenAI embeddings) |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | No | Override endpoint specifically for embeddings |
| `AZURE_OPENAI_API_KEY` | No | API key (omit to use Managed Identity) |
| `AZURE_OPENAI_EMBEDDING_API_KEY` | No | API key override for embeddings |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | No | Deployment name (default: `text-embedding-3-small`) |
| `AZURE_OPENAI_API_VERSION` | No | API version (default: `2024-12-01-preview`) |
| `AZURE_OPENAI_AUTH` | No | Set to `use_llm_provider_key` to use API key instead of Managed Identity |
| `GITHUB_APP_ID` | No | GitHub App ID for GitHub integration |
| `GITHUB_APP_PRIVATE_KEY` | No | GitHub App private key (PEM) |
| `SLACK_BOT_TOKEN` | No | Slack bot token for Slack integration |
| `JIRA_BASE_URL` | No | Jira instance base URL |
| `JIRA_API_TOKEN` | No | Jira API token |

See `.env.example` at the monorepo root for a complete template.

---

## Persistence

The persistence layer provides a PostgreSQL-backed implementation of all repository interfaces.

### Migrations

Numbered SQL migrations live in `src/persistence/migrations/`. Run them against your database before starting the application:

```typescript
import { getPool } from '@batta/shared/persistence';
import { runMigrations } from '@batta/shared/persistence';

await runMigrations(getPool());
```

Or run the SQL files directly with `psql`:

```bash
psql $DATABASE_URL -f packages/shared/src/persistence/migrations/001_initial.sql
psql $DATABASE_URL -f packages/shared/src/persistence/migrations/002_long_term_memory_session.sql
psql $DATABASE_URL -f packages/shared/src/persistence/migrations/003_drop_retired_tables.sql
```

### Repositories

```typescript
import {
  createChatMessageRepository,
  createMCPIntegrationRepository,
  createCustomIntegrationRepository,
  createSecurityReviewRepository,
  createPolicyTemplateRepository,
  createIndexingRunRepository,
} from '@batta/shared/persistence';

const repo = createSecurityReviewRepository();
await repo.initialize();
```

### Adapters

```typescript
import { createPostgresDataAdapter, createPostgresGraphAdapter } from '@batta/shared';
import { createAzureEmbeddingClient } from '@batta/core';

const embeddingHandler = createAzureEmbeddingClient(); // or bring your own IEmbeddingHandler
const dataAdapter = createPostgresDataAdapter(embeddingHandler);
const graphAdapter = createPostgresGraphAdapter();
```

---

## Services

| Service | Description |
|---|---|
| `AssetService` | Asset discovery, categorisation, and relationship queries |
| `FeatureService` | Business feature CRUD + semantic search |
| `PolicyService` | Security policy template management |
| `SecurityReviewService` | Full security review workflow orchestration |
| `PRCorrelationService` | Multi-signal PR/MR correlation scoring |

```typescript
import { SecurityReviewService, PolicyService } from '@batta/shared/services';
```

---

## Integrations

Integration clients (GitHub, GitLab, Slack, Jira, AWS, Microsoft Defender) are available via the `integrations` sub-path export to avoid pulling in large SDK dependencies for consumers that don't need them:

```typescript
import { GitHubIntegration } from '@batta/shared/integrations';
import { SlackIntegration } from '@batta/shared/integrations';
import { AWSIntegration } from '@batta/shared/integrations';
```

---

## Events

Redis-backed event pub/sub and worker queue:

```typescript
import { RedisEventPublisher, RedisEventSubscriber, WorkerQueue } from '@batta/shared/events';
```

---

## Types

All domain types are available from the main entry point:

```typescript
import type {
  SecurityReview,
  SecurityTask,
  PolicyTemplate,
  BusinessFeature,
  ThreatModelGraph,
  OverviewStats,
} from '@batta/shared';
```

### Legacy types

`FeatureContextFull` was deprecated in favour of the split `FeatureContext` + `FeatureSecurityContext` shape. If you need it for deserialising stored review payloads, import from the legacy sub-path:

```typescript
import type { FeatureContextFull } from '@batta/shared/legacy';
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a new integration, repository, or service to this package.
