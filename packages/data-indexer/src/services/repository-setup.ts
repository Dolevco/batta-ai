/**
 * Repository Setup Service
 * 
 * Handles cloning and verifying repositories exist on disk
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { RepositoryHandle } from '../types/pipeline.types';
import type { CodeIntegrationHandler } from '@ai-agent/shared';
import { GitLabIntegration } from '@ai-agent/shared';

export interface RepositorySetupConfig {
  cloneDir: string;
}

/**
 * Service to setup repositories for processing
 */
export class RepositorySetup {
  private config: RepositorySetupConfig;

  constructor(config: RepositorySetupConfig) {
    this.config = config;
  }

  /**
   * Ensure repository is available locally.
   * Returns the local path to the repository.
   *
   * NOTE: Does NOT checkout a specific branch/SHA — call checkoutBranch() after
   * this when you need the PR head rather than the default branch.
   */
  async ensureRepository(
    repository: RepositoryHandle,
    integration: CodeIntegrationHandler
  ): Promise<string> {
    // If already has clone path and exists, use it
    if (repository.clonePath && existsSync(repository.clonePath)) {
      console.log(`[Setup] Repository ${repository.name} already exists at ${repository.clonePath}`);
      return repository.clonePath;
    }

    // Determine clone path
    const clonePath = join(this.config.cloneDir, repository.name);

    if (existsSync(clonePath)) {
      console.log(`[Setup] Repository ${repository.name} already cloned at ${clonePath}`);
      return clonePath;
    }

    // Clone repository
    console.log(`[Setup] Cloning repository ${repository.name} to ${clonePath}`);
    await this.cloneRepository(repository, integration, clonePath);

    return clonePath;
  }

  /**
   * Fetch and checkout a specific branch at a specific SHA.
   *
   * Uses execFileSync (array args) throughout — no shell interpolation of
   * branch names or SHAs, preventing command injection.
   *
   * @param clonePath   Local repo directory (from ensureRepository).
   * @param branch      Remote branch name to fetch (e.g. "feature/my-pr").
   * @param sha         Exact commit SHA to verify and detach HEAD onto.
   * @param integration Optional integration handler; when provided a fresh
   *                    token is injected into the remote URL before fetching
   *                    so short-lived tokens (e.g. GitHub App) don't expire.
   */
  async checkoutBranch(
    clonePath: string,
    branch: string,
    sha: string,
    integration?: CodeIntegrationHandler,
  ): Promise<void> {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: clonePath, stdio: 'pipe' });

    if (integration) {
      await this.setAuthenticatedRemote(clonePath, integration);
    }

    console.log(`[Setup] Fetching branch ${branch} in ${clonePath}`);
    // Fetch only the target branch (shallow single-branch)
    git(['fetch', '--depth=1', 'origin', branch]);

    // Detach HEAD onto the exact SHA so stale caches can't serve wrong code
    console.log(`[Setup] Checking out SHA ${sha}`);
    git(['checkout', '--detach', sha]);
  }

  /**
   * Produce a unified diff of everything the PR added/changed/removed
   * relative to the merge-base with the base branch.
   *
   * Uses execFileSync (array args) — no shell interpolation.
   *
   * Shallow-clone merge-base strategy
   * ----------------------------------
   * After checkoutBranch fetches the PR head with --depth=1 there is no shared
   * history between the two shallow tips.  git diff origin/<base>...HEAD fails
   * with "no merge base" because the three-dot syntax requires a common ancestor.
   *
   * We resolve this by progressively deepening the PR-head side in powers of two
   * until git merge-base succeeds (capped at MAX_DEEPEN_COMMITS).  If after the
   * cap we still have no merge-base (very long-lived branch) we fall back to a
   * two-dot diff (origin/<base>..HEAD) which compares the two tips directly —
   * still a correct and useful diff for PR validation purposes.
   *
   * @param clonePath   Local repo directory.
   * @param baseBranch  Target branch the PR will merge into (e.g. "main").
   * @param integration Optional integration handler; when provided a fresh
   *                    token is injected into the remote URL before fetching.
   * @returns           git diff output (may be large — callers should truncate).
   */
  async getDiff(
    clonePath: string,
    baseBranch: string,
    integration?: CodeIntegrationHandler,
  ): Promise<string> {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: clonePath, stdio: 'pipe' });

    const gitTry = (args: string[]): Buffer | null => {
      try {
        return execFileSync('git', args, { cwd: clonePath, stdio: 'pipe' });
      } catch {
        return null;
      }
    };

    if (integration) {
      await this.setAuthenticatedRemote(clonePath, integration);
    }

    console.log(`[Setup] Fetching base branch ${baseBranch} for diff`);
    git(['fetch', '--depth=1', 'origin', baseBranch]);

    // Attempt to find a common merge-base.  With shallow fetches this may fail
    // initially because the two tips share no history yet.
    const MAX_DEEPEN_COMMITS = 500;
    let depth = 1;
    let mergeBaseSha: string | null = null;

    // First attempt before any deepening
    const initialMergeBase = gitTry(['merge-base', `origin/${baseBranch}`, 'HEAD']);
    if (initialMergeBase) {
      mergeBaseSha = initialMergeBase.toString('utf8').trim();
    }

    // Progressively deepen the HEAD side until we find a common ancestor
    if (!mergeBaseSha) {
      while (depth <= MAX_DEEPEN_COMMITS) {
        depth = Math.min(depth * 2, MAX_DEEPEN_COMMITS);
        console.log(`[Setup] Deepening history by ${depth} commits to find merge-base`);
        git(['fetch', `--deepen=${depth}`, 'origin', baseBranch]);

        const result = gitTry(['merge-base', `origin/${baseBranch}`, 'HEAD']);
        if (result) {
          mergeBaseSha = result.toString('utf8').trim();
          break;
        }

        if (depth >= MAX_DEEPEN_COMMITS) break;
      }
    }

    let diffOutput: Buffer;
    if (mergeBaseSha) {
      // Two-argument diff from the common ancestor to the PR head — equivalent
      // to three-dot but works correctly with shallow histories.
      console.log(`[Setup] Computing diff from merge-base ${mergeBaseSha.slice(0, 8)} to HEAD`);
      diffOutput = git(['diff', mergeBaseSha, 'HEAD']);
    } else {
      // Fallback: no common ancestor found within depth cap.  Two-dot diff
      // compares the base-branch tip directly to the PR head; it may include
      // commits from the base branch that aren't in the PR, but it is still
      // a useful and safe approximation for PR validation.
      console.warn(
        `[Setup] Could not find merge-base for ${baseBranch} within ${MAX_DEEPEN_COMMITS} commits; ` +
        `falling back to two-dot diff`,
      );
      diffOutput = git(['diff', `origin/${baseBranch}`, 'HEAD']);
    }

    return diffOutput.toString('utf8');
  }

  /**
   * Update the 'origin' remote URL to include a fresh access token.
   * Called before any fetch so short-lived tokens are always current.
   * The token is never written to disk beyond git's own config file,
   * and is stripped from error messages by callers.
   */
  private async setAuthenticatedRemote(
    clonePath: string,
    integration: CodeIntegrationHandler,
  ): Promise<void> {
    const token = await integration.getAccessToken();
    // Retrieve the current (unauthenticated) remote URL to build from
    const currentUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: clonePath, stdio: 'pipe',
    }).toString('utf8').trim();

    // Strip any existing credentials from the URL before embedding the fresh token
    const plainUrl = currentUrl.replace(/https:\/\/[^@]+@/, 'https://');

    let authenticatedUrl: string;
    if (integration instanceof GitLabIntegration) {
      authenticatedUrl = integration.buildCloneUrl(plainUrl);
    } else {
      authenticatedUrl = plainUrl.replace('https://', `https://x-access-token:${token}@`);
    }

    execFileSync('git', ['remote', 'set-url', 'origin', authenticatedUrl], {
      cwd: clonePath, stdio: 'pipe',
    });
  }

  /**
   * Clone a repository using the appropriate authentication scheme for the provider.
   */
  private async cloneRepository(
    repository: RepositoryHandle,
    integration: CodeIntegrationHandler,
    targetPath: string
  ): Promise<void> {
    // Ensure parent directory exists
    const parentDir = join(targetPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Build an authenticated clone URL appropriate for the provider.
    const token = await integration.getAccessToken();
    const url = repository.url;

    let authenticatedUrl: string;

    if (integration instanceof GitLabIntegration) {
      // GitLab uses oauth2 basic-auth user with the token
      authenticatedUrl = integration.buildCloneUrl(url);
    } else {
      // GitHub (and any other provider) uses x-access-token basic-auth scheme
      authenticatedUrl = url.replace('https://', `https://x-access-token:${token}@`);
    }

    try {
      // Clone with depth 1. Args passed as an array — no shell interpolation.
      execFileSync('git', ['clone', '--depth', '1', authenticatedUrl, targetPath], {
        stdio: 'pipe',
      });
      console.log(`[Setup] Successfully cloned ${repository.name}`);
    } catch (error: any) {
      // Strip the authenticated URL (which contains the token) from the error
      // message before re-throwing so it never appears in logs or upstream callers.
      const safeMessage = (error.message as string)
        .replace(authenticatedUrl, repository.url);
      throw new Error(`Failed to clone ${repository.name}: ${safeMessage}`);
    }
  }
}
