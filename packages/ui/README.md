# @batta/ui

The React frontend for the batta-ai platform. Provides security review workflows, asset graphs, DFD diagrams, policy editing, chat, and integration management.

Built with React 18, Vite, TypeScript, and Ant Design.

---

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9+

Install from the monorepo root:

```bash
pnpm install
```

---

## Running locally

```bash
# From the repo root
pnpm --filter @batta/ui dev
```

The dev server starts at `http://localhost:3100`. Set `VITE_API_BASE` to point at your API server (see [Environment variables](#environment-variables)).

To run with auth disabled (no login required):

```bash
VITE_AUTH_DISABLED=true pnpm --filter @batta/ui dev
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp packages/ui/.env.example packages/ui/.env
```

| Variable | Description | Required |
|---|---|---|
| `VITE_API_BASE` | Backend API base URL. Defaults to `/api`. | No — set when UI and API run on separate ports. |
| `VITE_AUTH_DISABLED` | Set `true` to skip all auth. Pair with `AUTH_DISABLED=true` on the API. **Never use in production.** | No |
| `VITE_MSAL_CLIENT_ID` | Azure AD application client ID | For Microsoft auth |
| `VITE_MSAL_AUTHORITY` | Azure AD authority URL (`https://login.microsoftonline.com/<tenant>`) | For Microsoft auth |
| `VITE_MSAL_REDIRECT_URI` | Redirect URI registered in Azure AD | For Microsoft auth |
| `VITE_OIDC_AUTHORITY` | OIDC provider URL | For OIDC auth |
| `VITE_OIDC_CLIENT_ID` | OIDC client ID | For OIDC auth |
| `VITE_OIDC_REDIRECT_URI` | OIDC redirect URI | For OIDC auth |

---

## Authentication

Three auth modes are supported, selected by environment variables:

- **No auth** (`VITE_AUTH_DISABLED=true`) — development only
- **Microsoft Entra ID / Azure AD** — set `VITE_MSAL_CLIENT_ID` (and optionally `VITE_MSAL_AUTHORITY`, `VITE_MSAL_REDIRECT_URI`)
- **Generic OIDC** — set `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`

---

## Building

```bash
pnpm --filter @batta/ui build
```

Output is in `packages/ui/dist/`.

---

## Type checking & linting

```bash
pnpm --filter @batta/ui typecheck
pnpm --filter @batta/ui lint
```

---

## Testing

```bash
pnpm --filter @batta/ui test
```

---

## Project structure

- `src/pages/` contains route-level pages grouped by domain.
- `src/components/` contains shared UI grouped by domain.
- `src/hooks/` contains API and state hooks; prefer domain-specific hooks for new code.
- `src/services/` contains typed API clients grouped by domain.
- `src/types/` contains domain type definitions and re-exports.

---

## Docker

The Dockerfile and nginx configs live in `deploy/ui/` at the repo root. Build from the **repo root** so the full monorepo context is available:

```bash
docker build -f deploy/ui/Dockerfile -t batta-ui .
```
