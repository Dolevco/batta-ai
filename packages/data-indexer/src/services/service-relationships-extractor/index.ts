/**
 * ServiceRelationshipsExtractor
 *
 * Single LLM pipeline that first analyses every entity type and then runs
 * all cross-entity correlations with the enriched context.
 *
 * ── ANALYSIS PHASE ───────────────────────────────────────────────────────────
 *   Step 0   – IaC Deep Analysis (per deployment artifact)
 *              Reads each IaC file and produces an IaCAnalysis: deployed
 *              services, created/referenced cloud resources, and naming
 *              conventions. Persisted back onto the DeploymentArtifact.
 *
 *   Step 0.5 – Build Artifact Analysis (per build artifact)
 *              Reads each build file (Dockerfile, etc.) and produces a
 *              BuildArtifactAnalysis: produced services, build technology,
 *              target runtime, and patterns. Persisted back onto the
 *              BuildArtifact.
 *
 *   Step 1   – Service Analysis (per service)
 *              Produces a rich structured ServiceAnalysis for each service:
 *              business description, business value, tech stack, code structure,
 *              external/internal dependencies, entry point types, and
 *              architectural patterns. Repository briefing context is injected
 *              as orientation. Stored on the CodeService as `serviceAnalysis`
 *              and `externalDeps`. Also populates `responsibility`.
 *
 * ── CORRELATION PHASE (uses analysis context) ────────────────────────────────
 *   Step 2   – Build → Service (BUILDS)
 *   Step 3   – Build → Deployment (DEPENDS_ON)
 *   Step 4   – IaC → Cloud Resource (DEPLOYS / USES)
 *   Step 5   – IaC → Service (DEPLOYS)
 *   Step 6   – Service → Cloud Resource (DEPLOYED_TO / USES)
 *
 * Threat model analysis and exploitability analysis are both deferred to
 * later task-processor stages (BusinessFeatureExtractor + ExploitabilityAnalyzer).
 *
 * Security:
 *   - All LLM outputs are sanitized with sanitizeMetadata before storage.
 *   - Errors are logged with only the message string.
 *   - The completion tools reject evidence fields containing secret patterns.
 *   - Repository briefing is injected read-only; it is never written by agents.
 */

import type { ILLMApiHandler } from '@ai-agent/core';
import type { BuildArtifact, CloudResource, CodeService, DeploymentArtifact, EntityId, RepositoryBriefing, Relationship } from '@ai-agent/shared';
import { Neo4jAdapter, QdrantAdapter } from '@ai-agent/shared';

import type { ServiceRelationshipsInput, ServiceRelationshipsResult } from './types';
import { PersistenceHelper } from './helpers/persistence';
import { IaCAnalyzer } from './analysis/iac-analyzer';
import { BuildArtifactAnalyzer } from './analysis/build-artifact-analyzer';
import { ServiceAnalyzer } from './analysis/service-analyzer';
import { correlateBuildToService } from './correlators/build-to-service';
import { correlateBuildToDeployment } from './correlators/build-to-deployment';
import { correlateIaCToCloudResources } from './correlators/iac-to-cloud';
import { correlateIaCToServices } from './correlators/iac-to-service';
import { correlateServicesToCloudResources } from './correlators/service-to-cloud';
import { ExploitabilityAnalyzer } from './exploitability/exploitability-analyzer';

export type { ServiceRelationshipsInput, ServiceRelationshipsResult };

export class ServiceRelationshipsExtractor {
  private readonly persistence: PersistenceHelper;
  private readonly iacAnalyzer: IaCAnalyzer;
  private readonly buildArtifactAnalyzer: BuildArtifactAnalyzer;
  private readonly serviceAnalyzer: ServiceAnalyzer;
  private readonly exploitabilityAnalyzer: ExploitabilityAnalyzer;

  constructor(
    private readonly api: ILLMApiHandler,
    private readonly neo4j?: Neo4jAdapter,
    private readonly qdrant?: QdrantAdapter,
  ) {
    this.persistence = new PersistenceHelper(neo4j, qdrant);
    this.iacAnalyzer = new IaCAnalyzer(api);
    this.buildArtifactAnalyzer = new BuildArtifactAnalyzer(api);
    this.serviceAnalyzer = new ServiceAnalyzer(api);
    this.exploitabilityAnalyzer = new ExploitabilityAnalyzer(api, this.persistence);
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
   * Run the full pipeline (Steps 0–6: analysis + correlation).
   * Threat model and exploitability are deferred to later stages.
   *
   * @param input.repositoryBriefing - Optional briefing produced before this call;
   *                                   injected as orientation context into Step 1.
   */
  async extract(input: ServiceRelationshipsInput): Promise<ServiceRelationshipsResult> {
    const { tenantId, repositoryPath, services, buildArtifacts, deploymentArtifacts, cloudResources, repositoryBriefing } = input;

    const allRelationships: Relationship[] = [];
    const serviceMap = new Map<EntityId, CodeService>(services.map(s => [s.id, { ...s }]));
    const artifactMap = new Map<EntityId, DeploymentArtifact>(
      deploymentArtifacts.map(a => [a.id, { ...a }]),
    );
    const buildArtifactMap = new Map<EntityId, BuildArtifact>(
      buildArtifacts.map(a => [a.id, { ...a }]),
    );

    // ── Step 0: IaC Deep Analysis per deployment artifact ─────────────────
    if (deploymentArtifacts.length > 0) {
      console.log(
        `   [SRE] Step 0 – IaC Deep Analysis (${deploymentArtifacts.length} artifact(s))…`,
      );
      for (const artifact of deploymentArtifacts) {
        try {
          const analysis = await this.iacAnalyzer.analyzeIaCFile(artifact, repositoryPath);
          const updated: DeploymentArtifact = {
            ...artifactMap.get(artifact.id)!,
            iacAnalysis: analysis,
            responsibility: this.iacAnalyzer.buildIaCResponsibility(artifact, analysis),
          };
          artifactMap.set(artifact.id, updated);
          await this.persistence.persistDeploymentArtifact(updated);
          console.log(
            `   [SRE]   ✅ ${artifact.name}: ` +
            `${analysis.deployedServices.length} service(s), ` +
            `${analysis.deployedResources.length} deployed resource(s), ` +
            `${analysis.usedResources.length} referenced resource(s)`,
          );
        } catch (err) {
          console.error(
            `   [SRE]   ❌ ${artifact.name}: IaC analysis failed:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // ── Step 0.5: Build Artifact Analysis per build artifact ──────────────
    if (buildArtifacts.length > 0) {
      console.log(
        `   [SRE] Step 0.5 – Build Artifact Analysis (${buildArtifacts.length} artifact(s))…`,
      );
      for (const artifact of buildArtifacts) {
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

    // ── Step 1: Service Analysis per service ──────────────────────────────
    // Produces rich ServiceAnalysis (structure, tech, external/internal deps,
    // business value) for each service. Repository briefing is injected as
    // orientation context when available.
    if (services.length > 0) {
      console.log(`   [SRE] Step 1 – Service Analysis (${services.length} service(s))…`);
      for (const service of services) {
        try {
          const analysis = await this.serviceAnalyzer.analyzeService(
            serviceMap.get(service.id) ?? service,
            repositoryPath,
            repositoryBriefing,
          );
          const updated: CodeService = {
            ...serviceMap.get(service.id)!,
            serviceAnalysis: analysis,
            externalDeps: analysis.externalDeps,
            responsibility: this.serviceAnalyzer.buildServiceResponsibility(analysis),
          };
          serviceMap.set(service.id, updated);
          await this.persistence.persistServiceAnalysis(updated);
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

    // ── Step 2: Build → Service (BUILDS) ──────────────────────────────────
    if (buildArtifacts.length > 0 && services.length > 0) {
      console.log(
        `   [SRE] Step 2 – Build → Service (${buildArtifacts.length} builds, ${services.length} services)…`,
      );
      const rels = await correlateBuildToService(
        this.api, this.persistence, tenantId, repositoryPath,
        [...buildArtifactMap.values()], [...serviceMap.values()],
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} Build→Service relationship(s)`);
    }

    // ── Step 3: Build → Deployment (DEPENDS_ON) ───────────────────────────
    if (buildArtifacts.length > 0 && deploymentArtifacts.length > 0) {
      console.log(
        `   [SRE] Step 3 – Build → Deployment (${buildArtifacts.length} builds, ${deploymentArtifacts.length} deployments)…`,
      );
      const rels = await correlateBuildToDeployment(
        this.api, this.persistence, tenantId, repositoryPath,
        [...buildArtifactMap.values()], [...artifactMap.values()],
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} Build→Deployment relationship(s)`);
    }

    // ── Step 4: IaC → Cloud Resource ───────────────────────────────────────
    if (deploymentArtifacts.length > 0 && cloudResources.length > 0) {
      console.log(
        `   [SRE] Step 4 – IaC → Cloud Resource (${deploymentArtifacts.length} IaC, ${cloudResources.length} resources)…`,
      );
      const rels = await correlateIaCToCloudResources(
        this.api, this.persistence, tenantId, repositoryPath,
        [...artifactMap.values()], cloudResources,
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} IaC→Cloud relationship(s)`);
    }

    // ── Step 5: IaC → Service ──────────────────────────────────────────────
    if (deploymentArtifacts.length > 0 && services.length > 0) {
      console.log(
        `   [SRE] Step 5 – IaC → Service (${deploymentArtifacts.length} IaC, ${services.length} services)…`,
      );
      const rels = await correlateIaCToServices(
        this.api, this.persistence, tenantId, repositoryPath,
        [...artifactMap.values()], [...serviceMap.values()],
      );
      allRelationships.push(...rels);
      console.log(`   [SRE]   ✅ ${rels.length} IaC→Service relationship(s)`);
    }

    // ── Step 6: Service → Cloud Resource ──────────────────────────────────
    if (services.length > 0 && cloudResources.length > 0) {
      console.log(
        `   [SRE] Step 6 – Service → Cloud Resource (${services.length} services)…`,
      );
      const rels = await correlateServicesToCloudResources(
        this.api, this.persistence, tenantId, repositoryPath,
        [...serviceMap.values()], cloudResources,
        allRelationships, [...artifactMap.values()],
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
