import type { ApiEnv } from './env';

export function logStartupConfig(env: ApiEnv): void {
  console.log('[init] DATABASE_URL:', env.databaseUrlSet ? '(set)' : '(unset -> using default)');
}

export function logStartupError(error: unknown, env: ApiEnv): void {
  const err = error as Error & { cause?: unknown };
  console.error('Failed to start server:', err);
  console.error('  message:', err?.message);
  console.error('  cause:  ', err?.cause);
  console.error('Config snapshot:');
  console.error('  DATABASE_URL    =', env.databaseUrlSet ? '(set)' : '(unset)');
  console.error('  PORT            =', env.port);
  console.error('  HTTPS           =', env.https ? 'true' : 'false');
  console.error('  MCP_ISSUER_URL  =', env.mcpIssuerUrl ?? '(unset)');
  console.error('  ENTRA_TENANT_ID =', env.entraTenantId ?? '(unset)');
  console.error('  ENTRA_CLIENT_ID =', env.entraClientId ?? '(unset)');
}
