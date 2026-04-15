# Dependency Extraction — Architecture Plan

## Problem Statement

The goal is to answer: **"Who is affected if I change X?"** across services, without a build or runtime failure to tell you. This means building a graph where:

- `ui -[:CALLS_API]-> api` (with specific endpoints)
- `api -[:READS_FROM]-> neo4j` (with collection/label names)
- `worker -[:SUBSCRIBES_TO]-> redis` (with queue names)

### What already works

The pipeline has a 3-pass LLM analysis per service (SRE Step 2):

| Pass | Agent | Output |
|------|-------|--------|
| Pass 0 | `ServiceFileMapper` | `ServiceFileMap` — which files to read |
| Pass 1 | `ServiceSkeletonExtractor` | `ServiceSkeleton` — exposed endpoints, tech stack, internal deps |
| Pass 2 | `ServiceSurfaceExtractor` | `ServiceExternalSurface` — external dep list |

Pass 1 already extracts `exposedEndpoints: [{method, path, file}]` for services like `api`. Pass 2 already identifies that a service depends on neo4j, redis, qdrant, etc.

### The actual gap: no concrete identifiers

`ExternalDep` (the output of Pass 2) currently has:

```typescript
interface ExternalDep {
  name: string;              // "Neo4j Graph Database"
  type: 'database' | ...;
  dataFlow: 'inbound' | 'outbound' | 'bidirectional';
  evidence?: string;         // "NEO4J_URI env var" — just a key name
  purpose: string;           // "stores graph relationships"
  // ... but NO:
  //   resourceName  — the actual DB name / collection / queue name / bucket
  //   endpoints     — which HTTP paths are called on a backend service
  //   operations    — read vs write vs subscribe
}
```

Without concrete identifiers, **correlation is impossible**:

- `ui` has an `ExternalDep` for "Backend API" — but no endpoint paths, so we can't match it against `api`'s `exposedEndpoints`
- `api` has an `ExternalDep` for "Neo4j" — but no collection/label names, so we can't tell which Neo4j data each service touches
- Two services both have `ExternalDep` for "Redis" — but we can't tell if they share the same queue or use different ones

The fix has two parts:
1. **Enrich `ExternalDep`** with concrete, matchable identifiers
2. **Wire the enriched data** into typed Neo4j relationships through a new correlation step

---

## Solution Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Pass 1 — ServiceSkeletonExtractor (existing, no changes needed)      │
│  Output: ServiceSkeleton.exposedEndpoints[] — already populated       │
│    e.g. api → [POST /tasks, GET /tasks/:id, POST /chat, ...]          │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Pass 2 — ServiceSurfaceExtractor (UPDATED)                           │
│  Change: ExternalDep gains concrete identifiers                       │
│                                                                       │
│  For backend API calls:  endpoints[]  e.g. ["/tasks", "/chat"]        │
│  For databases:          resourceName e.g. "neo4j", collection names  │
│  For queues:             resourceName e.g. "indexing", "scan"         │
│  For storage:            resourceName e.g. "artifacts-bucket"         │
│  Plus:                   operations[] e.g. ["read", "write"]          │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  NEW — ServiceCallCorrelator (post-Step 2)                            │
│  Joins ExternalDep.endpoints[] from consumers against                 │
│  ServiceSkeleton.exposedEndpoints[] from providers                    │
│  Emits: CALLS_API relationships with matched method+path              │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EXTENDED — ExternalDep Relationship Emitter (extends existing)       │
│  Uses ExternalDep.type + operations[] to emit typed edges:            │
│  database/read  → READS_FROM   database/write → WRITES_TO             │
│  queue/inbound  → SUBSCRIBES_TO  queue/outbound → PUBLISHES_TO        │
│  storage/read   → READS_STORAGE  storage/write  → WRITES_STORAGE      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Neo4j Graph — Impact Query Layer                                     │
│  "What breaks if neo4j goes down?" → graph traversal                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Change 1: Enrich `ExternalDep` in `canonical.types.ts`

Add three optional fields. They are optional so all existing agents continue to work unchanged — only the updated Pass 2 agent and completion tool populate them.

```typescript
// packages/shared/src/types/canonical.types.ts

export interface ExternalDep {
  name: string;
  type: 'api' | 'cloud' | 'queue' | 'database' | 'cache' | 'storage' | 'identity' | 'other';
  protocol?: string;
  purpose: string;
  dataFlow: 'inbound' | 'outbound' | 'bidirectional';
  dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  businessValue: string;
  evidence?: string;

  // ── NEW FIELDS for correlation ─────────────────────────────────────────────

  /**
   * Concrete resource name within the dependency — used as the join key during
   * cross-service correlation. Examples:
   *   database  → database/schema name: "neo4j", "postgres_main"
   *   cache     → key-space prefix or logical name: "session_cache"
   *   queue     → queue/topic name(s): "indexing", "scan-results"
   *   storage   → bucket/container name: "artifacts-bucket"
   *   api       → base URL path prefix: "/api"  (NOT the hostname)
   */
  resourceName?: string;

  /**
   * Sample endpoint paths called on a remote API dep, used for matching against
   * the provider's exposedEndpoints. Only populated when type = 'api'.
   * Examples: ["/tasks", "/tasks/:id", "/chat", "/agents"]
   * Include parameterized forms (/:id) not concrete IDs.
   */
  endpoints?: string[];

  /**
   * Specific operations performed on this dependency.
   * Examples: ["read"], ["write"], ["read", "write"], ["subscribe"], ["publish"]
   */
  operations?: string[];
}
```

### Why these three fields

| Field | What it enables |
|-------|----------------|
| `resourceName` | Deduplication: two services with `resourceName: "indexing"` queue are confirmed to share it. Also used as the Neo4j node name for `CloudResource` / `ExternalDependency` entities. |
| `endpoints` | `ui` lists `["/tasks", "/chat"]` → matched against `api`'s `exposedEndpoints` → `CALLS_API` relationship with specific routes. Without this, the join has no key. |
| `operations` | Distinguishes `READS_FROM` vs `WRITES_TO` for the same resource. Currently `dataFlow: bidirectional` forces both edges regardless; `operations` is more precise. |

---

## Change 2: Update the Pass 2 Agent and Completion Tool

### 2a. `ServiceExternalSurfaceCompletionTool` — add fields to parameter spec

File: `packages/data-indexer/src/agents/tools/serviceExternalSurfaceCompletionTool.ts`

Update the `surface` parameter description to document the new fields:

```typescript
parameters: ToolParameter[] = [
  {
    name: 'surface',
    description:
      'ServiceExternalSurface object with:\n' +
      '  externalDeps[]  — each dep:\n' +
      '    name              (string)   — short descriptive name\n' +
      '    type              (string)   — api | cloud | queue | database | cache | storage | identity | other\n' +
      '    purpose           (string)   — why the service uses this dep\n' +
      '    dataFlow          (string)   — inbound | outbound | bidirectional\n' +
      '    dataClassification(string)   — public | internal | confidential | restricted\n' +
      '    businessValue     (string)   — why this dep matters\n' +
      '    evidence          (string)   — env var KEY NAME(s) / import path — NEVER actual values\n' +
      '    resourceName      (string?)  — concrete resource id for correlation:\n' +
      '                                   database → db/schema name (e.g. "neo4j")\n' +
      '                                   cache    → logical name or key-space prefix\n' +
      '                                   queue    → queue/topic name (e.g. "indexing")\n' +
      '                                   storage  → bucket/container name\n' +
      '                                   api      → base path prefix (e.g. "/api") NOT hostname\n' +
      '    endpoints         (string[]?) — for type=api only: sampled paths called\n' +
      '                                   e.g. ["/tasks", "/tasks/:id", "/chat"]\n' +
      '                                   Use parameterized forms, not concrete IDs\n' +
      '    operations        (string[]?) — specific ops: ["read"], ["write"],\n' +
      '                                   ["read","write"], ["subscribe"], ["publish"]\n' +
      '  trustBoundaryMap — { IDENTITY: [], DATA: [], EXTERNAL: [], INTERNET: [], SERVICE: [] }\n' +
      '    Each dep.name must appear in exactly one boundary list',
    required: true,
    type: 'object',
  },
  // ... reasoning parameter unchanged
];
```

Also add validation for the new optional fields:

```typescript
// In validate():
s.externalDeps.forEach((dep, i) => {
  const p = `surface.externalDeps[${i}]`;
  // ... existing validation ...

  // NEW: validate optional correlation fields
  if (dep.endpoints !== undefined) {
    if (!Array.isArray(dep.endpoints))
      errors.push(`${p}.endpoints must be an array when present.`);
    else if (dep.type !== 'api')
      errors.push(`${p}.endpoints should only be set when type is 'api'.`);
    else if (dep.endpoints.length > 20)
      errors.push(`${p}.endpoints has too many items (max 20 — sample representative paths).`);
    else {
      dep.endpoints.forEach((ep, j) => {
        if (ep.includes('://') || /^https?:/i.test(ep))
          errors.push(`${p}.endpoints[${j}] must be a path (e.g. "/tasks"), not a full URL.`);
      });
    }
  }
  if (dep.operations !== undefined) {
    if (!Array.isArray(dep.operations))
      errors.push(`${p}.operations must be an array when present.`);
    const VALID_OPS = ['read', 'write', 'subscribe', 'publish', 'upsert', 'delete', 'search'];
    dep.operations.forEach((op, j) => {
      if (!VALID_OPS.includes(op))
        errors.push(`${p}.operations[${j}] "${op}" must be one of: ${VALID_OPS.join(', ')}`);
    });
  }
});
```

### 2b. `SERVICE_EXTERNAL_SURFACE_AGENT` — add detection steps for new fields

File: `packages/data-indexer/src/agents/definitions/serviceExternalSurfaceAgent.ts`

Extend `customInstructions` with a new Step 6 after the existing Step 5 (trustBoundaryMap), instructing the agent how to populate the new fields:

```
Step 6 — Populate correlation identifiers (NEW — required for dependency graph):

For EVERY ExternalDep, try to populate these fields. They are critical for cross-service
relationship mapping and impact analysis. Leave them undefined only if genuinely unknowable
from the files you have read.

  resourceName:
    - database/cache  → look for the DB name in connection strings or env var names
                        (e.g. NEO4J_URI=bolt://localhost/neo4j → resourceName: "neo4j")
                        (e.g. REDIS_URL → resourceName: name of the queue system or "redis")
    - queue           → look for queue/topic name strings in client files or env vars
                        (e.g. QUEUE_NAME=indexing → resourceName: "indexing")
    - storage         → look for bucket/container name in env vars or client config
                        (e.g. AZURE_BLOB_CONTAINER=artifacts → resourceName: "artifacts")
    - api (external)  → the URL path prefix, NOT the hostname
                        (e.g. calls to `${API_BASE}/tasks` → resourceName: "/api" if API_BASE ends in /api,
                         or just "/" if no prefix)
    - api (internal backend service) → the path prefix this service calls on the backend
                        (e.g. all calls go to `${BACKEND_URL}/api` → resourceName: "/api")

  endpoints (api type ONLY):
    - Collect a representative sample of the HTTP paths called (5–15 examples)
    - Read the service's HTTP client files and hooks to find the paths
    - Use parameterized form: "/tasks/:id" not "/tasks/abc123"
    - Include the HTTP method prefix if you can determine it: "POST /tasks", "GET /tasks/:id"
    - IMPORTANT: these paths are how we correlate this service as a caller against another
      service's exposed endpoints — be thorough

  operations:
    - database  → ["read"] if only reads (SELECT/MATCH/FIND), ["write"] if only writes,
                  ["read", "write"] if both, ["search"] if semantic/vector search only
    - cache     → ["read"] / ["write"] / ["read", "write"]
    - queue     → ["publish"] if producer, ["subscribe"] if consumer, ["publish", "subscribe"] if both
    - storage   → ["read"] / ["write"] / ["read", "write"]
    - api       → ["read"] for GET-only callers, ["write"] for POST/PUT/DELETE,
                  ["read", "write"] for both

Example output for a frontend service calling a backend API:
  {
    name: "Backend API",
    type: "api",
    dataFlow: "outbound",
    resourceName: "/api",
    endpoints: ["POST /tasks", "GET /tasks/:id", "GET /tasks", "DELETE /tasks/:id",
                "POST /chat", "GET /agents", "POST /tasks/:id/message"],
    operations: ["read", "write"],
    evidence: "API_BASE env var, src/services/api.ts",
    purpose: "Primary backend for all data operations",
    dataClassification: "internal",
    businessValue: "Provides all business logic and data persistence"
  }

Example output for a service using Redis queues:
  {
    name: "Redis (BullMQ)",
    type: "queue",
    dataFlow: "outbound",
    resourceName: "indexing",
    operations: ["publish"],
    evidence: "REDIS_URL env var, src/services/queue-manager.ts",
    purpose: "Dispatches indexing jobs to background worker",
    dataClassification: "internal",
    businessValue: "Enables async processing of repository scans"
  }
```

---

## Change 3: ServiceCallCorrelator (new correlator, runs after SRE Step 2)

File: `packages/data-indexer/src/services/service-relationships-extractor/correlators/service-to-service.ts`

This correlator runs after all services have completed Pass 2. It has two sub-steps:

### 3a. Deterministic path matching

```typescript
function correlateByEndpoints(
  services: CodeService[],
  tenantId: string,
): Relationship[] {
  const relationships: Relationship[] = [];
  const serviceByName = new Map(services.map(s => [s.name, s]));

  for (const consumer of services) {
    const surface = consumer.serviceExternalSurface;
    if (!surface) continue;

    for (const dep of surface.externalDeps) {
      if (dep.type !== 'api' || !dep.endpoints?.length) continue;

      // Normalise caller paths: strip method prefix → just the path
      const calledPaths = dep.endpoints.map(e => e.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '').trim());

      // Score each candidate service by how many of its exposedEndpoints match
      let bestMatch: { service: CodeService; score: number; matches: string[] } | null = null;

      for (const provider of services) {
        if (provider.id === consumer.id) continue;
        const skeleton = provider.serviceSkeleton;
        if (!skeleton?.exposedEndpoints?.length) continue;
        if (!skeleton.entryPointTypes?.includes('http')) continue;

        const matches: string[] = [];
        for (const calledPath of calledPaths) {
          const normalised = calledPath.replace(/\/:[^/]+/g, '/:param');
          for (const ep of skeleton.exposedEndpoints) {
            const epNorm = ep.path.replace(/\/:[^/]+/g, '/:param');
            if (epNorm === normalised || epNorm.startsWith(normalised) || normalised.startsWith(epNorm)) {
              matches.push(`${ep.method} ${ep.path}`);
              break;
            }
          }
        }

        const score = matches.length;
        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { service: provider, score, matches };
        }
      }

      if (bestMatch && bestMatch.score >= Math.min(2, calledPaths.length)) {
        // Emit a CALLS_SERVICE relationship for the service-level connection
        relationships.push(makeRel(tenantId, 'CALLS_SERVICE', consumer.id, bestMatch.service.id, {
          matchedEndpoints: bestMatch.matches,
          score: bestMatch.score,
          totalCalledPaths: calledPaths.length,
          confidence: bestMatch.score >= calledPaths.length * 0.5 ? 'heuristic' : 'low',
          correlatedBy: 'ServiceCallCorrelator',
        }));

        // Emit CALLS_API for each matched endpoint pair
        for (const match of bestMatch.matches) {
          const [method, path] = match.split(' ');
          relationships.push(makeRel(tenantId, 'CALLS_API', consumer.id, bestMatch.service.id, {
            method,
            path,
            callerEvidence: dep.evidence,
            correlatedBy: 'ServiceCallCorrelator',
          }));
        }
      }
    }
  }
  return relationships;
}
```

**Why minimum score of 2?** A single matching path (e.g. `/health`) could be coincidental. Two or more matching paths — especially ones like `/tasks` and `/tasks/:id` and `/chat` — are strong evidence of an intentional caller/provider relationship.

### 3b. LLM disambiguation (ambiguous and zero-match cases)

Register a new agent `ServiceCallCorrelatorAgent` for cases where:
- Path matching produces a tie (two services both expose the matched paths)
- `endpoints` is empty but `dep.type === 'api'` and `dep.resourceName` is set (a base URL was found but no paths extracted)
- Score is 1 and confidence is low

The agent receives only structured data — no file reading needed:

```
Consumer: ui — React frontend, calls REST APIs. ExternalDep: "Backend API", paths: ["/tasks", "/chat"]
Candidate providers:
  - api: Express HTTP server, exposes POST /tasks, GET /tasks/:id, POST /chat, GET /agents...
  - worker: Background queue processor, no HTTP server
  - data-indexer: CLI/queue entry point, no HTTP server

Which provider does "ui" call for "/tasks" and "/chat"?
```

Output: `{ consumerId, providerId, matchedPaths, confidence, reasoning }`

---

## Change 4: Extend ExternalDep Relationship Emitter

File: `packages/data-indexer/src/services/static-dependency-extractor/relationship-emitter.ts`

Add a new function `emitExternalDepRelationships()` alongside the existing `emitDependencyRelationships()`. This processes `service.serviceExternalSurface.externalDeps` (LLM-sourced) rather than `ServiceDependencyMap` (regex-sourced):

```typescript
export function emitExternalDepRelationships(
  tenantId: TenantId,
  service: CodeService,
  allCloudResources: CloudResource[],
): EmitResult {
  const relationships: Relationship[] = [];
  const inferredResources: CloudResource[] = [];

  const surface = service.serviceExternalSurface;
  if (!surface?.externalDeps?.length) return { relationships, inferredResources };

  for (const dep of surface.externalDeps) {
    if (dep.type === 'api' || dep.type === 'identity') continue; // handled by ServiceCallCorrelator

    const resourceType = depTypeToResourceType(dep.type);    // 'database' | 'cache' | 'queue' | 'storage'
    const nodeName = dep.resourceName ?? dep.name;
    const cloudNode = findOrInferCloudResource(tenantId, nodeName, resourceType, dep.evidence ?? '', allCloudResources, inferredResources);

    const ops = dep.operations ?? inferOperationsFromDataFlow(dep.dataFlow);
    const metadata = {
      depName: dep.name,
      resourceName: dep.resourceName,
      purpose: dep.purpose,
      evidence: dep.evidence,
      dataClassification: dep.dataClassification,
      extractedBy: 'ServiceSurfaceExtractor',
    };

    if (ops.includes('read') || ops.includes('subscribe') || ops.includes('search')) {
      relationships.push(makeRel(tenantId, 'READS_FROM', service.id, cloudNode.id, metadata));
    }
    if (ops.includes('write') || ops.includes('publish') || ops.includes('upsert') || ops.includes('delete')) {
      relationships.push(makeRel(tenantId, 'WRITES_TO', service.id, cloudNode.id, metadata));
    }
  }

  return { relationships, inferredResources };
}

function inferOperationsFromDataFlow(dataFlow: ExternalDep['dataFlow']): string[] {
  if (dataFlow === 'inbound') return ['read'];
  if (dataFlow === 'outbound') return ['write'];
  return ['read', 'write'];
}
```

**Key behaviour:**
- `type === 'api'` is skipped — those relationships are handled by `ServiceCallCorrelator` with endpoint-level precision
- `resourceName` is used as the Neo4j node name when available, falling back to `dep.name`
- `operations[]` drives which relationship types are emitted — this is more precise than always emitting both `READS_FROM` and `WRITES_TO`

---

## Change 5: Wire into SRE Pipeline

File: `packages/data-indexer/src/services/service-relationships-extractor/index.ts`

After Step 2 (Service Analysis) completes for all services, add two new steps:

```typescript
// ── Step 2.5: External Dep Relationship Emission ──────────────────────────
// Converts ExternalDep[] from Pass 2 (LLM-sourced) into typed graph edges.
// Runs after all services have been analysed so cross-service deduplication works.
for (const service of serviceMap.values()) {
  const { relationships: depRels, inferredResources } = emitExternalDepRelationships(
    tenantId, service, [...cloudRepository.listAll()],
  );
  // Persist inferred resources before relationships (Neo4j MATCH requires nodes first)
  for (const res of inferredResources) {
    await this.persistence.persistCloudResource(res);
  }
  allRelationships.push(...depRels);
}

// ── Step 2.6: Service-to-Service Call Correlation ─────────────────────────
// Matches ExternalDep.endpoints[] from consumers against ServiceSkeleton.exposedEndpoints[]
// from providers to emit CALLS_SERVICE and CALLS_API relationships.
const serviceCallRels = await correlateServiceCalls(
  [...serviceMap.values()], tenantId, this.registry,
);
allRelationships.push(...serviceCallRels);
```

These two steps run before the existing Steps 3–7 (build/IaC correlation), so the service-level dependency graph is populated before cloud topology runs.

---

## Neo4j Relationship Types

New relationship types needed in `RelationshipType` union in `canonical.types.ts`:

```typescript
export type RelationshipType =
  // existing
  | 'BUILDS' | 'DEPENDS_ON' | 'DEPLOYS' | 'USES' | 'DEPLOYED_TO'
  | 'CALLS_API' | 'READS_FROM' | 'WRITES_TO'
  // new
  | 'CALLS_SERVICE'    // service-level: consumer → provider (any endpoint)
  | 'SUBSCRIBES_TO'    // queue consumer
  | 'PUBLISHES_TO'     // queue producer
  | 'READS_STORAGE'    // blob/file storage read
  | 'WRITES_STORAGE'   // blob/file storage write
```

---

## Impact Queries (end state)

Once the pipeline runs, these Cypher queries answer the core impact questions:

**"Who calls the api service?"**
```cypher
MATCH (caller:CodeService)-[:CALLS_SERVICE]->(api:CodeService {name: 'api'})
RETURN caller.name
```

**"Exactly which endpoints does ui call on api?"**
```cypher
MATCH (ui:CodeService {name: 'ui'})-[r:CALLS_API]->(api:CodeService {name: 'api'})
RETURN r.method, r.path ORDER BY r.path
```

**"What breaks if neo4j goes down?"**
```cypher
MATCH (s:CodeService)-[:READS_FROM|WRITES_TO]->(r {name: 'neo4j'})
RETURN s.name, [rel IN [(s)-[x]->(r) | type(x)] | x] AS ops
```

**"Which services share the 'indexing' queue?"**
```cypher
MATCH (s:CodeService)-[r:PUBLISHES_TO|SUBSCRIBES_TO]->(q {name: 'indexing'})
RETURN s.name, type(r)
```

**"Full blast radius of a breaking change to api?"**
```cypher
MATCH path = (s)-[:CALLS_SERVICE|CALLS_API*1..3]->(api:CodeService {name: 'api'})
RETURN [n IN nodes(path) | n.name] AS impact_chain
```

---

## Concrete Example: This Repo

### What Pass 2 will produce for `ui` after the changes

```json
{
  "name": "Backend API",
  "type": "api",
  "dataFlow": "outbound",
  "resourceName": "/api",
  "endpoints": [
    "POST /tasks",
    "GET /tasks/:id",
    "GET /tasks",
    "DELETE /tasks/:id",
    "POST /tasks/:id/message",
    "POST /tasks/:id/execute",
    "POST /tasks/:id/runs/:runId/refine-plan",
    "GET /runs/:runId",
    "POST /runs/:runId/cancel",
    "POST /chat",
    "GET /agents",
    "POST /agents",
    "GET /knowledge-base/assets",
    "POST /knowledge-base/scan"
  ],
  "operations": ["read", "write"],
  "evidence": "API_BASE in src/services/api.ts, fetchWithAuth in hooks",
  "purpose": "All data and task operations for the React UI"
}
```

### What ServiceCallCorrelator produces from that

The correlator sees `ui.ExternalDep.endpoints` includes `POST /tasks`, `GET /tasks/:id`, `POST /chat`, `GET /agents` — and finds that `api.ServiceSkeleton.exposedEndpoints` contains exactly those routes.

Score: 14/14 matches → high confidence.

Emits:
```
ui -[:CALLS_SERVICE {score: 14, confidence: 'heuristic'}]-> api
ui -[:CALLS_API {method: 'POST', path: '/tasks'}]-> api
ui -[:CALLS_API {method: 'GET', path: '/tasks/:id'}]-> api
... (one edge per matched endpoint)
```

### What Pass 2 will produce for `api` after the changes

```json
[
  {
    "name": "Neo4j",
    "type": "database",
    "resourceName": "neo4j",
    "operations": ["read", "write"],
    "dataFlow": "bidirectional",
    "evidence": "NEO4J_URI env var, packages/shared/src/persistence/neo4jAdapter.ts"
  },
  {
    "name": "Qdrant",
    "type": "database",
    "resourceName": "qdrant",
    "operations": ["read", "write", "search"],
    "dataFlow": "bidirectional",
    "evidence": "QDRANT_URL env var, packages/shared/src/persistence/qdrantDataAdapter.ts"
  }
]
```

Emitter produces:
```
api -[:READS_FROM {resourceName: 'neo4j'}]-> CloudResource(neo4j)
api -[:WRITES_TO  {resourceName: 'neo4j'}]-> CloudResource(neo4j)
api -[:READS_FROM {resourceName: 'qdrant'}]-> CloudResource(qdrant)
api -[:WRITES_TO  {resourceName: 'qdrant'}]-> CloudResource(qdrant)
```

---

## Implementation Roadmap

### Step 1 — Type changes (no behaviour change, no tests broken)

- [ ] Add `resourceName?`, `endpoints?`, `operations?` to `ExternalDep` in `canonical.types.ts`
- [ ] Add `CALLS_SERVICE`, `SUBSCRIBES_TO`, `PUBLISHES_TO`, `READS_STORAGE`, `WRITES_STORAGE` to `RelationshipType`

**Files:** `packages/shared/src/types/canonical.types.ts`

---

### Step 2 — Update Pass 2 completion tool

- [ ] Extend `ServiceExternalSurfaceCompletionTool.parameters` description to document the three new fields
- [ ] Add validation for `endpoints[]` (type must be 'api', no full URLs, max 20 items) and `operations[]` (enum check)

**Files:** `packages/data-indexer/src/agents/tools/serviceExternalSurfaceCompletionTool.ts`

---

### Step 3 — Update Pass 2 agent instructions

- [ ] Add Step 6 to `SERVICE_EXTERNAL_SURFACE_AGENT.customInstructions`: how to populate `resourceName`, `endpoints`, `operations` with concrete examples
- [ ] For the `api`-type detection step: instruct the agent to read the service's HTTP client file (e.g. `src/services/api.ts`, `src/clients/httpClient.ts`) and collect all URL paths called

**Files:** `packages/data-indexer/src/agents/definitions/serviceExternalSurfaceAgent.ts`

---

### Step 4 — ExternalDep relationship emitter

- [ ] Add `emitExternalDepRelationships()` to `relationship-emitter.ts`
- [ ] Use `dep.operations[]` to select correct relationship type instead of always emitting both READS/WRITES
- [ ] Map `dep.type` → Neo4j `resourceType` for `CloudResource` node creation
- [ ] Skip `type === 'api'` and `type === 'identity'` (handled by correlator and identity boundary, not storage graph)

**Files:** `packages/data-indexer/src/services/static-dependency-extractor/relationship-emitter.ts`

---

### Step 5 — ServiceCallCorrelator

- [ ] Implement `correlateServiceCalls()` with deterministic path-matching algorithm
- [ ] Normalise parameterised paths (`/:id` → `/:param`) before matching
- [ ] Score by number of matching endpoints; require minimum threshold (2 or 30%)
- [ ] Register `ServiceCallCorrelatorAgent` in `DataIndexerAgentRegistry` for disambiguation
- [ ] Fall back to LLM agent when score is ambiguous or `endpoints[]` is empty but `dep.type === 'api'`

**Files:**
- `packages/data-indexer/src/services/service-relationships-extractor/correlators/service-to-service.ts` (new)
- `packages/data-indexer/src/agents/definitions/serviceCallCorrelatorAgent.ts` (new)

---

### Step 6 — Wire Steps 2.5 and 2.6 into SRE pipeline

- [ ] Call `emitExternalDepRelationships()` after Step 2 completes for all services
- [ ] Call `correlateServiceCalls()` after Step 2 as a new Step 2.6
- [ ] Persist inferred `CloudResource` nodes before persisting relationships
- [ ] Log relationship counts for new steps (`[SRE] Step 2.5 — Emitted N dep relationships`)

**Files:** `packages/data-indexer/src/services/service-relationships-extractor/index.ts`

---

## Design Principles

**1. Concrete identifiers are the join keys.**
`name: "Neo4j"` is a label for humans. `resourceName: "neo4j"` is the key the correlator joins on. Two services with the same `resourceName` share a resource. Without `resourceName`, deduplication is name-matching heuristics.

**2. The LLM populates the identifiers; the correlator uses them deterministically.**
Don't ask the LLM to do the join — it's expensive and error-prone. Ask it to extract the concrete values (paths, queue names, DB names) and let deterministic code do the join.

**3. `endpoints[]` is the bridge for service-to-service calls.**
There is no import relationship between `ui` and `api` — they communicate over HTTP. The only join key is: the paths `ui` calls match the paths `api` exposes. `endpoints[]` on `ExternalDep` makes that join possible.

**4. Fail gracefully — missing fields narrow confidence, not correctness.**
If `endpoints[]` is empty, `CALLS_API` edges aren't emitted, but `CALLS_SERVICE` may still be emitted from the LLM fallback. If `resourceName` is missing, the node name falls back to `dep.name`. The graph is always a subset of truth, never a superset.

**5. The existing `emitDependencyRelationships()` (regex-sourced) and new `emitExternalDepRelationships()` (LLM-sourced) are additive.**
Both run; their outputs are merged. The LLM output will catch what regex misses (Qdrant, abstractions); the regex output will have higher determinism for direct SDK calls. Both carry their `extractedBy` tag so confidence can be tracked.
