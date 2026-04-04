/**
 * Stage 4: Semantic Analysis
 *
 * Generates LLM descriptions and semantic documents for build artifacts and
 * deployment artifacts.
 *
 * NOTE: code_service entities are intentionally SKIPPED here.
 * The 3-pass ServiceAnalyzer (Stage 4.5 / ServiceRelationshipsExtractor) now
 * produces a richer skeleton-derived serviceDescription and sets
 * service.responsibility directly. The pipeline generates service semantic docs
 * AFTER Stage 4.5 completes (see CodeIndexingPipeline.run).
 * This eliminates the duplicate 15-iteration LLM call per service.
 */

import { MODES, PlannedTaskCompletionTool, Task, createReadOnlyFileTools } from '@ai-agent/core';
import type { ILLMApiHandler } from '@ai-agent/core';
import {
  SemanticAnalysisStage,
  SemanticAnalysisOutput,
  ExtractionOutput,
  ExtractionError,
} from '../../types/pipeline.types';
import {
  TenantId,
  CanonicalEntity,
  SemanticDocument,
  CodeService,
  BuildArtifact,
  DeploymentArtifact,
} from '@ai-agent/shared';
import { EntityIdUtils, InputHashGenerator } from '../../utils/id-generator';

/**
 * Code Semantic Analysis Stage
 *
 * Generates LLM-based responsibility descriptions for build artifacts and
 * deployment artifacts.  code_service entities are excluded — their
 * responsibility is derived from the skeleton output of the 3-pass
 * ServiceAnalyzer and does not require a separate LLM call here.
 */
export class CodeSemanticAnalysisStage implements SemanticAnalysisStage {
  private tenantId: TenantId;
  private idUtils: EntityIdUtils;
  private hashGenerator: InputHashGenerator;
  private api: ILLMApiHandler;
  private repositoryPath: string;

  constructor(tenantId: TenantId, idUtils: EntityIdUtils, api: ILLMApiHandler, repositoryPath: string) {
    this.tenantId = tenantId;
    this.idUtils = idUtils;
    this.hashGenerator = new InputHashGenerator();
    this.api = api;
    this.repositoryPath = repositoryPath;
  }

  async analyze(
    tenantId: TenantId,
    artifacts: CanonicalEntity[],
    extraction: ExtractionOutput
  ): Promise<SemanticAnalysisOutput> {
    const documents: SemanticDocument[] = [];
    const errors: ExtractionError[] = [];
    let cacheHits = 0;
    let cacheMisses = 0;

    let processedCount = 0;
    const totalCount = artifacts.filter(e =>
      e.entityType === 'build_artifact' ||
      e.entityType === 'deployment_artifact'
    ).length;

    for (const entity of artifacts) {
      // code_service: responsibility is now seeded from skeleton output in Stage 4.5.
      // Generating a separate LLM description here would be a redundant 15-iteration call
      // that gets overwritten anyway. Skip code_service entities entirely.
      if (entity.entityType === 'code_service') {
        continue;
      } else if (entity.entityType === 'build_artifact') {
        const buildArtifact = entity as BuildArtifact;
        processedCount++;
        console.log(`      🧠 [${processedCount}/${totalCount}] Analyzing build artifact: ${buildArtifact.name}`);
        const responsibility = await this.generateResponsibility(
          buildArtifact.name,
          buildArtifact.codePath,
          buildArtifact.technology,
          buildArtifact.buildType,
          'build_artifact',
          []
        );

        // Update the entity with responsibility
        buildArtifact.responsibility = responsibility;

        const inputHash = this.hashGenerator.generateInputHash(
          buildArtifact.name,
          buildArtifact.codePath,
          buildArtifact.technology,
          { buildType: buildArtifact.buildType }
        );

        const doc: SemanticDocument = {
          id: this.idUtils.semanticDocumentId(inputHash),
          tenantId,
          artifactId: buildArtifact.id,
          inputHash,
          language: buildArtifact.technology,
          filePath: buildArtifact.codePath,
          responsibility,
          llmModel: process.env.AZURE_OPENAI_DEPLOYMENT!,
          generatedAt: new Date().toISOString(),
          metadata: {},
        };

        documents.push(doc);
        cacheMisses++;
      } else if (entity.entityType === 'deployment_artifact') {
        const deployArtifact = entity as DeploymentArtifact;
        processedCount++;
        console.log(`      🧠 [${processedCount}/${totalCount}] Analyzing deployment artifact: ${deployArtifact.name}`);
        const responsibility = await this.generateResponsibility(
          deployArtifact.name,
          deployArtifact.codePath,
          deployArtifact.technology,
          deployArtifact.deploymentType,
          'deployment_artifact',
          []
        );

        // Update the entity with responsibility
        deployArtifact.responsibility = responsibility;

        const inputHash = this.hashGenerator.generateInputHash(
          deployArtifact.name,
          deployArtifact.codePath,
          deployArtifact.technology,
          { deploymentType: deployArtifact.deploymentType }
        );

        const doc: SemanticDocument = {
          id: this.idUtils.semanticDocumentId(inputHash),
          tenantId,
          artifactId: deployArtifact.id,
          inputHash,
          language: deployArtifact.technology,
          filePath: deployArtifact.codePath,
          responsibility,
          llmModel: process.env.AZURE_OPENAI_DEPLOYMENT!,
          generatedAt: new Date().toISOString(),
          metadata: {},
        };

        documents.push(doc);
        cacheMisses++;
      }
    }

    return { documents, cacheHits, cacheMisses, errors };
  }

  /**
   * Generate a SemanticDocument for a code_service entity whose responsibility
   * has already been populated by the 3-pass ServiceAnalyzer.
   *
   * Called by the pipeline AFTER Stage 4.5 (SRE) so the richer skeleton-derived
   * responsibility is used instead of a separate LLM call.
   *
   * Security: only the sanitized `service.responsibility` string is forwarded;
   *   no raw file content or secret values are included.
   */
  buildServiceSemanticDoc(tenantId: TenantId, service: CodeService): SemanticDocument {
    const responsibility = service.responsibility || `${service.serviceType} for ${service.name}`;

    const inputHash = this.hashGenerator.generateInputHash(
      service.name,
      service.codePath,
      service.language,
      { serviceType: service.serviceType },
    );

    return {
      id: this.idUtils.semanticDocumentId(inputHash),
      tenantId,
      artifactId: service.id,
      inputHash,
      language: service.language,
      filePath: service.codePath,
      responsibility,
      llmModel: process.env.AZURE_OPENAI_DEPLOYMENT!,
      generatedAt: new Date().toISOString(),
      metadata: {},
    };
  }

  private async generateResponsibility(
    name: string,
    codePath: string,
    language: string,
    type: string,
    entityType: 'code_service' | 'build_artifact' | 'deployment_artifact',
    techStack?: string[]
  ): Promise<string> {
    // If no API provided, return a simple default description
    if (!this.api) {
      return `${type} for ${name}`;
    }

    const context = this.buildContext(name, codePath, language, type, entityType, techStack);
    const requiredOutputs = {
      responsibility: '1-2 line description of the entity\'s purpose and responsibility',
    };

    const completionTool = new PlannedTaskCompletionTool(requiredOutputs);
    const tools = [...createReadOnlyFileTools({ workspacePath: this.repositoryPath }), completionTool];

    const task = new Task(this.api, {
      mode: MODES.RESPONSIBILITY_EXTRACTION,
      workspace: this.repositoryPath,
      tools,
      maxIterations: 15,
    });

    const result = await task.execute<{ responsibility: string }>(context);

    if (!result.success || !result.requiredOutput) {
      return `${type} for ${name}`;
    }

    return (result.requiredOutput as any).responsibility || `${type} for ${name}`;
  }

  private buildContext(
    name: string,
    codePath: string,
    language: string,
    type: string,
    entityType: 'code_service' | 'build_artifact' | 'deployment_artifact',
    techStack?: string[]
  ): string {
    const parts: string[] = [];
    
    parts.push('=== ENTITY ===');
    parts.push(`Name: ${name}`);
    parts.push(`Path: ${codePath}`);
    parts.push(`Language/Technology: ${language}`);
    parts.push(`Type: ${type}`);
    
    if (techStack && techStack.length > 0) {
      parts.push(`Tech Stack: ${techStack.join(', ')}`);
    }
    
    parts.push('');

    // Give type-specific instructions so the responsibility is concrete and useful for correlation
    if (entityType === 'build_artifact') {
      parts.push(`Read the file at ${codePath} and provide a 1-2 line description that explicitly names:`);
      parts.push('  - Which service or application this artifact builds (e.g. "Builds the API service", "Builds the worker job")');
      parts.push('  - The output image or package name if visible (e.g. "producing the api Docker image")');
      parts.push('  - The runtime/base technology if relevant (e.g. "Node.js 20", "Python 3.11")');
      parts.push('Example: "Builds the API service Docker image using Node.js 20, producing a container for the REST backend."');
    } else if (entityType === 'deployment_artifact') {
      parts.push(`Read the file at ${codePath} and provide a 1-2 line description that explicitly names:`);
      parts.push('  - Which service(s) or application(s) this artifact deploys (e.g. "Deploys the API service", "Deploys the worker job")');
      parts.push('  - The target platform or cloud resource (e.g. "to Azure Container Apps", "to an ECS cluster", "to Kubernetes")');
      parts.push('  - Any notable environment (e.g. "production", "staging") if determinable');
      parts.push('Example: "Deploys the API and worker services to Azure Container Apps, configuring Redis, Neo4j, and Qdrant dependencies."');
    } else {
      parts.push('Provide a 1-2 line description of what this entity does and its responsibility.');
    }
    
    return parts.join('\n');
  }
}
