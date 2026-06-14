# ETL Flow Editor — Implementation Plan

**Status:** Ready for implementation  
**Date:** 2026-06-04  
**Scope:** `@ai-agent/shared`, `@ai-agent/data-indexer`, `@ai-agent/api`, `@ai-agent/ui`

---

## 1. Goal

Allow users to **view and edit the ETL pipeline** for each connector (code, cloud, Jira) through a dedicated full-page UX. The experience ships "ready out of the box" — every connected integration gets a pre-configured pipeline with sensible defaults that runs immediately. Users can then tune:

- Which pipeline stages run (and in what configuration)
- Which agents fire in the Semantic Analysis stage, with per-agent iteration caps
- Full agent prompt overrides (with base-prompt versioning to prevent silent drift)
- Run mode (full vs. incremental) and optional schedule

**Not in scope for this plan:** custom extractor code (L3), per-repo config overrides, Jira connector implementation, cost estimation UI.

---

## 2. Architecture Decisions (Locked)

| Decision | Choice | Reason |
|---|---|---|
| Config storage | `flow_config JSONB` column on `custom_integrations` | Keeps config co-located with the connector; no extra table overhead for v1 |
| Prompt source of truth | Code (agent definition files) = default; DB override per connector | Keeps prompts in version control; DB override is opt-in |
| Prompt versioning | Each agent definition gains `agentVersion: string`; override stores `basedOnVersion` | Surfaces "base prompt updated" warnings without blocking usage |
| Edit depth | L1 (orchestration) + L2 (full prompts) | Addendum-only is too weak; full override with versioning is the right bar |
| Stage dependencies | Declared in config type, enforced in backend validation and frontend UI | Prevents impossible configs |
| Navigation placement | New top-level nav item `Pipelines` → `/pipelines` and `/pipelines/:integrationId` | Decoupled from Integrations list; cleaner as a dedicated section |
| Active run surface | Full-page run view at `/pipelines/:integrationId/runs/:runId` + sticky banner | Existing SSE stream endpoint reused |

---

## 3. New Types — `packages/shared/src/types/flow-config.types.ts`

Create this file from scratch.

```typescript
export type PipelineDomain = 'iac' | 'services' | 'service_relationships' | 'features';

export type PipelineStageId =
  | 'discovery'
  | 'extraction'
  | 'transformation'
  | 'semanticAnalysis'
  | 'persistence';

// Dependency map: a stage can only be enabled if all its requires stages are enabled.
export const STAGE_DEPENDENCIES: Record<PipelineStageId, PipelineStageId[]> = {
  discovery: [],
  extraction: ['discovery'],
  transformation: ['extraction'],
  semanticAnalysis: ['transformation'],
  persistence: ['transformation'],
};

export interface AgentRunConfig {
  agentType: string;              // DataIndexerAgentType value
  enabled: boolean;
  maxIterationsOverride?: number; // bounded by definition's maxIterations at runtime
  promptOverride?: string;        // replaces base customInstructions; expert mode
  instructionAddendum?: string;   // appended to base prompt (safe, non-destructive)
  modelOverride?: 'small' | 'large';
  basedOnVersion?: string;        // agentVersion the prompt override was written against
}

export interface DiscoveryStageConfig {
  enabled: boolean;
  repositoryAllowlist: string[];  // empty = all repos
  branchFilter: string[];         // empty = default branch only
  includeArchived: boolean;
}

export interface ExtractionStageConfig {
  enabled: boolean;
  domains: PipelineDomain[];
}

export interface SemanticAnalysisStageConfig {
  enabled: boolean;
  agents: AgentRunConfig[];
}

export interface PersistenceStageConfig {
  enabled: boolean;
  targets: ('relational' | 'graph' | 'vector')[];
}

export interface ConnectorFlowConfig {
  connectorId: string;
  connectorType: 'code' | 'cloud';
  runType: 'full' | 'incremental';
  schedule?: string;              // cron expression, e.g. "0 2 * * *"
  stages: {
    discovery: DiscoveryStageConfig;
    extraction: ExtractionStageConfig;
    transformation: { enabled: boolean };
    semanticAnalysis: SemanticAnalysisStageConfig;
    persistence: PersistenceStageConfig;
  };
  updatedAt: string;
  updatedBy: string;
}

// Returned from GET /integrations/agent-catalog
export interface AgentCatalogEntry {
  agentType: string;
  displayName: string;
  description: string;
  whenToUse: string;
  domain: PipelineDomain;
  defaultModel: 'small' | 'large';
  defaultMaxIterations: number;
  maxIterationsLimit: number;
  agentVersion: string;
  hasFileTools: boolean;
}
```

**Export from `packages/shared/src/types/index.ts`** (add the new module to existing barrel export).

---

## 4. Database Changes

### 4.1 Migration

Create migration file `packages/shared/src/persistence/migrations/YYYYMMDD_add_flow_config.ts`:

```sql
-- Add flow config columns to custom_integrations
ALTER TABLE custom_integrations
  ADD COLUMN IF NOT EXISTS flow_config JSONB,
  ADD COLUMN IF NOT EXISTS flow_config_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flow_config_updated_by TEXT;
```

Apply the same migration to `mcp_integrations` if cloud connectors are stored there (verify at implementation time).

### 4.2 Schema update — `packages/shared/src/persistence/schema.ts`

Add to the `custom_integrations` table definition:

```typescript
flow_config: sql`JSONB`,
flow_config_updated_at: sql`TIMESTAMPTZ`,
flow_config_updated_by: sql`TEXT`,
```

---

## 5. Agent Definition Changes — `packages/data-indexer/src/agents/`

### 5.1 Update `DataIndexerAgentDefinition` type — `src/agents/types.ts`

Add `agentVersion`, `displayName`, `description`, `whenToUse`, `domain` fields:

```typescript
import { PipelineDomain } from '@ai-agent/shared';

export interface DataIndexerAgentDefinition extends AgentDefinition {
  agentVersion: string;           // e.g. '2026-06-04'  — bump on any prompt change
  displayName: string;            // human-readable, e.g. 'IaC Analyzer'
  description: string;            // what this agent does
  whenToUse: string;              // when to enable it
  domain: PipelineDomain;         // which ETL domain this belongs to
  completionToolFactory: () => Tool;
  toolsFactory?: (workspacePath: string) => Tool[];
}
```

### 5.2 Update every agent definition file — `src/agents/definitions/*.ts`

Each of the 16 definition files must add the four new fields. Domain mapping:

| Agent file | domain | displayName |
|---|---|---|
| `iacAnalyzerAgent.ts` | `iac` | IaC Analyzer |
| `buildArtifactAnalyzerAgent.ts` | `iac` | Build Artifact Analyzer |
| `scriptAnalyzerAgent.ts` | `iac` | Script Analyzer |
| `repositoryBriefingAgent.ts` | `services` | Repository Briefing |
| `serviceFileMapperAgent.ts` | `services` | Service File Mapper |
| `serviceSkeletonExtractorAgent.ts` | `services` | Service Skeleton Extractor |
| `serviceExternalSurfaceAgent.ts` | `services` | Service External Surface |
| `serviceAnalyzerAgent.ts` | `services` | Service Analyzer (Legacy) |
| `serviceCallCorrelatorAgent.ts` | `service_relationships` | Service Call Correlator |
| `featureListExtractorAgent.ts` | `features` | Feature List Extractor |
| `dfdExtractorAgent.ts` | `features` | DFD Extractor |
| `featureThreatModelAgent.ts` | `features` | Feature Threat Model |
| `serviceDfdSynthesisAgent.ts` | `features` | Service DFD Synthesis |
| `serviceThreatModelAgent.ts` | `features` | Service Threat Model |
| `exploitabilityAnalyzerAgent.ts` | `features` | Exploitability Analyzer |
| `prValidationAgent.ts` | `services` | PR Validation |

Each gets `agentVersion: '2026-06-04'` initially. Bump this string any time `customInstructions` changes.

### 5.3 Update `DataIndexerAgentRegistry` — `src/agents/registry.ts`

Add override support to `createTask()`:

```typescript
createTask(
  agentType: string,
  overrides?: Omit<Partial<TaskConfig>, 'tools' | 'customInstructions'> & {
    maxIterationsOverride?: number;
    instructionAddendum?: string;
    promptOverride?: string;
    modelOverride?: 'small' | 'large';
  }
): Task {
  const def = this.get(agentType);

  const effectiveModel = overrides?.modelOverride ?? def.model;
  const api = effectiveModel === AgentModel.Small && this.smallApi
    ? this.smallApi
    : this.api;

  const baseInstructions = overrides?.promptOverride ?? def.customInstructions;
  const effectiveInstructions = overrides?.instructionAddendum
    ? `${baseInstructions}\n\n---\nAdditional instructions:\n${overrides.instructionAddendum}`
    : baseInstructions;

  const cap = def.maxIterations;
  const effectiveMaxIterations = overrides?.maxIterationsOverride
    ? Math.min(overrides.maxIterationsOverride, cap)
    : cap;

  const fileTools = def.toolsFactory
    ? def.toolsFactory((overrides as any)?.workspacePath ?? '')
    : [];
  const completionTool = def.completionToolFactory();

  return new Task(api, {
    ...overrides,
    tools: [...fileTools, completionTool],
    customInstructions: effectiveInstructions,
    maxIterations: effectiveMaxIterations,
  });
}

// New method for catalog endpoint
getCatalog(): AgentCatalogEntry[] {
  return this.getAll().map(def => ({
    agentType: def.agentType,
    displayName: def.displayName,
    description: def.description,
    whenToUse: def.whenToUse,
    domain: def.domain,
    defaultModel: def.model === AgentModel.Small ? 'small' : 'large',
    defaultMaxIterations: def.maxIterations,
    maxIterationsLimit: def.maxIterations,
    agentVersion: def.agentVersion,
    hasFileTools: !!def.toolsFactory,
  }));
}
```

### 5.4 Update `CodeIndexingPipeline` — `src/connectors/code.pipeline.ts`

The pipeline's `run()` method accepts an optional `ConnectorFlowConfig`. When provided, it gates each stage and passes agent overrides to the registry.

```typescript
// Add to constructor signature:
constructor(
  tenantId: TenantId,
  integrationOrIntegrations: CodeIntegrationHandler | CodeIntegrationHandler[],
  config: CodeIndexerConfig,
  flowConfig?: ConnectorFlowConfig,   // new optional param
)

// Store as private property:
private flowConfig?: ConnectorFlowConfig;
```

Inside `run()`, before each stage block, add guards:

```typescript
// Example: gate the semantic analysis stage
const semanticEnabled = this.flowConfig?.stages.semanticAnalysis.enabled ?? true;
if (semanticEnabled) {
  // existing semantic analysis code
}

// When spawning agents via the registry, resolve per-agent overrides:
const agentOverrides = this.resolveAgentOverrides(agentType);
const task = this.registry.createTask(agentType, { ...workspaceOverrides, ...agentOverrides });
```

Add private helper:

```typescript
private resolveAgentOverrides(agentType: string): AgentTaskOverrides {
  if (!this.flowConfig) return {};
  const agentConfig = this.flowConfig.stages.semanticAnalysis.agents
    .find(a => a.agentType === agentType);
  if (!agentConfig || !agentConfig.enabled) return {};
  return {
    maxIterationsOverride: agentConfig.maxIterationsOverride,
    instructionAddendum: agentConfig.instructionAddendum,
    promptOverride: agentConfig.promptOverride,
    modelOverride: agentConfig.modelOverride,
  };
}
```

Apply domain-level gating: if `flowConfig.stages.extraction.domains` does not include `'iac'`, skip IaC-specific extractors. Map extraction domain to agent types:

```typescript
const DOMAIN_AGENTS: Record<PipelineDomain, string[]> = {
  iac: ['iac-analyzer', 'build-artifact-analyzer', 'script-analyzer'],
  services: ['repository-briefing', 'service-file-mapper', 'service-skeleton-extractor', 'service-external-surface'],
  service_relationships: ['service-call-correlator'],
  features: ['feature-list-extractor', 'dfd-extractor', 'feature-threat-model', 'service-dfd-synthesis', 'service-threat-model', 'exploitability-analyzer'],
};
```

---

## 6. API Changes — `packages/api/`

### 6.1 Default flow config generator — `src/services/flowConfigService.ts` (new file)

```typescript
import { ConnectorFlowConfig, AgentCatalogEntry } from '@ai-agent/shared';

export function generateDefaultFlowConfig(
  connectorId: string,
  connectorType: 'code' | 'cloud',
  agentCatalog: AgentCatalogEntry[],
): ConnectorFlowConfig {
  return {
    connectorId,
    connectorType,
    runType: 'incremental',
    stages: {
      discovery: {
        enabled: true,
        repositoryAllowlist: [],
        branchFilter: [],
        includeArchived: false,
      },
      extraction: {
        enabled: true,
        domains: ['iac', 'services', 'service_relationships', 'features'],
      },
      transformation: { enabled: true },
      semanticAnalysis: {
        enabled: true,
        agents: agentCatalog.map(entry => ({
          agentType: entry.agentType,
          enabled: true,
          basedOnVersion: entry.agentVersion,
        })),
      },
      persistence: {
        enabled: true,
        targets: ['relational', 'graph', 'vector'],
      },
    },
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
}

export function validateFlowConfig(config: ConnectorFlowConfig): string[] {
  const errors: string[] = [];
  const { stages } = config;

  if (stages.extraction.enabled && !stages.discovery.enabled)
    errors.push('Extraction requires Discovery to be enabled.');
  if (stages.transformation.enabled && !stages.extraction.enabled)
    errors.push('Transformation requires Extraction to be enabled.');
  if (stages.semanticAnalysis.enabled && !stages.transformation.enabled)
    errors.push('Semantic Analysis requires Transformation to be enabled.');
  if (stages.persistence.enabled && !stages.transformation.enabled)
    errors.push('Persistence requires Transformation to be enabled.');

  return errors;
}
```

### 6.2 Flow config controller — `src/controllers/flowConfigController.ts` (new file)

```typescript
export class FlowConfigController {
  constructor(
    private customIntegrationRepo: ICustomIntegrationRepository,
    private registry: DataIndexerAgentRegistry,
  ) {}

  // GET /integrations/:id/flow-config
  async getFlowConfig(req: Request, res: Response): Promise<void>
  // Returns stored flow_config or generates+returns default if null.
  // Sets staleAgents[] — agents whose basedOnVersion < current agentVersion.

  // PUT /integrations/:id/flow-config
  async updateFlowConfig(req: Request, res: Response): Promise<void>
  // Validates config, persists to flow_config column, updates flow_config_updated_at/by.

  // GET /integrations/agent-catalog
  async getAgentCatalog(_req: Request, res: Response): Promise<void>
  // Returns registry.getCatalog()
}
```

### 6.3 Route registration — `src/index.ts`

Add routes under the existing `/integrations` prefix:

```
GET  /integrations/agent-catalog
GET  /integrations/:id/flow-config
PUT  /integrations/:id/flow-config
```

### 6.4 Update `ScanOptions` — `src/services/scanService.ts`

```typescript
export interface ScanOptions {
  enableCloudDiscovery: boolean;
  scope?: 'all' | 'code' | 'cloud';
  repositories?: string[];
  runType?: 'full' | 'incremental';
  domains?: ScanDomain[];
  flowConfig?: ConnectorFlowConfig;   // new — passed through to the pipeline
}
```

The `scanService` must pass `options.flowConfig` down when constructing `CodeIndexingPipeline`.

### 6.5 Auto-generate default config on integration creation

In the existing custom integration create handler, after saving the integration, call `generateDefaultFlowConfig()` and immediately save it back:

```typescript
// after createCustomIntegration succeeds:
const catalog = registry.getCatalog();
const defaultConfig = generateDefaultFlowConfig(newIntegration.id, 'code', catalog);
await customIntegrationRepo.updateFlowConfig(newIntegration.id, defaultConfig);
```

---

## 7. Frontend Changes — `packages/ui/`

### 7.1 New routes — `src/pages/App.tsx`

```typescript
/pipelines                           → PipelinesPage
/pipelines/:integrationId            → PipelineDetailPage
/pipelines/:integrationId/runs/:runId → PipelineRunPage
```

### 7.2 Nav item — `src/layout/MainLayout.tsx` (or `Sidebar.tsx`)

Add to `NAV_ITEMS`:

```typescript
{ key: 'pipelines', icon: ApartmentOutlined, label: 'Pipelines' }
```

Place it after `integrations`.

### 7.3 New API service — `src/services/pipelineService.ts` (new file)

```typescript
export const pipelineService = {
  getFlowConfig(integrationId: string): Promise<ConnectorFlowConfig & { staleAgents: string[] }>,
  updateFlowConfig(integrationId: string, config: ConnectorFlowConfig): Promise<ConnectorFlowConfig>,
  getAgentCatalog(): Promise<AgentCatalogEntry[]>,
};
```

Uses `fetchWithAuth` with `${API_BASE}/integrations/*`.

### 7.4 New hooks — `src/hooks/`

**`usePipelines.ts`**
```typescript
export function usePipelines() {
  // Fetches all integrations, joins with their last indexing_run status.
  // Returns: { pipelines: PipelineSummary[], loading, error }
}

interface PipelineSummary {
  integrationId: string;
  integrationName: string;
  connectorType: 'code' | 'cloud';
  lastRunAt?: string;
  lastRunStatus?: 'completed' | 'failed' | 'running';
  entityCount?: number;
}
```

**`useFlowConfig.ts`**
```typescript
export function useFlowConfig(integrationId: string) {
  // Returns: { config, staleAgents, agentCatalog, loading, save, reset }
  // save(updated: ConnectorFlowConfig): Promise<void>
  // reset(): void  — reverts local state to last saved
}
```

**`usePipelineRun.ts`**
```typescript
export function usePipelineRun(integrationId: string) {
  // Wraps existing scan SSE stream.
  // Returns: { activeRun, startRun, cancelRun, runHistory }
}
```

### 7.5 New pages

#### `PipelinesPage.tsx` — `/pipelines`

Simple table/card list. One row per integration:

- Connector name + type badge
- Last run: relative time + status chip (`completed` / `failed` / `running`)
- Entity count
- "View Pipeline →" link to detail page

If no integrations exist: empty state with link to `/integrations`.

#### `PipelineDetailPage.tsx` — `/pipelines/:integrationId`

Full-page layout with four tabs: **Flow | Agents | Runs | Settings**

**Header (always visible):**
```
[← Pipelines]  GitHub · batta-ai                [Run Full ▶] [Run Incremental ⟳]

  Active run: Discovery ██████░░ 2/3 repos...  [View live →]   ← visible only when running
```

**Flow tab** — horizontal pipeline canvas. Stages displayed left to right as cards. Each card:

- Stage name + enabled toggle
- Last-run stats (item count, duration)
- Status chip
- Click to expand inline (accordion) — shows that stage's config fields

Stage config fields per stage type:

| Stage | Config fields |
|---|---|
| Discovery | Repo allowlist (multi-select from known repos), branch filter, include archived toggle |
| Extraction | Domain checkboxes: IaC / Services / Service Relationships / Features |
| Transformation | Enabled only (no user-configurable fields) |
| Semantic Analysis | Shows count of enabled agents; "Edit agents →" link to Agents tab |
| Persistence | Target checkboxes: Relational / Graph / Vector |

Stage cards with missing upstream dependencies shown greyed-out with tooltip: _"Requires Transformation to be enabled."_

**Agents tab** — flat list of all 16 agents, grouped by domain accordion.

Each agent row:
- Name, description, domain badge
- Enabled toggle
- Iterations chip (shows current / max)
- Click row to expand inline:
  - Model selector (Small / Large)
  - Max Iterations slider (1 – definition max)
  - Instruction Addendum textarea (label: "Append to base prompt")
  - Prompt Override textarea (label: "Replace base prompt — expert mode") behind "Unlock" toggle with warning
  - If `basedOnVersion < agentVersion`: yellow banner _"Base prompt updated since your override. [View diff] [Rebase]"_

**Runs tab** — list of past runs (from `indexing_runs` table):

- Run type badge, timestamp, duration, status
- Expand to see per-stage breakdown: stage name, items processed, errors
- "View live" link for in-progress runs (navigates to `PipelineRunPage`)

**Settings tab:**

- Run type: Full / Incremental (radio)
- Schedule: cron input with human-readable preview (e.g. "Every day at 2:00 AM")
- Danger zone: "Reset all customizations to default" (requires confirmation)
- Config metadata: Last updated by / at

**Unsaved changes indicator:**
- When any field is dirty: sticky bottom bar appears — `"Unsaved changes  [Discard] [Save]"`
- On navigation away with unsaved changes: browser-native confirm dialog

**Diff from default banner:**
- If config differs from what `generateDefaultFlowConfig` would produce: banner at top of page — `"N customizations from default.  [View diff] [Reset all]"`

#### `PipelineRunPage.tsx` — `/pipelines/:integrationId/runs/:runId`

Live run view. Consumes existing SSE endpoint `POST /knowledge-base/scan/stream`.

Layout: vertical stage list, each with animated progress bar and live item count. Error list at bottom. "Cancel run" button (calls `DELETE /knowledge-base/scan/:scanId` — add this endpoint if it doesn't exist).

### 7.6 Shared components — `src/components/pipeline/`

Create the following components (new directory):

| Component | Props | Purpose |
|---|---|---|
| `StageCard.tsx` | `stage, config, lastRunStats, onConfigChange` | One pipeline stage — expandable |
| `AgentRow.tsx` | `agent, config, catalogEntry, staleVersion, onConfigChange` | One agent row with inline edit |
| `DomainGroup.tsx` | `domain, agents, configs, onConfigChange` | Accordion group of agents by domain |
| `PromptEditor.tsx` | `basePrompt, override, addendum, onChange, locked` | Prompt override + addendum editor |
| `PipelineCanvas.tsx` | `stages, stageConfigs, onStageChange` | Horizontal stage layout with connectors |
| `RunStatusBanner.tsx` | `activeRun` | Sticky top banner during active run |
| `StalePromptBanner.tsx` | `agentType, currentVersion, basedOnVersion, onRebase` | Prompt drift warning |
| `UnsavedChangesBar.tsx` | `isDirty, onSave, onDiscard` | Sticky bottom save bar |

---

## 8. Type Exports

Update `packages/shared/src/types/index.ts` to export from `flow-config.types.ts`:

```typescript
export * from './flow-config.types';
```

---

## 9. Implementation Sequence

Execute phases in order. Each phase is independently deployable (no broken states mid-phase).

### Phase 1 — Foundation (shared + data-indexer, no UI)

1. Create `packages/shared/src/types/flow-config.types.ts` with all types from §3.
2. Export from `packages/shared/src/types/index.ts`.
3. Write and run DB migration from §4.1.
4. Update `packages/shared/src/persistence/schema.ts` from §4.2.
5. Add `agentVersion`, `displayName`, `description`, `whenToUse`, `domain` to `DataIndexerAgentDefinition` (§5.1).
6. Update all 16 agent definition files (§5.2) — add the four fields, set `agentVersion: '2026-06-04'`.
7. Update `DataIndexerAgentRegistry.createTask()` with override support and add `getCatalog()` (§5.3).

**Checkpoint:** All existing tests pass. `registry.getCatalog()` returns 16 entries.

### Phase 2 — Pipeline integration

1. Update `CodeIndexingPipeline` constructor to accept optional `ConnectorFlowConfig` (§5.4).
2. Add stage gating and `resolveAgentOverrides()` helper in `run()`.
3. Wire `DOMAIN_AGENTS` map for extraction domain gating.
4. Update `ScanOptions` with `flowConfig?: ConnectorFlowConfig` (§6.4).
5. Pass `flowConfig` from `scanService` through to pipeline construction.

**Checkpoint:** Existing scan flow works unchanged when `flowConfig` is null. A config with one stage disabled correctly skips that stage.

### Phase 3 — API

1. Create `packages/api/src/services/flowConfigService.ts` (§6.1).
2. Create `packages/api/src/controllers/flowConfigController.ts` (§6.2).
3. Register routes in `src/index.ts` (§6.3).
4. Auto-generate default config on integration create (§6.5).
5. Backfill default configs for all existing integrations that have `flow_config IS NULL` — write a one-time migration script.

**Checkpoint:** `GET /integrations/agent-catalog` returns 16 entries. `GET /integrations/:id/flow-config` returns a populated config. `PUT` with a disabled stage persists and a subsequent scan respects it.

### Phase 4 — Frontend

1. `pipelineService.ts` — API client wrapper (§7.3).
2. `usePipelines.ts`, `useFlowConfig.ts`, `usePipelineRun.ts` hooks (§7.4).
3. Shared components under `src/components/pipeline/` (§7.6) — build in dependency order: `PromptEditor` → `AgentRow` → `DomainGroup` → `StageCard` → `PipelineCanvas`, then banners.
4. `PipelinesPage.tsx` — simple list, no editing (§7.5).
5. `PipelineDetailPage.tsx` — four tabs; implement Flow tab first, then Agents, then Runs, then Settings (§7.5).
6. `PipelineRunPage.tsx` — live run view (§7.5).
7. Add routes to `App.tsx` (§7.1).
8. Add nav item to sidebar (§7.2).

**Checkpoint:** End-to-end: navigate to Pipelines, see integrations listed, open one, see all stages, toggle an agent off, save, trigger a run, observe the agent is skipped.

---

## 10. Key Invariants for the Implementing Agent

- **Never break the existing scan flow.** All changes to `CodeIndexingPipeline` and `ScanOptions` must be backward-compatible — treat `flowConfig: undefined` as "use all defaults."
- **Do not store agent prompts in the DB by default.** The DB stores only overrides. The code definition is always the fallback.
- **Bound maxIterations at the registry, not the API.** The API accepts any integer; the registry silently clamps it to the definition's `maxIterations`.
- **Stage dependency validation happens at both API (save) and UI (render time).** A config that fails validation must be rejected with a 400 and `{ errors: string[] }` body.
- **`agentVersion` must be bumped in the definition file any time `customInstructions` changes**, so the stale-prompt banner fires for users who have overridden that prompt.
- **The `flow_config_updated_by` field stores the authenticated user's ID** (from `req.user.sub` or equivalent — match the pattern used elsewhere in the API controllers).

---

## 11. Out of Scope

- Per-repository config overrides within a connector (v2)
- Cost / time estimation pre-flight (v2)
- Custom extractor code / plugin SDK (L3 — future)
- Jira connector implementation
- Config version history / audit diff UI (the DB stores `updatedAt`/`updatedBy`; a full audit log is future)
- Prompt "rebase" UI — the banner appears but the rebase action is deferred; for now clicking "Rebase" clears the override (copies new default)
