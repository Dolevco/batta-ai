# Code Pipeline - Refactored Structure

The code pipeline has been split into smaller, more maintainable files for better organization and testability.

## Structure

```
connectors/
├── code.pipeline.ts          # Main pipeline orchestrator (263 lines)
└── stages/
    ├── index.ts              # Exports all stages
    ├── discovery.stage.ts    # Stage 1: Discovery (127 lines)
    ├── extraction.stage.ts   # Stage 2: Extraction (1032 lines)
    ├── transformation.stage.ts  # Stage 3: Transformation (663 lines)
    ├── semantic-analysis.stage.ts  # Stage 4: Semantic Analysis (99 lines)
    └── persistence.stage.ts  # Stage 5: Persistence (42 lines)
```

## Files

### Main Pipeline (`code.pipeline.ts`)
- **Purpose**: Orchestrates the 5-stage indexing pipeline
- **Responsibilities**:
  - Initialize all stages
  - Coordinate pipeline execution
  - Handle cloud discovery integration
  - Provide vulnerability impact analysis
- **Size**: ~263 lines (down from 2232 lines)

### Stage 1: Discovery (`stages/discovery.stage.ts`)
- **Purpose**: Find repositories and artifacts
- **Responsibilities**:
  - Discover GitHub repositories
  - Discover local repositories
  - Filter by scope
- **Size**: ~127 lines

### Stage 2: Extraction (`stages/extraction.stage.ts`)
- **Purpose**: Parse code and extract raw facts
- **Responsibilities**:
  - Clone/pull repositories
  - Extract services (Node.js, Python, Go)
  - Extract modules (source files)
  - Extract build artifacts (Dockerfiles)
  - Extract deployment artifacts (K8s, Terraform, Docker Compose)
  - Extract dependencies
  - Extract commits
- **Size**: ~1032 lines

### Stage 3: Transformation (`stages/transformation.stage.ts`)
- **Purpose**: Convert extracted data to canonical entities
- **Responsibilities**:
  - Transform repositories, services, modules, artifacts
  - Create relationships between entities
  - Generate evidence for each entity
- **Size**: ~663 lines

### Stage 4: Semantic Analysis (`stages/semantic-analysis.stage.ts`)
- **Purpose**: Generate LLM descriptions and embeddings
- **Responsibilities**:
  - Generate input hashes for caching
  - Call LLM service (stub implementation)
  - Cache results
- **Size**: ~99 lines

### Stage 5: Persistence (`stages/persistence.stage.ts`)
- **Purpose**: Project entities to downstream stores
- **Responsibilities**:
  - Write to relational DB
  - Write to graph DB
  - Write to vector DB
- **Size**: ~42 lines

## Benefits of Refactoring

1. **Maintainability**: Each stage is in its own file, making it easier to understand and modify
2. **Testability**: Stages can be tested independently
3. **Reusability**: Stages can be reused or replaced with alternative implementations
4. **Readability**: Smaller files are easier to navigate and review
5. **Separation of Concerns**: Each file has a single, well-defined responsibility

## Usage

The API remains the same. Import and use the pipeline as before:

```typescript
import { CodeIndexingPipeline } from './connectors/code.pipeline';

const pipeline = new CodeIndexingPipeline(tenantId, integration, config);
const result = await pipeline.run(tenantId, scope, options);
```

## Migration Notes

- The old implementation has been backed up to `code.pipeline.old.ts`
- All functionality remains the same
- No breaking changes to the public API
- Internal stage classes are now exported separately
