import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { ApiEnv } from './env';

type DevcertModule = {
  certificateFor?: (domain: string) => Promise<{ key: string; cert: string }>;
};

export interface HttpsCredentials {
  key: string;
  cert: string;
  source: 'configured' | 'workspace' | 'devcert';
}

const requireOptional = createRequire(__filename);

function resolveSslPath(rawPath: string): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  const fromCwd = path.resolve(process.cwd(), rawPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromPkg = path.resolve(__dirname, '..', rawPath);
  if (fs.existsSync(fromPkg)) return fromPkg;
  return fromCwd;
}

export async function loadHttpsCredentials(env: ApiEnv): Promise<HttpsCredentials | undefined> {
  const candidates: Array<{ key: string; cert: string; source: HttpsCredentials['source'] }> = [];

  if (env.sslKeyPath && env.sslCertPath) {
    candidates.push({
      key: resolveSslPath(env.sslKeyPath),
      cert: resolveSslPath(env.sslCertPath),
      source: 'configured',
    });
  }

  const workspaceRoot = path.resolve(__dirname, '../../..');
  const workspaceKey = path.join(workspaceRoot, 'ssl3', 'key.pem');
  const workspaceCert = path.join(workspaceRoot, 'ssl3', 'cert.pem');
  if (fs.existsSync(workspaceKey) && fs.existsSync(workspaceCert)) {
    candidates.push({ key: workspaceKey, cert: workspaceCert, source: 'workspace' });
  }

  const validCandidate = candidates.find(({ key, cert }) => fs.existsSync(key) && fs.existsSync(cert));
  if (validCandidate) {
    return {
      key: fs.readFileSync(validCandidate.key, 'utf8'),
      cert: fs.readFileSync(validCandidate.cert, 'utf8'),
      source: validCandidate.source,
    };
  }

  try {
    const devcert = requireOptional('devcert') as DevcertModule;
    if (devcert && typeof devcert.certificateFor === 'function') {
      return { ...(await devcert.certificateFor('localhost')), source: 'devcert' };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
