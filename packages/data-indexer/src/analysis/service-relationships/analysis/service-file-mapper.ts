/**
 * ServiceFileMapper
 *
 * Orchestrates Pass 0: cheap file-tree classification scan.
 * Runs one LLM agent that lists and classifies the service directory
 * without reading any file contents, producing a ServiceFileMap.
 *
 * Security:
 *   - Agent receives only the service path — no secrets, no credentials.
 *   - Output contains only file paths (sanitized via sanitizeMetadata).
 *   - Errors are logged with only the message string.
 */

import type { CodeService, RepositoryBriefing, ServiceFileMap } from '@batta/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { ServiceFileMapInput } from '../../../agents/tools/serviceFileMapCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType } from '../../../agents';

export class ServiceFileMapper {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
  ) {}

  /**
   * Run Pass 0: classify the service directory file tree.
   *
   * @param service        - The service to map.
   * @param repositoryPath - Absolute path to the repository root.
   * @param briefing       - Optional repository briefing for orientation.
   * @returns              Sanitized ServiceFileMap.
   */
  async mapServiceFiles(
    service: CodeService,
    repositoryPath: string,
    briefing?: RepositoryBriefing,
  ): Promise<ServiceFileMap> {
    const servicePath = (service.metadata?.codePath as string) || service.codePath || '';

    const briefingHint = briefing
      ? `\nRepository structure: ${briefing.structure}\nLanguages: ${briefing.languages.join(', ')}`
      : '';

    const task = this.registry.createTask(DataIndexerAgentType.ServiceFileMapper, {
      workspace: repositoryPath,
    });

    const result = await task.execute<ServiceFileMapInput>(
      `Map and classify all files in the service "${service.name}" located at "${servicePath}".` +
      briefingHint + `\n\n` +
      `List the directory tree under "${servicePath}" and classify each file into its bucket.\n` +
      `Do NOT read file contents — only use file names and paths for classification.\n\n` +
      `Call complete_service_file_map when done.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [Pass 0] File mapper produced no output for "${service.name}", using empty map`);
      return this.buildEmptyMap();
    }

    const raw = result.requiredOutput as unknown as ServiceFileMapInput;
    const sanitized = sanitizeMetadata(raw as unknown as Record<string, unknown>);
    return (sanitized as unknown as ServiceFileMapInput).fileMap;
  }

  private buildEmptyMap(): ServiceFileMap {
    return {
      priorityFiles: { entry: [], routes: [], models: [], types: [], config: [], clients: [] },
      skipFiles: [],
      estimatedSignalFiles: 0,
      totalFiles: 0,
    };
  }
}
