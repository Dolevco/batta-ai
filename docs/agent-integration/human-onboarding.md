# Human Onboarding

Use this path when you want to create the MCP config and repository instructions yourself
instead of delegating setup to a coding agent.

## VS Code one-click install

When using a packaged Batta MCP extension or install link, choose a stable repo key and
confirm the final MCP URL is:

```text
http://localhost:3101/api/mcp?repo=<repo-name>
```

The installed VS Code MCP config must use top-level `servers`.

## VS Code `.vscode/mcp.json`

Create or update `.vscode/mcp.json` in your target repository:

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

Preserve any unrelated existing servers.

## VS Code `code --add-mcp`

You can also add the server from the command line:

```bash
code --add-mcp '{"name":"batta","type":"http","url":"http://localhost:3101/api/mcp?repo=<repo-name>"}'
```

If your VS Code version writes a different config location, verify that the resulting
server entry points at the same Batta MCP URL.

## Claude Code `.claude/mcp.json`

Create or update `.claude/mcp.json` in your target repository:

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

Claude Code uses top-level `mcpServers`, not `servers`.

## Cursor and generic MCP

Use your environment's MCP settings UI or config file and add an HTTP server:

```json
{
  "batta": {
    "type": "http",
    "url": "http://localhost:3101/api/mcp?repo=<repo-name>"
  }
}
```

If the environment asks for a full config object, use its expected top-level key and place
the `batta` server entry under that key.

## Repository instructions

Add the standing instructions from [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) to
your repository's agent instruction file. For Claude Code, you can copy
[CLAUDE.md.template](./CLAUDE.md.template) to `CLAUDE.md`.

Optional Claude Code slash commands:

```bash
mkdir -p .claude/commands
cp /path/to/batta/docs/agent-integration/commands/*.md .claude/commands/
```

## Verification prompt

```text
Use the Batta MCP server to call get_indexing_status for this repository.
```

## Indexing prompt

```text
Use the Batta MCP server to index this repository for security architecture context.
Follow every returned stage instruction until indexing is complete.
```

## Review prompt

```text
Start a Batta security review for: <feature description>
```
