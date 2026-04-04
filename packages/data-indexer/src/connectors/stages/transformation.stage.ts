/**
 * Stage 3: Transformation
 * 
 * Converts extracted raw facts to canonical entities
 */

import {
  TransformationStage,
  TransformationOutput,
  ExtractionOutput,
  ExtractedRepository,
  ExtractedService,
  ExtractedModule,
  ExtractedBuildArtifact,
  ExtractedDeploymentArtifact,
  ExtractedDependency,
  ExtractedCommit,
  ExtractionError,
} from '../../types/pipeline.types';
import {
  TenantId,
  CanonicalEntity,
  CodeRepository,
  CodeService,
  CodeModule,
  BuildArtifact,
  DeploymentArtifact,
  Dependency,
  Commit,
  Relationship,
  Evidence,
} from '@ai-agent/shared';
import { EntityIdUtils } from '../../utils/id-generator';

/**
 * Code Transformation Stage
 */
export class CodeTransformationStage implements TransformationStage {
  private tenantId: TenantId;
  private idUtils: EntityIdUtils;

  constructor(tenantId: TenantId, idUtils: EntityIdUtils) {
    this.tenantId = tenantId;
    this.idUtils = idUtils;
  }

  async transform(
    tenantId: TenantId,
    extraction: ExtractionOutput,
  ): Promise<TransformationOutput> {
    const entities: CanonicalEntity[] = [];
    const relationships: Relationship[] = [];
    const evidence: Evidence[] = [];
    const errors: ExtractionError[] = [];
    const now = new Date().toISOString();

    // Build lookup maps for creating relationships
    const repoMap = new Map<string, string>(); // repo name -> repo id
    const serviceMap = new Map<string, string>(); // service name -> service id
    const buildMap = new Map<string, string>(); // build name -> build id
    const deploymentMap = new Map<string, string>(); // deployment name -> deployment id

    // Transform repositories
    for (const repo of extraction.repositories) {
      try {
        const entity = this.transformRepository(repo, now);
        entities.push(entity);
        evidence.push(this.createRepositoryEvidence(entity.id, repo, now));
        repoMap.set(repo.url, entity.id);
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: repo.name,
          message: `Failed to transform repository: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    // Transform services
    for (const service of extraction.services) {
      try {
        const entity = this.transformService(service, now);
        entities.push(entity);
        evidence.push(this.createServiceEvidence(entity.id, service, now));
        serviceMap.set(service.name, entity.id);

        // Create CONTAINS relationship from repo to service
        const repoId = repoMap.get(service.repository);
        if (repoId) {
          relationships.push(
            this.createRelationship('CONTAINS', repoId, entity.id, now)
          );
        }
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: service.name,
          message: `Failed to transform service: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    // Transform modules
    for (const module of extraction.modules) {
      try {
        const entity = this.transformModule(module, now, serviceMap);
        entities.push(entity);
        evidence.push(this.createModuleEvidence(entity.id, module, now));
        // Service→module membership is resolved via CodeModule.serviceId property;
        // no graph edge needed.
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: module.name,
          message: `Failed to transform module: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    // Transform build artifacts
    for (const build of extraction.buildArtifacts) {
      try {
        const entity = this.transformBuildArtifact(build, now, serviceMap);
        entities.push(entity);
        evidence.push(this.createBuildArtifactEvidence(entity.id, build, now));
        buildMap.set(build.name, entity.id);

        // Create BUILDS relationships
        const serviceId = build.serviceId;
        if (serviceId) {
          relationships.push(
            this.createRelationship('BUILDS', entity.id, serviceId, now)
          );
        }
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: build.name,
          message: `Failed to transform build artifact: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    // Transform deployment artifacts
    for (const deployment of extraction.deploymentArtifacts) {
      try {
        const entity = this.transformDeploymentArtifact(deployment, now, serviceMap);
        entities.push(entity);
        evidence.push(this.createDeploymentArtifactEvidence(entity.id, deployment, now));
        deploymentMap.set(deployment.name, entity.id);

        // Create DEPLOYS relationships if services are specified in metadata
        if (deployment.metadata?.services && Array.isArray(deployment.metadata.services)) {
          for (const serviceName of deployment.metadata.services) {
            const serviceId = serviceMap.get(serviceName);
            if (serviceId) {
              relationships.push(
                this.createRelationship('DEPLOYS', entity.id, serviceId, now)
              );
            }
          }
        }
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: deployment.name,
          message: `Failed to transform deployment artifact: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    // Note: Cloud resources are now discovered via CloudDiscoveryStage in the main pipeline
    // instead of being extracted from deployment artifacts

    // Create service-to-service DEPENDS_ON relationships from package dependency lists.
    // Build a set of all known service names for O(1) lookup.
    const serviceNameSet = new Set(extraction.services.map(s => s.name));
    for (const service of extraction.services) {
      const serviceId = serviceMap.get(service.name);
      if (!serviceId || !service.dependencies) continue;

      for (const depName of service.dependencies) {
        if (!serviceNameSet.has(depName)) continue;
        const targetServiceId = serviceMap.get(depName);
        if (targetServiceId && targetServiceId !== serviceId) {
          relationships.push(
            this.createRelationship('DEPENDS_ON', serviceId, targetServiceId, now)
          );
        }
      }
    }

    // Transform dependencies
    for (const dep of extraction.dependencies) {
      try {
        const entity = this.transformDependency(dep, now);
        entities.push(entity);
        evidence.push(this.createDependencyEvidence(entity.id, dep, now));

        // Create DEPENDS_ON relationship from service to dependency
        if (dep.usedByComponent) {
          const componentId = serviceMap.get(dep.usedByComponent);
          if (componentId) {
            relationships.push(
              this.createRelationship('DEPENDS_ON', componentId, entity.id, now)
            );
          }
        }
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: dep.name,
          message: `Failed to transform dependency: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    // Transform commits
    for (const commit of extraction.commits) {
      try {
        const entity = this.transformCommit(commit, now);
        entities.push(entity);
        evidence.push(this.createCommitEvidence(entity.id, commit, now));
      } catch (error: any) {
        errors.push({
          stage: 'transformation',
          artifact: commit.sha,
          message: `Failed to transform commit: ${error.message}`,
          error,
          timestamp: now,
        });
      }
    }

    return { entities, relationships, evidence, errors };
  }

  private transformRepository(repo: ExtractedRepository, now: string): CodeRepository {
    const id = this.idUtils.repositoryId(this.tenantId, repo.url);

    return {
      id,
      tenantId: this.tenantId,
      entityType: 'code_repository',
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      lastCommitSha: repo.lastCommitSha,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: repo.metadata,
      lastIndexedAt: now,
    };
  }

  private transformService(service: ExtractedService, now: string): CodeService {
    const id = this.idUtils.serviceId(this.tenantId, service.name, service.repository, service.codePath);
    return {
      id,
      tenantId: this.tenantId,
      entityType: 'code_service',
      serviceType: service.serviceType,
      name: service.name,
      codePath: service.codePath,
      repositoryId: this.idUtils.repositoryId(this.tenantId, service.repository),
      language: service.language,
      techStack: service.techStack,
      dependencies: service.dependencies,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: service.metadata,
      lastIndexedAt: now,
      lastIndexedCommit: service.lastCommit?.sha,
    };
  }

  private transformModule(module: ExtractedModule, now: string, serviceMap: Map<string, string>): CodeModule {
    const id = this.idUtils.moduleId(this.tenantId, module.name, module.repository, module.codePath);

    return {
      id,
      tenantId: this.tenantId,
      entityType: 'code_module',
      name: module.name,
      codePath: module.codePath,
      serviceId: serviceMap.get(module.serviceName) ?? module.serviceId,
      repositoryId: this.idUtils.repositoryId(this.tenantId, module.repository),
      language: module.language,
      dependencies: module.imports,
      isEntryPoint: module.isEntryPoint,
      entryType: module.entryType,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: module.metadata,
      lastIndexedAt: now,
      lastIndexedCommit: module.lastCommit?.sha,
    };
  }

  private transformBuildArtifact(build: ExtractedBuildArtifact, now: string, serviceMap: Map<string, string>): BuildArtifact {
    const id = this.idUtils.buildArtifactId(this.tenantId, build.name, build.repository, build.codePath);

    // Resolve service IDs from service names
    const serviceIds = [serviceMap.get(build.serviceId) ?? build.serviceId];

    return {
      id,
      tenantId: this.tenantId,
      entityType: 'build_artifact',
      buildType: build.buildType,
      name: build.name,
      codePath: build.codePath,
      repositoryId: this.idUtils.repositoryId(this.tenantId, build.repository),
      serviceIds,
      technology: build.technology,
      // Propagate scriptLanguage from metadata to the dedicated field
      ...(build.metadata?.scriptLanguage ? { scriptLanguage: build.metadata.scriptLanguage as string } : {}),
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: build.metadata,
      lastIndexedAt: now,
      lastIndexedCommit: build.lastCommit?.sha,
    };
  }

  private transformDeploymentArtifact(deployment: ExtractedDeploymentArtifact, now: string, serviceMap: Map<string, string>): DeploymentArtifact {
    // Resolve service IDs if specified in metadata
    const serviceIds: string[] = [];
    if (deployment.metadata?.services && Array.isArray(deployment.metadata.services)) {
      for (const serviceName of deployment.metadata.services) {
        const serviceId = serviceMap.get(serviceName);
        if (serviceId) {
          serviceIds.push(serviceId);
        }
      }
    }

    const id = this.idUtils.deploymentArtifactId(this.tenantId, deployment.name, deployment.repository, deployment.codePath);

    return {
      id,
      tenantId: this.tenantId,
      entityType: 'deployment_artifact',
      deploymentType: deployment.deploymentType,
      name: deployment.name,
      codePath: deployment.codePath,
      repositoryId: this.idUtils.repositoryId(this.tenantId, deployment.repository),
      technology: deployment.technology,
      serviceIds,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: deployment.metadata,
      lastIndexedAt: now,
      lastIndexedCommit: deployment.lastCommit?.sha,
    };
  }

  private transformDependency(dep: ExtractedDependency, now: string): Dependency {
    const id = this.idUtils.dependencyId(
      this.tenantId,
      dep.name,
      dep.version,
      dep.packageManager
    );

    return {
      id,
      tenantId: this.tenantId,
      entityType: 'dependency',
      name: dep.name,
      version: dep.version,
      versionConstraint: dep.versionConstraint,
      packageManager: dep.packageManager as any,
      isDev: dep.isDev,
      isTransitive: dep.isTransitive,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: dep.metadata,
      lastIndexedAt: now,
      lastIndexedCommit: dep.lastCommit?.sha,
    };
  }

  private transformCommit(commit: ExtractedCommit, now: string): Commit {
    const id = this.idUtils.commitId(this.tenantId, commit.repository, commit.sha);

    return {
      id,
      tenantId: this.tenantId,
      entityType: 'commit',
      sha: commit.sha,
      repository: commit.repository,
      branch: commit.branch,
      author: commit.author,
      authorEmail: commit.authorEmail,
      message: commit.message,
      timestamp: commit.timestamp,
      filesChanged: commit.filesChanged.length,
      linesAdded: commit.linesAdded,
      linesDeleted: commit.linesDeleted,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: commit.metadata,
    };
  }

  private createRelationship(
    type: string,
    sourceId: string,
    targetId: string,
    validFrom: string
  ): Relationship {
    const id = this.idUtils.relationshipId(
      this.tenantId,
      type,
      sourceId,
      targetId,
      validFrom
    );

    return {
      id,
      tenantId: this.tenantId,
      type: type as any,
      sourceId,
      targetId,
      validFrom,
      confidence: 'deterministic',
      metadata: {},
    };
  }

  private createRepositoryEvidence(
    entityId: string,
    repo: ExtractedRepository,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'git_commit',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'git_commit',
        location: repo.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        name: repo.name,
        url: repo.url,
        defaultBranch: repo.defaultBranch,
        lastCommitSha: repo.lastCommitSha,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: repo.metadata,
    };
  }

  private createServiceEvidence(
    entityId: string,
    service: ExtractedService,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'manifest_file',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'file',
        location: service.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        name: service.name,
        serviceType: service.serviceType,
        codePath: service.codePath,
        language: service.language,
        techStack: service.techStack,
        dependencies: service.dependencies,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: service.metadata,
    };
  }

  private createModuleEvidence(
    entityId: string,
    module: ExtractedModule,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'source_code',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'git_blob',
        location: module.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        name: module.name,
        codePath: module.codePath,
        language: module.language,
        imports: module.imports,
        exports: module.exports,
        isEntryPoint: module.isEntryPoint,
        entryType: module.entryType,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: module.metadata,
    };
  }

  private createBuildArtifactEvidence(
    entityId: string,
    build: ExtractedBuildArtifact,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'config_file',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'file',
        location: build.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        name: build.name,
        buildType: build.buildType,
        codePath: build.codePath,
        technology: build.technology,
        serviceNames: build.serviceId,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: build.metadata,
    };
  }

  private createDeploymentArtifactEvidence(
    entityId: string,
    deployment: ExtractedDeploymentArtifact,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'config_file',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'file',
        location: deployment.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        name: deployment.name,
        deploymentType: deployment.deploymentType,
        codePath: deployment.codePath,
        technology: deployment.technology,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: deployment.metadata,
    };
  }

  private createDependencyEvidence(
    entityId: string,
    dep: ExtractedDependency,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'manifest_file',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'file',
        location: dep.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        name: dep.name,
        version: dep.version,
        versionConstraint: dep.versionConstraint,
        packageManager: dep.packageManager,
        isDev: dep.isDev,
        declaredInFile: dep.declaredInFile,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: dep.metadata,
    };
  }

  private createCommitEvidence(
    entityId: string,
    commit: ExtractedCommit,
    now: string
  ): Evidence {
    return {
      id: this.idUtils.evidenceId(),
      tenantId: this.tenantId,
      evidenceType: 'git_commit',
      subjectId: entityId,
      subjectType: 'entity',
      source: {
        type: 'git_commit',
        location: commit.sourceLocation,
        retrievedAt: now,
      },
      extractedFacts: {
        sha: commit.sha,
        author: commit.author,
        message: commit.message,
        timestamp: commit.timestamp,
        filesChanged: commit.filesChanged,
        linesAdded: commit.linesAdded,
        linesDeleted: commit.linesDeleted,
      },
      confidence: 'deterministic',
      createdAt: now,
      metadata: commit.metadata,
    };
  }
}
