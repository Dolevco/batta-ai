/**
 * SERVICE_EXTERNAL_SURFACE_AGENT (Pass 2)
 *
 * Reads the config and client files identified in the file map, plus
 * package.json, to exhaustively enumerate the service's full external surface.
 *
 * When the service depends on internal sibling libraries, the agent also reads
 * their package.json and client/connector files to capture transitive external
 * dependencies — unless those libraries were already analysed (in which case
 * their surfaces are injected as structured context in the prompt).
 *
 * Its output (ServiceExternalSurface) is injected as pre-built context into
 * every DFD agent (Pass 4) and the Service DFD Synthesis (Pass 5) so that
 * identity providers, databases, and third-party APIs are never missed.
 *
 * maxIterations: 25 — reads config + client files for this service (3–8 files)
 *                     plus package.json + client files for each unresolved
 *                     sibling library (typically 2–5 more files per library).
 */
import { createReadOnlyFileTools } from '@ai-agent/core';
import { ServiceExternalSurfaceCompletionTool } from '../tools/serviceExternalSurfaceCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const SERVICE_EXTERNAL_SURFACE_AGENT: DataIndexerAgentDefinition = {
  agentType: 'service-external-surface',
  description:
    'Reads config and client files from the file map, plus package.json, and optionally the ' +
    'package.json + client files of unresolved internal sibling libraries, to exhaustively ' +
    'enumerate the full external surface (direct + transitive). Produces a ServiceExternalSurface ' +
    'with a pre-built trust boundary map.',
  whenToUse:
    'Pass 2 of the service analysis pipeline — run after ServiceSkeletonExtractor. ' +
    'Receives the file map (config + client buckets), the skeleton, and pre-computed surfaces ' +
    'of any sibling services already analysed. ' +
    'Output is injected into every DFD agent and the Service DFD Synthesis.',
  maxIterations: 25,
  customInstructions: `Enumerate every external service this service depends on — direct and transitive.

**GOLDEN RULE: dep.name = the SERVICE being called, never the library/package.**
  ✅ "Azure AD", "PostgreSQL", "Stripe API"  ❌ "jwks-rsa", "psycopg2", "stripe"
  Libraries are signals only. If a library could point to multiple services (requests, http),
  only add a dep when you can confirm the actual service from config or client code.

**READ (this service):** config files, client/SDK files from the file map, plus the manifest:
  Node.js→package.json, Python→requirements.txt/pyproject.toml, Go→go.mod,
  Java/Kotlin→pom.xml/build.gradle, Ruby→Gemfile, .NET→*.csproj, Rust→Cargo.toml
**READ (unresolved siblings):** manifest + src/clients|connectors|adapters/* files
**SKIP:** routes, models, tests. For KNOWN siblings use pre-computed surface — don't re-read.
**Locate siblings:** check workspace config (pnpm-workspace.yaml, go.work, pants.toml, etc.)

**DETECTION:**
1. Env/config vars — *_URL, *_API_KEY, *_HOST, *_CONNECTION_STRING, DATABASE_*, REDIS_*,
   AZURE_*, AWS_*, GCP_*, STRIPE_*, OPENAI_*, etc. Each cluster → one dep.
   Also check: appsettings.json, application.yml/properties, .env.*, config.py, config.go.
   evidence = KEY/FIELD NAME only, never the value.
2. Client code + imports — identify the service behind each SDK/library:
   Databases: SQLAlchemy|psycopg2|asyncpg→PostgreSQL, pymongo|mongoose|motor→MongoDB,
     @prisma/client|pg|typeorm→db from env, redis-py|ioredis|redis→Redis,
     neo4j-driver→Neo4j, Hibernate|JDBC→db from config
   Queues: pika|aio-pika→RabbitMQ, kafka-python|kafkajs|confluent-kafka→Kafka,
     @azure/service-bus|azure.servicebus→Azure Service Bus, amqplib|celery→broker from env
   Storage: boto3 s3|@aws-sdk/s3→S3, @azure/storage-blob|azure.storage.blob→Azure Blob,
     google-cloud-storage→GCS
   Identity: msal|@azure/identity|python-jose|jwks-rsa|passport-azure-ad→IdP from env (Azure AD),
     auth0-python|@auth0/*|python-jose+AUTH0_DOMAIN→Auth0,
     python-keycloak|keycloak-js→Keycloak, google-auth|passport-google→Google
   APIs: openai|openai-python→"OpenAI API", anthropic→"Anthropic API",
     stripe|stripe-python→"Stripe API", sendgrid|@sendgrid/mail→"SendGrid"
3. Manifest — signal only for anything missed above. Same naming rule applies.
4. Siblings — apply same logic. Deduplicate against steps 1–3.

**OUTPUT — ExternalDep fields:**
- name: the service name (see golden rule above)
- type: api | identity | database | cache | queue | storage | cloud | other
- dataFlow: inbound | outbound | bidirectional
- dataClassification: public | internal | confidential | restricted
- protocol: transport used — HTTPS, gRPC, AMQP, TCP, etc.
- purpose: one sentence — what this service uses it for
- businessValue: why it matters to the business
- evidence: KEY/FIELD NAMES or import paths — NEVER actual values or secrets
- resourceName (optional but important for correlation):
    database/cache → db or schema name (e.g. "neo4j", "redis")
    queue → topic/queue name (e.g. "indexing")
    storage → bucket/container name
    api → base path prefix (e.g. "/api"), NOT hostname
- endpoints (api only): 5–15 parameterized paths ("GET /tasks/:id", "POST /tasks")
- operations: database→read|write|search, cache→read|write, queue→publish|subscribe,
              storage→read|write, api→read|write

**trustBoundaryMap** — place each dep.name in exactly one zone:
- IDENTITY: identity/auth providers (Azure AD, Auth0, Okta, Cognito, Google, Keycloak)
- DATA: databases, caches, queues, blob/file storage (PostgreSQL, Redis, S3, etc.)
- EXTERNAL: third-party SaaS APIs outside your control (Stripe, SendGrid, OpenAI, etc.)
- INTERNET: internet-facing ingress in front of this service (API Gateway, CDN, load balancer)
- SERVICE: internal peer microservices this service calls at runtime

Call complete_service_external_surface when done. Fix validation errors and retry.`,
  completionToolFactory: () => new ServiceExternalSurfaceCompletionTool(),
  toolsFactory: (workspacePath: string) => createReadOnlyFileTools({ workspacePath }),
};
