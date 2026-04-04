# Security Automation Platform

AI-powered security posture management platform built with the AI Agent framework.

## Architecture

This is a monorepo consisting of multiple packages:

### Core Packages
- **`@ai-agent/core`** - Core AI agent functionality with task planning and execution
- **`@ai-agent/shared`** - Shared types and utilities
- **`@ai-agent/api`** - Express API server that exposes the agent functionality
- **`@ai-agent/ui`** - React + Vite frontend for visualizing task plans
- **`@ai-agent/worker`** - Task execution worker

### Data & Intelligence Packages
- **`@ai-agent/data-indexer`** - Multi-DB indexing layer (Qdrant, Neo4j) with semantic query capabilities and automated discovery connectors (Code, Azure)

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Installation

```bash
# Install all dependencies
pnpm install
```

### Development

Start both API and UI in development mode:

```bash
pnpm dev
```

Or run them separately:

```bash
# API (runs on http://localhost:3001)
pnpm dev:api

# UI (runs on http://localhost:3000)
pnpm dev:ui
```

### Build

```bash
pnpm build
```

## Data Intelligence Layer

The platform includes powerful data indexing and discovery capabilities for understanding organizational architecture:

### Data Indexer (`packages/data-indexer`)

Multi-database indexing layer that provides semantic search and graph queries for AI agents.

**Features:**
- **Multi-DB Architecture**: Qdrant (vectors), Neo4j (graph), Qdrant (metadata)
- **Entity Types**: Resources, Findings, Code Artifacts, Deployments, Identities, Teams, Services, Incidents, Evidence
- **Agent Query Tools**: `trace_finding_to_code()`, `resolve_ownership()`, `calculate_blast_radius()`, etc.
- **Semantic Search**: Natural language queries over indexed entities
- **Relationship Mapping**: Automatic relationship discovery and evidence tracking

### Connectors (Automated Discovery)

Automated discovery connectors for code repositories and cloud infrastructure.

**Supported Sources:**
- **Code Connector**: GitHub organizations, local repos, service detection (Node, Python, Java, Go, Rust), CI/CD pipelines, IaC
- **Azure Connector**: Azure Resource Graph, multi-subscription, network topology, identity management

### Docker Deployment

Run the entire stack (API, UI, Qdrant, and Redis) using Docker Compose:

```bash
# Build and start all services
pnpm docker

# Or directly with docker compose
docker compose up --build -d
```

The services will be available at:
- **UI**: http://localhost:3000
- **API**: http://localhost:3001
- **Qdrant**: http://localhost:6333
- **Redis**: http://localhost:6379

**Environment Configuration:**
- Docker uses the environment variables from `packages/api/.env`
- By default, services run with HTTP (no SSL/TLS) for cloud deployments
- For local HTTPS in Docker, use pnpm docker:https

**Stopping the services:**
```bash
docker compose down
```

### Azure Cloud Deployment

Deploy to Azure using **Azure Container Apps** for all services (API, Qdrant, Neo4j, Worker Job).
All infrastructure is defined as Bicep in `infra/` and deployed idempotently.

```bash
# 1. Configure environment
cp .azure-env.example .azure-env
# Edit .azure-env with your resource group, location, credentials, etc.

# 2. Bootstrap Azure infrastructure (one-time, idempotent)
source .azure-env && pnpm setup:azure
# ↑ Creates the resource group, ACR, Container Apps environment,
#   storage, Redis, Log Analytics, and all container apps.
#   Prints resource names to add to .azure-env.

# 3. Update .azure-env with the printed AZURE_API_APP_NAME value

# 4. Deploy API + Worker + Qdrant + Neo4j (build → push to ACR → update container apps)
source .azure-env && pnpm deploy:api

# 5. Deploy UI (build static assets → push to Azure Storage static website)
source .azure-env && pnpm deploy:ui

# Or deploy both at once
source .azure-env && pnpm deploy
```

**Infrastructure layout:**
| Resource | Type | Notes |
|---|---|---|
| `<base>-api` | Container App (external) | Port 3001, system identity, HTTPS |
| `<base>-qdrant` | Container App (external) | Persistent file share, ACR image |
| `<base>-neo4j` | Container App (internal) | Persistent file share, ACR image |
| `<base>-worker` | Container Apps Job (manual) | Triggered by API |
| `<base>-cae` | Container Apps Environment | Hosts all container apps |
| `<base>acr` | Container Registry | All images (ACR pull via managed identity) |
| `<base>-redis` | Azure Cache for Redis (Basic C0) | Managed Redis; auto-provisioned |
| `<base>-logs` | Log Analytics Workspace | Diagnostics |
| `<base>storage` | Storage Account | Qdrant + Neo4j persistent volumes; UI static website |


## Package Details

### API Package (`packages/api`)

Express API server that provides REST endpoints for task management.

**Endpoints:**
- `POST /api/tasks` - Create a new task with automatic plan generation
- `GET /api/tasks/:id` - Get a specific task
- `GET /api/tasks` - Get all tasks

**Environment Variables:**
- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment (development/production)
- `QDRANT_URL` - Qdrant vector database URL (default: http://localhost:6333)
- `QDRANT_API_KEY` - Qdrant API key (optional)
- `REDIS_URL` - Redis URL for event streaming (default: redis://localhost:6379)
- `SLACK_CLIENT_ID` - Slack OAuth app client ID (for Slack integration)
- `SLACK_CLIENT_SECRET` - Slack OAuth app client secret (for Slack integration)
- `SLACK_REDIRECT_URI` - Slack OAuth redirect URI (default: https://localhost:3001/api/oauth/slack/callback)
- `HTTPS` - Set to `true` to enable HTTPS in local development (default: false)
  - When `true`, the API will use SSL certificates from `ssl/` directory or generate them using `devcert`
  - In Docker/cloud deployments, keep this `false` as SSL/TLS is typically handled by load balancers or reverse proxies

### Setting Up Slack Integration

To enable one-click Slack OAuth integration:

1. **Create a Slack App:**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Enter app name and select a workspace for development

2. **Configure OAuth & Permissions:**
   - Navigate to "OAuth & Permissions" in the sidebar
   - Add the following **Bot Token Scopes**:
     - `channels:read` - View basic channel information
     - `groups:read` - View basic private channel information
     - `channels:history` - View messages in public channels
     - `groups:history` - View messages in private channels
     - `chat:write` - Send messages
     - `users:read` - View users in workspace
   - Add the following **User Token Scopes** (optional, for search):
     - `search:read` - Search workspace messages
   - Add Redirect URL: `https://localhost:3001/api/oauth/slack/callback`

3. **Configure Environment Variables:**
   - Copy `packages/api/.env.example` to `packages/api/.env`
   - Set `SLACK_CLIENT_ID` to your app's Client ID (found in "Basic Information")
   - Set `SLACK_CLIENT_SECRET` to your app's Client Secret (found in "Basic Information")
   - Set `SLACK_REDIRECT_URI=https://localhost:3001/api/oauth/slack/callback`

4. **Local HTTPS (optional, recommended for Slack OAuth):**
   - Slack requires a secure redirect URI for OAuth flows
   - For local development, set `HTTPS=true` in `packages/api/.env`
   - The API will automatically generate SSL certificates using `devcert` or use certificates from the `ssl/` directory

5. **Connect Slack:**
   - Start the development servers: `pnpm dev`
   - Navigate to http://localhost:3000/integrations (or https://localhost:3000 if HTTPS is enabled)
   - Click the "Slack" card to start OAuth flow
   - Authorize the app in your Slack workspace
   - You'll be redirected back to the integrations page with Slack connected

The integration supports multi-tenant architecture with proper workspace isolation.

### UI Package (`packages/ui`)

React application for defining tasks and visualizing execution plans.

**Features:**
- Free-text task input
- Graph visualization of task plans using ReactFlow
- Display of task steps with reasoning (chain of thought)
- Real-time status updates

## Usage Example

1. Start the development servers:
   ```bash
   pnpm dev
   ```

2. Open http://localhost:3000 in your browser

3. Enter a security automation task, for example:
   ```
   Scan all S3 buckets for public access and generate a compliance report
   ```

4. View the generated task plan as a graph, showing:
- Individual steps
- Reasoning for each step (chain of thought)
- Dependencies between steps
- Tools used for each step

## Future Enhancements

- [ ] Real-time execution monitoring
- [ ] Detailed chain of thought visualization
- [ ] Integration with security posture management systems
- [ ] User authentication and authorization
- [ ] Task history and analytics
- [ ] Custom tool definitions
- [ ] Webhook support for notifications

## License

MIT
