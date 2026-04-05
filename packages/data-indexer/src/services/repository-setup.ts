/**
 * Repository Setup Service
 * 
 * Handles cloning and verifying repositories exist on disk
 */

import { execSync } from 'child_process';
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
   * Ensure repository is available locally
   * Returns the local path to the repository
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

    // Check if already cloned
    if (existsSync(clonePath)) {
      console.log(`[Setup] Repository ${repository.name} already exists at ${clonePath}`);
      return clonePath;
    }

    // Clone repository
    console.log(`[Setup] Cloning repository ${repository.name} to ${clonePath}`);
    await this.cloneRepository(repository, integration, clonePath);
    
    return clonePath;
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
      // Clone with depth 1 for faster cloning
      execSync(`git clone --depth 1 ${authenticatedUrl} ${targetPath}`, {
        stdio: 'inherit',
      });
      console.log(`[Setup] Successfully cloned ${repository.name}`);
    } catch (error: any) {
      throw new Error(`Failed to clone ${repository.name}: ${error.message}`);
    }
  }
}
