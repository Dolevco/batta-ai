# Architecture & Security Threat Model

> **Generated:** 2026-03-02  
> **Scope:** All six packages — `api`, `core`, `data-indexer`, `shared`, `ui`, `worker`  
> **Method:** Source-code structural analysis + data-flow tracing + STRIDE threat modelling

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Service: API (`packages/api`)](#2-service-api)
   - [Feature 1 – Conversational AI Chat](#feature-1--conversational-ai-chat)
   - [Feature 2 – Autonomous Task Planning & Execution](#feature-2--autonomous-task-planning--execution)
   - [Feature 3 – Security Review Lifecycle (MCP)](#feature-3--security-review-lifecycle-mcp)
   - [Feature 4 – Integration Management (GitHub / Slack / Defender)](#feature-4--integration-management-github--slack--defender)
   - [Feature 5 – Knowledge-Base Scan Trigger](#feature-5--knowledge-base-scan-trigger)
3. [Service: Core (`packages/core`)](#3-service-core)
   - [Feature 1 – LLM Task Orchestration](#feature-1--llm-task-orchestration)
   - [Feature 2 – Hierarchical Tool Dispatch](#feature-2--hierarchical-tool-dispatch)
   - [Feature 3 – Long-Term Agent Memory](#feature-3--long-term-agent-memory)
4. [Service: Data Indexer (`packages/data-indexer`)](#4-service-data-indexer)
   - [Feature 1 – Repository Discovery & Code Indexing](#feature-1--repository-discovery--code-indexing)
   - [Feature 2 – Cloud Resource Discovery](#feature-2--cloud-resource-discovery)
   - [Feature 3 – LLM-Driven Security Correlation](#feature-3--llm-driven-security-correlation)
   - [Feature 4 – Vulnerability Impact Analysis](#feature-4--vulnerability-impact-analysis)
5. [Service: Shared (`packages/shared`)](#5-service-shared)
   - [Feature 1 – Multi-Tenant Persistence (Qdrant + Neo4j)](#feature-1--multi-tenant-persistence-qdrant--neo4j)
   - [Feature 2 – Security Review Service](#feature-2--security-review-service)
   - [Feature 3 – Asset Inventory & Relationship Graph](#feature-3--asset-inventory--relationship-graph)
6. [Service: Worker (`packages/worker`)](#6-service-worker)
   - [Feature 1 – Background Task Execution](#feature-1--background-task-execution)
   - [Feature 2 – Worker Lifecycle & Cancellation](#feature-2--worker-lifecycle--cancellation)
7. [Service: UI (`packages/ui`)](#7-service-ui)
   - [Feature 1 – Security Knowledge Base Explorer](#feature-1--security-knowledge-base-explorer)
   - [Feature 2 – Task & Agent Management Console](#feature-2--task--agent-management-console)
   - [Feature 3 – Security Review Dashboard](#feature-3--security-review-dashboard)
8. [Cross-Cutting Trust Boundaries](#8-cross-cutting-trust-boundaries)
9. [Data Classification Registry](#9-data-classification-registry)
10. [Consolidated Threat Matrix](#10-consolidated-threat-matrix)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  INTERNET / EXTERNAL BOUNDARY                                           │
│                                                                         │
│  ┌─────────┐   HTTPS/JWT    ┌──────────────────────────────────────┐   │
│  │  User   │───────────────▶│  UI  (React / Vite / nginx)          │   │
│  │ Browser │◀───────────────│  :443 (nginx TLS termination)        │   │
│  └─────────┘                └──────────────┬───────────────────────┘   │
│                                            │ REST + SSE (Bearer JWT)   │
│  ┌──────────┐  OAuth2/PKCE  ┌─────────────▼───────────────────────┐   │
│  │ Entra ID │◀─────────────▶│  API  (Express + MCP endpoint)       │   │
│  │ (Azure)  │               │  :3001 — JWT RS256 verified           │   │
│  └──────────┘               └──┬──────────┬──────────┬────────────┘   │
│                                │          │          │                  │
└────────────────────────────────┼──────────┼──────────┼──────────────────┘
                                 │          │          │
        INTERNAL / TRUSTED ZONE  │          │          │
                                 │          │          │
             ┌───────────────────▼┐  ┌──────▼──────┐  │
             │  Azure OpenAI      │  │   Redis      │  │
             │  (LLM calls)       │  │   :6379      │  │
             └───────────────────┘  └──────┬──────┘  │
                                           │          │
              ┌────────────────────────────▼─┐        │
              │  Worker  (Node.js container)  │◀───────┘ Spawn / enqueue
              │  Picks job from Redis queue   │
              └────────────┬─────────────────┘
                           │ writes results
              ┌────────────▼──────────────────┐
              │  Data Indexer  (pipeline)      │
              │  GitHub → code/cloud scan      │
              └──────┬───────────┬────────────┘
                     │           │
             ┌───────▼──┐  ┌─────▼──────┐
             │  Qdrant   │  │  Neo4j     │
             │ (vectors) │  │ (graph)    │
             └───────────┘  └────────────┘
```

### Infrastructure Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Identity Provider | Microsoft Entra ID | PKCE OAuth2; RS256 JWT issued by Entra |
| API Gateway | Express.js + nginx | JWT verified per request |
| Task Queue | Redis 7 | `allkeys-lru`; ephemeral – no sensitive data |
| Vector DB | Qdrant | All collections tenant-scoped; no auth by default |
| Graph DB | Neo4j 5 | Tenant isolation via `tenantId` property on every node |
| LLM | Azure OpenAI | API key auth; calls never include raw user passwords |
| Container Runtime | Docker / Azure Container Apps | Worker containers are ephemeral |

---

## 2. Service: API (`packages/api`)

The API is the single public-facing backend. Every HTTP route (except `GET /health`) is behind `authMiddleware`, which validates an RS256 JWT issued by Entra ID and populates `req.auth.tenantId`.

---

### Feature 1 – Conversational AI Chat

**Business value:** Lets operators ask natural-language security questions ("Which services are internet-exposed?") and receive streamed, context-aware answers backed by the organisation's live security graph.

#### Data Flow Diagram

```
User (Browser)
  │
  │  POST /api/chat  { message, conversationHistory }
  │  Authorization: Bearer <JWT>
  ▼
┌─────────────────────────────────────────────────────────┐
│  API  – chatController.ts                               │
│                                                         │
│  1. authMiddleware – validate JWT, extract tenantId     │
│  2. Validate: message is non-empty string               │
│  3. Open SSE stream (text/event-stream)                 │
│  4. Instantiate AzureOpenAIClient (env vars)            │
│  5. createChatTask() – builds HierarchicalTask with:    │
│       • task-query tools (list tasks, runs, plans)      │
│       • security-query tools (graph, vulnerabilities)   │
│       • chat-complete tool                              │
│  6. task.execute(message)                               │
│       ├──▶ Azure OpenAI  (LLM completion)               │
│       │     ◀── token stream                            │
│       └──▶ SecurityQueryTools / TaskQueryTools          │
│             └──▶ Qdrant + Neo4j (read-only queries)     │
│  7. Emit SSE events: tool_use, stream_chunk, graph      │
└─────────────────────────────────────────────────────────┘
  │
  │  SSE events → Browser renders streaming response
  ▼
User (Browser)
```

**Data sensitivity at each hop:**

| Hop | Data | Classification |
|-----|------|----------------|
| Browser → API | User message, conversation history | Internal |
| API → Azure OpenAI | User message + system prompt + tool results | Confidential |
| API → Qdrant | Vector similarity queries (embeddings, tenant-scoped filters) | Internal |
| API → Neo4j | Cypher read queries scoped to `tenantId` | Internal |
| API → Browser (SSE) | LLM token stream, graph JSON | Internal |

#### Threat Model

| # | Threat (STRIDE) | Attack vector | Severity | Mitigation | Residual risk |
|---|----------------|--------------|----------|-----------|---------------|
| C1-1 | **Spoofing** – Attacker forges JWT to impersonate another tenant | Bearer token in `Authorization` header | Critical | `authMiddleware` validates RS256 signature + issuer against Entra JWKS; `tenantId` extracted exclusively from JWT claims | Low – only broken if Entra private key is compromised |
| C1-2 | **Information Disclosure** – Prompt injection: user crafts message that forces LLM to exfiltrate another tenant's data | User message injected into LLM prompt | High | `tenantId` is injected via system prompt and all graph queries are tenant-scoped; LLM response is streamed directly, not re-executed as code | Medium – LLM output is not deterministically bounded; output should be reviewed |
| C1-3 | **Tampering** – Malicious `conversationHistory` in request body used to poison LLM context | Request body | Medium | History is passed as messages only; it does not modify tenantId or tool parameters | Low |
| C1-4 | **Denial of Service** – Flood of expensive LLM requests per tenant | POST /api/chat | High | No per-tenant rate limiting exists today | **High (open)** – rate limiting not implemented |
| C1-5 | **Information Disclosure** – Azure OpenAI API key leakage via logs | Server logs | High | API key is in env var; `console.error` on LLM exceptions should not print full request bodies | Medium – log sanitisation not formally enforced |

**Trust boundaries crossed:** Internet ↔ API (JWT required), API ↔ Azure OpenAI (API key), API ↔ Qdrant/Neo4j (no auth in default docker-compose).

---

### Feature 2 – Autonomous Task Planning & Execution

**Business value:** Operators define a high-level security objective ("Fix all critical Defender findings in the payments service") and the platform autonomously generates a multi-step plan, spawns an isolated worker container, and executes the plan using configured tools—optionally including code-writing, PR creation, and Slack notifications.

#### Data Flow Diagram

```
User (Browser)
  │
  │  POST /api/tasks  { description, agentId, tools, chatHistory }
  │  Authorization: Bearer <JWT>
  ▼
┌─────────────────────────────────────────────────────────┐
│  API  – taskController.ts → taskService.ts              │
│                                                         │
│  1. authMiddleware (tenantId from JWT)                  │
│  2. Save task record to Qdrant (status: planning)       │
│  3. Load enabled MCP integrations for tenant            │
│  4. preparePlannedTask() → core.PlannedTask             │
│       └──▶ Azure OpenAI (LLM planning call)             │
│  5. Stream planning events over SSE to browser          │
│  6. Save task.plan to Qdrant (status: planned)          │
│                                                         │
│  POST /api/tasks/:id/run                                │
│  7. Create TaskRun record (status: queued)              │
│  8. workerOrchestrator.spawnWorker()                    │
│       ├── [debug]   executeDebugAsync() in-process      │
│       ├── [local]   enqueue → Redis → Docker container  │
│       └── [azure]   enqueue → Redis → Container App Job │
└──────────────────────────┬──────────────────────────────┘
                           │
               ┌───────────▼─────────────┐
               │  Redis Queue            │
               │  { taskId, runId,       │
               │    tenantId }           │
               └───────────┬─────────────┘
                           │  dequeue
               ┌───────────▼─────────────┐
               │  Worker Container       │
               │  executor.ts            │
               │  – initializePlannedTask│
               │  – execute plan steps   │
               │  – emit Redis pub/sub   │
               │    events (progress)    │
               └───────────┬─────────────┘
                           │ pub/sub
               ┌───────────▼─────────────┐
               │  API subscribes         │
               │  → SSE to browser       │
               └─────────────────────────┘
```

**Data sensitivity at each hop:**

| Hop | Data | Classification |
|-----|------|----------------|
| Browser → API | Task description (may contain internal vulnerability details) | Confidential |
| API → Qdrant | Task record, plan JSON (may contain IaC paths, service names) | Confidential |
| API → Redis | `{ taskId, runId, tenantId }` — no secrets | Internal |
| Worker → Azure OpenAI | Full plan + step results + tool outputs | Confidential |
| Worker → GitHub (via GitHubIntegration) | Code diffs, PR content | Confidential |
| Worker → Slack | Notification messages | Internal |
| Worker → Qdrant / Neo4j | Step memories, task run results | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| C2-1 | **Elevation of Privilege** – Worker container gains access to another tenant's tasks via shared Qdrant | Critical | `tenantId` on every DB write/read; worker receives `tenantId` from queue payload | Medium – Qdrant has no network-level auth in default deployment |
| C2-2 | **Tampering** – Redis queue poisoning: attacker injects crafted `taskId`/`tenantId` into queue | Critical | Redis is on internal Docker network; no public port exposed | Low in prod; High if Redis port exposed in dev |
| C2-3 | **Denial of Service** – Runaway LLM loop in worker exhausts Azure OpenAI quota | High | `maxIterations` cap per task; worker container is ephemeral and gets SIGTERM | Medium |
| C2-4 | **Information Disclosure** – Plan JSON stored in Qdrant contains service credentials extracted from code | High | `sanitizeMetadata()` utility in data-indexer; task descriptions should not include raw secrets | Medium – enforced only in data-indexer path, not general task descriptions |
| C2-5 | **Spoofing** – Worker spawned without verifying `tenantId` matches task owner | High | Worker fetches task by `taskId` and verifies `tenantId` from the run record before execution | Low |
| C2-6 | **Repudiation** – No audit log for worker actions (which tools were called, what code was written) | Medium | `chainOfThoughts` array is stored in the task run result in Qdrant | Medium – chainOfThoughts are stored but not immutable/signed |

**Trust boundaries crossed:** API ↔ Redis (internal), Redis ↔ Worker (internal), Worker ↔ Azure OpenAI (external API key), Worker ↔ GitHub/Slack (OAuth token).

---

### Feature 3 – Security Review Lifecycle (MCP)

**Business value:** Coding agents (GitHub Copilot, Claude) must complete a mandatory security questionnaire before writing code. This creates an auditable, per-feature security record that tracks threat tasks and developer attestations—replacing ad-hoc security review processes.

#### Data Flow Diagram

```
Coding Agent (VS Code / Claude)
  │
  │  POST /mcp  { jsonrpc: "2.0", method: "tools/call",
  │               params: { name: "start_security_review", ... } }
  │  Authorization: Bearer <Entra JWT>
  ▼
┌────────────────────────────────────────────────────────────────┐
│  API  – mcp/handler.ts                                         │
│                                                                │
│  1. requireBearerAuth middleware                               │
│       – verify RS256 against Entra JWKS                       │
│       – check aud, iss, exp, scope ("security_review")         │
│  2. tenantIdFromAuthInfo() → extract tenantId from JWT         │
│  3. Route to McpServer tool handler                            │
│                                                                │
│  Tool: start_security_review                                   │
│  ├── securityReviewService.startReview(tenantId, desc)         │
│  │     └── Qdrant: store SecurityReview { id, status:         │
│  │                 "questionnaire", questions[] }               │
│  │   ◀── returns { reviewId, questions[] }                     │
│                                                                │
│  Tool: submit_security_answers                                 │
│  ├── securityReviewService.submitAnswers(id, tenantId, answers)│
│  │     – derive security tasks from TASK_RULES                 │
│  │     └── Qdrant: update SecurityReview { tasks[] }           │
│  │   ◀── returns { tasks[] }                                   │
│                                                                │
│  Tool: acknowledge_security_tasks                             │
│  ├── securityReviewService.acknowledgeTasks(id, tenantId)      │
│  │     └── Qdrant: update status → "implementing"              │
│                                                                │
│  Tool: submit_security_attestations                           │
│  ├── securityReviewService.submitAttestations(...)             │
│  │     └── Qdrant: update SecurityReview { attestations[],    │
│  │                 status: "completed" }                        │
│  │   ◀── returns completed review                              │
└────────────────────────────────────────────────────────────────┘
  │
  │  Entra OAuth discovery:
  │    GET /.well-known/oauth-protected-resource/mcp
  │    GET /.well-known/oauth-authorization-server
  │    POST /register  (static stub → ENTRA_CLIENT_ID)
  ▼
Entra ID (external auth server)
```

**Data sensitivity at each hop:**

| Hop | Data | Classification |
|-----|------|----------------|
| Agent → API | Feature description, security questionnaire answers, attestations | Confidential |
| API → Qdrant | SecurityReview document (answers may contain architectural details) | Confidential |
| API → Agent | Security tasks list (severity, principles) | Internal |
| API → Entra | JWKS fetch for token validation | Public |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| C3-1 | **Spoofing** – Agent presents token for wrong tenant to access another tenant's reviews | Critical | `tenantId` extracted exclusively from validated JWT claims; fallback to `x-tenant-id` header only when no JWT present (acceptable for dev) | Low in prod; Medium in dev where header fallback is used |
| C3-2 | **Repudiation** – Developer claims they completed security review but attestations are not signed | High | Each SecurityReview object is stored in Qdrant with immutable `createdAt`; no cryptographic signing of attestations | **Medium (open)** – attestations are mutable in Qdrant today |
| C3-3 | **Tampering** – Attacker updates a review's attestations post-merge to show `handled: true` | High | No current write-audit log on the Qdrant collection | **High (open)** – no immutability guarantee |
| C3-4 | **Elevation of Privilege** – Scope bypass: agent holds a valid JWT with wrong scope calls security_review tools | Medium | Per-tool scope enforcement via `TOOL_REQUIRED_SCOPES`; requireBearerAuth validates `scp` claim | Low |
| C3-5 | **Denial of Service** – Flood POST /mcp with expired tokens causing JWKS key lookups | Medium | JWKS client cached per issuer (10-min TTL); rate limited to 10 req/min per JWKS client | Low |

**Trust boundaries crossed:** Agent ↔ API (Entra JWT), API ↔ Entra JWKS endpoint (TLS), API ↔ Qdrant (internal, no auth).

---

### Feature 4 – Integration Management (GitHub / Slack / Defender)

**Business value:** Operators connect the platform to their GitHub organisation, Slack workspace, and Microsoft Defender for Cloud—enabling the AI agent to create PRs, post notifications, and fetch live security assessments without manual copy-paste.

#### Data Flow Diagram

```
Operator (Browser)
  │
  │  GET /api/integrations/built-in        → list available integrations
  │  POST /api/oauth/github/complete       → complete GitHub App install
  │  POST /api/oauth/slack/complete        → exchange OAuth code for token
  │  PUT  /api/integrations/built-in/:id  → save Defender credentials
  │  Authorization: Bearer <JWT>
  ▼
┌───────────────────────────────────────────────────────────────────┐
│  API  – builtInIntegrationController / githubOAuthController     │
│         slackOAuthController                                      │
│                                                                   │
│  GitHub OAuth:                                                    │
│  1. Receive { installationId, accountLogin } from UI             │
│  2. getInstallationToken(installationId)                          │
│       └──▶ GitHub API  (App JWT → installation access token)     │
│  3. Store {installationId, appId, accountLogin} in Qdrant         │
│     (no raw GitHub token stored; tokens generated on demand)      │
│                                                                   │
│  Slack OAuth:                                                     │
│  1. Receive { code } from UI callback                            │
│  2. axios.POST slack.com/api/oauth.v2.access                     │
│       → access_token (xoxb-*), team.id, bot_user_id             │
│  3. Store {botToken, workspaceId, workspaceName} in Qdrant        │
│                                                                   │
│  MS Defender:                                                     │
│  1. Receive { tenantId, clientId, clientSecret, subscriptionId } │
│  2. Validate via MicrosoftDefenderIntegration.validate()          │
│       └──▶ Entra token endpoint → MDC API                       │
│  3. Store credentials (including clientSecret) in Qdrant          │
└───────────────────────────────────────────────────────────────────┘
  │
  │  At agent execution time:
  │  Worker / API loads integration config from Qdrant
  │    → creates GitHubIntegration / SlackIntegration / DefenderIntegration
  │    → makes live API calls with stored tokens
  ▼
External APIs (GitHub / Slack / Azure MDC)
```

**Data sensitivity at each hop:**

| Hop | Data | Classification |
|-----|------|----------------|
| Browser → API | OAuth code, GitHub installationId | Confidential |
| API → GitHub | App JWT, installationId | Confidential |
| API → Slack | OAuth code, client secret | Restricted |
| API → Qdrant (write) | Slack botToken, GitHub installationId, Defender clientSecret | **Restricted** |
| Worker → Qdrant (read) | Same credentials above | **Restricted** |
| Worker → GitHub/Slack/MDC | Token-authenticated API calls | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| C4-1 | **Information Disclosure** – Defender `clientSecret` stored in plaintext in Qdrant | Critical | Currently stored as raw string in integration `config` map in Qdrant | **Critical (open)** – no encryption at rest of secrets in Qdrant |
| C4-2 | **Information Disclosure** – Slack `botToken` stored in plaintext in Qdrant | Critical | Same as above | **Critical (open)** |
| C4-3 | **Spoofing** – SSRF via Slack OAuth redirect: attacker controls `SLACK_REDIRECT_URI` env var | High | `SLACK_REDIRECT_URI` from env only, not user input | Low |
| C4-4 | **Tampering** – Attacker overwrites another tenant's integration config (BOLA) | Critical | `tenantId` from JWT used in `create`/`update`; `getById` checks tenantId | Low |
| C4-5 | **Elevation of Privilege** – GitHub token with installation-wide write access used beyond intended scope | High | Token is scoped to installation and used only for whitelisted operations; installation scope set at GitHub App configuration | Medium – scope is enforced at GitHub, not validated in code |
| C4-6 | **Information Disclosure** – Integration config (including secrets) returned to UI clients via GET /api/integrations | High | `getBuiltInIntegrations` returns schema definitions, not stored config values; stored configs are only loaded server-side | Low – UI never receives raw secrets |

**Trust boundaries crossed:** Browser ↔ API (JWT), API ↔ GitHub (App JWT), API ↔ Slack OAuth (client secret), API ↔ Azure MDC (client credentials), API ↔ Qdrant (secrets stored in-clear).

---

### Feature 5 – Knowledge-Base Scan Trigger

**Business value:** Operators launch a full security scan of their GitHub repositories and connected Azure subscription from the UI. The platform ingests code, infrastructure, and cloud configuration into a queryable security knowledge base used by all AI features.

#### Data Flow Diagram

```
Operator (Browser)
  │
  │  POST /api/knowledge-base/scan/stream
  │  { scope, repositories[], enableCloudDiscovery, ... }
  │  Authorization: Bearer <JWT>
  ▼
┌────────────────────────────────────────────────────────────────┐
│  API  – scanController.ts → scanService.ts                    │
│                                                                │
│  1. authMiddleware (tenantId from JWT)                         │
│  2. Input validation:                                          │
│       – scope ∈ { all, code, cloud } (allow-list)             │
│       – repositories[]: string, ≤200 chars, no /\<>&"'`       │
│  3. Rate-limit: one active scan per tenant                     │
│  4. Create ScanRecord in memory                               │
│  5. Open SSE stream                                            │
│  6. startScanStream() → CodeIndexingOrchestrator.run()        │
│       Stage 1: Discovery                                       │
│         └──▶ GitHubIntegration.getRepositories()              │
│               └──▶ GitHub API (installation token)            │
│       Stage 2: Code Clone & Extraction                        │
│         └──▶ simple-git clone repos → tmp dir                 │
│         └──▶ SecurityExtractor.extract() (static analysis)    │
│       Stage 3: Cloud Discovery                                 │
│         └──▶ AzureResourceGraphConnector                      │
│               └──▶ Azure Resource Graph API (managed identity)│
│       Stage 4: Semantic Analysis                               │
│         └──▶ Azure OpenAI (embeddings)                        │
│       Stage 5: Security Extraction                             │
│         └──▶ file system reads on cloned repos                │
│       Stage 6: LLM Correlation                                 │
│         └──▶ Azure OpenAI (LLM)                               │
│  7. Write results to Qdrant (vector) + Neo4j (graph)          │
│  8. SSE events: scan stage updates, completion                │
└────────────────────────────────────────────────────────────────┘
  │
  SSE stage events → Browser progress display
```

**Data sensitivity at each hop:**

| Hop | Data | Classification |
|-----|------|----------------|
| API → GitHub | Repository listing, file contents (may include secrets in code) | Restricted |
| API → local disk | Cloned repo source code | Restricted |
| API → Azure OpenAI | Code snippets, service descriptions for embedding/analysis | Confidential |
| API → Azure ARG | Resource Graph query | Internal |
| API → Qdrant | Semantic embeddings, entity metadata (may include exposed API keys found in code) | Confidential |
| API → Neo4j | Entity relationships, trust boundaries | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| C5-1 | **Information Disclosure** – Cloned source code left on disk after scan | High | Temporary clone directory; cleanup should happen post-scan | **High (open)** – explicit cleanup not visible in reviewed code |
| C5-2 | **Information Disclosure** – Secrets found in source code are stored in Qdrant unredacted | High | `sanitizeMetadata()` utility exists in data-indexer utils | Medium – utility must be applied consistently; not auditable |
| C5-3 | **Tampering** – Path traversal via repository name in scan request | High | Repository name validated: no `/\<>&"'\`` chars, max 200 chars | Low |
| C5-4 | **Denial of Service** – Single tenant triggers multiple concurrent scans | Medium | One-active-scan-per-tenant rate limit in `scanService` | Low |
| C5-5 | **Elevation of Privilege** – Scan uses GitHub token with write scope to clone private repos then exfiltrates data | High | GitHub installation scopes are read-only for indexing; token not stored in scan output | Medium – scope enforcement is at GitHub App configuration level |
| C5-6 | **Information Disclosure** – Azure OpenAI logs code sent for embedding | Medium | Azure OpenAI service has opt-out for abuse monitoring; commercial agreement governs | Medium – controlled by Azure policy, not in-code |

**Trust boundaries crossed:** API ↔ GitHub (token), API ↔ local filesystem (code clone), API ↔ Azure OpenAI (API key), API ↔ Azure ARG (managed identity / service principal), API ↔ Qdrant/Neo4j (internal, no auth).

---

## 3. Service: Core (`packages/core`)

The core package is a framework library consumed by the API and Worker. It is never deployed standalone. It provides the LLM task engine, tool registry, and memory subsystems.

---

### Feature 1 – LLM Task Orchestration

**Business value:** Wraps Azure OpenAI in a reusable, tool-aware agentic loop that lets any service implement multi-step reasoning without reimplementing the completion/tool-dispatch/retry cycle.

#### Data Flow Diagram

```
Caller (API or Worker)
  │  task.execute(userInput)
  ▼
┌──────────────────────────────────────────────────────────┐
│  core/task/task.ts  – Task.execute()                     │
│                                                          │
│  loop (until TaskCompletion tool called or maxIterations)│
│  ┌────────────────────────────────────────────────────┐  │
│  │ 1. addMessageToHistory('user', input)              │  │
│  │ 2. shortTermMemory.getContextMessages()            │  │
│  │    (summarize if >token limit → Azure OpenAI call) │  │
│  │ 3. api.createCompletion(messages)                  │  │
│  │    └──▶ Azure OpenAI  → CompletionResponse         │  │
│  │ 4. Parse tool calls from completion                │  │
│  │ 5. toolRegistry.execute(toolName, params)          │  │
│  │    ├── SecurityQueryTool → Neo4j / Qdrant          │  │
│  │    ├── GitHubTool        → GitHub API              │  │
│  │    ├── SlackTool         → Slack API               │  │
│  │    ├── MCPTool           → external MCP server     │  │
│  │    ├── CommandTool       → shell exec (worker only)│  │
│  │    └── TaskCompletionTool → exits loop             │  │
│  │ 6. Append tool result to history                   │  │
│  │ 7. events.emit('toolUse', ...) / 'toolResult'      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Return TaskResult<T>                                    │
└──────────────────────────────────────────────────────────┘
```

**Data sensitivity:**

| Component | Data | Classification |
|-----------|------|----------------|
| shortTermMemory | All messages including tool results (may contain code, secrets found in code) | Confidential |
| LLM messages sent to Azure OpenAI | Full conversation including intermediate tool outputs | Confidential |
| Tool results from SecurityQueryTool | Graph data, vulnerability details | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| K1-1 | **Tampering** – Prompt injection through tool results (e.g., a GitHub file contains `Ignore previous instructions`) | High | Tool results are passed as `tool` role messages, not injected into system/user messages | Medium – LLM may still follow injected instructions depending on model |
| K1-2 | **Denial of Service** – Infinite tool loop exhausts Azure OpenAI tokens | High | `maxIterations` hard cap per task | Low |
| K1-3 | **Information Disclosure** – Conversation history (including secrets from tool results) grows unbounded in short-term memory | Medium | ShortTermMemory summarises when near token limit; summaries are also sent to OpenAI | Medium – summaries may still contain secret fragments |
| K1-4 | **Elevation of Privilege** – CommandTool allows arbitrary shell execution | Critical | CommandTool is only registered in Worker context, not in API chat path; worker runs in isolated container | Medium – container escape is the residual risk |

---

### Feature 2 – Hierarchical Tool Dispatch

**Business value:** Organises hundreds of available tools into named categories so the LLM only sees category summaries in the system prompt, dramatically reducing token usage and preventing the model from being overwhelmed—while still enabling it to request full tool specs on demand.

#### Data Flow Diagram

```
Task Initialisation
  │
  ├── HierarchicalToolProvider(allTools)
  │     – groups tools by tool.category.name
  │     – builds compact prompt section listing categories + tool names
  │
  ├── getFullSystemPrompt(alwaysAvailableTools, mode, customInstructions)
  │     – injects: toolsSection (compact), list_tool_details (meta-tool)
  │
  └── LLM receives system prompt with:
        • list_tool_details  (always available)
        • compact tool listing per category

  ── At runtime ──

  LLM calls list_tool_details(category: "github")
  │  toolRegistry.execute("list_tool_details", { category })
  │  returns: full parameter schema for each tool in that category
  ▼
  LLM calls specific tool (e.g., githubCreatePullRequest)
```

**Data sensitivity:** Tool schemas and parameter descriptions may reference internal service names. These are static metadata and classified as **Internal**.

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| K2-1 | **Information Disclosure** – Tool descriptions expose internal architecture details to the LLM (and potentially to logged requests) | Low | Tool descriptions are hardcoded strings, not derived from live data | Low |
| K2-2 | **Tampering** – Malicious MCP integration registers a tool that overrides a legitimate tool name | Medium | Tool registry uses `name` as key; duplicate names would overwrite; MCP tools are registered per-session only | Medium – no duplicate detection or name-space isolation |

---

### Feature 3 – Long-Term Agent Memory

**Business value:** The agent learns from operator feedback (👍/👎) by storing step-level memories as vector embeddings. On subsequent tasks, relevant past experiences are retrieved and injected into the system context, progressively improving task quality without retraining the model.

#### Data Flow Diagram

```
Feedback Submission (FeedbackController)
  │
  │  POST /api/tasks/:id/runs/:runId/feedback
  │  { content, rating: "like"|"dislike" }
  ▼
┌──────────────────────────────────────────────────────────────┐
│  taskService.storeStepMemoriesForTaskRun()                   │
│                                                              │
│  1. Load chainOfThoughts from TaskRun record (Qdrant)        │
│  2. For each step in the task run:                           │
│     a. Format step as natural-language memory               │
│     b. Prepend feedback sentiment ("like: ..." / "dislike:")│
│     c. api.createEmbedding(memoryText)                      │
│           └──▶ Azure OpenAI Embeddings endpoint             │
│     d. Store embedding + metadata in Qdrant                 │
│        collection: task_step_memories (scoped to tenantId)   │
│                                                              │
│  At next task execution:                                     │
│  LongTermMemoryManager.retrieveRelevantMemories(input)       │
│  1. api.createEmbedding(userInput)                          │
│  2. Qdrant vector similarity search (tenant-scoped)         │
│  3. Inject top-k memories into system prompt context        │
└──────────────────────────────────────────────────────────────┘
```

**Data sensitivity:**

| Component | Data | Classification |
|-----------|------|----------------|
| Step memory text | Execution steps including tool results; may reference code paths, service names | Confidential |
| Embeddings stored in Qdrant | Vector floats – non-reversible but correlated with content | Internal |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| K3-1 | **Information Disclosure** – Memory from one task leaks into a different tenant's task context | Critical | Memory queries are tenant-scoped in Qdrant (`filter: { tenantId }`) | Low |
| K3-2 | **Tampering** – Adversarial feedback poisons agent memory with misleading step patterns | Medium | No sanitisation of feedback content before memory storage | Medium – attacker with operator access could poison memories |
| K3-3 | **Information Disclosure** – Sensitive data from tool results (e.g., credentials found in code) stored as memory text | High | No redaction before memory storage | **High (open)** – step memories may contain raw secrets |

---

## 4. Service: Data Indexer (`packages/data-indexer`)

The data indexer is a pipeline library invoked by the API scan service. It reads from external sources (GitHub, Azure), processes data through staged transformations, and writes to Qdrant and Neo4j.

---

### Feature 1 – Repository Discovery & Code Indexing

**Business value:** Automatically discovers all repositories in the GitHub organisation, clones them, and builds a rich, structured knowledge base of services, modules, dependencies, API endpoints, and identity references—enabling AI-powered security analysis without manual documentation.

#### Data Flow Diagram

```
CodeIndexingOrchestrator.orchestrate()
  │
  ├─ Stage 1: Discovery
  │   └──▶ GitHubIntegration.getRepositories()
  │           └──▶ GitHub API /installation/repositories
  │         ◀── RepositoryHandle[] { name, url, branch }
  │
  ├─ Stage 2: Clone
  │   └──▶ simple-git.clone(url, tmpDir)
  │         – clones to /tmp/ai-agent-clones/<tenantId>/<repoName>
  │         ◀── local path with full source code
  │
  ├─ Stage 3: Extraction (SecurityExtractor)
  │   └── Reads: package.json, Dockerfile, *.tf, *.bicep, src/**/*.ts
  │   ├── Extract: CodeService, CodeModule, BuildArtifact, DeploymentArtifact
  │   ├── Identify: API endpoints, identities, data stores, dependencies
  │   └── Create Relationship edges (deterministic)
  │
  ├─ Stage 4: Semantic Analysis
  │   └──▶ Azure OpenAI Embeddings
  │         – embed service/module responsibility descriptions
  │         ◀── float[] vectors
  │
  ├─ Stage 5: LLM Correlation (LLMCorrelator)
  │   └──▶ Azure OpenAI Chat (GPT-4)
  │         – reason over services + cloud resources
  │         – generate Relationship[] with RelationshipType
  │         ◀── CorrelationResult { relationships[], reasoning }
  │
  └─ Stage 6: Persistence
      ├──▶ Qdrant.upsertEntity() – all canonical entities with embeddings
      └──▶ Neo4j.mergeRelationship() – graph edges between entities
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| GitHub → disk | Full source code (may contain hardcoded secrets, PII-handling code) | **Restricted** |
| Disk → Azure OpenAI | File contents, service descriptions | Confidential |
| Disk → SecurityExtractor | Source code static analysis | Confidential |
| Extraction result → Qdrant | Entity metadata, dependency names, endpoint paths | Confidential |
| Extraction result → Neo4j | Relationship graph | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| D1-1 | **Information Disclosure** – Hardcoded secrets in cloned code stored in Qdrant metadata | Critical | `sanitizeMetadata()` in `utils/secret-sanitizer.ts` applied before storage | Medium – sanitiser must cover all metadata paths |
| D1-2 | **Information Disclosure** – Clone directory persisted beyond scan lifetime | High | No explicit cleanup code found in pipeline | **High (open)** |
| D1-3 | **Tampering** – Malicious repository name used for path traversal during clone | High | Repository names validated in `scanController` before reaching pipeline | Low |
| D1-4 | **Denial of Service** – Indexing extremely large repositories exhausts disk or memory | Medium | No repository size limit enforced | Medium |
| D1-5 | **Information Disclosure** – LLM reasoning output stored verbatim includes secrets from code context | High | `sanitizeMetadata()` applied to LLM correlation outputs | Medium |

---

### Feature 2 – Cloud Resource Discovery

**Business value:** Queries the organisation's Azure subscription via Resource Graph to build a complete inventory of compute, storage, database, network, and identity resources—providing the cloud half of the security knowledge base alongside the code half.

#### Data Flow Diagram

```
CloudDiscoveryStage.discover(tenantId)
  │
  ├──▶ AzureResourceGraphConnector.fetchCloudResources()
  │     │
  │     ├── getAccessToken()
  │     │   └──▶ Entra token endpoint
  │     │         { client_credentials, scope: management.azure.com/.default }
  │     │         ◀── access_token
  │     │
  │     └── queryResourceGraph(token)
  │         └──▶ Azure Resource Graph API
  │               POST /providers/Microsoft.ResourceGraph/resources
  │               { query: "Resources | project ..." }
  │               ◀── AzureResource[] { id, name, type, location,
  │                                     properties, tags }
  │
  ├── Map AzureResource → CloudResource (canonical type)
  │
  └── extractAzureRelationships(resources, tenantId)
        – deterministic: parse resource IDs, subnet refs, VNet IDs
        ◀── Relationship[]
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| API → Entra | Client credentials (clientId + clientSecret) | **Restricted** |
| Azure ARG → API | Resource names, IDs, regions, tags (tags may contain sensitive labels) | Confidential |
| API → Qdrant/Neo4j | CloudResource entities and relationships | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| D2-1 | **Information Disclosure** – Azure service principal clientSecret stored in Qdrant (Defender integration) | Critical | See C4-1 above | **Critical (open)** |
| D2-2 | **Information Disclosure** – Resource tags may contain sensitive operational data (cost codes, owner PII) | Medium | Tags are stored as-is in CloudResource metadata | Medium |
| D2-3 | **Elevation of Privilege** – Over-permissioned service principal grants read to all subscriptions | High | Service principal should be scoped to Reader on target subscriptions only; enforced at Azure IAM | Medium – enforced outside this codebase |
| D2-4 | **Spoofing** – Attacker compromises service principal and feeds fabricated resource data | High | Access token is short-lived; token obtained fresh per scan | Low |

---

### Feature 3 – LLM-Driven Security Correlation

**Business value:** Uses GPT-4 to reason about the relationships between code services, Docker images, IaC configurations, and cloud resources—automatically building a security graph that would take a human architect days to construct manually.

#### Data Flow Diagram

```
LLMCorrelator.correlate(RepositoryCorrelationInput)
  │
  ├── Build correlation prompt:
  │     { services, buildArtifacts, deploymentArtifacts, cloudResources }
  │
  ├──▶ Azure OpenAI Chat (GPT-4)
  │     System prompt: "You are a security architect..."
  │     User prompt: JSON of all entities
  │     ◀── JSON response: Relationship[]
  │
  ├── Validate relationship types (allow-list of VALID_RELATIONSHIP_TYPES)
  │
  ├── ThreatModel extraction per service:
  │   ├── Build threat model prompt for each CodeService
  │   ├──▶ Azure OpenAI Chat
  │   │     ◀── ThreatModelData { internetExposed, authMethod, dataClassification, ... }
  │   └── sanitizeMetadata(threatModelData)
  │
  ├──▶ Neo4j.mergeRelationship() – all derived relationships
  └──▶ Qdrant.upsertEntity() – enriched services with threatModel
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| Code entities → Azure OpenAI | Service names, file paths, dependency names, cloud resource IDs | Confidential |
| Azure OpenAI → LLM correlator | Relationship graph, threat model data | Confidential |
| Threat model data → Qdrant | Authentication methods, data classification, internet exposure flags | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| D3-1 | **Tampering** – LLM hallucinates non-existent relationships and stores them as facts | High | Relationship types validated against `VALID_RELATIONSHIP_TYPES` allow-list; entity IDs must match actual discovered entities | Medium – type validation does not prevent logically incorrect relationships |
| D3-2 | **Information Disclosure** – Sending proprietary system architecture to Azure OpenAI | Medium | Azure commercial contract; data not used for training by default (enterprise agreement) | Medium – contractual, not technical |
| D3-3 | **Denial of Service** – LLM correlation fails silently leaving stale threat model data | Medium | Errors logged; scan stage marked failed; partial data may exist in Qdrant | Medium |
| D3-4 | **Repudiation** – Automated threat model has no human sign-off | Medium | Threat models are marked `assessmentMethod: 'llm'` | Low – clearly labelled |

---

### Feature 4 – Vulnerability Impact Analysis

**Business value:** Given a CVE or vulnerable dependency name, instantly identifies every service, container image, deployment, and cloud resource in the organisation's environment that is transitively affected—removing weeks of manual impact assessment.

#### Data Flow Diagram

```
SecurityQueryTools.analyzeVulnerabilityImpact(query)
  │
  ├──▶ Qdrant: search for Dependency entities matching packageName/version
  │     (tenant-scoped vector + filter query)
  │     ◀── Dependency[]
  │
  ├──▶ Neo4j: MATCH (m:CodeModule)-[:DEPENDS_ON]->(d:Dependency)
  │     WHERE d.id IN [matchingDeps] AND m.tenantId = $tenantId
  │     ◀── CodeModule[]  (directly vulnerable modules)
  │
  ├──▶ Neo4j: traverse CONTAINS relationships upward
  │     CodeModule → CodeService (directly affected services)
  │
  ├──▶ Neo4j: traverse DEPENDS_ON chain
  │     (transitive service dependencies)
  │
  ├──▶ Neo4j: BUILDS relationships
  │     CodeService → BuildArtifact (Docker images to rebuild)
  │
  ├──▶ Neo4j: DEPLOYS / DEPLOYED_TO relationships
  │     BuildArtifact → DeploymentArtifact → CloudResource
  │
  └── Assemble VulnerabilityImpact {
        dependency,
        directlyAffectedServices[],
        transitivelyAffectedServices[],
        buildArtifacts[],
        deploymentArtifacts[],
        cloudResources[],
        impactGraph (nodes + edges for UI rendering)
      }
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| Input query | Package name + version | Internal |
| Qdrant reads | Dependency metadata | Internal |
| Neo4j reads | Full service/module/cloud graph for tenant | Confidential |
| Output | Full blast radius of a CVE across the estate | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| D4-1 | **Information Disclosure** – Vulnerability impact results expose internal service topology to unauthorised callers | High | All graph queries are tenant-scoped; API endpoint requires JWT auth | Low |
| D4-2 | **Denial of Service** – Query for a widely-used package (e.g., "lodash") triggers graph traversal over thousands of nodes | Medium | Neo4j query depth limited by relationship traversal depth parameter | Medium – no explicit depth cap in current implementation |
| D4-3 | **Tampering** – False dependency relationships in Neo4j inflate or deflate impact scope | Medium | Relationships are created deterministically from parsed `package.json` files; LLM-derived relationships are labelled with confidence level | Medium |

---

## 5. Service: Shared (`packages/shared`)

The shared package is a library of persistence adapters, service logic, and integration clients consumed by all other packages. It has no runtime entry point of its own.

---

### Feature 1 – Multi-Tenant Persistence (Qdrant + Neo4j)

**Business value:** Provides a single, consistent data layer that cleanly isolates all data between tenants—so multiple customer organisations can safely share the same database infrastructure without risk of data bleed.

#### Data Flow Diagram

```
Any service calls Qdrant/Neo4j adapter
  │
  ├── QdrantAdapter.upsertEntity(tenantId, entity)
  │     – entity ID = hash(tenantId + entityType + naturalKey)
  │     – payload includes tenantId as filter field
  │     – all search calls include { must: [{ key: "tenantId", match: { value } }] }
  │     └──▶ Qdrant HTTP API (port 6333)
  │
  └── Neo4jAdapter.mergeRelationship(relationship)
        – every node: SET n.tenantId = $tenantId
        – every MATCH query: WHERE n.tenantId = $tenantId
        └──▶ Neo4j Bolt (port 7687)
```

**Data sensitivity:**

| Store | Data stored | Classification |
|-------|------------|----------------|
| Qdrant | All entity types including secrets found in code (if not sanitised) | Restricted |
| Qdrant | Integration configs including OAuth tokens and client secrets | **Restricted** |
| Neo4j | Relationship graph (service topology, trust boundaries) | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| S1-1 | **Information Disclosure** – Qdrant has no authentication in default docker-compose | Critical | `QDRANT_API_KEY` environment variable supported; not enforced by default | **Critical (open)** – any process with network access to port 6333 can read all data |
| S1-2 | **Information Disclosure** – Neo4j uses default password `neo4j/password` in docker-compose | Critical | Must be changed for production; enforced by deployment policy | **High (open)** – default credentials in code |
| S1-3 | **Elevation of Privilege** – Qdrant tenant isolation relies solely on application-layer `tenantId` filtering | Critical | No row-level security or database-level isolation; a bug in the filter could expose cross-tenant data | **High (open)** – single point of failure for multi-tenancy |
| S1-4 | **Tampering** – Attacker with Qdrant access can overwrite any tenant's data | Critical | Network-level isolation (Docker internal network) is the only control | High |

---

### Feature 2 – Security Review Service

**Business value:** Implements the mandatory security review workflow for all code changes—questionnaire, task derivation, and attestation—as a reusable service consumed by both the REST API and the MCP endpoint, ensuring the same security rigour regardless of how developers interact with the platform.

#### Data Flow Diagram

```
SecurityReviewService methods
  │
  ├── startReview(tenantId, featureDescription)
  │     – generate UUID reviewId
  │     – attach BASE_QUESTIONS[] (9 standard questions)
  │     – status: "questionnaire"
  │     └──▶ Qdrant: create SecurityReview document
  │
  ├── submitAnswers(reviewId, tenantId, answers[])
  │     – validate: answer for every question
  │     – derive tasks from TASK_RULES (Yes/No answer → 0-2 tasks per rule)
  │       Tasks include severity: critical | high | medium | low
  │     – status: "tasks_generated"
  │     └──▶ Qdrant: update review with tasks[]
  │
  ├── acknowledgeTasks(reviewId, tenantId)
  │     – status: "implementing"
  │     └──▶ Qdrant: update review status
  │
  └── submitAttestations(reviewId, tenantId, attestations[])
        – validate: attestation for every task
        – status: "completed"
        └──▶ Qdrant: update review with attestations[], completedAt
```

**Data sensitivity:**

| Data element | Classification |
|-------------|----------------|
| Feature description | Internal |
| Security questionnaire answers | Confidential (may reveal architectural decisions) |
| Security tasks (derived) | Internal |
| Attestation text (how task was handled) | Confidential (reveals security implementation details) |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| S2-1 | **Repudiation** – Attestations can be modified after submission (no write-once guarantee) | High | Qdrant allows updates; no append-only or signing mechanism | **High (open)** |
| S2-2 | **Spoofing** – Tenant header fallback allows access without JWT in some paths | Medium | `resolveTenantId()` falls back to `x-tenant-id` header if no `req.auth`; this bypasses JWT validation | **Medium (open)** – should require auth for all paths |
| S2-3 | **Tampering** – Answer content not sanitised before storage or task derivation | Low | Answers are stored as strings and matched only by `startsWith("yes")`; no code execution | Low |

---

### Feature 3 – Asset Inventory & Relationship Graph

**Business value:** Provides operators with a browsable, searchable inventory of every security-relevant asset in their environment (services, cloud resources, identities, data stores) with interactive relationship graphs—replacing manual spreadsheets or fragmented CMDB data.

#### Data Flow Diagram

```
AssetController (API)
  │
  ├── GET /api/assets/categories
  │     └── AssetService.getAssetCategories(tenantId)
  │           └──▶ QdrantAdapter.listEntityTypes(tenantId)
  │                 ◀── string[] entity type names
  │
  ├── GET /api/assets/category/:category
  │     └── AssetService.getAssetsByCategory(tenantId, category)
  │           └──▶ QdrantAdapter.listEntities(tenantId, category, limit=1000)
  │                 ◀── CanonicalEntity[]
  │
  ├── GET /api/assets/:id
  │     └── AssetService.getAssetById(tenantId, id)
  │           └──▶ QdrantAdapter.getEntity(tenantId, id)
  │                 ◀── CanonicalEntity (with full threatModel)
  │
  └── GET /api/assets/:id/relationships
        └── AssetService.getAssetRelationships(tenantId, id)
              └──▶ SecurityQueryTools.getRelationshipGraph(assetId, depth=1)
                    ├──▶ Neo4j: MATCH relationships at depth 1
                    └──▶ Qdrant: fetch neighbour entity metadata
                    ◀── RelationshipGraph { nodes[], edges[], graph }
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| API → Browser | Asset list (service names, cloud resource IDs, threat model summaries) | Confidential |
| API → Browser | Relationship graph (service topology, trust boundaries) | Confidential |
| Qdrant → API | Full entity metadata including threatModel fields | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| S3-1 | **Information Disclosure** – Full security topology (internet-exposed services, authentication gaps) returned to any authenticated user | High | Requires valid JWT; all assets are tenant-scoped | Low – but no role-based access control within a tenant |
| S3-2 | **Denial of Service** – `listEntities` with `limit=1000` on large tenants | Medium | Hard limit of 1000 per category per request; pagination not implemented | Medium |
| S3-3 | **Tampering** – Asset ID injected to traverse another tenant's graph nodes | Medium | Neo4j and Qdrant queries always include `tenantId` filter | Low |

---

## 6. Service: Worker (`packages/worker`)

The worker is an ephemeral Node.js container that picks one task from the Redis queue, executes it using the core task engine, streams progress via Redis pub/sub, and terminates.

---

### Feature 1 – Background Task Execution

**Business value:** Executes long-running, multi-tool agentic tasks (security remediation, code fixes, PR creation) in an isolated container separate from the API server—ensuring that expensive or slow AI workloads never degrade API response times and can be independently scaled, monitored, and restarted.

#### Data Flow Diagram

```
Worker Container Starts
  │
  │  env: TASK_ID, RUN_ID, TENANT_ID
  ▼
┌────────────────────────────────────────────────────────────────┐
│  worker/index.ts → initializeWorker(config)                   │
│                                                                │
│  1. createTaskRepository() → Qdrant                           │
│  2. taskRepository.getById(taskId)  ← task record + plan      │
│  3. taskRunRepository.getById(runId, tenantId)  ← run record  │
│  4. Update run status: "running"                              │
│  5. Connect RedisEventPublisher(channel: tenantId:runId)       │
│  6. executeTask(context)                                       │
│       a. Load MCP integrations for tenant from Qdrant         │
│       b. initializePlannedTask({ mcpIntegrations, ... })      │
│       c. plannedTask.execute(task.description)                │
│            loop:                                              │
│              ├──▶ Azure OpenAI (step reasoning)              │
│              ├──▶ Tool calls (GitHub / Slack / MDC / shell)  │
│              └──▶ Redis PUBLISH progress events              │
│  7. Update run: status=completed|failed, result, chainOfThoughts│
│  8. Disconnect Redis                                          │
│  9. Process.exit(0)                                           │
└────────────────────────────────────────────────────────────────┘
```

**Data sensitivity:**

| Component | Data | Classification |
|-----------|------|----------------|
| Env vars | TASK_ID, RUN_ID, TENANT_ID (no secrets) | Internal |
| Qdrant reads | Task plan (may include vulnerability details), integration configs (secrets) | **Restricted** |
| Redis pub/sub | Progress events (tool names, partial results) | Confidential |
| Tool calls | May write code, create PRs, post Slack messages | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| W1-1 | **Elevation of Privilege** – Worker can execute arbitrary shell commands via CommandTool | Critical | CommandTool only used in worker context; worker runs in Docker container | Medium – container escape risk remains |
| W1-2 | **Information Disclosure** – Integration secrets (GitHub token, Slack botToken) loaded from Qdrant into worker process memory | High | Process memory is ephemeral; container is destroyed after task completion | Medium – secrets accessible to any code running in container |
| W1-3 | **Tampering** – Worker modifies task plan before execution by reading stale or corrupted Qdrant data | Medium | Task plan is fetched fresh from Qdrant at start; no local cache | Low |
| W1-4 | **Repudiation** – Worker actions (PR creation, Slack posts) not linked to the originating user | Medium | `tenantId` is tracked throughout; no individual user attribution on external actions | Medium |
| W1-5 | **Denial of Service** – Worker hangs indefinitely waiting for LLM response | Medium | SIGTERM handler sets `cancelled` flag and calls `plannedTask.cancel()` | Low |

---

### Feature 2 – Worker Lifecycle & Cancellation

**Business value:** Operators can cancel a running task at any time from the UI, freeing up compute resources and stopping potentially irreversible actions (e.g., a PR about to be merged) before they complete.

#### Data Flow Diagram

```
User (Browser)
  │
  │  POST /api/tasks/:id/runs/:runId/cancel
  │  Authorization: Bearer <JWT>
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  API  – taskController.ts → taskService.cancelTaskRun()        │
│                                                                 │
│  1. taskRunRepository.getById(runId, tenantId)                  │
│  2. Verify status == "running"                                  │
│  3. Update status → "cancelled"                                │
│  4. workerOrchestrator.terminateWorker(workerId, environment)  │
│       ├── [local] docker stop <containerId>                    │
│       └── [azure] ContainerAppsAPIClient.jobs.stop(jobName)    │
└─────────────────────────────────────────────────────────────────┘

  Worker receives SIGTERM
  │
  ├── gracefulShutdownHandler sets cancelled = true
  ├── plannedTask.cancel() called
  └── plannedTask.events.emit('abort')
        └── Task.aborted = true
              └── execute() loop exits on next iteration
```

**Data sensitivity:** Cancellation flow carries only `runId`, `tenantId`, `workerId`—no sensitive business data.

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| W2-1 | **Tampering** – User cancels another tenant's task run by guessing `runId` | High | `cancelTaskRun()` fetches run by `(runId, tenantId)` — mismatched tenantId returns not-found | Low |
| W2-2 | **Denial of Service** – Docker stop command injected via `workerId` (if workerId is user-controlled) | Medium | `workerId` is a UUID generated by the orchestrator; it is stored in Qdrant and only read back server-side | Low |
| W2-3 | **Tampering** – Race condition: task marked cancelled but worker has already committed irreversible changes | Medium | Signal-based cancellation; `cancelled` flag checked between tool calls, not within a single tool invocation | Medium |

---

## 7. Service: UI (`packages/ui`)

The UI is a React SPA served by nginx. It authenticates users via MSAL (Microsoft Entra PKCE) and communicates with the API over HTTPS with a Bearer JWT. All sensitive operations are delegated entirely to the API — the UI holds no secrets.

---

### Feature 1 – Security Knowledge Base Explorer

**Business value:** Gives security engineers a visual, interactive map of the entire organisation's security posture—browsable asset inventory, clickable relationship graphs, and AI-generated threat model summaries—replacing fragmented spreadsheets and wiki pages.

#### Data Flow Diagram

```
Security Engineer (Browser)
  │
  │  Navigate to /assets
  ▼
┌───────────────────────────────────────────────────────────┐
│  UI  – AssetsPage.tsx / AssetDetailsPage.tsx              │
│                                                           │
│  1. useMsal() → acquire Bearer JWT (PKCE)                │
│  2. GET /api/assets/categories                           │
│       ◀── string[] (service, cloud_resource, identity, …) │
│  3. GET /api/assets/category/:cat                        │
│       ◀── Asset[] (name, entityType, metadata)           │
│  4. Click asset → GET /api/assets/:id                    │
│       ◀── AssetDetail { fullEntity, threatModel, ... }   │
│  5. RelationshipGraph component                          │
│       GET /api/assets/:id/relationships                  │
│       ◀── { nodes[], edges[], graph }                    │
│       Render: react-force-graph / d3                     │
│  6. ThreatModelAiAnalysisPanel                           │
│       POST /api/chat  { message: "Analyse threats for X" }│
│       ◀── SSE streamed AI analysis                       │
└───────────────────────────────────────────────────────────┘
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| Browser → API | Bearer JWT, asset ID | Internal |
| API → Browser | Asset metadata, threat model data, relationship graph | Confidential |
| Browser (local state) | Rendered graph, threat model summaries | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| U1-1 | **Information Disclosure** – XSS allows attacker to exfiltrate Bearer JWT from localStorage/sessionStorage | High | Vite React app with CSP headers (to be enforced by nginx); no `eval()` usage | Medium – CSP not verified in nginx config |
| U1-2 | **Information Disclosure** – Asset relationship graph reveals internal service topology in browser dev tools | Low | Data is fetched per authenticated request; no caching to localStorage | Low |
| U1-3 | **Spoofing** – MSAL redirect URI manipulation during OAuth callback | Medium | Redirect URI validated by Entra; PKCE code verifier prevents code interception | Low |

---

### Feature 2 – Task & Agent Management Console

**Business value:** Lets operators define AI agents with specific personas and permissions, create complex multi-step tasks, monitor real-time execution progress through visual chain-of-thought trees, and review historical task run logs—providing full operational visibility into the AI system's actions.

#### Data Flow Diagram

```
Operator (Browser)
  │
  ├── AgentsPage.tsx
  │     POST /api/agents   { name, role, tools[] }
  │     GET  /api/agents
  │
  ├── TasksPage.tsx
  │     POST /api/tasks    { description, agentId, tools, chatHistory }
  │     GET  /api/tasks
  │     ◀── SSE stream: planning events (tool_use, stream_chunk)
  │
  ├── TaskExecutionPage/
  │     POST /api/tasks/:id/run
  │     GET  /api/tasks/:id/runs  (list runs)
  │     SSE  /api/tasks/:id/runs/:runId/stream  (live progress)
  │     ◀── chain-of-thought events, tool calls, partial results
  │
  └── TaskRunHistoryPage.tsx
        GET /api/tasks/:id/runs
        GET /api/tasks/:id/runs/:runId
        ◀── TaskRun { status, chainOfThoughts[], result }
```

**Data sensitivity:**

| Component | Data | Classification |
|-----------|------|----------------|
| Task description | May contain internal vulnerability details | Confidential |
| Chain-of-thought display | Tool names, parameters, partial results | Confidential |
| Agent config | Role definition, assigned tool IDs | Internal |
| Task run result | Full execution output including code changes, PR URLs | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| U2-1 | **Information Disclosure** – Chain-of-thought tree may display secrets returned by tools | High | Tool results are rendered as text; no explicit secret masking in UI | **High (open)** |
| U2-2 | **Tampering** – Operator modifies task description to inject instructions that override agent safeguards | Medium | Task description is user-authored input; passed as LLM user message | Medium – prompt injection is a known risk |
| U2-3 | **Repudiation** – No per-user audit trail for task creation / run triggering | Medium | `tenantId` tracked but not individual `userId` on task records | Medium |

---

### Feature 3 – Security Review Dashboard

**Business value:** Provides a security team dashboard showing all in-progress and completed security reviews across the organisation—with drill-down into questionnaire answers, security tasks, and developer attestations—replacing email-based review tracking with a searchable, auditable record.

#### Data Flow Diagram

```
Security Lead (Browser)
  │
  ├── SecurityReviewsPage.tsx
  │     GET /api/security-reviews
  │     ◀── SecurityReview[] (list with status summary)
  │
  └── SecurityReviewDetailsPage.tsx
        GET /api/security-reviews/:id
        ◀── SecurityReview {
              featureDescription,
              questions[],
              answers[],
              tasks[],
              attestations[],
              status,
              completedAt
            }
        Render: ThreatModelDiffView, ThreatModelGraph
```

**Data sensitivity:**

| Hop | Data | Classification |
|-----|------|----------------|
| API → Browser | Security review answers (may reveal architecture details) | Confidential |
| API → Browser | Security task list (severity, description) | Confidential |
| API → Browser | Attestations (how security controls were implemented) | Confidential |

#### Threat Model

| # | Threat (STRIDE) | Severity | Mitigation | Residual risk |
|---|----------------|----------|-----------|---------------|
| U3-1 | **Information Disclosure** – Security review details expose sensitive architectural decisions to any authenticated user in the tenant | Medium | Requires valid JWT; no role separation between read-only security analysts and admins | Medium |
| U3-2 | **Tampering** – Review list page can be manipulated via XSS to show fabricated review status | Low | MSAL token validation on every API request; UI state derived from API responses | Low |

---

## 8. Cross-Cutting Trust Boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│  ZONE 0: External / Internet                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  User    │  │  Coding  │  │  GitHub API  │  │  Slack API   │   │
│  │ Browser  │  │  Agent   │  │              │  │              │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └──────┬───────┘   │
│       │ HTTPS/JWT   │ HTTPS/Entra    │                  │           │
│  ┌────▼─────────────▼────────────────▼──────────────────▼──────┐   │
│  │  ZONE 1: DMZ / TLS Termination (nginx / Azure Front Door)   │   │
│  └────────────────────────────┬─────────────────────────────────┘   │
│                               │ JWT-authenticated REST/SSE           │
│  ┌────────────────────────────▼─────────────────────────────────┐   │
│  │  ZONE 2: Application Tier                                    │   │
│  │  ┌─────────┐  ┌────────┐  ┌──────────────┐                  │   │
│  │  │   API   │  │ Worker │  │ Data Indexer │                  │   │
│  │  └────┬────┘  └───┬────┘  └──────┬───────┘                  │   │
│  │       │           │              │                            │   │
│  └───────┼───────────┼──────────────┼────────────────────────────┘  │
│          │           │              │  No auth by default            │
│  ┌───────▼───────────▼──────────────▼────────────────────────────┐  │
│  │  ZONE 3: Data Tier                                            │  │
│  │  ┌────────┐  ┌─────────┐  ┌──────────────┐                  │  │
│  │  │ Qdrant │  │  Neo4j  │  │    Redis     │                  │  │
│  │  └────────┘  └─────────┘  └──────────────┘                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ZONE 4: External Managed Services                            │  │
│  │  Azure OpenAI  ·  Entra ID  ·  Azure Resource Graph          │  │
│  │  Azure Container Apps  ·  Microsoft Defender for Cloud       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**Boundary crossing controls:**

| Boundary | Control | Gap |
|----------|---------|-----|
| Zone 0 → Zone 1 | TLS (nginx) | None |
| Zone 1 → Zone 2 | Entra RS256 JWT validation | CORS policy is wildcard `*` (should be origin-locked) |
| Zone 2 → Zone 3 | Docker network isolation only | **No auth on Qdrant or Neo4j** |
| Zone 2 → Zone 4 | API key (Azure OpenAI), client credentials (MDC), OAuth tokens | Secrets stored in Qdrant (Zone 3) unencrypted |

---

## 9. Data Classification Registry

| Data Element | Classification | Where stored | Encrypted at rest | Encrypted in transit |
|-------------|---------------|-------------|-------------------|---------------------|
| User JWT (Entra) | Confidential | Browser memory only | N/A | Yes (TLS) |
| GitHub Installation Token | Restricted | Generated per-request; not persisted | N/A | Yes |
| GitHub App Private Key | Restricted | Env var (`GITHUB_PRIVATE_KEY`) | Depends on host | Yes |
| Slack Bot Token (`xoxb-*`) | Restricted | Qdrant (plaintext) | **No** | Yes |
| Defender Client Secret | Restricted | Qdrant (plaintext) | **No** | Yes |
| Azure OpenAI API Key | Restricted | Env var only | Depends on host | Yes |
| Task descriptions | Confidential | Qdrant | No | Yes |
| Task plans & results | Confidential | Qdrant | No | Yes |
| Chain-of-thought steps | Confidential | Qdrant | No | Yes |
| Source code (cloned) | Restricted | Temporary local disk | No | Yes |
| Security review answers | Confidential | Qdrant | No | Yes |
| Security review attestations | Confidential | Qdrant | No | Yes |
| Vector embeddings | Internal | Qdrant | No | Yes |
| Service relationship graph | Confidential | Neo4j | No | Yes |
| Threat model data | Confidential | Qdrant | No | Yes |
| Step memories (RLHF) | Confidential | Qdrant | No | Yes |
| Scan records | Internal | In-memory (API process) | N/A | N/A |

---

## 10. Consolidated Threat Matrix

The table below aggregates every open risk identified across all features, sorted by severity.

| ID | Service | Feature | Threat | Severity | Status |
|----|---------|---------|--------|----------|--------|
| C4-1 | API | Integration Mgmt | Defender `clientSecret` stored in plaintext in Qdrant | **Critical** | **Open** |
| C4-2 | API | Integration Mgmt | Slack `botToken` stored in plaintext in Qdrant | **Critical** | **Open** |
| S1-1 | Shared | Persistence | Qdrant has no authentication by default | **Critical** | **Open** |
| S1-2 | Shared | Persistence | Neo4j uses default password `neo4j/password` | **Critical** | **Open** |
| S1-3 | Shared | Persistence | Tenant isolation via application-layer filter only | **Critical** | **Open** |
| C1-4 | API | Chat | No per-tenant rate limiting on LLM endpoint | **High** | **Open** |
| C3-3 | API | Security Review | Attestations are mutable; no append-only guarantee | **High** | **Open** |
| C5-1 | API | Scan | Cloned source code not cleaned up after scan | **High** | **Open** |
| D1-2 | Data Indexer | Code Indexing | Clone directory persists beyond scan lifetime | **High** | **Open** |
| K3-3 | Core | Memory | Step memories may contain raw secrets from tool results | **High** | **Open** |
| U2-1 | UI | Task Console | Chain-of-thought display may show secrets returned by tools | **High** | **Open** |
| C3-2 | API | Security Review | Tenant header fallback bypasses JWT when no auth context | **Medium** | **Open** |
| S2-1 | Shared | Security Review | Attestations mutable in Qdrant (no signing) | **Medium** | **Open** |
| C2-3 | API | Task Execution | Runaway LLM worker exhausts Azure OpenAI quota | **Medium** | Partially mitigated (`maxIterations`) |
| D4-2 | Data Indexer | Vuln Analysis | Graph traversal depth unbounded on large estates | **Medium** | **Open** |
| K2-2 | Core | Tool Dispatch | MCP integration can register tool with conflicting name | **Medium** | **Open** |
| K3-2 | Core | Memory | Adversarial feedback can poison agent memories | **Medium** | **Open** |
| W2-3 | Worker | Cancellation | Cancellation race: irreversible tool action may complete | **Medium** | **Open** |
| C1-2 | API | Chat | Prompt injection via user message to access graph data | **Medium** | Partially mitigated (tenant-scoped queries) |
| C1-5 | API | Chat | Azure OpenAI API key may appear in error logs | **Medium** | **Open** |
| D1-1 | Data Indexer | Code Indexing | Secrets in source code stored in Qdrant metadata | **Medium** | Partially mitigated (`sanitizeMetadata`) |
| U3-1 | UI | Security Review | No role separation within tenant for review data | **Medium** | **Open** |

### Recommended Remediation Priority

1. **Immediate (Critical):**
   - Enable Qdrant API key authentication (`QDRANT_API_KEY`) in all environments.
   - Change Neo4j default password and enforce via environment variable validation at startup.
   - Encrypt integration secrets (Slack token, Defender client secret) using Azure Key Vault or an application-level KMS before writing to Qdrant.

2. **Short-term (High):**
   - Implement per-tenant rate limiting on `POST /api/chat` (e.g., `express-rate-limit` with Redis store).
   - Add automatic cleanup of cloned repository directories after scan completion.
   - Implement secret redaction in chain-of-thought rendering in the UI.
   - Apply cryptographic signing or an append-only log for security review attestations.

3. **Medium-term:**
   - Replace `x-tenant-id` header fallback in `resolveTenantId()` with strict JWT requirement.
   - Add depth cap to Neo4j graph traversal in vulnerability impact analysis.
   - Implement per-tool namespace isolation to prevent MCP tool name collisions.
   - Add `userId` claim tracking on task creation for per-user audit trails.
   - Enforce Content Security Policy headers in nginx for the UI.
