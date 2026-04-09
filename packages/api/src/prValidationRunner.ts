/**
 * PR Validation Runner (in-process)
 *
 * Runs the pr-validation agent directly inside the API process — no worker queue
 * required. Called fire-and-forget from SecurityReviewController after the HTTP
 * response has already been sent.
 *
 * Mirrors the logic in packages/worker/src/prValidationExecutor.ts.
 * When the worker queue is re-enabled this file can be removed and the worker
 * executor used exclusively.
 *
 * Security:
 *   - Clone URL built from stored integration credentials only — never user input.
 *   - Only the LLM-generated report is persisted; no source code is stored.
 *   - The security review is tenant-scoped before any mutation (enforced upstream).
 */

import { createDataIndexerRegistry, RepositorySetup } from '@ai-agent/data-indexer';
import type { RepositoryHandle } from '@ai-agent/data-indexer';
import {
  createSecurityReviewRepository,
  createCustomIntegrationRepository,
  getDatabaseConfig,
  GitHubIntegration,
  GitLabIntegration,
  initializePlannedTask,
  cleanupPlannedTask,
} from '@ai-agent/shared';
import type { PRValidationReport, CustomIntegration, PRValidationPayload } from '@ai-agent/shared';

export type { PRValidationPayload };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves a CodeIntegrationHandler for the given provider from stored tenant integrations.
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
function buildRepositoryHandle(plan: PRValidationPayload): RepositoryHandle {
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
  correlatedPR: PRValidationPayload['correlatedPR'],
): string {
  const outcome  = report.overallOutcome ?? 'unknown';
  const emoji    = OUTCOME_EMOJI[outcome] ?? '🔍';
  const summary  = (report.executiveSummary ?? 'No summary available.').slice(0, 500);

  const confirmed    = report.findings.filter(f => f.outcome === 'confirmed').length;
  const disputed     = report.findings.filter(f => f.outcome === 'disputed').length;
  const unverifiable = report.findings.filter(f => f.outcome === 'unverifiable').length;
  const total        = report.findings.length;

  const additionalRisks = report.additionalRisks.length > 0
    ? report.additionalRisks
        .slice(0, 5)
        .map(r => `- **[${r.severity.toUpperCase()}]** ${r.title.slice(0, 200)}`)
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
  plan: PRValidationPayload,
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
 * Format Q&A pairs and the PR diff into the agent prompt string.
 */
function formatValidationInput(
  questionsAndAnswers: PRValidationPayload['questionsAndAnswers'],
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
    ...questionsAndAnswers.map((qa: { questionId: string; questionText: string; answer: string }, i: number) =>
      `[${i + 1}] Question (ID: ${qa.questionId}): ${qa.questionText}\n    Agent answered: ${qa.answer}`,
    ),
  ].join('\n');
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a pr-validation agent in-process.
 *
 * Designed to be called fire-and-forget (no await at call site).
 * Persists the result (or failure) directly on the security review record.
 */
export async function runPRValidationInProcess(plan: PRValidationPayload): Promise<void> {
  const { reviewId, tenantId, correlatedPR, questionsAndAnswers } = plan;

  const dbConfig = getDatabaseConfig();
  const securityReviewRepo = createSecurityReviewRepository({
    qdrantUrl:    dbConfig.qdrantUrl,
    qdrantApiKey: dbConfig.qdrantApiKey,
  });

  // Bootstrap the LLM client (same env vars used by the generic PlannedTask path)
  const llmInit = await initializePlannedTask({
    usePlanningAssistantMode: false,
    mcpIntegrations:          [],
    customIntegrationRepository: createCustomIntegrationRepository(),
    tenantId,
    enableChainOfThoughts: false,
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
    //     Required even when the directory already existed (stale cache guard).
    //     Pass integration so a fresh token is injected before the fetch —
    //     GitHub App tokens are short-lived and must be refreshed each time.
    await repositorySetup.checkoutBranch(
      workspacePath,
      correlatedPR.headBranch,
      correlatedPR.headSha,
      integration,
    );

    // 3b. Produce a diff of the PR changes relative to the base branch.
    const diffOutput = await repositorySetup.getDiff(workspacePath, correlatedPR.baseBranch, integration);

    // 4. Build agent task using the DataIndexer registry
    const registry = createDataIndexerRegistry(llmInit.apiClient);
    const agentTask = registry.createTask('pr-validation', { workspace: workspacePath });

    // 5. Run agent with Q&A context + diff as input
    const input = formatValidationInput(questionsAndAnswers, diffOutput);
    const result = await agentTask.execute<PRValidationReport>(input);

    // 6. Extract structured report from the completion tool's requiredOutput
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

    // 7. Persist the completed report
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
  } finally {
    await cleanupPlannedTask(llmInit);
  }
}
