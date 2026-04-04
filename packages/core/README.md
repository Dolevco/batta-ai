# ai-agent — core package

The `core` package contains the primitives and building blocks used by the ai-agent project: tasks, tools, memory abstractions, planners and helpers for composing multi-step or multi-agent workflows.

This README summarises the main concepts, the important classes and modules, and points to examples in the `examples/` folder.

---

## Quick overview

- **Task**: the main agent class — direct tool access + built-in `agent` meta-tool for spawning sub-agents. All Tasks have this capability.
- **Tool**: a capability the agent can call (file access, shell commands, external services, delegated sub-agents, etc.).
- **Short-term memory**: in-context memory used during a single task execution (streams of messages, ephemeral summaries).
- **Long-term memory**: persistent, embedding-backed memory (used for plan caching, retrieval across runs).
- **PlannedTask**: two-stage task that first generates a structured plan (sub-tasks + dependencies) then executes it.

---

## Concepts

### Task
A Task is the primary abstraction that models an agent's job:

- Receives a textual description or intent to accomplish.
- Maintains a conversation (messages) with the LLM provider.
- Selects and calls Tools to perform side-effects or fetch information.
- Emits events (for example: `message`, `toolUse`, `toolResult`) that consumers can subscribe to.
- Can delegate work to sub-agents via the built-in `agent` tool, or break work into sub-tasks.

Every `Task` automatically receives these built-in tools:
- `task_complete` — signals task completion.
- `todo_write` / `todo_read` — structured todo list for multi-step tracking.
- `agent` — spawns a focused sub-agent that runs to completion and returns a concise summary.

The system prompt is built automatically from `mode`, `workspace`, and `customInstructions` — no need to craft it manually.

Core classes related to tasks live in `src/task/`:
- `task.ts` — main Task implementation (parallel tool execution, agent spawning, token budget, session memory)
- `plannedTask.ts` & planner/ — two-stage planning-capable task


### Task 

1. **Direct tool calls**: for simple, single-step operations (read a file, search, list a directory, run a command) the model calls the tool directly. This is faster and cheaper than spawning a sub-agent.

2. **`agent` tool for sub-agents**: for complex, multi-step, or isolated work the model uses the built-in `agent` meta-tool, which creates a focused sub-agent, runs it to completion, and returns a concise summary.

3. **Fork mode** (`agent` with `fork=true`): the sub-agent inherits the parent's full conversation history. Ideal for research or exploration tasks where re-discovering context would be wasteful. Fork children share the parent's prompt cache — they're cheap to start.

4. **Parallel sub-agents**: the model can spawn multiple independent agents in a single message. They execute concurrently.

5. **Agent registry**: an optional `AgentRegistry` lets you define typed agents (e.g. `code-reviewer`, `explore`) with scoped tool allowlists, custom instructions, and per-agent memory. The `agent` tool's `subagent_type` parameter selects from the registry.

```typescript
const task = new Task(apiClient, {
  tools: allTools,          // all tools — model can call them directly
  mode: MODES.CODE_ASSISTANT,
  workspace: '/',
  agentRegistry: myRegistry // optional typed agents
});

// agent tool, todo_write/todo_read, and task_complete are injected automatically.
// The system prompt is built from mode + workspace automatically.
const result = await task.execute('Find all TypeScript files and summarise the architecture');
```

### Tool
A Tool is a modular capability the Task can invoke. Tools are plain TypeScript objects implementing a simple interface (name, description, parameters, and an executor).

Tool categories included in this package:
- Files and filesystem helpers (`tools/files/`)
- Shell/command tools (`tools/command/`)
- Chat/interaction tools (`tools/interactions/`)
- Task-related tools (`tools/task/`) — `task_complete`, `todo_write`, `todo_read`
- MCP tools & loaders (`tools/mcp/`) — run remote or jailed agents via MCP servers/containers
- Paging & data access helpers (`tools/paging/`)
- Planner tools (`tools/planner/`) — helpers for plan generation and execution
- Delegation/provider utilities (`tools/delegation/`) — includes `AgentTool`

Factory helpers exist such as `createFileTools`, `createCommandTools`, `createChatInteractionTools` and `createTaskTools` to quickly assemble a toolset for a Task.


### Short-term memory
Short-term memory refers to in-memory, ephemeral memory used by a Task while it runs. Its purpose is to:

- Store recent messages and context needed for the LLM.
- Provide short summaries when full context is too large for the model.
- Support task-local summarizers and rolling memory strategies.

Short-term memory implementations live under `src/context/memory/shortTerm/` and are used automatically by Tasks.


### Long-term memory
Long-term memory is persistent and typically backed by embedding-based retrieval. It is used for:

- Storing and retrieving past plans (Plan caching)
- Remembering facts across task runs
- Building semantic search indexes for later retrieval

The package includes a `LongTermMemory` abstraction (`src/context/memory/longTerm/longTermMemory.ts`) which depends on an embedding client. Typical usage uses an embedding provider (for example the `AzureOpenAIEmbeddingClient`) and configures a collection name and similarity thresholds.


## Task types

- **Task** (main): direct tool access + built-in `agent` meta-tool for spawning sub-agents, parallel execution, token budget, session memory. The default mode is `DELEGATING_TASK` — a task orchestrator that calls tools directly for simple work and uses `agent` for complex multi-step work.
- **PlannedTask**: generates explicit plans (sub-tasks with dependencies) and can cache/reuse plans via `PlanMemory` and `LongTermMemory`.

PlannedTask exposes helpers such as:
- `generatePlan(description)` — returns a `StoredPlan` with `subTasks` (dependencies are computed at execution time).
- `executeWithPlanCache(description)` — attempts to reuse a cached plan (semantic similarity) and executes it.
- `execute(description)` — runs the task directly, potentially delegating sub-tasks.

Look at `src/task/planner/` for `PlanMemory`, `planMemory` usage and plan data structures such as `StoredPlan` and `PlanResult`.


## System prompt sections
The stable system prompt (cached between calls) contains these sections:
- **System** — parallel execution, concurrency-safe tool batching
- **Doing tasks** — autonomy, no fabrication, efficient tool use
- **Executing actions with care** — reversibility, blast radius
- **Using your tools** — JSON format, parallel tool call examples
- **Task management** — `todo_write` / `todo_read` usage rules
- **Spawning sub-agents** — when to call tools directly vs. use the `agent` tool; fork vs. fresh agent; parallel agents
- **Output efficiency** — concise, actionable output

Dynamic sections (appended per-call): available tools, mode instructions, workspace, environment.


## Events and observability
Tasks emit events that consumers can listen to. Common events include:
- `message` — when the task or LLM produces a message
- `toolUse` — when a tool call is planned or executed
- `toolResult` — a tool returned a result or error
- `subAgentProgress` — progress update from a running sub-agent
- `tokenBudgetWarning` / `tokenBudgetExceeded` — token budget notifications

The examples in `packages/core/examples/` demonstrate subscribing to these events and printing concise, human-readable logs.


## Examples & running
The `examples/` folder contains runnable examples that show common usage patterns:
- `basic-usage.ts` — start a Task with a minimal toolset
- `hierarchical-usage.ts` — example of hierarchical tasks and nested orchestration
- `mcp-usage.ts` — shows loading MCP servers and using MCP-based tools
- `planned-task-usage.ts` — demonstrates `PlannedTask`, plan generation, caching and execution
- `code-usage.ts` — Task with git tools for automated code-fix workflows
