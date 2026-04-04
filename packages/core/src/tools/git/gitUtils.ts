import simpleGit, { SimpleGit } from 'simple-git';
import { GitToolConfig } from './types';
import { promises as fs } from 'fs';


export const getInitializedGitClient = async (config: GitToolConfig): Promise<SimpleGit> => {
  // ensure repository is cloned and up-to-date (shallow)
  const localPath = await ensureRepoCloned(config);

  const git: SimpleGit = simpleGit(localPath);
  await git.addConfig('user.name', 'Security Agent Bot');
  await git.addConfig('user.email', 'security-agent@yourdomain.com');

  // Checkout (create) the current branch
  await git.checkout(['-b', config.currentBranch]);

  return git;
};

// Ensure the workspace path exists and contains the expected repository. If not, perform a shallow clone.
export const ensureRepoCloned = async (config: GitToolConfig): Promise<string> => {
  if (!config.workspacePath) {
    throw new Error('GitToolConfig.workspacePath is required to clone a repository');
  }
  if (!config.gitProviderUrl) {
    throw new Error('GitToolConfig.gitProviderUrl is required');
  }
  if (!config.repository) {
    throw new Error('GitToolConfig.repository is required');
  }

  // normalize provider host and repository path
  const providerHost = config.gitProviderUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const repoPath = config.repository.replace(/^\/+|\.git$/g, '');

  // Construct remote URL. If accessToken present, inject it before the host like: https://<token>@github.com/owner/repo.git
  let repoUrl: string;
  const expectedUrlNoToken = `https://${providerHost}/${repoPath}.git`;
  if (config.accessToken) {
    const token = encodeURIComponent(config.accessToken);
    repoUrl = `https://x-access-token:${token}@${providerHost}/${repoPath}.git`;
  } else {
    repoUrl = expectedUrlNoToken;
  }

  const localPath: string = config.workspacePath;
  const bareGit = simpleGit();

  // If any content exists at the path, remove it and perform a fresh shallow clone
  try {
    await fs.stat(localPath);
    // path exists - remove it to ensure a clean clone
    await fs.rm(localPath, { recursive: true, force: true });
  } catch (e) {
    // path does not exist - nothing to remove
  }

  await bareGit.clone(repoUrl, localPath, ['--depth', '1']);
  return localPath;
};
