/**
 * ServiceRelationshipsExtractor
 *
 * Single LLM pipeline that first analyses every entity type and then runs
 * all cross-entity correlations with the enriched context.
 *
 * ── ANALYSIS PHASE ───────────────────────────────────────────────────────────
 *   Step 0   – IaC Deep Analysis (per declarative deployment artifact)
 *              Reads each IaC file and produces an IaCAnalysis: deployed
 *              services, created/referenced cloud resources, naming conventions,
 *              and deployment target scope. Persisted back onto the artifact.
 *
 *   Step 0.5 – Script Analysis (per script build/deployment artifact)
 *              Reads each imperative script (bash, PS1, CI pipelines, Makefiles)
 *              and produces a ScriptAnalysis. The deployment side is normalised to
 *              IaCAnalysis; the build side to BuildArtifactAnalysis. Persisted
 *              back onto the respective artifact.
 *
 *   Scope Resolution (after Step 0.5)
 *              Deterministic extraction of deployment scopes from analysis output.
 *              Builds a map of artifactId → DeploymentScope used by Steps 4 and 6.
 *
 *   Step 1   – Build Artifact Analysis (per non-script build artifact)
 *              Reads each build file (Dockerfile, etc.) and produces a
 *              BuildArtifactAnalysis. Persisted back onto the BuildArtifact.
 *
 *   Step 2   – Service Analysis (per service)
 *              Produces a rich structured ServiceAnalysis for each service.
 *
 * ── CORRELATION PHASE (uses analysis context) ────────────────────────────────
 *   Step 3   – Build → Service (BUILDS)
 *   Step 4   – Build → Deployment (DEPENDS_ON)
 *   Step 5   – IaC → Cloud Resource (DEPLOYS / USES) — scoped; builds affinity map
 *   Step 6   – IaC → Service (DEPLOYS)
 *   Step 7   – Service → Cloud Resource (DEPLOYED_TO / USES) — scoped via affinity
 *
 * Security:
 *   - All LLM outputs are sanitized with sanitizeMetadata before storage.
 *   - Errors are logged with only the message string.
 *   - The completion tools reject evidence fields containing secret patterns.
 *   - Repository briefing is injected read-only; it is never written by agents.
 *   - CloudResourceRepository is bounded; correlators receive at most 40 candidates.
 *   - cloudResources backward-compat input is wrapped in a bounded repository on entry.
 */

import type { BuildArtifact, CloudResource, CodeService, DeploymentArtifact, EntityId, RepositoryBriefing, Relationship, ServiceExternalSurface } from '@ai-agent/shared';
import { Neo4jAdapter, QdrantAdapter } from '@ai-agent/shared';
import { DataIndexerAgentRegistry } from '../../agents';

import type { ServiceRelationshipsInput, ServiceRelationshipsResult } from './types';
import { PersistenceHelper } from './helpers/persistence';
import { IaCAnalyzer } from './analysis/iac-analyzer';
import { BuildArtifactAnalyzer } from './analysis/build-artifact-analyzer';
import { ServiceAnalyzer } from './analysis/service-analyzer';
import { ScriptAnalyzer } from './analysis/script-analyzer';
import { correlateBuildToService } from './correlators/build-to-service';
import { correlateBuildToDeployment } from './correlators/build-to-deployment';
import { correlateIaCToCloudResources } from './correlators/iac-to-cloud';
import type { ArtifactResourceGroupAffinity, ServiceResourceGroupAffinity } from './correlators/iac-to-cloud';
import { correlateIaCToServices } from './correlators/iac-to-service';
import { correlateServicesToCloudResources } from './correlators/service-to-cloud';
import { ExploitabilityAnalyzer } from './exploitability/exploitability-analyzer';
import { CloudResourceRepository } from '../cloud-resource-repository';
import { extractDeploymentScopes } from './helpers/scope-resolver';
import type { DeploymentScope } from './helpers/scope-resolver';

export type { ServiceRelationshipsInput, ServiceRelationshipsResult };

export class ServiceRelationshipsExtractor {
  private readonly persistence: PersistenceHelper;
  private readonly iacAnalyzer: IaCAnalyzer;
  private readonly buildArtifactAnalyzer: BuildArtifactAnalyzer;
  private readonly serviceAnalyzer: ServiceAnalyzer;
  private readonly exploitabilityAnalyzer: ExploitabilityAnalyzer;

  constructor(
    private readonly registry: DataIndexerAgentRegistry,
    private readonly neo4j?: Neo4jAdapter,
    private readonly qdrant?: QdrantAdapter,
  ) {
    this.persistence = new PersistenceHelper(neo4j, qdrant);
    this.iacAnalyzer = new IaCAnalyzer(registry);
    this.buildArtifactAnalyzer = new BuildArtifactAnalyzer(registry);
    this.serviceAnalyzer = new ServiceAnalyzer(registry);
    this.exploitabilityAnalyzer = new ExploitabilityAnalyzer(registry, this.persistence);
  }

  /**
   * Fetch the cloud topology context for a single service from Neo4j + Qdrant.
   */
  async getCloudContextForService(
    tenantId: string,
    serviceId: string,
  ): Promise<{ relationships: Relationship[]; dependentServices: CodeService[] }> {
    const relationships = await this.persistence.getCloudRelationshipsForService(tenantId, serviceId);
    const dependentServices = await this.persistence.getDependentServices(tenantId, serviceId);
    return { relationships, dependentServices };
  }

  /**
   * Run exploitability analysis using the unified security context.
   * Called by the task-processor as a separate stage after BusinessFeatureExtractor.
   */
  async analyzeExploitability(
    services: CodeService[],
    cloudResources: CloudResource[],
    tenantId: string,
  ): Promise<CodeService[]> {
    return this.exploitabilityAnalyzer.analyzeExploitability(services, cloudResources, tenantId);
  }

  /**
   * Run the full pipeline (Steps 0–7: analysis + correlation).
   * Threat model and exploitability are deferred to later stages.
   *
   * @param input.cloudRepository   - Preferred: pre-built indexed store for cloud resources.
   * @param input.cloudResources    - Deprecated fallback: flat array wrapped in a repository.
   * @param input.repositoryBriefing - Optional briefing injected as context into Step 2.
   */
  async extract(input: ServiceRelationshipsInput): Promise<ServiceRelationshipsResult> {
    const { tenantId, repositoryPath, services, buildArtifacts, deploymentArtifacts, repositoryBriefing } = input;

    // ── Cloud resource store ───────────────────────────────────────────────
    // Prefer the pre-built repository; fall back to wrapping the flat array.
    // Security: the repository enforces maxResults bounds on every query so
    //           no correlator can accidentally receive an unbounded resource list.
    const cloudRepository: CloudResourceRepository =
      input.cloudRepository ??
      new CloudResourceRepository(input.cloudResources ?? []);

    const allRelationships: Relationship[] = [];
    const serviceMap = new Map<EntityId, CodeService>(services.map(s => [s.id, { ...s }]));
    const artifactMap = new Map<EntityId, DeploymentArtifact>(
      deploymentArtifacts.map(a => [a.id, { ...a }]),
    );
    const buildArtifactMap = new Map<EntityId, BuildArtifact>(
      buildArtifacts.map(a => [a.id, { ...a }]),
    );

    // ── Instantiate analyzers with cloud repository (enables LLM query tools) ──
    const iacAnalyzerWithRepo = new IaCAnalyzer(this.registry, cloudRepository);
    const scriptAnalyzer = new ScriptAnalyzer(this.registry, cloudRepository);

    // ── Step 0: IaC Deep Analysis — declarative deployment artifacts ──────
    // Only runs for non-script deployment artifacts (terraform, bicep, ARM, helm, compose).
    const declarativeArtifacts = deploymentArtifacts.filter(
      a => !isScriptDeploymentArtifact(a),
    );
    if (declarativeArtifacts.length > 0) {
      console.log(
        `   [SRE] Step 0 – IaC Deep Analysis (${declarativeArtifacts.length} declarative artifact(s))…`,
      );
      for (const artifact of declarativeArtifacts) {
        try {
          const analysis = await iacAnalyzerWithRepo.analyzeIaCFile(artifact, repositoryPath);
          const updated: DeploymentArtifact = {
            ...artifactMap.get(artifact.id)!,
            iacAnalysis: analysis,
            responsibility: iacAnalyzerWithRepo.buildIaCResponsibility(artifact, analysis),
          };
          artifactMap.set(artifact.id, updated);
          await this.persistence.persistDeploymentArtifact(updated);
          console.log(
            `   [SRE]   ✅ ${artifact.name}: ` +
            `${analysis.deployedServices.length} service(s), ` +
            `${analysis.deployedResources.length} deployed resource(s), ` +
            `${analysis.usedResources.length} referenced resource(s)` +
            (analysis.deploymentTargets?.resourceGroups?.length
              ? `, RG scope: [${analysis.deploymentTargets.resourceGroups.join(', ')}]`
              : ''),
          );
        } catch (err) {
          console.error(
            `   [SRE]   ❌ ${artifact.name}: IaC analysis failed:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // ── Step 0.5: Script Analysis — imperative build + deployment scripts ─
    // Script-based deployment artifacts: bash, PS1, CI pipeline files.
    // Script-based build artifacts: CI pipeline, Makefile, build.sh files.
    const scriptDeploymentArtifacts = deploymentArtifacts.filter(isScriptDeploymentArtifact);
    const scriptBuildArtifacts = buildArtifacts.filter(isScriptBuildArtifact);
    const scriptArtifactCount = scriptDeploymentArtifacts.length + scriptBuildArtifacts.length;

    if (scriptArtifactCount > 0) {
      console.log(
        `   [SRE] Step 0.5 – Script Analysis (${scriptDeploymentArtifacts.length} deploy script(s), ` +
        `${scriptBuildArtifacts.length} build script(s))…`,
      );

      // Script deployment artifacts → normalise to IaCAnalysis
      for (const artifact of scriptDeploymentArtifacts) {
        try {
          const scriptAnalysis = await scriptAnalyzer.analyzeScript(artifact, repositoryPath);
          const iacAnalysis = scriptAnalyzer.promoteToIaCAnalysis(scriptAnalysis);
          const updated: DeploymentArtifact = {
            ...artifactMap.get(artifact.id)!,
            iacAnalysis,
            responsibility: scriptAnalyzer.buildScriptResponsibility(artifact, scriptAnalysis),
          };
          artifactMap.set(artifact.id, updated);
          await this.persistence.persistDeploymentArtifact(updated);
          console.log(
            `   [SRE]   ✅ ${artifact.name} (deploy script): ` +
            `${scriptAnalysis.deployedServices.length} service(s), ` +
            `${scriptAnalysis.deployedResources.length} deployed resource(s)` +
            (scriptAnalysis.deploymentTargets.resourceGroups?.length
              ? `, RG scope: [${scriptAnalysis.deploymentTargets.resourceGroups.join(', ')}]`
              : ''),
          );
        } catch (err) {
          console.error(
            `   [SRE]   ❌ ${artifact.name}: deploy script analysis failed:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // Script build artifacts → normalise to BuildArtifactAnalysis
      for (const artifact of scriptBuildArtifacts) {
        try {
          const scriptAnalysis = await scriptAnalyzer.analyzeScript(artifact, repositoryPath);
          const buildArtifactAnalysis = scriptAnalyzer.promoteToBuildArtifactAnalysis(scriptAnalysis);
          const updated: BuildArtifact = {
            ...buildArtifactMap.get(artifact.id)!,
            buildArtifactAnalysis,
            responsibility: scriptAnalyzer.buildScriptResponsibility(artifact, scriptAnalysis),
          };
          buildArtifactMap.set(artifact.id, updated);
          await this.persistence.persistBuildArtifact(updated);
          console.log(
            `   [SRE]   ✅ ${artifact.name} (build script): ` +
            `${scriptAnalysis.producedServices.length} service(s), ` +
            `technology: ${scriptAnalysis.buildTechnology ?? 'script'}`,
          );
        } catch (err) {
          console.error(
            `   [SRE]   ❌ ${artifact.name}: build script analysis failed:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // ── Scope Resolution (after Steps 0 + 0.5) ─────────────────────────────
    // Build a deterministic map of artifactId → DeploymentScope from the
    // analysis output. Used by Steps 5 and 7 to constrain candidate resources.
    // Security: scope strings come from sanitized IaCAnalysis fields, not raw LLM output.
    let deploymentScopes: Map<string, DeploymentScope> | undefined;
    if (cloudRepository.totalCount > 0 && artifactMap.size > 0) {
      const allResourceGroups = cloudRepository.listResourceGroups();
      deploymentScopes = extractDeploymentScopes([...artifactMap.values()], allResourceGroups);
      const scopedCount = [...deploymentScopes.values()].filter(s => s.resourceGroups.length > 0).length;
      console.log(
        `   [SRE] Scope Resolution: ${artifactMap.size} artifact(s), ` +
        `${scopedCount} with resolved RG scope, ` +
        `${artifactMap.size - scopedCount} fallback`,
      );
    }

    // ── Step 1: Build Artifact Analysis — non-script build artifacts ──────
    const nonScriptBuildArtifacts = buildArtifacts.filter(a => !isScriptBuildArtifact(a));
    if (nonScriptBuildArtifacts.length > 0) {
      console.log(
        `   [SRE] Step 1 – Build Artifact Analysis (${nonScriptBuildArtifacts.length} artifact(s))…`,
      );
      for (const artifact of nonScriptBuildArtifacts) {
        try {
          const analysis = await this.buildArtifactAnalyzer.analyzeBuildArtifactFile(artifact, repositoryPath);
          const updated: BuildArtifact = {
            ...buildArtifactMap.get(artifact.id)!,
            buildArtifactAnalysis: analysis,
            responsibility: this.buildArtifactAnalyzer.buildBuildArtifactResponsibility(artifact, analysis),
          };
          buildArtifactMap.set(artifact.id, updated);
          await this.persistence.persistBuildArtifact(updated);
          console.log(
            `   [SRE]   ✅ ${artifact.name}: ` +
            `${analysis.producedServices.length} service(s), ` +
            `technology: ${analysis.buildTechnology}`,
          );
        } catch (err) {
          console.error(
            `   [SRE]   ❌ ${artifact.name}: build artifact analysis failed:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // ── Step 2: Service Analysis per service ──────────────────────────────
    // Produces rich ServiceAnalysis (structure, tech, external/internal deps,
    // business value) for each service. Repository briefing is injected as
    // orientation context when available.
    //
    // Services are processed in topological order (leaves first) so that when
    // service A depends on service B, B's completed surface is available as
    // structured context for A's Pass 2 — avoiding redundant file reads and
    // ensuring transitive deps are captured accurately.
    if (services.length > 0) {
      const orderedServices = topoSortServices([...serviceMap.values()]);
      console.log(
        `   [SRE] Step 2 – Service Analysis (${orderedServices.length} service(s), ` +
        `dependency order: ${orderedServices.map(s => s.name).join(' → ')})…`,
      );

      // Accumulates serviceName → completed surface; passed into each analyzeService call.
      const completedSurfaces = new Map<string, ServiceExternalSurface>();

      for (const service of orderedServices) {
        try {
          const analysis = await this.serviceAnalyzer.analyzeService(
            serviceMap.get(service.id) ?? service,
            repositoryPath,
            repositoryBriefing,
            completedSurfaces,
          );
          const updated: CodeService = {
            ...serviceMap.get(service.id)!,
            serviceAnalysis: analysis,
            externalDeps: analysis.externalDeps,
            responsibility: this.serviceAnalyzer.buildServiceResponsibility(analysis),
            // Persist the 3-pass pre-analysis artifacts for downstream use
            ...(('_fileMap' in analysis) && { serviceFileMap: (analysis as any)._fileMap }),
            ...(('_skeleton' in analysis) && { serviceSkeleton: (analysis as any)._skeleton }),
            ...(('_surface' in analysis) && { serviceExternalSurface: (analysis as any)._surface }),
          };
          serviceMap.set(service.id, updated);
          await this.persistence.persistServiceAnalysis(updated);

          // Register the completed surface so dependent services see it as context.
          if ('_surface' in analysis) {
            completedSurfaces.set(service.name, (analysis as any)._surface);
          }

          console.log(
            `   [SRE]   ✅ ${service.name}: ` +
            `${analysis.externalDeps.length} external dep(s), ` +
            `${analysis.internalDependencies.length} internal dep(s), ` +
            `patterns: ${analysis.architecturalPatterns.join(', ') || 'none'}`,
          );
        } catch (err) {
          console.error(
            `   [SRE]   ❌ ${service.name}: service analysis failed:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // ── Step 3: Build → Service (BUILDS) ──────────────────────────────────
    if (buildArtifacts.length > 0 && services.length > 0) {
      console.log(
        `   [SRE] Step 3 – Build → Service (${buildArtifacts.length} builds, ${services.length} services)…`,
      );
      const rels = await correlateBuildToService(
        this.registry.getApi(), this.persistence, tenantId, repositoryPath,
        [...buildArtifactMap.values()], [...serviceMap.values()],
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} Build→Service relationship(s)`);
    }

    // ── Step 4: Build → Deployment (DEPENDS_ON) ───────────────────────────
    if (buildArtifacts.length > 0 && deploymentArtifacts.length > 0) {
      console.log(
        `   [SRE] Step 4 – Build → Deployment (${buildArtifacts.length} builds, ${deploymentArtifacts.length} deployments)…`,
      );
      const rels = await correlateBuildToDeployment(
        this.registry.getApi(), this.persistence, tenantId, repositoryPath,
        [...buildArtifactMap.values()], [...artifactMap.values()],
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} Build→Deployment relationship(s)`);
    }

    // ── Step 5: IaC → Cloud Resource ── scoped ────────────────────────────
    // Each artifact only sees cloud resources in its resolved scope (5–30 vs 800).
    // Builds the artifact-level affinity map used by Step 7.
    let affinityByArtifact: ArtifactResourceGroupAffinity = new Map();
    if (artifactMap.size > 0 && cloudRepository.totalCount > 0) {
      console.log(
        `   [SRE] Step 5 – IaC → Cloud Resource (${artifactMap.size} IaC, ${cloudRepository.totalCount} resources)…`,
      );
      const result = await correlateIaCToCloudResources(
        this.registry.getApi(), this.persistence, tenantId, repositoryPath,
        [...artifactMap.values()], cloudRepository, deploymentScopes,
      );
      allRelationships.push(...result.relationships);
      affinityByArtifact = result.affinityByArtifact;
      console.log(`   [SRE]   ✅ ${result.relationships.length} IaC→Cloud relationship(s)`);
    }

    // ── Step 6: IaC → Service ──────────────────────────────────────────────
    if (artifactMap.size > 0 && services.length > 0) {
      console.log(
        `   [SRE] Step 6 – IaC → Service (${artifactMap.size} IaC, ${services.length} services)…`,
      );
      const rels = await correlateIaCToServices(
        this.registry.getApi(), this.persistence, tenantId, repositoryPath,
        [...artifactMap.values()], [...serviceMap.values()],
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} IaC→Service relationship(s)`);
    }

    // ── Affinity promotion: artifact-level → service-level ─────────────────
    // Use the IaC→Service relationships from Step 6 to promote the
    // artifact-resource-group affinity to service-level so Step 7 can
    // scope candidates per service without re-running LLM calls.
    //
    // For each IaC artifact that DEPLOYS a service (from Step 6),
    // union its resource groups into the service's affinity set.
    const serviceRGAffinity: ServiceResourceGroupAffinity = new Map();
    if (affinityByArtifact.size > 0) {
      for (const rel of allRelationships) {
        if (rel.type !== 'DEPLOYS') continue;
        // Is the source an artifact and the target a service?
        const artifactRGs = affinityByArtifact.get(rel.sourceId);
        if (!artifactRGs || artifactRGs.size === 0) continue;
        if (!serviceMap.has(rel.targetId)) continue;

        if (!serviceRGAffinity.has(rel.targetId)) {
          serviceRGAffinity.set(rel.targetId, new Set());
        }
        for (const rg of artifactRGs) {
          serviceRGAffinity.get(rel.targetId)!.add(rg);
        }
      }
      console.log(
        `   [SRE] Affinity promotion: ${serviceRGAffinity.size} service(s) with RG affinity`,
      );
    }

    // ── Step 7: Service → Cloud Resource ── scoped via affinity ───────────
    if (services.length > 0 && cloudRepository.totalCount > 0) {
      console.log(
        `   [SRE] Step 7 – Service → Cloud Resource (${services.length} services)…`,
      );
      const rels = await correlateServicesToCloudResources(
        this.registry.getApi(), this.persistence, tenantId, repositoryPath,
        [...serviceMap.values()], cloudRepository,
        allRelationships, [...artifactMap.values()],
        serviceRGAffinity, deploymentScopes,
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} Service→Cloud relationship(s)`);
    }

    return {
      relationships: allRelationships,
      updatedServices: [...serviceMap.values()],
      updatedDeploymentArtifacts: [...artifactMap.values()],
      updatedBuildArtifacts: [...buildArtifactMap.values()],
    };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if the deployment artifact was produced by an imperative script
 * (bash, PowerShell, CI pipeline, Makefile) rather than a declarative IaC file.
 *
 * Heuristic: deployment artifacts whose `deploymentType` indicates a script
 * source (az/aws/gcloud CLI scripts, CI/CD runners, makefiles).
 *
 * Falling back to codePath extension pattern when deploymentType is generic.
 */
function isScriptDeploymentArtifact(artifact: DeploymentArtifact): boolean {
  const scriptTypes = new Set(['script', 'bash', 'powershell', 'github-actions', 'azure-pipelines', 'jenkins', 'makefile']);
  if (scriptTypes.has(artifact.deploymentType?.toLowerCase() ?? '')) return true;
  // Fallback: check file extension
  const ext = artifact.codePath.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'sh' || ext === 'ps1' || ext === 'psm1';
}

/**
 * Returns true if the build artifact is a script-based builder
 * (CI pipeline, Makefile, build.sh) rather than a declarative build file.
 *
 * Declarative build files (Dockerfile, pom.xml, build.gradle, package.json)
 * are handled by BuildArtifactAnalyzer, not ScriptAnalyzer.
 */
function isScriptBuildArtifact(artifact: BuildArtifact): boolean {
  return artifact.buildType === 'script';
}

/**
 * Topologically sort services so that dependency leaves come first.
 *
 * This ensures that when service A lists service B in its skeleton's
 * `internalDependencies`, B has already been analysed and its
 * ServiceExternalSurface is available as context for A's Pass 2.
 *
 * Algorithm: Kahn's algorithm (BFS).
 *   - Nodes are matched by service.name (the value stored in internalDependencies).
 *   - Services whose deps are not present in the input set (external / unresolved)
 *     are treated as having no in-workspace deps and are scheduled first.
 *   - Cycles are broken by appending remaining nodes after the sorted prefix,
 *     emitting a warning so the situation is visible in logs.
 *
 * Security: operates only on service names (strings already in the entity);
 *           no external input is introduced.
 */
function topoSortServices(services: CodeService[]): CodeService[] {
  const nameToService = new Map<string, CodeService>(services.map(s => [s.name, s]));
  const nameSet = new Set<string>(nameToService.keys());

  // Build adjacency: dep → dependents (reverse edges for Kahn's)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → [services that depend on it]

  for (const svc of services) {
    if (!inDegree.has(svc.name)) inDegree.set(svc.name, 0);
    const deps = svc.dependencies
      ?? [];
    for (const dep of deps) {
      if (!nameSet.has(dep)) continue; // external / not in this run → ignore
      inDegree.set(svc.name, (inDegree.get(svc.name) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(svc.name);
    }
  }

  const queue: string[] = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([name]) => name);
  const sorted: CodeService[] = [];

  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(nameToService.get(name)!);
    for (const dependent of dependents.get(name) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  // Handle cycles / unresolved (append remaining in original order)
  if (sorted.length < services.length) {
    const sortedNames = new Set(sorted.map(s => s.name));
    const remaining = services.filter(s => !sortedNames.has(s.name));
    console.warn(
      `   [SRE] topoSortServices: ${remaining.length} service(s) could not be topologically sorted ` +
      `(possible cycle or unresolved dep). Appending in original order: ` +
      remaining.map(s => s.name).join(', '),
    );
    sorted.push(...remaining);
  }

  return sorted;
}
