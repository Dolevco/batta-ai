import https from 'https';
import type express from 'express';
import type { ApiEnv } from '../config/env';
import { loadHttpsCredentials } from '../config/https';

function logListening(env: ApiEnv, protocol: 'http' | 'https', suffix = ''): void {
  const baseUrl = `${protocol}://localhost:${env.port}`;
  console.log(`API server running on ${baseUrl}${suffix}`);
  console.log(`   MCP endpoint:   ${baseUrl}/api/mcp`);
  console.log(`   Agent setup:    ${baseUrl}/api/onboarding/agent-led?repo=<repo-name>`);
  console.log(`   OAuth issuer:   ${env.mcpIssuerUrl ?? baseUrl}`);
}

function registerShutdownHandlers(server: { close(cb?: () => void): unknown }): void {
  const shutdown = () => {
    server.close(() => process.exit(0));
    // Force exit if graceful close takes too long
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export async function startServer(app: express.Express, env: ApiEnv): Promise<void> {
  if (!env.https) {
    const server = app.listen(env.port, () => logListening(env, 'http'));
    registerShutdownHandlers(server);
    return;
  }

  const credentials = await loadHttpsCredentials(env);
  if (credentials) {
    const suffix = credentials.source === 'devcert' ? ' (devcert)' : '';
    const server = https.createServer({ key: credentials.key, cert: credentials.cert }, app).listen(env.port, () => {
      logListening(env, 'https', suffix);
    });
    registerShutdownHandlers(server);
    return;
  }

  console.warn('[SSL] No certs found and devcert unavailable - falling back to HTTP');
  const server = app.listen(env.port, () => logListening(env, 'http', ' (no SSL)'));
  registerShutdownHandlers(server);
}
