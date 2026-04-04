# @ai-agent/api

Express API server for the AI Agent platform.

## Development

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

## API Endpoints

### POST /api/tasks

Create a new task and generate an execution plan.

**Request:**
```json
{
  "description": "Your task description",
  "tools": ["optional", "list", "of", "tools"]
}
```

**Response:**
```json
{
  "id": "task_123",
  "description": "Your task description",
  "status": "completed",
  "plan": {
    "steps": [
      {
        "id": "step_1",
        "description": "Step description",
        "reason": "Reasoning for this step",
        "tool": "tool_name",
        "dependencies": []
      }
    ]
  },
  "createdAt": "2025-12-06T...",
  "updatedAt": "2025-12-06T..."
}
```

### GET /api/tasks/:id

Get a specific task by ID.

### GET /api/tasks

Get all tasks.

## Environment Variables

Create a `.env` file:

```env
PORT=3001
NODE_ENV=development
```
