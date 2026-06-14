# MCP Configuration Reference

Use this page when you need exact MCP config shapes, production OAuth settings, or repo
scoping rules. For first-time setup, start with
[agent-led onboarding](./agent-led-onboarding.md).

## Local development

Local Batta MCP URL:

```text
http://localhost:3101/api/mcp?repo=<repo-name>
```

Required local Batta `.env` values:

```env
HTTPS=false
AUTH_DISABLED=true
TENANT_ID=local
EMBEDDINGS_ENABLED=false
DATABASE_URL=postgresql://app:changeme@localhost:5432/app
REDIS_URL=redis://localhost:6379
```

### VS Code local config

VS Code uses top-level `servers`.

File: `.vscode/mcp.json`

```json
{
  "servers": {
    "batta": {
      "type": "http",
      "url": "http://localhost:3101/api/mcp?repo=<repo-name>"
    }
  }
}
```

### Claude Code local config

Claude Code uses top-level `mcpServers`.

File: `.claude/mcp.json`

```json
{
  "mcpServers": {
    "batta": {
      "type": "http",
      "url": "http://localhost:3101/api/mcp?repo=<repo-name>"
    }
  }
}
```

## Production OAuth

Production Batta MCP URL:

```text
https://<your-batta-host>/api/mcp?repo=<repo-name>
```

### VS Code production config

```json
{
  "servers": {
    "batta": {
      "type": "http",
      "url": "https://<your-batta-host>/api/mcp?repo=<repo-name>",
      "authorization_token": "<entra-bearer-token>"
    }
  }
}
```

### Claude Code production config

```json
{
  "mcpServers": {
    "batta": {
      "type": "http",
      "url": "https://<your-batta-host>/api/mcp?repo=<repo-name>",
      "authorization_token": "<entra-bearer-token>"
    }
  }
}
```

Claude Code handles the OAuth PKCE flow automatically on first use when the server
advertises OAuth metadata. It opens a browser for Entra login and caches the token.

## `?repo=` scoping

The `?repo=` query parameter scopes all indexed data and review sessions to a named
repository within your tenant.

Rules:

- Use the same value consistently across sessions to resume or update an existing index.
- The value does not need to match the git remote URL. It is a stable scoping key.
- Use short names such as `payments-service`, `batta-ai`, or `infra`.
- Do not put secrets or private URLs in the repo key.

## Entra ID app registration

Required only for production OAuth.

1. Create an App Registration in Azure Entra ID.
2. Open **Expose an API** and add the `security_review` scope.
   Scope URI: `api://<client-id>/security_review`
3. Open **Authentication** and add redirect URIs:
   - `https://vscode.dev/redirect`
   - `https://<your-batta-host>/oauth/callback`
4. Set production Batta `.env` values:

```env
ENTRA_TENANT_ID=<tenant-guid>
ENTRA_CLIENT_ID=<app-registration-id>
MCP_ISSUER_URL=https://<your-batta-host>
HTTPS=true
```

## Common config mistakes

- VS Code config must use top-level `servers`.
- Claude Code config must use top-level `mcpServers`.
- Preserve unrelated MCP servers when adding Batta.
- Keep the same `?repo=` value across setup, indexing, and security reviews.
