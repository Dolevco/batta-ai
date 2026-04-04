import { createAppAuth } from '@octokit/auth-app';

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
