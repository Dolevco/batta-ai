/**
 * Repository Setup Service
 * 
 * Handles cloning and verifying repositories exist on disk
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { RepositoryHandle } from '../types/pipeline.types';
import type { GitHubIntegration } from '@ai-agent/shared';

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
    integration: GitHubIntegration
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
   * Clone a repository
   */
  private async cloneRepository(
    repository: RepositoryHandle,
    integration: GitHubIntegration,
    targetPath: string
  ): Promise<void> {
    // Ensure parent directory exists
    const parentDir = join(targetPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Get access token
    const token = await integration.getAccessToken();

    // Build clone URL with token
    const url = repository.url;
    const authenticatedUrl = url.replace('https://', `https://x-access-token:${token}@`);

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
