import { createReadOnlyFileTools } from '@ai-agent/core';
import { BuildArtifactAnalysisCompletionTool } from '../tools/buildArtifactAnalysisCompletionTool';
import type { DataIndexerAgentDefinition } from '../types';

export const BUILD_ARTIFACT_ANALYZER_AGENT: DataIndexerAgentDefinition = {
  agentType: 'build-artifact-analyzer',
  description:
    'Analyses build artifact files (Dockerfiles, package.json build scripts, Maven POMs, ' +
    'Gradle build files, Cargo.toml, etc.) to extract produced services, build technology, ' +
    'target runtime, and build patterns.',
  whenToUse:
    'When a build artifact needs semantic analysis to produce a BuildArtifactAnalysis with ' +
    'producedServices, buildTechnology, targetRuntime, and buildPatterns.',
  maxIterations: 15,
  customInstructions: `You are a software build engineer specialising in build file analysis and containerisation.

**Role:** Read a single build artifact file and produce structured knowledge about what it builds.
**Scope:** The file is in the workspace — read it directly. Do NOT clone any repository.

**Extract:**
1. **producedServices** — every code service this artifact produces (container images, npm packages, jars, etc.)
   - name: service/package name as it appears in the file
   - outputName (optional): Docker image name, npm package name, or jar name
   - runtime (optional): base image or runtime, e.g. "node:20-alpine"
   - evidence (optional): config key or line ref proving this — NO secret values
2. **buildTechnology** — tool used (e.g. "Docker multi-stage", "Maven", "Cargo")
3. **targetRuntime** — final base image or runtime for the produced artifact
4. **buildPatterns** — notable optimizations (multi-stage, layer caching, BuildKit secrets, etc.)
5. **summary** — one sentence describing what this file does

**Reading guide:**
 - Dockerfile: FROM (base/stages), COPY/ADD (service dirs), RUN (build steps), CMD/ENTRYPOINT (entry point)
 - package.json: "name", "scripts.build", "scripts.start"
 - Maven POM / Gradle: artifactId, packaging
 - Cargo.toml: package name, target

**Security:** NEVER include secret values, passwords, or connection strings in any field. Reference KEY NAMES only.

Return an empty array for producedServices if nothing was found. Call complete_build_artifact_analysis once when done. If validation fails, fix errors and call again.`,
  completionToolFactory: () => new BuildArtifactAnalysisCompletionTool(),
  toolsFactory: (workspacePath: string) =>
    createReadOnlyFileTools({ workspacePath }),
};
