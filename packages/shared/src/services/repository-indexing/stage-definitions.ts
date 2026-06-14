import type { RepositoryIndexingStage } from '../../types/repository-indexing.types';

export interface StageDefinition {
  stage: RepositoryIndexingStage;
  instructions: string;
  questions: string[];
  inspect: string[];
  requiredOutputSchema: Record<string, unknown>;
}

const INVENTORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['name', 'languages', 'frameworks', 'buildTools', 'packageManagers', 'serviceCandidates', 'entryPointCandidates', 'importantDirectories', 'summary', 'evidence'],
  properties: {
    name: { type: 'string', description: 'Repository name' },
    url: { type: 'string', description: 'Repository URL or remote origin' },
    defaultBranch: { type: 'string', description: 'Default branch name' },
    languages: { type: 'array', items: { type: 'string' }, description: 'Primary programming languages' },
    frameworks: { type: 'array', items: { type: 'string' }, description: 'Frameworks and runtimes' },
    buildTools: { type: 'array', items: { type: 'string' }, description: 'Build and packaging tools' },
    packageManagers: { type: 'array', items: { type: 'string' }, description: 'Package managers in use' },
    serviceCandidates: { type: 'array', items: { type: 'string' }, description: 'Names of apps/packages/services discovered' },
    entryPointCandidates: { type: 'array', items: { type: 'string' }, description: 'Entry point file paths' },
    importantDirectories: { type: 'array', items: { type: 'string' }, description: 'Key directories' },
    deploymentArtifacts: { type: 'array', items: { type: 'string' }, description: 'Deployment artifact paths (Dockerfiles, k8s, bicep)' },
    buildArtifacts: { type: 'array', items: { type: 'string' }, description: 'Build artifact paths' },
    architecturalPatterns: { type: 'array', items: { type: 'string' }, description: 'High-level architectural patterns observed' },
    deploymentTargets: { type: 'array', items: { type: 'string' }, description: 'Deployment targets or cloud providers detected' },
    summary: { type: 'string', description: '1-3 sentence description of what the repository delivers end-to-end' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        required: ['filePath', 'rationale'],
        properties: {
          filePath: { type: 'string' },
          lineStart: { type: 'number' },
          lineEnd: { type: 'number' },
          symbol: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
  },
  additionalProperties: false,
};

const SERVICE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['services'],
  properties: {
    services: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'serviceType', 'codePath', 'language', 'techStack', 'responsibility', 'businessValue', 'entryPointTypes', 'evidence'],
        properties: {
          name: { type: 'string' },
          serviceType: { type: 'string', enum: ['api', 'library', 'worker', 'other'] },
          codePath: { type: 'string' },
          language: { type: 'string' },
          techStack: { type: 'array', items: { type: 'string' } },
          responsibility: { type: 'string' },
          businessValue: { type: 'string' },
          entryPointTypes: { type: 'array', items: { type: 'string' } },
          exposedEndpoints: {
            type: 'array',
            items: {
              type: 'object',
              required: ['method', 'path', 'file'],
              properties: {
                method: { type: 'string' },
                path: { type: 'string' },
                file: { type: 'string' },
              },
            },
          },
          authBoundaries: { type: 'array', items: { type: 'string' } },
          dataStores: { type: 'array', items: { type: 'string' } },
          externalDependencies: { type: 'array', items: { type: 'object' } },
          internalDependencies: { type: 'array', items: { type: 'string' } },
          priorityFiles: { type: 'array', items: { type: 'string' } },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              required: ['filePath', 'rationale'],
              properties: {
                filePath: { type: 'string' },
                lineStart: { type: 'number' },
                lineEnd: { type: 'number' },
                symbol: { type: 'string' },
                rationale: { type: 'string' },
              },
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
};

const FEATURE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['features'],
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description', 'businessValue', 'userStories', 'technicalSummary', 'sourceServiceNames', 'routeEvidence'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          businessValue: { type: 'string' },
          userStories: { type: 'array', items: { type: 'string' } },
          technicalSummary: { type: 'string' },
          sourceServiceNames: { type: 'array', items: { type: 'string' } },
          routeEvidence: { type: 'array', items: { type: 'object' } },
          correlationTags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  },
};

const TRUST_BOUNDARY_ENUM = { type: 'string', enum: ['INTERNET', 'IDENTITY', 'SERVICE', 'DATA', 'EXTERNAL'] };

const STRIDE_THREAT_ITEM: Record<string, unknown> = {
  type: 'object',
  required: ['id', 'title', 'category', 'description', 'affectedComponents', 'affectedFlows', 'severity', 'likelihoodScore', 'impactScore', 'mitigations', 'status'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string', enum: ['Spoofing', 'Tampering', 'Repudiation', 'InformationDisclosure', 'DenialOfService', 'ElevationOfPrivilege'] },
    description: { type: 'string' },
    affectedComponents: { type: 'array', items: { type: 'string' } },
    affectedFlows: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    likelihoodScore: { type: 'number' },
    impactScore: { type: 'number' },
    mitigations: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['identified', 'mitigated', 'accepted', 'transferred'] },
    cvssVector: { type: 'string' },
  },
};

const FEATURE_THREAT_MODEL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['strideThreats', 'trustBoundaryAnalysis', 'dataClassificationSummary', 'overallRiskScore', 'complianceConsiderations', 'attackVectors', 'securityRecommendations'],
  properties: {
    strideThreats: { type: 'array', items: STRIDE_THREAT_ITEM },
    trustBoundaryAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'crossingFlows', 'controlsRequired', 'controlsInPlace', 'riskRating'],
        properties: {
          name: { type: 'string' },
          crossingFlows: { type: 'array', items: { type: 'string' } },
          controlsRequired: { type: 'array', items: { type: 'string' } },
          controlsInPlace: { type: 'array', items: { type: 'string' } },
          riskRating: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
        },
      },
    },
    dataClassificationSummary: { type: 'array', items: { type: 'object' } },
    overallRiskScore: { type: 'number', minimum: 0, maximum: 100 },
    complianceConsiderations: { type: 'array', items: { type: 'string' } },
    attackVectors: { type: 'array', items: { type: 'string' } },
    securityRecommendations: { type: 'array', items: { type: 'string' } },
  },
};

const DATA_CLASSIFICATION_ENUM = { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted'] };

const DFD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['dfds'],
  properties: {
    dfds: {
      type: 'array',
      items: {
        type: 'object',
        required: ['featureName', 'dataFlowDiagram'],
        properties: {
          featureName: { type: 'string' },
          dataFlowDiagram: {
            type: 'object',
            required: ['actors', 'processes', 'dataStores', 'flows', 'trustBoundaries'],
            properties: {
              actors: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'label', 'type', 'trusted'],
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    type: { type: 'string', enum: ['external_user', 'internal_service', 'admin', 'system', 'third_party'] },
                    trusted: { type: 'boolean', description: 'true = inside the system trust boundary; false = external (user, third party)' },
                    trustBoundary: TRUST_BOUNDARY_ENUM,
                    correlationTags: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
              processes: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'label', 'type'],
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    type: { type: 'string', enum: ['entry_point', 'input_validation', 'authorization', 'business_logic', 'data_access', 'external_call', 'response_builder', 'event_publisher'] },
                    trustBoundary: TRUST_BOUNDARY_ENUM,
                    serviceId: { type: 'string' },
                    correlationTags: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
              dataStores: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'label', 'type', 'dataClassification', 'encryptionAtRest'],
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    type: { type: 'string', enum: ['database', 'cache', 'blob_storage', 'queue', 'file_system', 'other'] },
                    dataClassification: DATA_CLASSIFICATION_ENUM,
                    encryptionAtRest: { type: 'boolean' },
                    trustBoundary: TRUST_BOUNDARY_ENUM,
                    correlationTags: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
              flows: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'from', 'to', 'label', 'dataTypes', 'dataClassification', 'direction', 'protocol', 'encrypted', 'authenticationRequired', 'crossesTrustBoundary', 'branch', 'async'],
                  properties: {
                    id: { type: 'string' },
                    from: { type: 'string' },
                    to: { type: 'string' },
                    label: { type: 'string' },
                    dataTypes: { type: 'array', items: { type: 'string' }, description: 'Human-readable data type names on this edge, e.g. ["JWT token", "user profile"]' },
                    dataClassification: DATA_CLASSIFICATION_ENUM,
                    direction: { type: 'string', enum: ['inbound', 'outbound', 'bidirectional'] },
                    protocol: { type: 'string' },
                    encrypted: { type: 'boolean' },
                    authenticationRequired: { type: 'boolean' },
                    crossesTrustBoundary: { type: 'boolean' },
                    branch: { type: 'string', enum: ['happy_path', 'error_path', 'both'] },
                    async: { type: 'boolean' },
                  },
                },
              },
              trustBoundaries: {
                type: 'array',
                items: TRUST_BOUNDARY_ENUM,
                description: 'Array of trust boundary type strings: INTERNET | IDENTITY | SERVICE | DATA | EXTERNAL',
              },
            },
          },
          evidence: { type: 'array' },
        },
      },
    },
  },
};

const THREAT_MODEL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['threatModels'],
  properties: {
    threatModels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['featureName', 'featureThreatModel', 'serviceThreatModels'],
        properties: {
          featureName: { type: 'string' },
          featureThreatModel: FEATURE_THREAT_MODEL_SCHEMA,
          serviceThreatModels: {
            type: 'array',
            items: {
              type: 'object',
              required: ['serviceName', 'threatModel', 'serviceDfd'],
              properties: {
                serviceName: { type: 'string' },
                threatModel: FEATURE_THREAT_MODEL_SCHEMA,
                serviceDfd: {
                  type: 'object',
                  required: ['dataFlowDiagram', 'featuresCovered', 'reasoning', 'generatedAt'],
                  properties: {
                    dataFlowDiagram: { type: 'object' },
                    featuresCovered: { type: 'array', items: { type: 'string' } },
                    reasoning: { type: 'string' },
                    generatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const RELATIONSHIP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['relationships'],
  properties: {
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sourceKey', 'targetKey', 'relationshipType', 'confidence', 'rationale'],
        properties: {
          sourceKey: { type: 'string', description: 'Natural key or canonical ID of the source entity' },
          targetKey: { type: 'string', description: 'Natural key or canonical ID of the target entity' },
          relationshipType: { type: 'string' },
          confidence: { type: 'string', enum: ['deterministic', 'manual', 'heuristic'] },
          rationale: { type: 'string' },
          evidence: { type: 'array' },
        },
      },
    },
  },
};

const COMPLETENESS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    notes: { type: 'string', description: 'Optional notes about the completeness check' },
    acceptedGaps: { type: 'array', items: { type: 'string' }, description: 'Gap IDs explicitly accepted by the agent' },
  },
  additionalProperties: false,
};

export const STAGE_DEFINITIONS: Record<RepositoryIndexingStage, StageDefinition> = {
  repository_inventory: {
    stage: 'repository_inventory',
    instructions: `
## Stage: Repository Inventory

Discover the top-level structure of this repository.

Your goal is to produce a structured inventory that captures:
- Repository name and URL
- Primary languages and frameworks
- Build tools and package managers
- Candidate services or packages (names only, no full analysis yet)
- Key entry point files
- Important directories (src, packages, apps, infra, etc.)
- Deployment artifacts (Dockerfiles, Bicep, Terraform, Kubernetes manifests)
- Build artifacts (CI configs, Makefiles, Docker Compose)
- Architectural patterns at the repository level (monorepo, microservices, etc.)
- Deployment targets (Azure, AWS, GCP, Docker, etc.)

**Rules:**
- Do NOT include actual secret values — paths, env var names, and config key names only.
- Evidence file paths must be relative to the repository root.
- Do not fabricate data you have not verified from actual files.

Submit with: \`{ "stage": "repository_inventory", "inventory": { ... } }\`
`.trim(),
    questions: [
      'What is the primary purpose of this repository?',
      'Is this a monorepo or a single-service repository?',
      'What are the main packages or services in this repo?',
      'What deployment platform(s) are targeted?',
    ],
    inspect: [
      'package.json / pnpm-workspace.yaml / lerna.json at root',
      'Dockerfile(s) and docker-compose files',
      'README.md',
      'Any .github/workflows or CI configuration files',
      'Bicep / Terraform / Kubernetes manifests',
      'Top-level directory listing',
    ],
    requiredOutputSchema: { stage: 'repository_inventory', inventory: INVENTORY_SCHEMA },
  },

  service_extraction: {
    stage: 'service_extraction',
    instructions: `
## Stage: Service Extraction

For each deployable service discovered during inventory, produce a detailed service context.

A "service" is any independently deployable unit: an API, a background worker, a scheduled job, a frontend app.
Libraries are included only if they expose a significant security surface.

For each service, capture:
- Name (matching the service candidate from inventory)
- Service type: api | library | worker | other
- Code path (relative to repo root)
- Primary language
- Tech stack (frameworks, ORMs, runtimes)
- Responsibility (1-3 sentence business description)
- Business value
- Entry point types (http | queue | cron | cli | other)
- Exposed HTTP endpoints (method, path, file) — parameterized paths only
- Auth boundaries (e.g., "JWT verified at middleware layer")
- Data stores accessed (logical names, e.g., "PostgreSQL", "Redis")
- External dependencies (typed, with protocol, purpose, data flow)
- Internal dependencies (names of sibling services called)
- Priority files (most security-relevant files for downstream analysis)
- Evidence refs linking claims to specific files

**Rules:**
- No secret values. Env var names, config key names, import paths only.
- Evidence paths must be relative to the repository root.
- Exposed endpoints: parameterized forms (/:id) not concrete IDs.
`.trim(),
    questions: [
      'Which services expose external HTTP endpoints?',
      'Which services handle authentication or authorization?',
      'Which services interact with sensitive data stores?',
      'Are there any background workers or queue consumers?',
    ],
    inspect: [
      'Each service\'s entry point file (index.ts, main.ts, app.ts, server.ts)',
      'Route / controller files',
      'Middleware / auth configuration',
      'Database connection or ORM configuration',
      'Environment variable references (.env.example, config files)',
      'package.json dependencies per service',
    ],
    requiredOutputSchema: SERVICE_SCHEMA,
  },

  feature_extraction: {
    stage: 'feature_extraction',
    instructions: `
## Stage: Feature Extraction

Identify the meaningful business/user features implemented across the services.

A "feature" is a distinct capability that a user or system can invoke — not a code module.
Examples: "User Authentication", "Payment Processing", "File Upload", "Report Generation".

For each feature, capture:
- Name (short, business-oriented)
- Description (one paragraph, business-value oriented)
- Business value (who benefits and how)
- User stories (1-5 as-a/I-want/so-that statements)
- Technical summary (how it is implemented across services)
- Source service names (which services implement this feature)
- Route evidence (HTTP endpoints, file paths, or CLI commands that implement this feature)
- Correlation tags (keywords for entity matching: service names, table names, queue names)

**Rules:**
- Do NOT produce DFDs yet — that is the next stage.
- Feature names should be stable business concepts, not implementation details.
- Each feature should map to at least one service.
- Avoid redundant features — prefer merging related flows.
`.trim(),
    questions: [
      'What are the core user-facing capabilities of this system?',
      'Are there administrative or background features distinct from user-facing ones?',
      'Are there integration-facing features (webhooks, APIs consumed by partners)?',
    ],
    inspect: [
      'Route files and controller handlers',
      'Service layer method names and JSDoc',
      'README feature documentation',
      'OpenAPI / Swagger specs if present',
      'Queue consumer handlers',
    ],
    requiredOutputSchema: FEATURE_SCHEMA,
  },

  dfd_creation: {
    stage: 'dfd_creation',
    instructions: `
## Stage: DFD Creation

For each feature identified in the previous stage, produce a feature-level Data Flow Diagram (DFD).

A feature DFD models the security-relevant data flow for one business feature:
- Actors: who initiates or receives data (external_user, internal_service, admin, system, third_party)
- Processes: coarse capability/responsibility nodes using these types: entry_point, input_validation, authorization, business_logic, data_access, external_call, response_builder, event_publisher
- Data Stores: persistent storage nodes (database, cache, blob_storage, queue, file_system, other)
- Flows: directed data movements between nodes — ordered from first to last step so the diagram can be played back as an animation
- Trust Boundaries: INTERNET | IDENTITY | SERVICE | DATA | EXTERNAL

**Granularity rules — default to coarse:**
- The primary error is too many nodes. When uncertain, merge.
- Merge into one process node everything that runs inside the same service process, serves the same user-facing capability end-to-end, and has no independent external dependency.
- A feature that does "receive → validate → authorize → compute → respond" is typically one process node, not five.
- Split process nodes only when a stage runs in a genuinely separate service/worker/container, or when it has its own independent connection to a different external system such as a different database, queue, identity provider, or third-party API.
- Target 2-5 process nodes per feature DFD. More than 6 process nodes is a signal to consolidate before submitting.

**Actor rules:**
- trusted: true for actors inside your system boundary (internal services, workers); false for external actors (users, third-party APIs, browsers).
- Actors are external systems or humans that trigger or receive data. Do not model internal subcomponents, framework components, or deployment infrastructure as actors.

**Process rules:**
- Label processes by what business capability or security responsibility they perform, not by code symbols.
- Do not create process nodes for controllers, route handlers, middleware, decorators, classes, functions, ORM calls, repositories, utility helpers, loggers, or framework internals.
- Do not model in-process function calls as process-to-process edges. If two steps live in the same service process and do not cross a real boundary, merge them.

**Data store rules:**
- dataClassification: public | internal | confidential | restricted
- encryptionAtRest: true/false
- Use one node per persistent/shared storage system, not per table, collection, entity, in-memory variable, or ORM model.
- Model queues/topics as dataStores with type "queue" only when the feature actually publishes to or consumes from them.

**Flow rules (all fields required for playback):**
- from/to must reference valid actor, process, or dataStore IDs in this DFD.
- dataTypes: array of human-readable data type names flowing on this edge, e.g. ["JWT token", "user profile", "review result"]
- dataClassification: public | internal | confidential | restricted (highest classification of data on this edge)
- direction: inbound | outbound | bidirectional (relative to the system boundary)
- protocol: the transport protocol (HTTPS, gRPC, AMQP, SQL, Redis, etc.)
- encrypted: true/false
- authenticationRequired: true/false
- crossesTrustBoundary: true when the flow crosses a trust boundary type
- branch: happy_path | error_path | both
- async: true for queue handoffs, false for synchronous calls
- **Order flows in execution order** — the diagram plays them back as an animation step-by-step.
- Create a flow only when data crosses a real boundary: network, persistent storage, queue/event broker, third-party system, identity provider, or trust zone.
- Flow labels should describe data transformation or movement, e.g. "validated credentials", "persisted review result", "published audit event"; not function names, HTTP method strings, ORM calls, or framework hook names.

**ID rules:**
- All IDs must be lowercase kebab-case, unique within the DFD.
- Do not reuse IDs across actors, processes, and dataStores.

Evidence refs should point to the source files where each flow is implemented.
Before submitting, self-check that every process node is a named capability/responsibility, no label is a class/function/controller name, and all internal implementation steps that do not cross boundaries have been merged.
`.trim(),
    questions: [
      'Does any flow skip authentication that should require it?',
      'Are there flows that handle sensitive data classifications?',
      'Are there asynchronous queue flows that need to be modelled separately?',
    ],
    inspect: [
      'Route handler implementations (as evidence for entry points, not as DFD nodes)',
      'Middleware/auth chain for each entry point (as evidence for trust/auth boundaries, not as DFD nodes)',
      'Database query layers (as evidence for storage flows, not as DFD nodes)',
      'External HTTP client calls (as evidence for external flows)',
      'Queue publish/consume code (as evidence for async queue flows)',
    ],
    requiredOutputSchema: DFD_SCHEMA,
  },

  threat_model_creation: {
    stage: 'threat_model_creation',
    instructions: `
## Stage: Threat Model Creation

Apply STRIDE threat analysis to each feature DFD and produce service-level threat models.

For each feature:
- Enumerate STRIDE threats (Spoofing, Tampering, Repudiation, InformationDisclosure, DenialOfService, ElevationOfPrivilege)
- Reference affected DFD node IDs and flow IDs (must exist in the DFD you created)
- Assign severity: critical | high | medium | low | info
- Provide likelihood (1-5) and impact (1-5) scores
- List concrete mitigations (specific controls, not generic advice)
- Perform trust boundary analysis for each boundary type crossed
- Summarize data classifications handled
- Note compliance considerations (GDPR, SOC2, PCI, HIPAA if applicable)

For each non-library service:
- Produce a service-level threat model by merging feature threat models for that service
- Produce a service-level DFD that merges the feature DFDs for that service — include featuresCovered (feature names), reasoning (merge rationale), and generatedAt (ISO 8601 timestamp)
- The service-level DFD must answer "How does this service fit into the world around it?"
- The service-level DFD must be architectural: one process node per independently deployable service/microservice/container. The service being modeled is itself one process node.
- Service-level actors are external entities only: human personas, identity providers, monitoring agents, API gateways/CDNs/load balancers, peer services that call into this service, or third-party SaaS/webhook callers.
- Service-level dataStores are storage systems only, one node per system. Do not split by table, collection, topic, repository, or ORM model.
- Service-level flows should have exactly one flow per from/to pair. Merge all data types and labels between the same two nodes into one summarized edge.
- Do not include controllers, route handlers, middleware, modules, helper classes, internal workers within the same process, or per-feature subgraphs in the service-level DFD.

**Rules:**
- affectedComponents must reference valid actor/process/dataStore IDs.
- affectedFlows must reference valid flow IDs from the same DFD.
- Do not fabricate CVE IDs; use a descriptive threat ID format: T-FEATURESHORT-001.
`.trim(),
    questions: [
      'Are there unauthenticated endpoints that handle sensitive data?',
      'Are there flows where data is not encrypted in transit?',
      'Are there privilege escalation paths in the authorization logic?',
      'Are there denial-of-service vectors in the exposed entry points?',
    ],
    inspect: [
      'Authentication and authorization middleware',
      'Input validation logic',
      'Error handling and logging',
      'Rate limiting configuration',
      'CORS configuration',
    ],
    requiredOutputSchema: THREAT_MODEL_SCHEMA,
  },

  relationship_correlation: {
    stage: 'relationship_correlation',
    instructions: `
## Stage: Relationship Correlation

Produce explicit relationships between the canonical entities you have indexed.

Relationship types to consider:
- CONTAINS: repository → service, service → module
- DEPENDS_ON: service → service (internal), service → external dep
- IMPLEMENTS_FEATURE: service → feature
- READS_FROM_STORE / WRITES_TO_STORE / ACCESSES_STORE: service → data store
- CALLS_API: service → service (specific endpoint)
- PUBLISHES_TO / SUBSCRIBES_TO: service → queue/topic

For each relationship:
- sourceKey: natural key (service name, feature name) or canonical ID if known
- targetKey: natural key or canonical ID of the target
- relationshipType: one of the types above
- confidence: deterministic | manual | heuristic
- rationale: why this relationship exists
- evidence: file paths / line numbers proving it

**Rules:**
- Unknown targets should be listed as gaps, not created as fabricated entities.
- Only include relationships you can evidence — do not guess.
`.trim(),
    questions: [
      'Are there internal service-to-service calls not yet captured?',
      'Are there shared data stores accessed by multiple services?',
      'Are there event-driven relationships via queues or message brokers?',
    ],
    inspect: [
      'HTTP client configurations and base URLs',
      'Queue producer/consumer configurations',
      'Shared database connection strings (env var names)',
      'Internal package imports across service boundaries',
    ],
    requiredOutputSchema: RELATIONSHIP_SCHEMA,
  },

  completeness_check: {
    stage: 'completeness_check',
    instructions: `
## Stage: Completeness Check

Verify that the repository is indexed sufficiently for security reviews.

Minimum requirements:
- One repository entity exists
- At least one service exists
- Each non-library service has: responsibility, entry points, auth/persistence/dependency context, and evidence
- At least one feature exists for product repos (unless library-only)
- Reviewable features have a DFD and threat model
- Service-level DFD exists for each non-library service

If all requirements are met, submit with empty acceptedGaps to complete indexing.
If gaps exist that cannot be filled, list the gap IDs in acceptedGaps with a note.

Submit with: \`{ "stage": "completeness_check", "notes": "...", "acceptedGaps": ["gap-id-1"] }\`
`.trim(),
    questions: [
      'Are there services without a DFD or threat model?',
      'Are there features without evidence refs?',
      'Are there unexplained gaps in the relationship graph?',
    ],
    inspect: [
      'Indexing coverage summary returned by get_indexing_status',
      'Any high-severity gaps in the coverage report',
    ],
    requiredOutputSchema: COMPLETENESS_SCHEMA,
  },

  completed: {
    stage: 'completed',
    instructions: 'Indexing is complete. Call get_indexing_status to see full coverage.',
    questions: [],
    inspect: [],
    requiredOutputSchema: {},
  },
};

export const STAGE_ORDER: RepositoryIndexingStage[] = [
  'repository_inventory',
  'service_extraction',
  'feature_extraction',
  'dfd_creation',
  'threat_model_creation',
  'relationship_correlation',
  'completeness_check',
  'completed',
];

export function nextStage(current: RepositoryIndexingStage): RepositoryIndexingStage {
  const idx = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
}
