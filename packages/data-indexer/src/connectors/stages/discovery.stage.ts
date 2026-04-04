/**
 * Stage 1: Discovery
 * 
 * Finds repositories and artifacts from various sources (GitHub, local paths)
 */

import { GitHubIntegration } from '@ai-agent/shared';
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import {
  DiscoveryStage,
  DiscoveryScope,
  DiscoveryOutput,
  RepositoryHandle,
} from '../../types/pipeline.types';
import { TenantId } from '@ai-agent/shared';
import type { ILLMApiHandler } from '@ai-agent/core';
import type { QdrantAdapter } from '@ai-agent/shared';
import type { Neo4jAdapter } from '@ai-agent/shared';

export interface CodeIndexerConfig {
  localPath?: string;
  cloneDir?: string;
  skipClone?: boolean;
  analysisDepth: 'shallow' | 'deep';
  enableCloudDiscovery?: boolean;
  cloudDiscovery?: any;
  maxConcurrency?: number;
  api: ILLMApiHandler; // ILLMApiHandler for semantic analysis
  qdrant: QdrantAdapter; // Optional Qdrant adapter for vector storage
  neo4j: Neo4jAdapter; // Optional Neo4j adapter for graph storage
}

/**
 * Code Discovery Stage
 */
export class CodeDiscoveryStage implements DiscoveryStage {
  private integration: GitHubIntegration;
  private config: CodeIndexerConfig;
  private git: SimpleGit;

  constructor(integration: GitHubIntegration, config: CodeIndexerConfig) {
    this.integration = integration;
    this.config = config;
    this.git = simpleGit();
  }

  async discover(tenantId: TenantId, scope: DiscoveryScope): Promise<DiscoveryOutput> {
    const repositories: RepositoryHandle[] = [];

    // GitHub repositories
    try {
      const githubRepos = await this.integration.getRepositories();
      for (const repo of githubRepos) {
        if (!!scope.repositories?.length && !scope.repositories.includes(repo.name)) {
          continue;
        }
        
        repositories.push({
          name: repo.name,
          url: repo.url,
          defaultBranch: repo.defaultBranch || 'main',
          lastCommitSha: '', // Will be fetched during clone
        });
      }
    } catch (error: any) {
      console.error('Failed to fetch GitHub repositories:', error);
    }

    // Local repositories
    if (this.config.localPath) {
      const localRepos = await this.discoverLocalRepos(this.config.localPath, scope);
      repositories.push(...localRepos);
    }

    return {
      repositories,
      totalArtifacts: repositories.length,
    };
  }

  private async discoverLocalRepos(
    basePath: string,
    scope: DiscoveryScope
  ): Promise<RepositoryHandle[]> {
    const repos: RepositoryHandle[] = [];
    
    if (!fs.existsSync(basePath)) {
      return repos;
    }

    // If the base path itself is a git repository, treat it as a single repo
    try {
      const baseIsRepo = await simpleGit(basePath).checkIsRepo();
      if (baseIsRepo) {
        const name = path.basename(basePath);

        if (scope.repositories && !scope.repositories.includes(name)) {
          return repos;
        }

        const handle = await this.getRepoHandleFromPath(basePath, name);
        if (handle) repos.push(handle);

        return repos;
      }
    } catch (error) {
      // If checkIsRepo fails for any reason, fall back to scanning the directory
      console.warn(`Failed to determine if base path is a git repo (${basePath}), scanning children instead:`, error);
    }

    const entries = fs.readdirSync(basePath);

    for (const entry of entries) {
      const fullPath = path.join(basePath, entry);
      if (!fs.statSync(fullPath).isDirectory()) continue;

      const gitPath = path.join(fullPath, '.git');
      if (!fs.existsSync(gitPath)) continue;

      if (scope.repositories && !scope.repositories.includes(entry)) {
        continue;
      }

      const handle = await this.getRepoHandleFromPath(fullPath, entry);
      if (handle) repos.push(handle);
    }

    return repos;
  }

  private async getRepoHandleFromPath(
    fullPath: string,
    name?: string
  ): Promise<RepositoryHandle | null> {
    try {
      const git = simpleGit(fullPath);
      const remotes = await git.getRemotes(true);
      const branch = await git.branch();
      const log = await git.log({ maxCount: 1 });

      return {
        name: name || path.basename(fullPath),
        url: remotes[0]?.refs?.fetch || fullPath,
        defaultBranch: branch.current,
        lastCommitSha: log.latest?.hash || '',
        clonePath: fullPath,
      };
    } catch (error) {
      console.error(`Failed to read git info for ${fullPath}:`, error);
      return null;
    }
  }
}
