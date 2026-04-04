# @ai-agent/ui

React + Vite frontend for the Security Automation Platform.

## Development

```bash
pnpm dev
```

The UI will be available at http://localhost:3000

## Build

```bash
pnpm build
```

## Features

- **Task Input** - Free-text input for defining security automation tasks
- **Plan Visualization** - Interactive graph view of task execution plans
- **Chain of Thought** - Display reasoning for each step in the plan
- **Real-time Updates** - Status tracking for task execution

## Tech Stack

- React 18
- TypeScript
- Vite
- ReactFlow (for graph visualization)

## Configuration

The UI proxies API requests to `http://localhost:3001` in development mode.
This is configured in `vite.config.ts`.
