# Data Indexer

Agent-native, production-ready data indexer for code repositories with **comprehensive security analysis**, queue-based distributed processing, and dynamic integration fetching.

## Features

### Core Capabilities
- **Canonical entities**: Code repositories, services, modules, artifacts, dependencies, commits
- **Evidence tracking**: Append-only facts linking entities to sources
- **Semantic search**: Vector embeddings for intelligent queries
- **Graph relationships**: Neo4j for efficient relationship traversal
- **Tenant isolation**: Multi-tenant support
- **LLM-based correlation**: Automatically identify relationships between entities using AI reasoning
- **Queue-based processing**: Distributed task processing via Redis/BullMQ for production scale
- **Checkpointing**: Automatic checkpointing after each stage for fault tolerance and resumability
- **Dynamic integration fetching**: Automatically fetches code and cloud integrations from Qdrant based on tenant ID
- **Automatic repository setup**: Clones repositories on-demand with authentication

### 🔒 Security Index (NEW)
- **Security entities**: Identities, data stores, API endpoints, external dependencies, network segments, trust boundaries
- **Threat modeling**: STRIDE threat analysis with severity, mitigations, and MITRE ATT&CK mapping
- **LLM-based threat extraction**: Task-based AI analysis for comprehensive threat identification (see [LLM_THREAT_EXTRACTION.md](./LLM_THREAT_EXTRACTION.md))
- **Attack path analysis**: Graph-based attack path enumeration from internet to sensitive data
- **Risk assessment**: Automated risk scoring and high-risk component identification
- **Data classification**: Track sensitive data (PII, PHI, PCI) and encryption controls
- **Compliance checking**: Support for GDPR, HIPAA, SOC2, and other frameworks
- **Trust boundaries**: Explicit modeling of security boundaries and boundary crossings
- **Internet exposure**: Automatic detection of public endpoints and attack surface

See [SECURITY_INDEX.md](./SECURITY_INDEX.md) for complete documentation.

## Architecture

- **Qdrant**: Stores entities, evidence, and integration configurations with vector embeddings
- **Neo4j**: Stores relationships as graph edges for efficient traversal queries
- **Redis/BullMQ**: Queue management for distributed task processing
- **Checkpointing**: Redis-based checkpointing for fault tolerance

## Prerequisites

Before running the indexer, you must configure integrations in Qdrant:

### 1. Code Integration (GitHub)

Store a GitHub integration with your tenant ID in Qdrant:

```typescript
{
  id: 'github-integration-id',
  type: 'code',
  name: 'GitHub',
  tenantId: 'your-tenant-id',
  enabled: true,
  config: {
    gitUrl: 'https://github.com',
    token: 'github-installation-id', // or installationId field
    repositories: []
  }
}
```

### 2. Cloud Integration (Microsoft Defender) - Optional

For cloud resource discovery, store a Microsoft Defender integration:

```typescript
{
  id: 'defender-integration-id',
  type: 'custom',
  name: 'Microsoft Defender',
  tenantId: 'your-tenant-id',
  enabled: true,
  config: {
    tenantId: 'azure-tenant-id',
    clientId: 'azure-client-id',
    clientSecret: 'azure-client-secret',
    subscriptionId: 'azure-subscription-id'
  }
}
```

## Usage

### Production Mode (Queue-based)

For production use at scale, use the queue-based orchestrator and worker.
Integrations are fetched automatically from Qdrant based on tenant ID.

**1. Start the Orchestrator** (discovers repos and enqueues tasks):

```typescript
import { CodeIndexingOrchestrator, QueueManager } from '@ai-agent/data-indexer';

const queueManager = new QueueManager({ 
  redisUrl: process.env.REDIS_URL 
});

// No need to pass integration - it will be fetched from Qdrant
const orchestrator = new CodeIndexingOrchestrator(
  'your-tenant-id',
  queueManager
);

const result = await orchestrator.orchestrate(
  { repositories: [] }, // Empty = all repos
  {
    enableSemanticAnalysis: true,
    enableVectorIndexing: true,
    enableGraphProjection: true,
    enableCloudDiscovery: true // Uses Microsoft Defender if configured
  }
);

console.log(`Enqueued ${result.tasksEnqueued} indexing tasks`);
```

**2. Start Workers** (process tasks from the queue):

```typescript
import { IndexingWorker } from '@ai-agent/data-indexer';

// Workers automatically fetch integrations per task
const worker = new IndexingWorker({
  cloneDir: '/tmp/clones',
  redisUrl: process.env.REDIS_URL,
  queueName: 'code-indexing',
  concurrency: 3, // Process 3 repos concurrently
  api: yourLLMApiHandler, // Your ILLMApiHandler implementation
});

await worker.start();
```

**3. Run via CLI Example**:

```bash
# Set environment variables
export TENANT_ID=your-tenant-id
export REDIS_URL=redis://localhost:6379
export QDRANT_URL=http://localhost:6333

# Start orchestrator
tsx examples/queue-based-indexing.ts orchestrator

# Start worker (in another terminal)
tsx examples/queue-based-indexing.ts worker

# Check task status
tsx examples/queue-based-indexing.ts status <task-id>
```

## How It Works

### Dynamic Integration Fetching

The system automatically fetches integrations from Qdrant based on tenant ID:

1. **Orchestrator**: Fetches GitHub integration to discover repositories
2. **Worker**: Each task fetches both GitHub and Microsoft Defender integrations as needed
3. **Repository Setup**: Automatically clones repositories with authentication from the integration

### Processing Pipeline

Each repository goes through these stages:

1. **Setup**: Fetch integrations and clone repository
2. **Extract & Transform**: Parse code and create canonical entities
3. **Cloud Discovery**: Fetch Azure resources (if enabled and integration exists)
4. **Semantic Analysis**: Generate embeddings and descriptions
5. **LLM Correlation**: Identify relationships using AI
6. **Persistence**: Store everything in Qdrant and Neo4j

### Fault Tolerance

- **Checkpointing**: After each stage, progress is saved to Redis
- **Resumability**: Failed tasks can resume from the last successful stage
- **Distributed**: Multiple workers can process tasks in parallel

## Benefits of Queue-based Processing

1. **Scalability**: Distribute work across multiple workers
2. **Fault Tolerance**: Automatic retry with exponential backoff
3. **Resumability**: Checkpoint after each stage, resume from failures
4. **Incremental Persistence**: Save results immediately after each stage
5. **Observability**: Monitor queue stats and task progress
6. **Resource Efficiency**: Process repositories concurrently with controlled concurrency
7. **No Data Loss**: Already persisted data remains intact on retry
8. **Memory Efficient**: Data persisted immediately, not kept in memory
9. **Dynamic Configuration**: Integrations fetched per tenant, no hardcoded credentials

## Environment Variables

- `TENANT_ID` - Your tenant identifier (required)
- `REDIS_URL` - Redis connection URL (default: redis://localhost:6379)
- `QDRANT_URL` - Qdrant URL (default: http://localhost:6333)
- `QDRANT_API_KEY` - Qdrant API key (optional)
- `NEO4J_URI` - Neo4j connection URI (optional)
- `CLONE_DIR` - Directory for cloning repositories (default: /tmp/clones)

## Examples

See the `examples/` directory:
- `queue-based-indexing.ts`: Production queue-based indexing workflow with dynamic integration fetching
- `vulnerability-workflow.ts`: Vulnerability impact analysis using relationships
- `security-index-example.ts`: Complete security index output example
- `complete-security-indexing.ts`: Full security indexing pipeline
- `llm-threat-extraction-example.ts`: LLM-based threat model extraction demonstration
