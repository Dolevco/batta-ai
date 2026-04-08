/**
 * PR Validation Executor
 *
 * Handles worker execution for pr-validation tasks.
 * Clones the PR branch (using existing RepositorySetup), runs the
 * DataIndexer pr-validation agent, and stores the resulting report
 * on the security review.
 *
 * Security:
 *   - Clone URL built from stored integration credentials only — never user input.
 *   - Only the LLM-generated report is persisted; no source code is stored.
 *   - The security review is tenant-scoped before any mutation.
 */

import { createDataIndexerRegistry, RepositorySetup } from '@ai-agent/data-indexer';
import type { RepositoryHandle } from '@ai-agent/data-indexer';
import {
  createSecurityReviewRepository,
  createCustomIntegrationRepository,
  getDatabaseConfig,
  GitHubIntegration,
  GitLabIntegration,
} from '@ai-agent/shared';
import type { PRValidationReport, CustomIntegration } from '@ai-agent/shared';
import type { ILLMApiHandler } from '@ai-agent/core';

export interface PRValidationPlan {
  agentType: 'pr-validation';
  reviewId: string;
  tenantId: string;
  questionsAndAnswers: Array<{
    questionId: string;
    questionText: string;
    answer: string;
  }>;
  correlatedPR: {
    provider: 'github' | 'gitlab';
    repository: string;
    headBranch: string;
    headSha: string;
    baseBranch: string;
  };
}

/**
 * Resolves a CodeIntegrationHandler for the given provider from stored tenant integrations.
 * Uses the same pattern as IntegrationFetcher in data-indexer.
 */
async function resolveIntegration(tenantId: string, provider: 'github' | 'gitlab') {
  const customIntegrationRepo = createCustomIntegrationRepository();
  const integrations = await customIntegrationRepo.getAll(tenantId, true);

  if (provider === 'github') {
    const integration = integrations.find(
      (i: CustomIntegration) => i.type === 'code' && i.name?.toLowerCase().includes('github'),
    );
    if (!integration) throw new Error(`No GitHub integration found for tenant ${tenantId}`);

    const { installationId } = integration.config;
    if (!installationId) {
      throw new Error(`GitHub integration ${integration.id} missing installationId in config`);
    }
    return new GitHubIntegration({ tenantId, installationId: String(installationId) });
  }

  // GitLab
  const integration = integrations.find(
    (i: CustomIntegration) => i.type === 'code' && i.name?.toLowerCase().includes('gitlab'),
  );
  if (!integration) throw new Error(`No GitLab integration found for tenant ${tenantId}`);

  const { groupAccessToken, groupId, baseUrl } = integration.config;
  if (!groupAccessToken) {
    throw new Error(`GitLab integration ${integration.id} missing groupAccessToken in config`);
  }
  return new GitLabIntegration({
    tenantId,
    groupAccessToken,
    groupId:  groupId  || undefined,
    baseUrl:  baseUrl  || undefined,
  });
}

/**
 * Build a RepositoryHandle for the PR branch.
 */
function buildRepositoryHandle(plan: PRValidationPlan): RepositoryHandle {
  const safeName = plan.correlatedPR.repository.replace('/', '--');
  const repoUrl = plan.correlatedPR.provider === 'github'
    ? `https://github.com/${plan.correlatedPR.repository}.git`
    : `https://gitlab.com/${plan.correlatedPR.repository}.git`;

  return {
    name:          `${safeName}-${plan.correlatedPR.headSha.slice(0, 7)}`,
    url:           repoUrl,
    defaultBranch: plan.correlatedPR.headBranch,
    lastCommitSha: plan.correlatedPR.headSha,
  };
}

/** Max diff size passed to the agent to avoid overwhelming the context window. */
const MAX_DIFF_CHARS = 40_000;

/**
 * Format Q&A pairs and the PR diff into the agent input string.
 */
function formatValidationInput(
  questionsAndAnswers: PRValidationPlan['questionsAndAnswers'],
  diffOutput: string,
): string {
  const truncatedDiff = diffOutput.length > MAX_DIFF_CHARS
    ? diffOutput.slice(0, MAX_DIFF_CHARS) + '\n... [diff truncated]'
    : diffOutput;

  return [
    'Review the following security questions and the answers provided by a coding agent.',
    'Validate each answer against the cloned PR branch code, then call submit_pr_validation_report.',
    '',
    '=== PR DIFF (changes introduced by this PR) ===',
    truncatedDiff,
    '=== END OF DIFF ===',
    '',
    'Use the diff above as your primary reference for which code was changed.',
    'Read full source files only when the diff alone is insufficient to verify a claim.',
    '',
    ...questionsAndAnswers.map((qa, i) =>
      `[${i + 1}] Question (ID: ${qa.questionId}): ${qa.questionText}\n    Agent answered: ${qa.answer}`,
    ),
  ].join('\n');
}

/**
 * Execute a pr-validation task.
 *
 * @param plan - Validated plan extracted from the task record.
 * @param api  - LLM API handler passed in from the worker init context.
 */
export async function executePRValidation(
  plan: PRValidationPlan,
  api: ILLMApiHandler,
): Promise<void> {
  const { reviewId, tenantId, correlatedPR, questionsAndAnswers } = plan;

  const dbConfig = getDatabaseConfig();
  const securityReviewRepo = createSecurityReviewRepository({
    qdrantUrl:    dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
  });

  try {
    // 1. Resolve git integration from stored tenant credentials
    const integration = await resolveIntegration(tenantId, correlatedPR.provider);

    // 2. Build RepositoryHandle for the PR branch
    const repositoryHandle = buildRepositoryHandle(plan);

    // 3. Clone using existing RepositorySetup — no new clone logic
    const cloneDir = process.env.PR_VALIDATION_CLONE_DIR ?? '/tmp/pr-validation';
    const repositorySetup = new RepositorySetup({ cloneDir });
    const workspacePath = await repositorySetup.ensureRepository(repositoryHandle, integration);

    // 3a. Checkout the exact PR head branch + SHA.
    //     This is required even when the directory already existed on disk, so
    //     a stale cache from a previous run cannot serve the wrong commit.
    //     Pass integration so a fresh token is injected before the fetch —
    //     GitHub App tokens are short-lived and must be refreshed each time.
    await repositorySetup.checkoutBranch(
      workspacePath,
      correlatedPR.headBranch,
      correlatedPR.headSha,
      integration,
    );

    // 3b. Produce a diff of the PR changes relative to the base branch so the
    //     agent knows exactly which lines were added/changed/removed.
    const diffOutput = await repositorySetup.getDiff(workspacePath, correlatedPR.baseBranch, integration);

    // 4. Build agent task using the shared DataIndexer registry
    const registry = createDataIndexerRegistry(api);
    const agentTask = registry.createTask('pr-validation', { workspace: workspacePath });

    // 5. Run agent with Q&A context + diff as input
    const input = formatValidationInput(questionsAndAnswers, diffOutput);
    const result = await agentTask.execute<PRValidationReport>(input);

    // 6. Extract the structured report from the completion tool's requiredOutput
    const report: PRValidationReport = result.requiredOutput
      ? (result.requiredOutput as unknown as PRValidationReport)
      : {
          status:           'completed',
          findings:         [],
          additionalRisks:  [],
          filesReviewed:    0,
          linesReviewed:    0,
          validatedAt:      new Date().toISOString(),
          executiveSummary: result.summary,
        };

    report.status = 'completed';

    // 7. Persist the report on the security review
    await securityReviewRepo.update(reviewId, tenantId, { prValidationReport: report });

    console.log(`[PRValidation] Completed: review=${reviewId} outcome=${report.overallOutcome ?? 'unknown'}`);
  } catch (err: any) {
    console.error(`[PRValidation] Failed: review=${reviewId}:`, err);

    // Best-effort: mark the review as failed so the UI reflects the error
    await securityReviewRepo.update(reviewId, tenantId, {
      prValidationReport: {
        status:          'failed',
        errorMessage:    String(err?.message ?? 'Validation failed').slice(0, 500),
        findings:        [],
        additionalRisks: [],
        filesReviewed:   0,
        linesReviewed:   0,
      },
    }).catch(() => { /* ignore secondary failure */ });

    throw err;
  }
}
