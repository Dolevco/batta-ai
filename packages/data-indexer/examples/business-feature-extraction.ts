/**
 * Business Feature Extraction Example
 *
 * Runs the extract → transform → feature-extraction pipeline directly,
 * bypassing the LLM correlator (which is slow) and the queue system.
 *
 * Pipeline:
 *   1. Clone / resolve repository (RepositorySetup)
 *   2. Extract raw facts          (CodeExtractionStage)
 *   3. Transform to entities      (CodeTransformationStage)
 *   4. Persist entities           (CodePersistenceStage)
 *   5. Extract business features  (BusinessFeatureExtractor)  ← skips LLM correlator
 *
 * Required environment variables:
 *   TENANT_ID                          – tenant identifier
 *   AZURE_OPENAI_ENDPOINT              – e.g. https://<resource>.openai.azure.com
 *   AZURE_OPENAI_API_KEY               – API key for chat completions
 *   AZURE_OPENAI_DEPLOYMENT            – deployment name, e.g. gpt-4o
 *   AZURE_OPENAI_API_VERSION           – e.g. 2024-05-01-preview
 *   AZURE_OPENAI_EMBEDDING_ENDPOINT    – endpoint for the embedding model
 *   AZURE_OPENAI_EMBEDDING_API_KEY     – API key for embeddings
 *   AZURE_OPENAI_EMBEDDING_DEPLOYMENT  – embedding deployment name
 *   AZURE_OPENAI_EMBEDDING_API_VERSION – (optional) embedding API version
 *   QDRANT_URL                         – e.g. http://localhost:6333
 *   QDRANT_API_KEY                     – (optional) Qdrant API key
 *   NEO4J_URI                          – e.g. bolt://localhost:7687
 *   NEO4J_USERNAME                     – default: neo4j
 *   NEO4J_PASSWORD                     – default: password
 *   QDRANT_INTEGRATION_URL             – Qdrant that stores integrations (often same as QDRANT_URL)
 *   QDRANT_INTEGRATION_API_KEY         – (optional)
 *   CLONE_DIR                          – local clone directory (default: /tmp/clones)
 *   REPOSITORY_NAME                    – single repo to process (optional; default: all repos for tenant)
 *   LOCAL_REPO_PATH                    – use a pre-cloned local path instead of fetching from GitHub
 */

import { AzureOpenAIClient, AzureOpenAIEmbeddingClient } from '@ai-agent/core';
import { QdrantAdapter, Neo4jAdapter } from '@ai-agent/shared';
import { CodeExtractionStage } from '../src/connectors/stages/extraction.stage';
import { CodeTransformationStage } from '../src/connectors/stages/transformation.stage';
import { CodePersistenceStage } from '../src/connectors/stages/persistence.stage';
import { BusinessFeatureExtractor } from '../src/services/business-feature-extractor';
import { IntegrationFetcher } from '../src/services/integration-fetcher';
import { RepositorySetup } from '../src/services/repository-setup';
import { EntityIdUtils } from '../src/utils/id-generator';
import type { CodeService } from '@ai-agent/shared';
import type { RepositoryHandle } from '../src/types/pipeline.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

async function setup() {
  // LLM (chat completions) — used by BusinessFeatureExtractor
  const apiClient = new AzureOpenAIClient({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        apiKey: process.env.AZURE_OPENAI_API_KEY!,
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4',
        apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    });

  // Embedding model — used by QdrantAdapter for semantic search
  const embeddingClient = new AzureOpenAIEmbeddingClient({
        endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!,
        apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY!,
        deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
        apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
    });

  // Qdrant
  console.log('🔍  Initializing Qdrant...');
  const qdrant = new QdrantAdapter({
            url: process.env.QDRANT_URL!,
            apiKey: process.env.QDRANT_API_KEY,
            collectionPrefix: 'code_indexer',
        }, embeddingClient);

  await qdrant.initialize();
  console.log('✅  Qdrant connected');

  // Neo4j
  const neo4j = process.env.NEO4J_URI
    ? new Neo4jAdapter({
        uri: process.env.NEO4J_URI,
        username: optionalEnv('NEO4J_USERNAME', 'neo4j'),
        password: optionalEnv('NEO4J_PASSWORD', 'password'),
      })
    : undefined;

  if (neo4j) {
    console.log('🔗  Initializing Neo4j...');
    await neo4j.initialize();
    console.log('✅  Neo4j connected');
  } else {
    console.log('⚠️   NEO4J_URI not set — Neo4j persistence will be skipped');
  }

  return { apiClient, qdrant, neo4j };
}

// ─── Repository resolution ───────────────────────────────────────────────────

/**
 * Returns the list of RepositoryHandles to process.
 * Priority:
 *   1. LOCAL_REPO_PATH  → single local repo, no GitHub required
 *   2. REPOSITORY_NAME  → fetch single named repo from GitHub via integration
 *   3. (default)        → fetch all repos from GitHub integration
 */
async function resolveRepositories(tenantId: string): Promise<RepositoryHandle[]> {
  // ── Option A: caller supplies a pre-cloned local path ──────────────────
  const localPath = process.env.LOCAL_REPO_PATH;
  if (localPath) {
    const repoName = localPath.split('/').filter(Boolean).pop() ?? 'local-repo';
    console.log(`📁  Using local repository path: ${localPath}`);
    return [
      {
        name: repoName,
        url: localPath,
        defaultBranch: 'main',
        lastCommitSha: '',
        clonePath: localPath,
      },
    ];
  }

  // ── Options B/C: pull from GitHub via stored integration ──────────────
  console.log('🔑  Fetching GitHub integration from Qdrant...');
  const integrationFetcher = new IntegrationFetcher({
    qdrantUrl: optionalEnv('QDRANT_INTEGRATION_URL', process.env.QDRANT_URL ?? 'http://localhost:6333'),
    qdrantApiKey: optionalEnv('QDRANT_INTEGRATION_API_KEY', process.env.QDRANT_API_KEY ?? ''),
  });
  await integrationFetcher.initialize();

  const integrations = await integrationFetcher.fetchIntegrations(tenantId);
  if (!integrations.codeIntegration) {
    console.error('❌  No GitHub integration found for tenant. Set LOCAL_REPO_PATH to skip GitHub.');
    process.exit(1);
  }

  const githubRepos = await integrations.codeIntegration.getRepositories();
  const filterName = 'ai-agent';

  const filtered = filterName
    ? githubRepos.filter((r: any) => r.name === filterName)
    : githubRepos;

  if (!filtered.length) {
    console.error(`❌  No repositories found${filterName ? ` matching "${filterName}"` : ''}`);
    process.exit(1);
  }

  // Clone missing repos
  const cloneDir = optionalEnv('CLONE_DIR', '/tmp/clones');
  const repoSetup = new RepositorySetup({ cloneDir });

  const handles: RepositoryHandle[] = [];
  for (const repo of filtered) {
    const handle: RepositoryHandle = {
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch ?? 'main',
      lastCommitSha: '',
    };
    const clonePath = await repoSetup.ensureRepository(handle, integrations.codeIntegration);
    handles.push({ ...handle, clonePath });
  }

  return handles;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const tenantId = process.env.TENANT_ID || '0361b075-6fe1-44cd-89f2-e9603816fa52';

  console.log('\n══════════════════════════════════════════════');
  console.log('  Business Feature Extraction (direct mode)  ');
  console.log('══════════════════════════════════════════════');
  console.log(`Tenant : ${tenantId}`);
  console.log();

  // ── 0. Setup clients ──────────────────────────────────────────────────
  const { apiClient, qdrant, neo4j } = await setup();
  console.log();

  // ── 1. Resolve repositories ───────────────────────────────────────────
  const repositories = await resolveRepositories(tenantId);
  console.log(`\n📦  Repositories to process: ${repositories.map(r => r.name).join(', ')}`);
  console.log();

  // ── 2. Extraction + Transformation stages (reused from task-processor) ─
  const idUtils = new EntityIdUtils();
  const extractionStage = new CodeExtractionStage({
    cloneDir: optionalEnv('CLONE_DIR', '/tmp/clones'),
    analysisDepth: 'deep',
    api: apiClient,
    qdrant: qdrant,
    neo4j: neo4j!,
  });
  const transformationStage = new CodeTransformationStage(tenantId, idUtils);
  // CodePersistenceStage requires both adapters; fall back to Qdrant-only if Neo4j is absent.
  // We still pass neo4j even when undefined — the stage guards writes internally.
  const persistenceStage = new CodePersistenceStage(qdrant, neo4j as any);

  // ── 3. BusinessFeatureExtractor ───────────────────────────────────────
  const featureExtractor = new BusinessFeatureExtractor(apiClient, qdrant, neo4j);

  // ── 4. Per-repository pipeline ────────────────────────────────────────
  let grandTotalFeatures = 0;

  for (const repo of repositories) {
    console.log(`\n─────────────────────────────────────────────`);
    console.log(`🔍  Extracting: ${repo.name}`);
    console.log(`    path: ${repo.clonePath ?? repo.url}`);
    console.log();

    try {
      // Step 1: Extract raw facts from the local repository
      console.log('  [1/3] Running extraction stage...');
      const extraction = await extractionStage.extract(tenantId, [repo]);
      console.log(
        `        ✅ ${extraction.services.length} services, ` +
        `${extraction.modules.length} modules, ` +
        `${extraction.buildArtifacts.length} build artifacts`
      );
      if (extraction.errors.length) {
        extraction.errors.forEach(e => console.warn(`        ⚠️  ${e.message}`));
      }

      // Step 2: Transform extracted facts into canonical entities
      console.log('  [2/3] Running transformation stage...');
      const transformation = await transformationStage.transform(tenantId, extraction);
      console.log(
        `        ✅ ${transformation.entities.length} entities, ` +
        `${transformation.relationships.length} relationships`
      );
      if (transformation.errors.length) {
        transformation.errors.forEach(e => console.warn(`        ⚠️  ${e.message}`));
      }

      // Step 3: Persist entities and evidence (identical to task-processor)
      console.log('  [3/3] Persisting entities...');
      const persistResult = await persistenceStage.persistEntities(
        tenantId,
        transformation.entities,
        transformation.evidence
      );
      console.log(
        `        ✅ ${persistResult.entitiesWritten} entities, ` +
        `${persistResult.evidenceWritten} evidence items written`
      );
      if (persistResult.errors.length) {
        persistResult.errors.forEach(e => console.warn(`        ⚠️  ${e.message}`));
      }

      // Step 4: Business Feature Extraction — directly after transformation,
      //         skipping the LLM correlator entirely.
      const services = transformation.entities.filter(
        (e): e is CodeService => e.entityType === 'code_service'
      );

      if (!services.length) {
        console.warn('  ⚠️   No code_service entities found for this repository — skipping feature extraction');
        continue;
      }

      console.log(`\n  🏗️   Extracting business features for ${services.length} service(s)...`);

      const repositoryPath = repo.clonePath ?? repo.url;
      let repoFeatureCount = 0;

      for (const service of services) {
        console.log(`\n  📦  Service: ${service.name}`);
        try {
          const features = await featureExtractor.extractFeaturesForService(
            tenantId,
            service,
            repositoryPath
          );
          repoFeatureCount += features.length;
          grandTotalFeatures += features.length;

          for (const feature of features) {
            console.log(`       ✅  "${feature.name}"`);
            console.log(`           Risk score : ${feature.threatModel.overallRiskScore}`);
            console.log(`           Threats    : ${feature.threatModel.strideThreats.length}`);
            console.log(`           DFD nodes  : ${
              (feature.dataFlowDiagram.actors?.length ?? 0) +
              (feature.dataFlowDiagram.processes?.length ?? 0) +
              (feature.dataFlowDiagram.dataStores?.length ?? 0)
            }`);
          }
        } catch (err: any) {
          console.error(`       ❌  Feature extraction failed for "${service.name}": ${err?.message ?? err}`);
        }
      }

      console.log(`\n  📊  Repository summary: ${repoFeatureCount} feature(s) extracted for "${repo.name}"`);

    } catch (err: any) {
      console.error(`\n❌  Failed to process repository "${repo.name}": ${err?.message ?? err}`);
    }
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`✅  Done — ${grandTotalFeatures} business feature(s) extracted across ${repositories.length} repo(s)`);
  console.log('══════════════════════════════════════════════\n');
}

// ─── Shutdown handling ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n\nInterrupted — exiting cleanly.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nTerminated — exiting cleanly.');
  process.exit(0);
});

// ─── Entry point ──────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
