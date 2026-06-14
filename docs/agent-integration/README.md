# Agent Integration

Batta brings security-by-design guidance into agentic development. It gives coding agents
the code, cloud, and architecture context they need to reason about security before
implementation, similar to the design reviews human security architects provide before code
is written.

Most users should use agent-led onboarding. Start Batta locally, choose a stable repository
key such as `payments-service` or `customer-portal`, then paste this into your coding agent
while the target repository is open:

```text
Fetch Batta onboarding instructions from:
http://localhost:3101/api/onboarding/agent-led?repo=<repo-name>

Then follow those instructions in this repository. Configure MCP, verify the connection, and index this repository before considering onboarding complete so future reviews have architecture context.
```

## Cloud Graph Context

Connect an LLM/embeddings provider and a cloud integration to let Batta map live cloud
resources into the knowledge graph. This links code, services, identities, infrastructure,
data stores, and trust boundaries so reviews can account for both application behavior and
cloud architecture before code is written.

- [Agent-led onboarding](./agent-led-onboarding.md)
- [Manual MCP configuration](./mcp-config.md)
- [Manual human setup](./human-onboarding.md)
