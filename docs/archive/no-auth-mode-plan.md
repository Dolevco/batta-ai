# No-Auth Mode: End-to-End Implementation Plan

## Overview

Add a **no-auth mode** that allows running both the API and UI without any authentication.
When enabled, the system behaves as if a fixed "local" user is always authenticated — all
existing features work unchanged, but there is no login screen, no token flow, and no
identity provider dependency.

This is useful for:
- Local development without an identity provider configured
- Self-hosted single-user deployments
- Demo / evaluation environments

---

## Design Decisions

### Single flag, two packages

A single environment variable `AUTH_DISABLED=true` controls the feature at the API level.
The UI reads its own parallel flag `VITE_AUTH_DISABLED=true` to suppress all auth UI.

Both flags must be set together. Mismatching them (e.g., UI has auth but API skips it)
would produce 401s from the API or a stuck login screen.

### Synthetic identity

When auth is disabled, all requests are treated as coming from a fixed synthetic user:

```
userId:   "local"
tenantId: "local"
email:    "local@localhost"
name:     "Local User"
```

This ensures all existing code paths that read `req.auth` continue to work without changes.

### No partial "skip signature only" mode

The existing `JWT_SKIP_VALIDATION=true` flag only skips JWT signature validation but still
requires a valid Bearer token with real claims. `AUTH_DISABLED` goes further: it removes
the token requirement entirely. The two flags remain independent; `JWT_SKIP_VALIDATION`
is unaffected.

---

## Scope

### Out of scope

- MCP endpoint (`/api/mcp`) — this endpoint is designed for external tool integrations and
  should always require real authentication. No changes are made to the MCP auth path.
- Per-route opt-in/opt-out — when auth is disabled, it is disabled for all REST routes.

---

## Files to Change

### API

| File | Change |
|------|--------|
| `packages/api/src/middleware/auth.ts` | Add `AUTH_DISABLED` short-circuit in `authMiddleware` |
| `packages/api/.env.example` | Document `AUTH_DISABLED` variable |

### UI

| File | Change |
|------|--------|
| `packages/ui/src/hooks/useAuth.tsx` | Return pre-authenticated state when `VITE_AUTH_DISABLED=true` |
| `packages/ui/src/services/api.ts` | Skip `Authorization` header injection when auth is disabled |
| `packages/ui/src/pages/App.tsx` | Bypass `ProtectedRoute` wrapping when auth is disabled |
| `packages/ui/src/pages/LoginPage.tsx` | Redirect to `/overview` immediately when auth is disabled |
| `packages/ui/src/pages/LandingPage.tsx` | Redirect to `/overview` immediately when auth is disabled |
| `packages/ui/.env.example` | Document `VITE_AUTH_DISABLED` variable |

---

## Detailed Implementation

### Step 1 — API: `packages/api/src/middleware/auth.ts`

Add the short-circuit at the very top of `authMiddleware`, before any token inspection.
Place it after the existing `JWT_SKIP_VALIDATION` block so the two are clearly separated.

```typescript
// At the top of authMiddleware, before token extraction:
if (process.env.AUTH_DISABLED === 'true') {
  req.auth = {
    userId: 'local',
    tenantId: 'local',
    email: 'local@localhost',
    name: 'Local User',
  };
  return next();
}
```

The `req.auth` shape must match the existing `AuthInfo` interface used throughout the
codebase. Verify the interface definition in `src/mcp/auth.d.ts` and align the fields.

**Security note:** Emit a single startup warning (not per-request) when `AUTH_DISABLED=true`
is detected, so the condition is visible in server logs:

```typescript
// In index.ts, near where the app starts listening:
if (process.env.AUTH_DISABLED === 'true') {
  console.warn(
    'WARNING: AUTH_DISABLED=true — authentication is completely disabled. ' +
    'Never use this in production.'
  );
}
```

### Step 2 — API: `packages/api/.env.example`

Add the new variable with a comment:

```dotenv
# Disable all authentication checks. All requests are treated as "local" user.
# DO NOT enable in production.
AUTH_DISABLED=false
```

---

### Step 3 — UI: `packages/ui/src/hooks/useAuth.tsx`

The `AuthProvider` currently runs through MSAL/OIDC initialization. When auth is disabled,
skip all of that and return a static authenticated state.

Add a helper constant at the top of the file:

```typescript
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';
```

At the top of the `AuthProvider` component, before any effects or provider initialization,
return a pre-authenticated context value when the flag is set:

```typescript
if (AUTH_DISABLED) {
  const noAuthValue: AuthContextType = {
    isAuthenticated: true,
    isLoading: false,
    userInfo: { name: 'Local User', email: 'local@localhost' },
    accessToken: null,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    acquireToken: () => Promise.resolve(null),
  };
  return (
    <AuthContext.Provider value={noAuthValue}>
      {children}
    </AuthContext.Provider>
  );
}
```

This keeps all consumer code (`useAuth()`) working identically — they see `isAuthenticated: true`
immediately with no loading phase.

### Step 4 — UI: `packages/ui/src/services/api.ts`

When auth is disabled, `fetchWithAuth` must not attempt to acquire a token and must not
inject an `Authorization` header (the API does not expect one).

```typescript
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  if (AUTH_DISABLED) {
    const response = await fetch(url, options);
    if (response.status === 401) {
      // Should not happen in no-auth mode; surface as an error rather than redirect
      throw new Error('Unexpected 401 in no-auth mode');
    }
    return response;
  }

  // Existing token injection logic unchanged ...
}
```

The existing 401 → redirect-to-login behavior is suppressed because in no-auth mode there
is no login page to redirect to.

### Step 5 — UI: `packages/ui/src/components/ProtectedRoute.tsx`

When auth is disabled, render children directly without checking `isAuthenticated`.
The `AuthProvider` already returns `isAuthenticated: true`, so this change is technically
redundant — but it avoids any future edge-case where the provider hasn't resolved yet on
the very first render.

```typescript
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (AUTH_DISABLED) return <>{children}</>;

  // Existing logic unchanged ...
}
```

### Step 6 — UI: `packages/ui/src/pages/LoginPage.tsx`

If a user navigates to `/login` when auth is disabled (e.g., via a saved bookmark),
redirect immediately to `/overview` rather than rendering a broken login form.

At the top of the `LoginPage` component body:

```typescript
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

if (AUTH_DISABLED) {
  return <Navigate to="/overview" replace />;
}
```

### Step 7 — UI: `packages/ui/src/pages/LandingPage.tsx`

The landing page currently redirects authenticated users to `/overview` and unauthenticated
users to the login flow. When auth is disabled, go straight to `/overview`.

```typescript
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

if (AUTH_DISABLED) {
  return <Navigate to="/overview" replace />;
}
```

### Step 8 — UI: `packages/ui/.env.example`

```dotenv
# Disable all authentication in the UI. Must be paired with AUTH_DISABLED=true on the API.
# DO NOT enable in production.
VITE_AUTH_DISABLED=false
```

---

## AuthInfo Interface Check

Before implementing Step 1, verify the exact shape of `AuthInfo` used across the API.
The fields to populate in the bypass are `userId`, `tenantId`, `email`, and `name`.
Check `packages/api/src/mcp/auth.d.ts` and `packages/api/src/middleware/auth.ts` to
confirm no additional required fields exist (e.g., `roles`, `scopes`). Add any missing
fields with sensible defaults to the synthetic identity object.

---

## What Does Not Change

- The MCP endpoint (`/api/mcp`) continues to require real Entra tokens. No changes.
- The `JWT_SKIP_VALIDATION` flag is independent and unchanged.
- OAuth discovery endpoints (`/.well-known/*`) remain public. No changes.
- Health check (`/api/health`) remains public. No changes.
- All existing business logic, controllers, and services are unchanged.
- All existing UI pages and components other than the ones listed above are unchanged.

---

## Verification Checklist

After implementation, verify the following scenarios:

1. **No-auth mode off (default):** Normal auth flow works — unauthenticated requests get 401,
   UI redirects to login, login page is rendered correctly.

2. **No-auth mode on — API only:** Every REST request returns 401 because the API's bypass
   fires but the UI still sends no token (or sends null). Confirm this is the expected
   "misconfigured" state and document it clearly.

3. **No-auth mode on — both flags set:**
   - UI loads directly to `/overview` with no login prompt.
   - `useAuth().isAuthenticated` is `true` immediately.
   - `useAuth().userInfo` shows `{ name: "Local User", email: "local@localhost" }`.
   - All REST API calls succeed (no Authorization header is sent, API accepts the request).
   - Navigating to `/login` redirects to `/overview`.
   - Navigating to `/` redirects to `/overview`.
   - All protected pages render correctly.
   - MCP endpoint still returns 401 for unauthenticated requests.

4. **Startup log:** When `AUTH_DISABLED=true`, a warning is logged once on API startup.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Accidentally enabled in production | Startup warning in server logs; document in README and `.env.example` |
| UI flag set without API flag (or vice versa) | Document pairing requirement; mismatched state is visible immediately (401 errors) |
| MCP bypass accidentally widened | MCP auth path is not touched; reviewed in verification step |
| Synthetic user collides with real user data | `userId: "local"` and `tenantId: "local"` are not valid UUIDs so they cannot collide with Entra/OIDC identities |
