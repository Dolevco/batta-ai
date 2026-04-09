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
import type { PRValidationReport, CustomIntegration, PRValidationAdditionalRisk, PRValidationFinding } from '@ai-agent/shared';
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
    prNumber: number;
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

// ── PR comment ────────────────────────────────────────────────────────────────

const OUTCOME_EMOJI: Record<string, string> = {
  clean:     '✅',
  attention: '⚠️',
  critical:  '🚨',
};

/**
 * Build the Markdown comment body for a completed PR validation.
 *
 * Security: all values come from the internally-generated PRValidationReport;
 * no user-controlled input is interpolated. Strings are length-capped to
 * prevent oversized comments from being rejected by the provider API.
 */
function buildCommentBody(
  report: PRValidationReport,
  reviewId: string,
  correlatedPR: PRValidationPlan['correlatedPR'],
): string {
  const outcome  = report.overallOutcome ?? 'unknown';
  const emoji    = OUTCOME_EMOJI[outcome] ?? '🔍';
  const summary  = (report.executiveSummary ?? 'No summary available.').slice(0, 500);

  const confirmed    = report.findings.filter((f: PRValidationFinding) => f.outcome === 'confirmed').length;
  const disputed     = report.findings.filter((f: PRValidationFinding) => f.outcome === 'disputed').length;
  const unverifiable = report.findings.filter((f: PRValidationFinding) => f.outcome === 'unverifiable').length;
  const total        = report.findings.length;

  const additionalRisks = report.additionalRisks.length > 0
    ? report.additionalRisks
        .slice(0, 5)
        .map((r: PRValidationAdditionalRisk) => `- **[${r.severity.toUpperCase()}]** ${r.title.slice(0, 200)}`)
        .join('\n')
    : '_None identified._';

  const baseUrl   = (process.env.UI_BASE_URL ?? '').replace(/\/$/, '');
  const reviewUrl = baseUrl
    ? `${baseUrl}/security-reviews/${reviewId}`
    : `_(review ID: ${reviewId})_`;

  return [
    `## ${emoji} Security Review — PR Validation`,
    '',
    `**Outcome:** ${outcome.toUpperCase()}`,
    '',
    summary,
    '',
    '### Findings',
    `| Status | Count |`,
    `|--------|-------|`,
    `| ✅ Confirmed    | ${confirmed} / ${total} |`,
    `| ❌ Disputed     | ${disputed} / ${total} |`,
    `| ❓ Unverifiable | ${unverifiable} / ${total} |`,
    '',
    '### Additional Risks',
    additionalRisks,
    '',
    `**Files reviewed:** ${report.filesReviewed} · **Lines reviewed:** ${report.linesReviewed}`,
    '',
    `🔗 [View full security review](${reviewUrl})`,
    '',
    `_Validated against \`${correlatedPR.headSha.slice(0, 7)}\` on ${correlatedPR.headBranch}_`,
  ].join('\n');
}

/**
 * Post the validation summary as a comment on the correlated PR/MR.
 * Errors are caught and logged; a comment failure never propagates to the caller.
 */
async function postValidationComment(
  plan: PRValidationPlan,
  report: PRValidationReport,
): Promise<void> {
  try {
    const integration = await resolveIntegration(plan.tenantId, plan.correlatedPR.provider);
    const body = buildCommentBody(report, plan.reviewId, plan.correlatedPR);

    if (plan.correlatedPR.provider === 'github') {
      const [owner, repo] = plan.correlatedPR.repository.split('/');
      await (integration as GitHubIntegration).postPRComment(owner, repo, plan.correlatedPR.prNumber, body);
    } else {
      await (integration as GitLabIntegration).postPRComment(
        plan.correlatedPR.repository,
        plan.correlatedPR.prNumber,
        body,
      );
    }

    console.log(`[PRValidation] Comment posted: review=${plan.reviewId} pr=${plan.correlatedPR.prNumber}`);
  } catch (err: any) {
    // Non-fatal: comment failure must not fail the validation run
    console.error(`[PRValidation] Failed to post comment: review=${plan.reviewId}:`, err?.message ?? err);
  }
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

    // 8. Post a summary comment on the PR/MR (best-effort; never blocks the run)
    await postValidationComment(plan, report);
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
