/**
 * Module augmentation for @modelcontextprotocol/sdk AuthInfo.
 *
 * The MCP SDK's AuthInfo type only defines the standard OAuth fields.
 * We extend it with the Entra-specific claims (tenantId, userId, email, name) that
 * verifyEntraToken and authMiddleware populate so that handler.ts and other callers
 * can access them with proper types instead of going through `authInfo.extra`.
 */
import '@modelcontextprotocol/sdk/server/auth/types.js';

declare module '@modelcontextprotocol/sdk/server/auth/types.js' {
  interface AuthInfo {
    /** Azure AD tenant GUID extracted from the `tid` claim. */
    tenantId: string;
    /** Azure AD object ID from the `oid` claim (or `sub` fallback). */
    userId?: string;
    /** User's email from `preferred_username` or `email` claim. */
    email?: string;
    /** Display name from the `name` claim. */
    name?: string;
  }
}