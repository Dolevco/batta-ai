/**
 * Stage 2: Extraction
 * 
 * Parses code and extracts raw facts from repositories
 */

import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as yaml from 'yaml';
import {
  ExtractionStage,
  ExtractionOutput,
  RepositoryHandle,
  ExtractedRepository,
  ExtractedService,
  ExtractedModule,
  ExtractedBuildArtifact,
  ExtractedDeploymentArtifact,
  ExtractedArtifact,
  ExtractedDependency,
  ExtractedCommit,
  ExtractionError,
} from '../../types/pipeline.types';
import { TenantId } from '@ai-agent/shared';
import type { CodeIndexerConfig } from './discovery.stage';

/**
 * Code Extraction Stage
 */
export class CodeExtractionStage implements ExtractionStage {
  private config: CodeIndexerConfig;
  private cloneDir: string;

  constructor(config: CodeIndexerConfig) {
    this.config = config;
    this.cloneDir = config.cloneDir || '/tmp/code-connector';
  }

  /**
   * Returns the last git commit (SHA + ISO timestamp) that touched a given path.
   * Falls back to undefined if the path has no history or git fails.
   * Security: filePath is validated to be relative and non-empty before passing to git.
   */
  private async getLastCommitForPath(
    repoPath: string,
    filePath: string,
  ): Promise<{ sha: string; timestamp: string } | undefined> {
    // Only accept relative, non-empty paths with no shell metacharacters
    if (!filePath || path.isAbsolute(filePath) || filePath.includes('..')) return undefined;
    try {
      const git = simpleGit(repoPath);
      // simple-git passes args as an array — never shell-interpolated
      const log = await git.log({ file: filePath, maxCount: 1, format: { hash: '%H', date: '%aI' } });
      const latest = log.latest;
      if (latest?.hash && latest?.date) {
        return { sha: latest.hash.trim(), timestamp: latest.date.trim() };
      }
    } catch {
      // Silently swallow — not all paths have git history (e.g. untracked files)
    }
    return undefined;
  }

  // Helper: determine whether an import path refers to an external package
  private isPackageImport(importPath: string): boolean {
    if (!importPath) return false;
    const p = importPath.trim();
    // Relative or absolute paths are file imports and not interesting
    if (p.startsWith('.') || p.startsWith('/')) return false;
    // Python relative imports may start with one or more dots
    if (/^\.+/.test(p)) return false;
    return true;
  }

  // Helper: normalize an import to its package root
  // Examples:
  //  - '@scope/name/sub/path' -> '@scope/name'
  //  - 'lodash/get' -> 'lodash'
  //  - 'pkg.submodule' -> 'pkg'
  private packageRootImport(importPath: string): string {
    if (!importPath) return importPath;
    const p = importPath.trim();
    if (p.startsWith('@')) {
      const parts = p.split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : p;
    }

    // Prefer '/' segment (JS/TS), fall back to '.' (Python)
    const firstSegment = p.split('/')[0];
    return firstSegment.split('.')[0];
  }

  async extract(
    tenantId: TenantId,
    repositories: RepositoryHandle[],
    sinceCommit?: string
  ): Promise<ExtractionOutput> {
    const extractedRepos: ExtractedRepository[] = [];
    const services: ExtractedService[] = [];
    const modules: ExtractedModule[] = [];
    const buildArtifacts: ExtractedBuildArtifact[] = [];
    const deploymentArtifacts: ExtractedDeploymentArtifact[] = [];
    const dependencies: ExtractedDependency[] = [];
    const commits: ExtractedCommit[] = [];
    const errors: ExtractionError[] = [];

    // Legacy support
    const artifacts: ExtractedArtifact[] = [];

    // Ensure clone directory exists
    if (!fs.existsSync(this.cloneDir)) {
      fs.mkdirSync(this.cloneDir, { recursive: true });
    }

    for (const repo of repositories) {
      try {
        // Ensure repository is available locally
        const repoPath = await this.ensureRepositoryCloned(repo);

        // ── Incremental: compute changed paths via git diff ──────────────────
        let changedPaths: Set<string> | undefined;
        if (sinceCommit) {
          // Security: validate SHA format BEFORE passing to git — prevents command injection
          if (!/^[0-9a-f]{40}$/i.test(sinceCommit)) {
            console.warn(`[ExtractionStage] Invalid sinceCommit SHA "${sinceCommit}" — falling back to full extraction`);
          } else {
            try {
              const git = simpleGit(repoPath);
              // simple-git API — arguments are passed as an array, never shell-interpolated
              const diffOutput = await git.diff([`${sinceCommit}..HEAD`, '--name-only']);
              const paths = diffOutput.trim().split('\n').filter(Boolean);
              changedPaths = new Set(paths);
              console.log(`[ExtractionStage] Incremental diff from ${sinceCommit}: ${changedPaths.size} changed file(s)`);

              if (changedPaths.size === 0) {
                console.log(`[ExtractionStage] No changes detected since ${sinceCommit} — skipping extraction`);
                // Return an empty output with a marker so task-processor can detect this
                return {
                  repositories: [{
                    name: repo.name,
                    url: repo.url,
                    defaultBranch: repo.defaultBranch,
                    lastCommitSha: repo.lastCommitSha,
                    clonePath: repoPath,
                    sourceLocation: repo.url,
                    sourceType: repo.clonePath ? 'local_clone' : 'git_remote',
                    confidence: 1.0,
                    metadata: { skippedDueToNoChanges: true },
                  }],
                  services: [],
                  modules: [],
                  buildArtifacts: [],
                  deploymentArtifacts: [],
                  dependencies: [],
                  commits: [],
                  errors: [],
                  skippedDueToNoChanges: true,
                };
              }
            } catch (diffErr: any) {
              // Security: log server-side only; never expose git error to API response
              console.warn(`[ExtractionStage] Failed to compute diff from ${sinceCommit}: ${diffErr?.message}. Falling back to full extraction.`);
              changedPaths = undefined; // fall back to full extraction
            }
          }
        }
        // ────────────────────────────────────────────────────────────────────

        // Extract repository entity
        extractedRepos.push({
          name: repo.name,
          url: repo.url,
          defaultBranch: repo.defaultBranch,
          lastCommitSha: repo.lastCommitSha,
          clonePath: repoPath,
          sourceLocation: repo.url,
          sourceType: repo.clonePath ? 'local_clone' : 'git_remote',
          confidence: 1.0,
          metadata: {},
        });

        // Extract services (pass changedPaths for incremental filtering)
        const repoServices = await this.extractServices(repoPath, repo, changedPaths);
        services.push(...repoServices);

        // Extract modules for each service
        for (const service of repoServices) {
          const serviceModules = await this.extractModules(repoPath, repo, service);
          modules.push(...serviceModules);
        }

        // Extract build artifacts (pass changedPaths for filtering)
        const builds = await this.extractBuildArtifacts(repoPath, repo, changedPaths);
        buildArtifacts.push(...builds);

        // Extract deployment artifacts (pass changedPaths for filtering)
        const deployments = await this.extractDeploymentArtifacts(repoPath, repo, changedPaths);
        deploymentArtifacts.push(...deployments);

        // Extract dependencies (pass changedPaths for filtering)
        const deps = await this.extractDependencies(repoPath, repo, changedPaths);
        dependencies.push(...deps);

        // Extract commits — use sinceCommit range if available
        const repoCommits = await this.extractCommits(repoPath, repo, sinceCommit);
        commits.push(...repoCommits);

        // Legacy: Extract old-style artifacts for backward compatibility
        artifacts.push({
          type: 'repository',
          name: repo.name,
          path: repo.url,
          repository: repo.url,
          branch: repo.defaultBranch,
          commitSha: repo.lastCommitSha,
          sourceLocation: repo.url,
          sourceType: 'git_tree',
          confidence: 1.0,
          metadata: {},
        });

      } catch (error: any) {
        errors.push({
          stage: 'extraction',
          repository: repo.url,
          message: `Failed to extract: ${error.message}`,
          error,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { 
      repositories: extractedRepos,
      services, 
      modules, 
      buildArtifacts, 
      deploymentArtifacts, 
      dependencies, 
      commits, 
      errors 
    };
  }

  private async ensureRepositoryCloned(repo: RepositoryHandle): Promise<string> {
    // If clonePath is provided (local repo), use it
    if (repo.clonePath) {
      return repo.clonePath;
    }

    const repoPath = path.join(this.cloneDir, repo.name);

    if (this.config.skipClone && fs.existsSync(repoPath)) {
      return repoPath;
    }

    if (fs.existsSync(repoPath)) {
      const git = simpleGit(repoPath);
      await git.pull();
    } else {
      const git = simpleGit();
      await git.clone(repo.url, repoPath, ['--depth', '1']);
    }

    return repoPath;
  }

  /**
   * Returns true if any path in changedPaths falls within the given directory prefix.
   * Used for incremental filtering: include a service/artifact if at least one of
   * its files changed.
   */
  private hasChangedFilesUnder(dirPrefix: string, changedPaths: Set<string>): boolean {
    // Normalize: ensure prefix ends with /  (or is empty → root)
    const prefix = dirPrefix && dirPrefix !== '.' ? dirPrefix.replace(/\/?$/, '/') : '';
    for (const p of changedPaths) {
      if (prefix === '' || p.startsWith(prefix) || p === dirPrefix) return true;
    }
    return false;
  }

  /**
   * Extract services from the repository.
   * When changedPaths is defined, only services whose manifest file (or any file
   * under that service directory) appears in the changed set are returned.
   */
  private async extractServices(
    repoPath: string,
    repo: RepositoryHandle,
    changedPaths?: Set<string>
  ): Promise<ExtractedService[]> {
    const services: ExtractedService[] = [];

    // Look for package.json (Node.js services)
    const packageJsonFiles = await glob('**/package.json', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });

    for (const file of packageJsonFiles) {
      // Incremental: skip if no files changed under this service's directory
      if (changedPaths && !this.hasChangedFilesUnder(path.dirname(file), changedPaths) && !changedPaths.has(file)) continue;
      try {
        const service = await this.extractNodeService(repoPath, file, repo);
        if (service) services.push(service);
      } catch (error) {
        console.error(`Failed to extract Node.js service from ${file}:`, error);
      }
    }

    // Look for Python services (requirements.txt, pyproject.toml, setup.py)
    const pythonFiles = await glob('**/{requirements.txt,pyproject.toml,setup.py}', {
      cwd: repoPath,
      ignore: ['**/venv/**', '**/node_modules/**', '**/.venv/**'],
    });

    for (const file of pythonFiles) {
      if (changedPaths && !this.hasChangedFilesUnder(path.dirname(file), changedPaths) && !changedPaths.has(file)) continue;
      try {
        const service = await this.extractPythonService(repoPath, file, repo);
        if (service) services.push(service);
      } catch (error) {
        console.error(`Failed to extract Python service from ${file}:`, error);
      }
    }

    // Look for Go services (go.mod)
    const goModFiles = await glob('**/go.mod', {
      cwd: repoPath,
    });

    for (const file of goModFiles) {
      if (changedPaths && !this.hasChangedFilesUnder(path.dirname(file), changedPaths) && !changedPaths.has(file)) continue;
      try {
        const service = await this.extractGoService(repoPath, file, repo);
        if (service) services.push(service);
      } catch (error) {
        console.error(`Failed to extract Go service from ${file}:`, error);
      }
    }

    return services;
  }

  /**
   * Returns true when a package.json belongs to a monorepo/workspace root rather
   * than an actual deployable service.  Such manifests exist solely to coordinate
   * scripts and tooling across sub-packages and should never be indexed as a
   * service.
   *
   * Detection heuristics (any one is sufficient):
   *  1. Contains a `workspaces` field (npm / yarn workspaces).
   *  2. A `pnpm-workspace.yaml` file exists next to the manifest.
   *  3. `private: true` **and** zero runtime `dependencies` **and** the
   *     directory contains no `src/` sub-directory – i.e. it is a pure
   *     scripts/tooling shell.
   */
  private isMonorepoRoot(packageJsonDir: string, content: Record<string, unknown>): boolean {
    // Heuristic 1 – npm / yarn workspaces field
    if (content.workspaces) {
      return true;
    }

    // Heuristic 2 – pnpm-workspace.yaml sibling
    if (fs.existsSync(path.join(packageJsonDir, 'pnpm-workspace.yaml'))) {
      return true;
    }

    // Heuristic 3 – private package with no runtime deps and no src directory
    const hasNoDeps = Object.keys((content.dependencies as Record<string, unknown>) || {}).length === 0;
    const hasSrc = fs.existsSync(path.join(packageJsonDir, 'src'));
    if (content.private === true && hasNoDeps && !hasSrc) {
      return true;
    }

    return false;
  }

  private async extractNodeService(
    repoPath: string,
    packageJsonPath: string,
    repo: RepositoryHandle
  ): Promise<ExtractedService | null> {
    const fullPath = path.join(repoPath, packageJsonPath);
    const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

    // Skip monorepo / workspace root manifests – they are not deployable services.
    const packageJsonDir = path.join(repoPath, path.dirname(packageJsonPath));
    if (this.isMonorepoRoot(packageJsonDir, content)) {
      return null;
    }

    // Determine service type
    let serviceType: 'api' | 'library' | 'worker' | 'other' = 'other';
    const techStack: string[] = ['node', 'javascript'];

    if (content.dependencies?.typescript || content.devDependencies?.typescript) {
      techStack.push('typescript');
    }

    if (content.dependencies?.express || content.dependencies?.fastify || content.dependencies?.koa) {
      serviceType = 'api';
      if (content.dependencies?.express) techStack.push('express');
      if (content.dependencies?.fastify) techStack.push('fastify');
      if (content.dependencies?.koa) techStack.push('koa');
    } else if (content.main || content.exports) {
      serviceType = 'library';
    } else if (content.scripts?.worker || content.scripts?.start) {
      serviceType = 'worker';
    }

    const servicePath = path.dirname(packageJsonPath);
    // Include both regular and dev dependencies
    const dependencies = [
      ...Object.keys(content.dependencies || {}),
      ...Object.keys(content.devDependencies || {})
    ];

    // Detect whether this service uses TypeScript by checking for tsconfig or .ts/.tsx files
    let language: 'javascript' | 'typescript' = 'javascript';
    try {
      const tsConfig = path.join(repoPath, servicePath, 'tsconfig.json');
      if (content.dependencies?.typescript || content.devDependencies?.typescript || fs.existsSync(tsConfig)) {
        language = 'typescript';
      } else {
        const tsFiles = await glob('**/*.{ts,tsx}', {
          cwd: path.join(repoPath, servicePath),
          ignore: ['**/node_modules/**'],
        });
        if (tsFiles.length > 0) language = 'typescript';
      }
    } catch (e) {
      // If detection fails, fall back to javascript
    }

    const lastCommit = await this.getLastCommitForPath(repoPath, packageJsonPath);

    return {
      id: `${repo.url}/${path.dirname(packageJsonPath)}`,
      name: content.name || path.basename(servicePath),
      serviceType,
      codePath: servicePath,
      repository: repo.url,
      branch: repo.defaultBranch,
      language,
      techStack,
      dependencies,
      entryFiles: [content.main || 'index.js'].filter(Boolean),
      configFiles: [packageJsonPath],
      lastCommit,
      sourceLocation: `${repo.url}/${packageJsonPath}`,
      sourceType: 'manifest_file',
      confidence: 0.9,
      metadata: {
        version: content.version,
        scripts: content.scripts,
      },
    };
  }

  private async extractPythonService(
    repoPath: string,
    manifestPath: string,
    repo: RepositoryHandle
  ): Promise<ExtractedService | null> {
    const fullPath = path.join(repoPath, manifestPath);
    const servicePath = path.dirname(manifestPath);
    const techStack: string[] = ['python'];
    let serviceType: 'api' | 'library' | 'worker' | 'other' = 'other';
    const dependencies: string[] = [];

    // Parse requirements.txt
    if (manifestPath.endsWith('requirements.txt')) {
      const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
      
      if (content.includes('flask')) {
        serviceType = 'api';
        techStack.push('flask');
      } else if (content.includes('fastapi')) {
        serviceType = 'api';
        techStack.push('fastapi');
      } else if (content.includes('django')) {
        serviceType = 'api';
        techStack.push('django');
      } else if (content.includes('celery')) {
        serviceType = 'worker';
        techStack.push('celery');
      }

      // Extract dependencies
      content.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
          const match = line.match(/^([a-zA-Z0-9_-]+)/);
          if (match) dependencies.push(match[1]);
        }
      });
    }

    const lastCommit = await this.getLastCommitForPath(repoPath, manifestPath);

    return {
      id: `${repo.url}/${path.dirname(manifestPath)}`,
      name: path.basename(servicePath) || 'python-service',
      serviceType,
      codePath: servicePath,
      repository: repo.url,
      branch: repo.defaultBranch,
      language: 'python',
      techStack,
      dependencies,
      configFiles: [manifestPath],
      lastCommit,
      sourceLocation: `${repo.url}/${manifestPath}`,
      sourceType: 'manifest_file',
      confidence: 0.8,
      metadata: {},
    };
  }

  private async extractGoService(
    repoPath: string,
    goModPath: string,
    repo: RepositoryHandle
  ): Promise<ExtractedService | null> {
    const fullPath = path.join(repoPath, goModPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const servicePath = path.dirname(goModPath);
    
    // Extract module name
    const moduleMatch = content.match(/^module\s+(.+)$/m);
    const moduleName = moduleMatch ? moduleMatch[1].trim() : path.basename(servicePath);

    // Extract dependencies
    const dependencies: string[] = [];
    const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireMatch) {
      requireMatch[1].split('\n').forEach(line => {
        const depMatch = line.match(/^\s*([^\s]+)/);
        if (depMatch) dependencies.push(depMatch[1]);
      });
    }

    const lastCommit = await this.getLastCommitForPath(repoPath, goModPath);

    return {
      id: `${repo.url}/${path.dirname(goModPath)}`,
      name: moduleName,
      serviceType: 'other', // Would need more analysis to determine
      codePath: servicePath,
      repository: repo.url,
      branch: repo.defaultBranch,
      language: 'go',
      techStack: ['go'],
      dependencies,
      configFiles: [goModPath],
      lastCommit,
      sourceLocation: `${repo.url}/${goModPath}`,
      sourceType: 'manifest_file',
      confidence: 0.8,
      metadata: {},
    };
  }

  /**
   * Extract modules (source files) from a service
   */
  private async extractModules(
    repoPath: string,
    repo: RepositoryHandle,
    service: ExtractedService
  ): Promise<ExtractedModule[]> {
    const modules: ExtractedModule[] = [];
    const serviceFullPath = path.join(repoPath, service.codePath);

    if (!fs.existsSync(serviceFullPath)) {
      return modules;
    }

    // Extract based on language
    if (service.language === 'javascript' || service.language === 'typescript') {
      const pattern = '**/*.{js,ts,jsx,tsx}';
      const files = await glob(pattern, {
        cwd: serviceFullPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.*', '**/*.spec.*'],
      });

      for (const file of files) {
        try {
          const module = await this.extractJavaScriptModule(serviceFullPath, file, service, repo);
          if (module) modules.push(module);
        } catch (error) {
          console.error(`Failed to extract module ${file}:`, error);
        }
      }
    } else if (service.language === 'python') {
      const pattern = '**/*.py';
      const files = await glob(pattern, {
        cwd: serviceFullPath,
        ignore: ['**/venv/**', '**/.venv/**', '**/test_*.py', '**/*_test.py'],
      });

      for (const file of files) {
        try {
          const module = await this.extractPythonModule(serviceFullPath, file, service, repo);
          if (module) modules.push(module);
        } catch (error) {
          console.error(`Failed to extract module ${file}:`, error);
        }
      }
    }

    return modules;
  }

  private async extractJavaScriptModule(
    serviceFullPath: string,
    relativePath: string,
    service: ExtractedService,
    repo: RepositoryHandle
  ): Promise<ExtractedModule | null> {
    const fullPath = path.join(serviceFullPath, relativePath);
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const modulePath = path.join(service.codePath, relativePath);

    // Extract imports - handle various import patterns
    const imports: string[] = [];
    const exports: string[] = [];
    
    // Match ES6 import statements:
    // import X from 'module'
    // import { X, Y } from 'module'
    // import * as X from 'module'
    // import 'module'
    const es6ImportRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+)?['"]([^'\"]+)['"]/g;
    let match;
    while ((match = es6ImportRegex.exec(fileContent)) !== null) {
      imports.push(match[1]);
    }
    
    // Match CommonJS require statements:
    // require('module')
    // const X = require('module')
    const cjsRequireRegex = /require\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
    while ((match = cjsRequireRegex.exec(fileContent)) !== null) {
      if (!imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }
    
    // Extract exports
    // export { X, Y }
    // export const X = ...
    // export function X() {}
    // export default X
    // module.exports = ...
    // exports.X = ...
    const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    while ((match = namedExportRegex.exec(fileContent)) !== null) {
      exports.push(match[1]);
    }
    
    const exportListRegex = /export\s+\{([^}]+)\}/g;
    while ((match = exportListRegex.exec(fileContent)) !== null) {
      const exportNames = match[1].split(',').map(e => e.trim().split(/\s+as\s+/)[0].trim());
      exports.push(...exportNames);
    }
    
    if (fileContent.includes('export default')) {
      exports.push('default');
    }
    
    if (/module\.exports\s*=/.test(fileContent) || /exports\.\w+\s*=/.test(fileContent)) {
      exports.push('default'); // CommonJS exports
    }

    // Normalize imports to package roots and filter out local file imports
    const normalizedImports = Array.from(new Set(
      imports.map(p => this.packageRootImport(p)).filter(p => this.isPackageImport(p))
    ));
    imports.splice(0, imports.length, ...normalizedImports);

    // Check if entry point
    const isEntryPoint = service.entryFiles?.some(entry => 
      relativePath.includes(entry)
    ) || false;

    let entryType: 'http' | 'queue' | 'cron' | 'cli' | 'other' | undefined;
    if (isEntryPoint) {
      if (fileContent.includes('express') || fileContent.includes('fastify') || fileContent.includes('.get(') || fileContent.includes('.post(')) {
        entryType = 'http';
      } else if (fileContent.includes('cron') || fileContent.includes('schedule')) {
        entryType = 'cron';
      } else if (fileContent.includes('queue') || fileContent.includes('bull') || fileContent.includes('rabbitmq')) {
        entryType = 'queue';
      } else {
        entryType = 'other';
      }
    }

    // Determine language from file extension
    const ext = path.extname(relativePath).toLowerCase();
    let language: 'javascript' | 'typescript' = 'javascript';
    if (ext === '.ts' || ext === '.tsx') language = 'typescript';

    const lastCommit = await this.getLastCommitForPath(serviceFullPath, relativePath);

    return {
      name: path.basename(relativePath, path.extname(relativePath)),
      codePath: modulePath,
      serviceName: service.name,
      serviceId: service.id,
      repository: repo.url,
      branch: repo.defaultBranch,
      language,
      imports,
      exports,
      isEntryPoint,
      entryType,
      lastCommit,
      sourceLocation: `${repo.url}/${modulePath}`,
      sourceType: 'source_file',
      confidence: 0.9,
      metadata: {},
    };
  }

  private async extractPythonModule(
    serviceFullPath: string,
    relativePath: string,
    service: ExtractedService,
    repo: RepositoryHandle
  ): Promise<ExtractedModule | null> {
    const fullPath = path.join(serviceFullPath, relativePath);
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const modulePath = path.join(service.codePath, relativePath);

    // Extract imports - handle various Python import patterns
    const imports: string[] = [];
    const exports: string[] = [];
    
    // Match Python import statements:
    // from module import X, Y
    // from module.submodule import X
    // import module
    // import module.submodule
    // import module as alias
    const fromImportRegex = /^\s*from\s+([^\s]+)\s+import/gm;
    let match;
    while ((match = fromImportRegex.exec(fileContent)) !== null) {
      if (!imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }
    
    const directImportRegex = /^\s*import\s+([^\s,]+)(?:\s+as\s+\w+)?/gm;
    while ((match = directImportRegex.exec(fileContent)) !== null) {
      const modules = match[1].split(',').map(m => m.trim());
      modules.forEach(mod => {
        if (!imports.includes(mod)) {
          imports.push(mod);
        }
      });
    }

    // Normalize imports to package roots and filter out local file imports
    const normalizedPyImports = Array.from(new Set(
      imports.map(p => this.packageRootImport(p)).filter(p => this.isPackageImport(p))
    ));
    imports.splice(0, imports.length, ...normalizedPyImports);
    
    // Extract exports (functions, classes defined at module level)
    const functionDefRegex = /^def\s+(\w+)\s*\(/gm;
    while ((match = functionDefRegex.exec(fileContent)) !== null) {
      if (!match[1].startsWith('_')) { // Exclude private functions
        exports.push(match[1]);
      }
    }
    
    const classDefRegex = /^class\s+(\w+)\s*[\(:]/gm;
    while ((match = classDefRegex.exec(fileContent)) !== null) {
      if (!match[1].startsWith('_')) { // Exclude private classes
        exports.push(match[1]);
      }
    }

    // Check if entry point
    const isEntryPoint = fileContent.includes('if __name__ == "__main__"') ||
                        relativePath.includes('main.py') ||
                        relativePath.includes('app.py');

    let entryType: 'http' | 'queue' | 'cron' | 'cli' | 'other' | undefined;
    if (isEntryPoint) {
      if (fileContent.includes('Flask') || fileContent.includes('FastAPI') || fileContent.includes('@app.route')) {
        entryType = 'http';
      } else if (fileContent.includes('celery') || fileContent.includes('@task')) {
        entryType = 'queue';
      } else if (fileContent.includes('schedule') || fileContent.includes('cron')) {
        entryType = 'cron';
      } else if (fileContent.includes('argparse') || fileContent.includes('click')) {
        entryType = 'cli';
      } else {
        entryType = 'other';
      }
    }

    const lastCommit = await this.getLastCommitForPath(serviceFullPath, relativePath);

    return {
      name: path.basename(relativePath, '.py'),
      codePath: modulePath,
      serviceName: service.name,
      serviceId: service.id,
      repository: repo.url,
      branch: repo.defaultBranch,
      language: 'python',
      imports,
      exports,
      isEntryPoint,
      entryType,
      lastCommit,
      sourceLocation: `${repo.url}/${modulePath}`,
      sourceType: 'source_file',
      confidence: 0.9,
      metadata: {},
    };
  }

  /**
   * Extract build artifacts (Dockerfiles, etc.)
   * When changedPaths is defined, only artifacts whose file appears in the changed set are returned.
   */
  private async extractBuildArtifacts(
    repoPath: string,
    repo: RepositoryHandle,
    changedPaths?: Set<string>
  ): Promise<ExtractedBuildArtifact[]> {
    const artifacts: ExtractedBuildArtifact[] = [];

    // ── 1. Dockerfiles ────────────────────────────────────────────────────
    const dockerfiles = await glob('**/Dockerfile*', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/dist/**'],
    });

    for (const file of dockerfiles) {
      // Incremental: skip unchanged build files
      if (changedPaths && !changedPaths.has(file)) continue;
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Detect technology
        let technology: 'python' | 'node' | 'go' | 'java' | 'rust' | 'other' = 'other';
        if (content.includes('FROM node') || content.includes('FROM nodejs')) {
          technology = 'node';
        } else if (content.includes('FROM python')) {
          technology = 'python';
        } else if (content.includes('FROM golang') || content.includes('FROM go')) {
          technology = 'go';
        } else if (content.includes('FROM java') || content.includes('FROM openjdk')) {
          technology = 'java';
        } else if (content.includes('FROM rust')) {
          technology = 'rust';
        }

        const lastCommit = await this.getLastCommitForPath(repoPath, file);

        artifacts.push({
          name: path.dirname(file),
          buildType: 'docker',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology,
          serviceId: `${repo.url}/${path.dirname(file)}`,
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'build_file',
          confidence: 1.0,
          metadata: {},
        });
      } catch (error) {
        console.error(`Failed to extract Dockerfile ${file}:`, error);
      }
    }

    // ── 2. Script-based build artifacts ──────────────────────────────────
    const scriptArtifacts = await this.extractScriptBuildArtifacts(repoPath, repo, changedPaths);
    artifacts.push(...scriptArtifacts);

    return artifacts;
  }

  /**
   * Discover CI pipelines, Makefiles, and build scripts that invoke docker build
   * or other build commands. These are stored as BuildArtifacts with
   * buildType='script' and a scriptLanguage metadata field so the
   * ScriptAnalyzerAgent can handle them in Step 0.5.
   *
   * Security: file content is read locally from the cloned repo; no user-controlled
   * data is passed to the detection regexes.
   */
  private async extractScriptBuildArtifacts(
    repoPath: string,
    repo: RepositoryHandle,
    changedPaths?: Set<string>
  ): Promise<ExtractedBuildArtifact[]> {
    const artifacts: ExtractedBuildArtifact[] = [];

    /** Build-command indicators for heuristic detection */
    const BUILD_COMMAND_PATTERNS = [
      /docker\s+build/i,
      /docker\s+push/i,
      /mvn\s+package/i,
      /mvn\s+install/i,
      /gradle\s+build/i,
      /cargo\s+build/i,
      /npm\s+run\s+build/i,
      /pnpm\s+(?:run\s+)?build/i,
      /yarn\s+build/i,
      /go\s+build/i,
    ];

    const hasBuildCommands = (content: string): boolean =>
      BUILD_COMMAND_PATTERNS.some(p => p.test(content));

    // ── 2a. GitHub Actions workflows with build commands ─────────────────
    const ghWorkflows = await glob('.github/workflows/*.{yml,yaml}', {
      cwd: repoPath,
      ignore: [],
    });
    for (const file of ghWorkflows) {
      if (changedPaths && !changedPaths.has(file)) continue;
      try {
        const content = fs.readFileSync(path.join(repoPath, file), 'utf-8');
        if (!hasBuildCommands(content)) continue;
        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: path.basename(file, path.extname(file)),
          buildType: 'script',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'other',
          serviceId: `${repo.url}/${file}`,
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'build_file',
          confidence: 0.85,
          metadata: {
            scriptLanguage: 'github-actions',
            detectedBuildCommands: this.extractMatchingLines(content, BUILD_COMMAND_PATTERNS),
          },
        });
      } catch (err) {
        console.error(`Failed to extract GitHub Actions workflow ${file}:`, err);
      }
    }

    // ── 2b. Azure Pipelines ───────────────────────────────────────────────
    const azurePipelines = await glob('azure-pipelines*.{yml,yaml}', {
      cwd: repoPath,
      ignore: [],
    });
    for (const file of azurePipelines) {
      if (changedPaths && !changedPaths.has(file)) continue;
      try {
        const content = fs.readFileSync(path.join(repoPath, file), 'utf-8');
        if (!hasBuildCommands(content)) continue;
        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: path.basename(file, path.extname(file)),
          buildType: 'script',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'other',
          serviceId: `${repo.url}/${file}`,
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'build_file',
          confidence: 0.85,
          metadata: {
            scriptLanguage: 'azure-pipelines',
            detectedBuildCommands: this.extractMatchingLines(content, BUILD_COMMAND_PATTERNS),
          },
        });
      } catch (err) {
        console.error(`Failed to extract Azure Pipeline ${file}:`, err);
      }
    }

    // ── 2c. Jenkinsfiles ──────────────────────────────────────────────────
    const jenkinsfiles = await glob('**/Jenkinsfile', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });
    for (const file of jenkinsfiles) {
      if (changedPaths && !changedPaths.has(file)) continue;
      try {
        const content = fs.readFileSync(path.join(repoPath, file), 'utf-8');
        if (!hasBuildCommands(content)) continue;
        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: path.basename(path.dirname(file)) || 'Jenkinsfile',
          buildType: 'script',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'other',
          serviceId: `${repo.url}/${file}`,
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'build_file',
          confidence: 0.8,
          metadata: {
            scriptLanguage: 'jenkins',
            detectedBuildCommands: this.extractMatchingLines(content, BUILD_COMMAND_PATTERNS),
          },
        });
      } catch (err) {
        console.error(`Failed to extract Jenkinsfile ${file}:`, err);
      }
    }

    // ── 2d. Makefiles with docker build targets ───────────────────────────
    const makefiles = await glob('**/Makefile', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });
    for (const file of makefiles) {
      if (changedPaths && !changedPaths.has(file)) continue;
      try {
        const content = fs.readFileSync(path.join(repoPath, file), 'utf-8');
        if (!hasBuildCommands(content)) continue;
        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: `Makefile (${path.dirname(file)})`,
          buildType: 'script',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'other',
          serviceId: `${repo.url}/${file}`,
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'build_file',
          confidence: 0.8,
          metadata: {
            scriptLanguage: 'makefile',
            detectedBuildCommands: this.extractMatchingLines(content, BUILD_COMMAND_PATTERNS),
          },
        });
      } catch (err) {
        console.error(`Failed to extract Makefile ${file}:`, err);
      }
    }

    // ── 2e. build.sh, build-*.sh, *-build.sh, build.ps1 ─────────────────
    const buildShScripts = await glob('**/{build,build-*,*-build}.{sh,ps1}', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    });
    for (const file of buildShScripts) {
      if (changedPaths && !changedPaths.has(file)) continue;
      try {
        const content = fs.readFileSync(path.join(repoPath, file), 'utf-8');
        if (!hasBuildCommands(content)) continue;
        const ext = path.extname(file);
        const scriptLanguage = ext === '.ps1' ? 'powershell' : 'bash';
        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: path.basename(file, ext),
          buildType: 'script',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'other',
          serviceId: `${repo.url}/${file}`,
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'build_file',
          confidence: 0.85,
          metadata: {
            scriptLanguage,
            detectedBuildCommands: this.extractMatchingLines(content, BUILD_COMMAND_PATTERNS),
          },
        });
      } catch (err) {
        console.error(`Failed to extract build script ${file}:`, err);
      }
    }

    return artifacts;
  }

  /**
   * Extract lines from content that match any of the given patterns.
   * Returns at most 20 matching lines (trimmed) for metadata storage.
   * Security: only reads local file content, never user-controlled input.
   */
  private extractMatchingLines(content: string, patterns: RegExp[]): string[] {
    const lines = content.split('\n');
    const matching: string[] = [];
    for (const line of lines) {
      if (matching.length >= 20) break;
      const trimmed = line.trim();
      if (trimmed && patterns.some(p => p.test(trimmed))) {
        matching.push(trimmed.slice(0, 256)); // length cap
      }
    }
    return matching;
  }

  /**
   * Extract deployment artifacts (K8s, Terraform, Bicep, Helm, Scripts, etc.)
   * When changedPaths is defined, only artifacts whose file appears in the changed set are returned.
   */
  private async extractDeploymentArtifacts(
    repoPath: string,
    repo: RepositoryHandle,
    changedPaths?: Set<string>
  ): Promise<ExtractedDeploymentArtifact[]> {
    const artifacts: ExtractedDeploymentArtifact[] = [];

    // Kubernetes manifests
    const k8sFiles = await glob('**/{*.yaml,*.yml}', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/Chart.yaml', '**/values.yaml'],
    });

    for (const file of k8sFiles) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Check if it's a Kubernetes manifest
        if (content.includes('apiVersion:') && content.includes('kind:')) {
          const lastCommit = await this.getLastCommitForPath(repoPath, file);
          artifacts.push({
            name: path.dirname(file),
            deploymentType: 'kubernetes',
            codePath: file,
            repository: repo.url,
            branch: repo.defaultBranch,
            technology: 'yaml',
            lastCommit,
            sourceLocation: `${repo.url}/${file}`,
            sourceType: 'deployment_file',
            confidence: 0.9,
            metadata: {},
          });
        }
      } catch (error) {
        console.error(`Failed to extract K8s manifest ${file}:`, error);
      }
    }

    // Terraform files
    const tfFiles = await glob('**/*.tf', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/.terraform/**'],
    });

    for (const file of tfFiles) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lastCommit = await this.getLastCommitForPath(repoPath, file);

        artifacts.push({
          name: path.dirname(file),
          deploymentType: 'terraform',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'hcl',
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'deployment_file',
          confidence: 1.0,
          metadata: {},
        });
      } catch (error) {
        console.error(`Failed to extract Terraform file ${file}:`, error);
      }
    }

    // Bicep files (Azure IaC)
    const bicepFiles = await glob('**/*.bicep', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });

    for (const file of bicepFiles) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lastCommit = await this.getLastCommitForPath(repoPath, file);

        artifacts.push({
          name: path.dirname(file),
          deploymentType: 'bicep',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'bicep',
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'deployment_file',
          confidence: 1.0,
          metadata: {},
        });
      } catch (error) {
        console.error(`Failed to extract Bicep file ${file}:`, error);
      }
    }

    // Helm charts
    const helmCharts = await glob('**/Chart.yaml', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });

    for (const file of helmCharts) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = yaml.parse(content);
        
        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: parsed?.name || path.basename(path.dirname(file)),
          deploymentType: 'helm',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'yaml',
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'deployment_file',
          confidence: 1.0,
          metadata: {
            version: parsed?.version,
            appVersion: parsed?.appVersion,
          },
        });
      } catch (error) {
        console.error(`Failed to extract Helm chart ${file}:`, error);
      }
    }

    // Docker Compose
    const composeFiles = await glob('**/docker-compose*.{yml,yaml}', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });

    for (const file of composeFiles) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = yaml.parse(content);
        const services = parsed?.services ? Object.keys(parsed.services) : [];
        const dirName = path.dirname(file);

        const lastCommit = await this.getLastCommitForPath(repoPath, file);
        artifacts.push({
          name: dirName.length > 2 ? dirName : repo.name,
          deploymentType: 'docker-compose',
          codePath: file,
          repository: repo.url,
          branch: repo.defaultBranch,
          technology: 'yaml',
          lastCommit,
          sourceLocation: `${repo.url}/${file}`,
          sourceType: 'deployment_file',
          confidence: 1.0,
          metadata: {
            services,
          },
        });
      } catch (error) {
        console.error(`Failed to extract Docker Compose ${file}:`, error);
      }
    }

    // Deployment scripts (bash)
    const bashScripts = await glob('**/*.sh', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    });

    for (const file of bashScripts) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const deploymentInfo = this.analyzeDeploymentScript(content, 'bash');
        if (deploymentInfo.isDeployment) {
          const lastCommit = await this.getLastCommitForPath(repoPath, file);
          artifacts.push({
            name: path.basename(file, '.sh'),
            deploymentType: 'script',
            codePath: file,
            repository: repo.url,
            branch: repo.defaultBranch,
            technology: 'bash',
            lastCommit,
            sourceLocation: `${repo.url}/${file}`,
            sourceType: 'deployment_file',
            confidence: deploymentInfo.confidence,
            metadata: {
              deployedComponents: deploymentInfo.components,
              targetPlatform: deploymentInfo.platform,
            },
          });
        }
      } catch (error) {
        console.error(`Failed to extract bash script ${file}:`, error);
      }
    }

    // Deployment scripts (PowerShell)
    const ps1Scripts = await glob('**/*.ps1', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    });

    for (const file of ps1Scripts) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const deploymentInfo = this.analyzeDeploymentScript(content, 'powershell');
        if (deploymentInfo.isDeployment) {
          const lastCommit = await this.getLastCommitForPath(repoPath, file);
          artifacts.push({
            name: path.basename(file, '.ps1'),
            deploymentType: 'script',
            codePath: file,
            repository: repo.url,
            branch: repo.defaultBranch,
            technology: 'powershell',
            lastCommit,
            sourceLocation: `${repo.url}/${file}`,
            sourceType: 'deployment_file',
            confidence: deploymentInfo.confidence,
            metadata: {
              deployedComponents: deploymentInfo.components,
              targetPlatform: deploymentInfo.platform,
            },
          });
        }
      } catch (error) {
        console.error(`Failed to extract PowerShell script ${file}:`, error);
      }
    }

    return artifacts;
  }

  /**
   * Analyze a script to determine if it's a deployment script and extract deployment info
   */
  private analyzeDeploymentScript(
    content: string,
    scriptType: 'bash' | 'powershell'
  ): {
    isDeployment: boolean;
    confidence: number;
    components: string[];
    platform?: string;
  } {
    const lowerContent = content.toLowerCase();
    const components: string[] = [];
    let isDeployment = false;
    let confidence = 0;
    let platform: string | undefined;

    // Deployment indicators
    const deploymentKeywords = [
      'deploy', 'deployment', 'publish', 'release', 'rollout',
      'docker push', 'docker build', 'kubectl apply', 'helm install',
      'terraform apply', 'az containerapp', 'az webapp', 'az storage blob upload',
      'aws deploy', 'gcloud app deploy', 'heroku deploy'
    ];

    // Check for deployment keywords
    const foundKeywords = deploymentKeywords.filter(keyword => 
      lowerContent.includes(keyword)
    );

    if (foundKeywords.length > 0) {
      isDeployment = true;
      confidence = Math.min(0.9, 0.5 + (foundKeywords.length * 0.1));
    }

    // Detect platform
    if (lowerContent.includes('az ') || lowerContent.includes('azure')) {
      platform = 'azure';
    } else if (lowerContent.includes('aws ') || lowerContent.includes('eb deploy')) {
      platform = 'aws';
    } else if (lowerContent.includes('gcloud ') || lowerContent.includes('google cloud')) {
      platform = 'gcp';
    } else if (lowerContent.includes('kubectl ') || lowerContent.includes('kubernetes')) {
      platform = 'kubernetes';
    } else if (lowerContent.includes('docker ')) {
      platform = 'docker';
    } else if (lowerContent.includes('heroku ')) {
      platform = 'heroku';
    }

    // Extract component names from common patterns
    const componentPatterns = [
      // Azure patterns: deploy-api.sh, deploy-ui.sh
      { regex: /deploy[_-](\w+)\./gi, group: 1 },
      // Generic patterns: api-deploy.sh, ui-deployment.sh
      { regex: /(\w+)[_-]deploy/gi, group: 1 },
      // Variable patterns: API_APP_NAME="xyz-api"
      { regex: /(?:API|SERVICE|APP|WORKER|UI|WEB)_(?:APP_)?NAME\s*=\s*["']([^"']+)["']/gi, group: 1 },
      // Docker image patterns: docker build ... -t name:tag
      { regex: /-t\s+[^\/\s]+\/([^:\/\s]+)[:\/]/g, group: 1 },
      // Azure container app patterns: az containerapp create --name xyz
      { regex: /containerapp\s+(?:create|update)\s+--name\s+(\S+)/gi, group: 1 },
    ];

    for (const { regex, group } of componentPatterns) {
      // Create a new regex instance to reset lastIndex
      const patternRegex = new RegExp(regex.source, regex.flags);
      let match;
      while ((match = patternRegex.exec(content)) !== null) {
        const component = match[group];
        if (component && !components.includes(component)) {
          components.push(component);
        }
        // Safety check to prevent infinite loops
        if (patternRegex.lastIndex === 0) break;
      }
    }

    return {
      isDeployment,
      confidence,
      components: components.slice(0, 10), // Limit to 10 components
      platform,
    };
  }

  /**
   * Detect the actual package manager used in a Node.js project
   */
  private detectNodePackageManager(repoPath: string, packageJsonDir: string): 'npm' | 'yarn' | 'pnpm' {
    const projectPath = path.join(repoPath, packageJsonDir);
    
    // Check for lock files in order of specificity
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
      return 'yarn';
    }
    if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) {
      return 'npm';
    }
    
    // Check package.json for packageManager field (Node.js 16.9+)
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (content.packageManager) {
        const pm = content.packageManager.split('@')[0];
        if (pm === 'pnpm' || pm === 'yarn' || pm === 'npm') {
          return pm;
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }
    
    // Default to npm if no lock file is found
    return 'npm';
  }

  /**
   * Extract dependencies.
   * When changedPaths is defined, only files in the changed set are processed.
   */
  private async extractDependencies(
    repoPath: string,
    repo: RepositoryHandle,
    changedPaths?: Set<string>
  ): Promise<ExtractedDependency[]> {
    const dependencies: ExtractedDependency[] = [];

    // Node.js dependencies
    const packageJsonFiles = await glob('**/package.json', {
      cwd: repoPath,
      ignore: ['**/node_modules/**'],
    });

    for (const file of packageJsonFiles) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const packageJsonDir = path.dirname(file);
        const packageManager = this.detectNodePackageManager(repoPath, packageJsonDir);
        const lastCommit = await this.getLastCommitForPath(repoPath, file);

        // Production dependencies
        Object.entries(content.dependencies || {}).forEach(([name, version]) => {
          dependencies.push({
            name,
            version: version as string,
            versionConstraint: version as string,
            packageManager,
            isDev: false,
            isTransitive: false,
            declaredInFile: file,
            repository: repo.url,
            lastCommit,
            sourceLocation: `${repo.url}/${file}`,
            sourceType: 'manifest_file',
            confidence: 1.0,
            metadata: {},
          });
        });

        // Dev dependencies
        Object.entries(content.devDependencies || {}).forEach(([name, version]) => {
          dependencies.push({
            name,
            version: version as string,
            versionConstraint: version as string,
            packageManager,
            isDev: true,
            isTransitive: false,
            declaredInFile: file,
            repository: repo.url,
            lastCommit,
            sourceLocation: `${repo.url}/${file}`,
            sourceType: 'manifest_file',
            confidence: 1.0,
            metadata: {},
          });
        });
      } catch (error) {
        console.error(`Failed to extract dependencies from ${file}:`, error);
      }
    }

    // Python dependencies
    const requirementsFiles = await glob('**/requirements.txt', {
      cwd: repoPath,
      ignore: ['**/venv/**'],
    });

    for (const file of requirementsFiles) {
      if (changedPaths && !changedPaths.has(file)) continue; // incremental skip
      try {
        const fullPath = path.join(repoPath, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lastCommit = await this.getLastCommitForPath(repoPath, file);

        content.split('\n').forEach(line => {
          line = line.trim();
          if (!line || line.startsWith('#')) return;

          const match = line.match(/^([^=><\s]+)([=><]=?)(.+)$/);
          if (match) {
            dependencies.push({
              name: match[1].trim(),
              version: match[3].trim(),
              versionConstraint: match[2] + match[3],
              packageManager: 'pip',
              isDev: false,
              isTransitive: false,
              declaredInFile: file,
              repository: repo.url,
              lastCommit,
              sourceLocation: `${repo.url}/${file}`,
              sourceType: 'manifest_file',
              confidence: 1.0,
              metadata: {},
            });
          }
        });
      } catch (error) {
        console.error(`Failed to extract dependencies from ${file}:`, error);
      }
    }

    return dependencies;
  }

  private async extractCommits(
    repoPath: string,
    repo: RepositoryHandle,
    sinceCommit?: string
  ): Promise<ExtractedCommit[]> {
    const commits: ExtractedCommit[] = [];

    try {
      const git = simpleGit(repoPath);

      // For incremental runs, fetch commits since the last indexed commit
      // For full runs, fetch the last 10 commits
      let log;
      if (sinceCommit && /^[0-9a-f]{40}$/i.test(sinceCommit)) {
        // Security: SHA validated; arguments passed as array — no shell interpolation
        log = await git.log({ from: sinceCommit, to: 'HEAD' });
      } else {
        log = await git.log({ maxCount: 10 });
      }

      for (const commit of log.all) {
        const stats = await git.show([commit.hash, '--stat', '--format=']);
        const lines = stats.split('\n');
        let linesAdded = 0;
        let linesDeleted = 0;

        lines.forEach(line => {
          const match = line.match(/(\d+) insertion.*?(\d+) deletion/);
          if (match) {
            linesAdded += parseInt(match[1]);
            linesDeleted += parseInt(match[2]);
          }
        });

        commits.push({
          sha: commit.hash,
          repository: repo.url,
          branch: repo.defaultBranch,
          author: commit.author_name,
          authorEmail: commit.author_email,
          message: commit.message,
          timestamp: commit.date,
          filesChanged: [], // Would need separate call to get file list
          linesAdded,
          linesDeleted,
          sourceLocation: `${repo.url}/commit/${commit.hash}`,
          metadata: {},
        });
      }
    } catch (error) {
      console.error(`Failed to extract commits from ${repo.name}:`, error);
    }

    return commits;
  }
}
