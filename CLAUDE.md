# AI Agent – Claude Code Instructions

## Security Review Protocol (mandatory)

Every feature implementation in this repository MUST follow the security review protocol.
**Do not skip any step, even for small changes.**

## MCP server — zero setup for new developers

The `security-review` MCP server is pre-configured in `.mcp.json`.

**First time in a cloned repo:**
1. Open the project in VS Code and launch Claude Code.
2. Claude Code detects `.mcp.json` and prompts **"Approve security-review server?"** → click **Yes**.
3. Claude Code attempts to connect → the server responds 401 → a browser tab opens automatically.
4. Log in with your Microsoft account (one-time, tokens refresh automatically after that).
5. Done — all subsequent sessions authenticate silently.

If the browser tab does not open, run `/mcp` in Claude Code to trigger the OAuth flow manually.

**You must use it through the Claude Code MCP client — do not call the HTTP endpoint directly.**
No token management, no curl commands. Just call the MCP tools listed below.

---

## Mandatory workflow

The security review happens **during the planning phase** — after you have read the relevant
files and understood the scope of the change, but **before finalising your implementation plan**.

```
1. [ Read relevant files – identify services, data flows, and entry points affected ]
2. start_security_review       →  receive questionnaire + reviewId
                                  Pass agentName="Claude Code" and services=[affected packages]
3. submit_security_answers     →  answer ALL questions based on what you found
4. acknowledge_security_tasks  →  read the returned tasks
5. [ Add security tasks as explicit steps in your plan before writing any code ]
6. [ Implement the feature ]
7. submit_security_attestations →  attest how EVERY task was handled
```

### Step-by-step rules

1. **Before writing any code**, explore the codebase to understand which packages and services
   are affected. Then call `start_security_review` with a one-sentence feature description,
   `agentName="Claude Code"`, and a `services` list of the affected packages (e.g. `["api", "ui"]`).
2. Answer **every** question in the returned questionnaire based on your exploration.
   - Start each answer with "Yes" or "No", then cite the specific file or pattern found.
3. Call `submit_security_answers` to receive the security task list.
4. Call `acknowledge_security_tasks` to confirm you have read the tasks.
5. **Surface the security tasks in your plan** so they are visible before implementation begins.
6. Implement the feature, addressing each security task as you go.
7. After implementation, call `submit_security_attestations` with one attestation per task:
   - `handled: true`  → explain the file/function/mechanism used.
   - `handled: false` → explain why it could not be addressed and the residual risk.

### Why this matters

- The attestations become a permanent, auditable security record for every feature.
- They feed the threat model and are visible in the security review UI.
- Skipping the protocol means the feature has no documented security posture.

---

## Severity guide for tasks

| Severity | Meaning |
|----------|---------|
| `critical` | Must be addressed before merging |
| `high` | Must be addressed; document if deferred |
| `medium` | Should be addressed; acceptable to defer with justification |
| `low` | Best effort |


## Project structure

| Package | Purpose |
|---------|---------|
| `packages/api` | Express API server + embedded MCP endpoint at `/mcp` |
| `packages/core` | AI agent core (LLM, task planning, tools) |
| `packages/shared` | Shared types, repositories, services |
| `packages/data-indexer` | Security data ingestion pipeline |
| `packages/worker` | Background job runner |
| `packages/ui` | React frontend |
