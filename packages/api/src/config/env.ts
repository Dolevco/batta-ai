import dotenv from 'dotenv';

dotenv.config();

export interface ApiEnv {
  nodeEnv: string;
  port: number;
  https: boolean;
  databaseUrlSet: boolean;
  mcpIssuerUrl?: string;
  entraTenantId?: string;
  entraClientId?: string;
  sslKeyPath?: string;
  sslCertPath?: string;
  corsOrigin: string;
  authDisabled: boolean;
  jwtSkipValidation: boolean;
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? '3101');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3101;
}

export function loadEnv(): ApiEnv {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const authDisabled = process.env.AUTH_DISABLED === 'true';
  const jwtSkipValidation = process.env.JWT_SKIP_VALIDATION === 'true';

  if (nodeEnv === 'production' && (authDisabled || jwtSkipValidation)) {
    throw new Error('AUTH_DISABLED and JWT_SKIP_VALIDATION are not allowed in production.');
  }

  if (authDisabled) {
    console.warn('WARNING: AUTH_DISABLED=true - authentication is completely disabled. Never use this in production.');
  }

  if (jwtSkipValidation) {
    console.warn('WARNING: JWT_SKIP_VALIDATION=true - JWT signatures are not validated. Never use this in production.');
  }

  return {
    nodeEnv,
    port: readPort(process.env.PORT),
    https: process.env.HTTPS === 'true',
    databaseUrlSet: Boolean(process.env.DATABASE_URL),
    mcpIssuerUrl: process.env.MCP_ISSUER_URL,
    entraTenantId: process.env.ENTRA_TENANT_ID,
    entraClientId: process.env.ENTRA_CLIENT_ID,
    sslKeyPath: process.env.SSL_KEY_PATH,
    sslCertPath: process.env.SSL_CERT_PATH,
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    authDisabled,
    jwtSkipValidation,
  };
}
