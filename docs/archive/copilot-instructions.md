# Security Review Protocol for GitHub Copilot

Every feature implementation in this repository MUST follow the security review protocol.
**Do not skip any step, even for small changes.**

## MCP server — no configuration needed

The `security-review` MCP server is pre-configured in `.vscode/mcp.json`.
**You must use it through VS Code's MCP client — do not call the HTTP endpoint directly.**

- VS Code discovers the server automatically from `.vscode/mcp.json`.
- Authentication (Azure Entra ID OAuth, PKCE) is handled entirely by VS Code on first use — no manual steps required.
- No setup, no token management, no curl commands. Just call the MCP tools listed below.

---

## Mandatory workflow

The security review happens **during the planning phase** — after you have read the relevant
files and understood the scope of the change, but **before finalising your implementation plan**.

```
1. [ Read relevant files – identify services, data flows, and entry points affected ]
2. start_security_review       →  receive questionnaire + reviewId
                                  Pass agentName="GitHub Copilot" and services=[affected packages]
3. submit_security_answers     →  answer ALL questions based on what you found
4. acknowledge_security_tasks  →  read the returned tasks
5. [ Add security tasks as explicit steps in your plan before writing any code ]
6. [ Implement the feature ]
7. submit_security_attestations →  attest how EVERY task was handled
```

### Step-by-step rules

1. **Before writing any code**, explore the codebase to understand which packages and services
   are affected. Then call `start_security_review` with a one-sentence feature description,
   `agentName="GitHub Copilot"`, and a `services` list of the affected packages.
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
