import { createAppAuth } from '@octokit/auth-app';

export interface PATValidationResult {
  valid: boolean;
  login: string;
  scopes: string[];
}

export interface InstallationAuthResult {
  token: string;
  expiresAt?: string;
}

export async function getInstallationToken(installationId: number | string): Promise<InstallationAuthResult> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY || '';

  if (!appId || !privateKeyRaw) {
    throw new Error('GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY is not configured');
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  const auth = createAppAuth({
    appId: appId,
    privateKey,
  });

  const installationAuthentication = await auth({
    type: 'installation',
    installationId: Number(installationId),
  }) as any;

  return { token: installationAuthentication.token, expiresAt: installationAuthentication.expiresAt };
}

export async function validatePersonalAccessToken(token: string): Promise<PATValidationResult> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'batta-ai',
    },
  });
  if (!response.ok) return { valid: false, login: '', scopes: [] };
  const scopeHeader = response.headers.get('x-oauth-scopes') ?? '';
  const scopes = scopeHeader ? scopeHeader.split(',').map(s => s.trim()).filter(Boolean) : [];
  const user = await response.json() as { login: string };
  return { valid: true, login: user.login, scopes };
}
