/**
 * ServiceSkeletonExtractor
 *
 * Orchestrates Pass 1: reads only the priority files identified by the file map
 * (entry, routes, models, types, config) and produces a compact ServiceSkeleton.
 *
 * Security:
 *   - Agent receives only the service path and the file map — no secrets.
 *   - Output is sanitized via sanitizeMetadata before use.
 *   - Errors are logged with only the message string.
 */

import type { CodeService, RepositoryBriefing, ServiceFileMap, ServiceSkeleton } from '@batta/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { ServiceSkeletonInput } from '../../../agents/tools/serviceSkeletonCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType } from '../../../agents';

export class ServiceSkeletonExtractor {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
  ) {}

  /**
   * Run Pass 1: extract the service skeleton from priority files only.
   *
   * @param service        - The service to analyse.
   * @param fileMap        - File map from Pass 0.
   * @param repositoryPath - Absolute path to the repository root.
   * @param briefing       - Optional repository briefing for orientation.
   * @returns              Sanitized ServiceSkeleton.
   */
  async extractSkeleton(
    service: CodeService,
    fileMap: ServiceFileMap,
    repositoryPath: string,
    briefing?: RepositoryBriefing,
  ): Promise<ServiceSkeleton> {
    const servicePath = (service.metadata?.codePath as string) || service.codePath || '';

    const priorityFilesList = buildPriorityFilesList(fileMap);
    const briefingHint = briefing
      ? `\nRepository: ${briefing.summary}\nPatterns: ${briefing.architecturalPatterns.join(', ')}`
      : '';

    const task = this.registry.createTask(DataIndexerAgentType.ServiceSkeletonExtractor, {
      workspace: repositoryPath,
    });

    const result = await task.execute<ServiceSkeletonInput>(
      `Extract the skeleton for service "${service.name}" at "${servicePath}".` +
      briefingHint + `\n\n` +
      `READ ONLY these priority files (from the file map — do NOT read other files):\n` +
      priorityFilesList + `\n\n` +
      `Call complete_service_skeleton when done.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [Pass 1] Skeleton extractor produced no output for "${service.name}", using fallback`);
      return this.buildFallbackSkeleton(service);
    }

    const raw = result.requiredOutput as unknown as ServiceSkeletonInput;
    const sanitized = sanitizeMetadata(raw as unknown as Record<string, unknown>);
    return (sanitized as unknown as ServiceSkeletonInput).skeleton;
  }

  /**
   * Build a responsibility string from the skeleton.
   * Used to seed CodeService.responsibility, replacing the CodeSemanticAnalysisStage pass.
   */
  buildResponsibility(skeleton: ServiceSkeleton): string {
    return skeleton.serviceDescription || `Service with ${skeleton.techStack.slice(0, 3).join(', ')} tech stack`;
  }

  private buildFallbackSkeleton(service: CodeService): ServiceSkeleton {
    return {
      serviceDescription: service.responsibility || service.name,
      businessValue: `Provides ${service.serviceType} capabilities.`,
      entryPointTypes: ['other'],
      architecturalPatterns: [],
      techStack: service.techStack ?? [],
      exposedEndpoints: [],
      dataModels: [],
      internalDependencies: [],
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPriorityFilesList(fileMap: ServiceFileMap): string {
  const { entry, routes, models, types, config } = fileMap.priorityFiles;
  const lines: string[] = [];

  const addSection = (label: string, files: string[]) => {
    if (files.length > 0) {
      lines.push(`${label}:`);
      files.forEach(f => lines.push(`  - ${f}`));
    }
  };

  addSection('Entry files', entry);
  addSection('Route/controller files', routes);
  addSection('Model/schema files', models);
  addSection('Type definition files', types);
  addSection('Config/env files', config);

  return lines.length > 0
    ? lines.join('\n')
    : '(no priority files found — read README.md and package.json as fallback)';
}
