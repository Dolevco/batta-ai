# Queue-Based Indexing Architecture

## System Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ORCHESTRATOR (One-time/Scheduled)                   │
│                                                                              │
│  1. Discover Repositories (GitHub API)                                      │
│  2. Create IndexRepositoryTask for each repo                                │
│  3. Enqueue tasks to Redis Queue                                            │
│                                                                              │
│  Result: N tasks in queue (one per repository)                              │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Redis Queue   │
                    │    (BullMQ)     │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│  WORKER 1        │                   │  WORKER 2        │
│  (Concurrent)    │                   │  (Concurrent)    │
│                  │                   │                  │
│  Processes:      │        ...        │  Processes:      │
│  - repo-1        │                   │  - repo-N        │
│  - repo-2        │                   │  - repo-N+1      │
│  - repo-3        │                   │  - repo-N+2      │
└──────────────────┘                   └──────────────────┘
        │                                         │
        └────────────────────┬────────────────────┘
                             │
                             ▼
                   ┌──────────────────┐
                   │  Task Processor  │
                   │  (Per Repository)│
                   └────────┬─────────┘
                            │
                            ▼
    ┌───────────────────────────────────────────────────┐
    │         Stage-by-Stage Processing                  │
    │         (with Incremental Persistence)             │
    │                                                    │
    │  Stage 1: Extract + Transform                     │
    │           ↓ [Persist Entities & Evidence]         │
    │           ↓ [Save Checkpoint]                     │
    │  Stage 2: Cloud Discovery (optional)              │
    │           ↓ [Persist Cloud Entities]              │
    │           ↓ [Save Checkpoint]                     │
    │  Stage 3: Semantic Analysis (optional)            │
    │           ↓ [Persist Semantic Documents]          │
    │           ↓ [Save Checkpoint]                     │
    │  Stage 4: LLM Correlation                         │
    │           ↓ [Persist Relationships]               │
    │           ↓ [Delete Checkpoint - Complete]        │
    │                                                    │
    │  Benefits:                                         │
    │  • Data persisted immediately after generation    │
    │  • Minimal data loss on failure                   │
    │  • Can query partial results during processing    │
    │  • Reduced memory footprint                       │
    │                                                    │
    │  If failure at any stage:                         │
    │  → Retry (3 attempts with exponential backoff)    │
    │  → Resume from last checkpoint                    │
    │  → Already persisted data is not re-written       │
    └────────────────────────┬──────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │    Storage Backends          │
              │                              │
              │  • Qdrant (Entities/Vectors) │
              │  • Neo4j (Relationships)     │
              │  • Redis (Checkpoints)       │
              └──────────────────────────────┘
```

## Checkpoint Recovery Flow

```
Task starts → Check Redis for checkpoint
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
   No checkpoint          Checkpoint exists
   (Fresh start)          (Resume from stage)
        │                       │
        ▼                       ▼
   Start from           Load checkpoint data
   Extract+Transform    Already persisted data intact
        │               Skip completed stages
        ▼                       │
   Persist entities     ───────┘
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
            Execute remaining stages
            Persist after each stage
            Save checkpoint after each
                    │
                    ▼
              Task complete
           Delete checkpoint
```

## Components

### Orchestrator
- **Purpose**: Discover repositories and create tasks
- **Runs**: One-time, scheduled, or on-demand
- **Output**: Tasks enqueued in Redis queue
- **Scalability**: Single instance (lightweight)

### Queue (Redis/BullMQ)
- **Purpose**: Task distribution and retry management
- **Features**: 
  - Automatic retry with exponential backoff
  - Job persistence
  - Priority queuing
  - Rate limiting support
- **Scalability**: Redis cluster for high throughput

### Workers
- **Purpose**: Process repository indexing tasks
- **Runs**: Continuously (long-running processes)
- **Concurrency**: Each worker processes N repos simultaneously
- **Scalability**: Horizontal (add more workers)
- **Fault Tolerance**: Graceful shutdown, automatic task requeue on crash

### Task Processor
- **Purpose**: Execute indexing stages for a single repository
- **Checkpointing**: After each stage to Redis
- **Recovery**: Resume from last successful stage on retry
- **Idempotency**: Safe to retry at any stage

### Checkpoint Manager
- **Purpose**: Save/load task progress
- **Storage**: Redis (key-value)
- **TTL**: 7 days (configurable)
- **Format**: JSON serialized stage data

## Scalability Example

```
1 Orchestrator → 1 Queue → 5 Workers (3 concurrent repos each)
                                ↓
                    15 repositories processed concurrently
                    
Each worker:
- Processes 3 repos at once
- Each repo goes through 6 stages
- Each stage checkpointed
- Failed stages retry automatically
```

## Deployment Models

### Small Scale (< 100 repos)
- 1 Redis instance
- 1 Worker (concurrency: 5)
- Orchestrator runs on schedule (e.g., hourly)

### Medium Scale (100-1000 repos)
- 1 Redis instance
- 3-5 Workers (concurrency: 3-5 each)
- Orchestrator triggered on events (e.g., PR merge)

### Large Scale (1000+ repos)
- Redis cluster
- 10+ Workers (auto-scaled based on queue depth)
- Orchestrator with incremental discovery
- Separate workers for different tenants
