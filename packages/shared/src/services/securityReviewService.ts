import { v4 as uuidv4 } from 'uuid';
import type { ISecurityReviewRepository } from '../persistence/interfaces';
import type { IPolicyTemplateRepository } from '../persistence/interfaces';
import type { ITaskRepository } from '../persistence/interfaces';
import type {
  SecurityReview,
  SecurityReviewQuestion,
  SecurityReviewAnswer,
  SecurityTask,
  SecurityAttestation,
  FeatureContext,
  FeatureSecurityContext,
  FeatureDataFlowEntry,
  ReviewDataClassificationEntry,
  AttestationArchitectureUpdate,
  ArchitectureDiff,
  DataFlowDiffEntry,
  DataClassificationDiffEntry,
  PolicyTaskRule,
  ReviewGitContext,
  CorrelatedPR,
} from '../types';
import type { BusinessFeature } from '../types/business-feature.types';
import type { FeatureService } from './featureService';
import { BASE_QUESTIONS, TASK_RULES, BASELINE_TASKS } from './securityReviewDefaults';
import { PRCorrelationService, sanitiseGitContext, parseRemoteUrl, GitHubPRIntegration, GitLabPRIntegration } from './prCorrelationService';
import type { PRIntegration } from './prCorrelationService';
import { GitHubIntegration } from '../integrations/githubIntegration';
import { GitLabIntegration } from '../integrations/gitlabIntegration';
import type { ICustomIntegrationRepository } from '../persistence/interfaces';
import { WorkerQueue } from '../events/redis/workerQueue';

// ── PR Validation payload ─────────────────────────────────────────────────────

/**
 * Sanitised plan returned by triggerPRValidation.
 * Consumed directly by the API in-process runner (and, when re-enabled, by the worker).
 */
export interface PRValidationPayload {
  reviewId: string;
  tenantId: string;
  questionsAndAnswers: Array<{
    questionId: string;
    questionText: string;
    answer: string;
  }>;
  correlatedPR: Pick<CorrelatedPR, 'provider' | 'repository' | 'headBranch' | 'headSha' | 'baseBranch'>;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SecurityReviewService {

  private prCorrelationService = new PRCorrelationService();

  constructor(
    private repository: ISecurityReviewRepository,
    private featureService?: FeatureService,
    private policyRepository?: IPolicyTemplateRepository,
    private customIntegrationRepository?: ICustomIntegrationRepository,
    private taskRepository?: ITaskRepository,
    private workerQueue?: WorkerQueue,
  ) {
  }

  async startReview(
    tenantId: string,
    featureDescription: string,
    options?: {
      title?: string;
      agentName?: string;
      humanResponsible?: string;
      services?: string[];
      repository?: string;
      prLink?: string;
      /** Raw git context from the agent CLI — will be sanitised before storage */
      gitContext?: Record<string, unknown>;
    },
  ): Promise<SecurityReview> {
    const now = new Date().toISOString();

    // Resolve matched features when a FeatureService is available and services were provided.
    // Failures are non-fatal — the review proceeds without feature context.
    let matchedFeatures: FeatureContext[] = [];
    if (this.featureService && options?.services?.length && options.repository) {
      try {
        matchedFeatures = await this.resolveMatchedFeatures(
          tenantId,
          options.services,
          options.repository,
        );
      } catch {
        // Graceful degradation: feature lookup failure must not block the security review
      }
    }

    // Load active policy template (snapshot at creation time for immutability)
    let snapshotTaskRules: PolicyTaskRule[] = TASK_RULES;
    let snapshotBaselineTasks: Omit<SecurityTask, 'id'>[] = BASELINE_TASKS;
    let policyTemplateVersion: number | undefined;
    let policyQuestions: SecurityReviewQuestion[] = BASE_QUESTIONS;

    if (this.policyRepository) {
      try {
        const activePolicy = await this.policyRepository.getActiveByType(tenantId, 'security_review');
        if (activePolicy) {
          policyQuestions = activePolicy.questions;
          snapshotTaskRules = activePolicy.taskRules;
          snapshotBaselineTasks = activePolicy.baselineTasks;
          policyTemplateVersion = activePolicy.version;
        }
      } catch {
        // Fall back to hardcoded defaults on any repo error
      }
    }

    const questions: SecurityReviewQuestion[] = [
      ...policyQuestions,
      this.buildFeatureScopeQuestion(matchedFeatures),
    ];

    const review: SecurityReview = {
      id: uuidv4(),
      tenantId,
      ...(options?.title !== undefined && { title: options.title }),
      featureDescription,
      ...(options?.agentName !== undefined && { agentName: options.agentName }),
      ...(options?.humanResponsible !== undefined && { humanResponsible: options.humanResponsible }),
      ...(options?.services !== undefined && { services: options.services }),
      ...(options?.repository !== undefined && { repository: options.repository }),
      ...(options?.prLink !== undefined && { prLink: options.prLink }),
      status: 'questionnaire_pending',
      questions,
      answers: [],
      tasks: [],
      attestations: [],
      ...(matchedFeatures.length > 0 && { matchedFeatures }),
      snapshotTaskRules,
      snapshotBaselineTasks,
      ...(policyTemplateVersion !== undefined && { policyTemplateVersion }),
      policyTemplateType: 'security_review',
      createdAt: now,
      updatedAt: now,
    };

    // Sanitise and attach git context when provided.
    // [Critical-2] All fields pass sanitiseGitContext() before storage — never raw.
    // [Critical-4] authorEmail/authorName are stored but never logged below.
    if (options?.gitContext && typeof options.gitContext === 'object') {
      const sanitised = sanitiseGitContext(options.gitContext);
      // Only attach when at least one field survived sanitisation
      if (Object.keys(sanitised).length > 0) {
        review.gitContext = sanitised;
      }
    }

    return this.repository.create(review);
  }

  async submitAnswers(
    id: string,
    tenantId: string,
    answers: SecurityReviewAnswer[]
  ): Promise<SecurityReview> {
    const review = await this.requireReview(id, tenantId);

    if (review.status !== 'questionnaire_pending') {
      throw new Error(`Cannot submit answers: review is in status '${review.status}'`);
    }

    // Ensure every question has an answer
    const answeredIds = new Set(answers.map(a => a.questionId));
    const missing = review.questions.filter(q => !answeredIds.has(q.id));
    if (missing.length > 0) {
      throw new Error(
        `Missing answers for question(s): ${missing.map(q => q.id).join(', ')}`
      );
    }

    const tasks = this.deriveTasks(
      answers,
      review.snapshotTaskRules ?? TASK_RULES,
      review.snapshotBaselineTasks ?? BASELINE_TASKS,
    );

    // Resolve feature association from the feature_scope answer
    const featureScopeAnswer = answers.find(a => a.questionId === 'feature_scope');
    const linkedFeatureIds = featureScopeAnswer
      ? this.parseLinkedFeatureIds(featureScopeAnswer.answer, review.matchedFeatures ?? [])
      : [];

    // Build enriched feature security context for linked features
    let featureSecurityContext: FeatureSecurityContext[] | undefined;
    if (linkedFeatureIds.length > 0 && this.featureService) {
      try {
        featureSecurityContext = await this.buildFeatureSecurityContexts(
          tenantId,
          linkedFeatureIds,
        );
      } catch {
        // Non-fatal: proceed without enriched context if lookup fails
      }
    }

    // When no feature is linked, append a synthetic FeatureSecurityContext built
    // from the services' DFDs so both paths share the same baseline field.
    if (linkedFeatureIds.length === 0 && this.featureService && review.services?.length) {
      try {
        const serviceDfdEntry = await this.buildServiceDfdContext(tenantId, review.services, review.repository);
        if (serviceDfdEntry) {
          featureSecurityContext = [serviceDfdEntry];
        }
      } catch {
        // Non-fatal
      }
    }

    return this.repository.update(id, tenantId, {
      answers,
      tasks,
      status: 'questionnaire_answered',
      ...(linkedFeatureIds.length > 0 && { linkedFeatureIds }),
      ...(featureSecurityContext && { featureSecurityContext }),
    });
  }

  async acknowledgeTasks(id: string, tenantId: string): Promise<SecurityReview> {
    const review = await this.requireReview(id, tenantId);

    if (review.status !== 'questionnaire_answered') {
      throw new Error(`Cannot acknowledge tasks: review is in status '${review.status}'`);
    }

    return this.repository.update(id, tenantId, { status: 'tasks_acknowledged' });
  }

  async submitAttestations(
    id: string,
    tenantId: string,
    attestations: SecurityAttestation[],
    architectureUpdates?: AttestationArchitectureUpdate[],
  ): Promise<SecurityReview> {
    const review = await this.requireReview(id, tenantId);

    if (review.status !== 'tasks_acknowledged') {
      throw new Error(`Cannot attest: review is in status '${review.status}'`);
    }

    const attestedIds = new Set(attestations.map(a => a.taskId));
    const missing = review.tasks.filter(t => !attestedIds.has(t.id));
    if (missing.length > 0) {
      throw new Error(
        `Missing attestations for task(s): ${missing.map(t => t.id).join(', ')}`
      );
    }

    // Validate and compute architecture diff when updates are provided.
    // Two valid paths:
    // featureSecurityContext holds the baseline for both paths:
    //   - Existing-feature path: enriched feature contexts (featureId = actual feature ID)
    //   - New-feature path:      synthetic service-dfd entry (featureId = "service-dfd")
    // architectureUpdates featureIds must reference an entry in featureSecurityContext.
    let validatedUpdates: AttestationArchitectureUpdate[] | undefined;
    let architectureDiff: ArchitectureDiff[] | undefined;

    if (architectureUpdates && architectureUpdates.length > 0) {
      const validIds = new Set((review.featureSecurityContext ?? []).map(c => c.featureId));
      validatedUpdates = this.validateArchitectureUpdates(architectureUpdates, validIds);

      if (review.featureSecurityContext?.length) {
        architectureDiff = this.computeArchitectureDiff(validatedUpdates, review.featureSecurityContext);
      }
    }

    const attested = await this.repository.update(id, tenantId, {
      attestations,
      status: 'attested',
      completedAt: new Date().toISOString(),
      ...(validatedUpdates !== undefined && { architectureUpdates: validatedUpdates }),
      ...(architectureDiff !== undefined && { architectureDiff }),
    });

    return attested;
  }

  async getReview(id: string, tenantId: string): Promise<SecurityReview | null> {
    return this.repository.getById(id, tenantId);
  }

  async listReviews(
    tenantId: string,
    filters?: {
      prUrl?: string;
      branchName?: string;
      repository?: string;
    },
  ): Promise<SecurityReview[]> {
    const all = await this.repository.getAll(tenantId);
    if (!filters) return all;

    return all.filter(r => {
      if (filters.prUrl) {
        const matchesPrLink = r.prLink === filters.prUrl;
        const matchesCorrelatedPR = r.correlatedPR?.prUrl === filters.prUrl;
        if (!matchesPrLink && !matchesCorrelatedPR) return false;
      }
      if (filters.branchName) {
        if (r.gitContext?.branchName?.toLowerCase() !== filters.branchName.toLowerCase()) return false;
      }
      if (filters.repository) {
        if (r.repository?.toLowerCase() !== filters.repository.toLowerCase()) return false;
      }
      return true;
    });
  }

  /**
   * Manually trigger PR validation for a security review.
   *
   * Validates inputs, sanitises the Q&A payload, marks the review as 'running',
   * and returns the sanitised plan so the caller can execute it directly in-process.
   *
   * NOTE: Worker-queue dispatch is temporarily disabled.
   *       The API controller runs the agent in-process (fire-and-forget) instead.
   *       To re-enable the worker path, uncomment the block labelled [WORKER-QUEUE]
   *       and remove the in-process call from SecurityReviewController.
   *
   * Security:
   *   [Critical-1]  Tenant-scoped — only the review owner can trigger.
   *   [Critical-2]  Answers sanitised (control chars stripped, capped at 1 000 chars).
   *   [High-6]      Rate-limiting enforced at the HTTP layer.
   *   [Medium-11]   Mutation logged with tenantId and timestamp.
   */
  async triggerPRValidation(
    reviewId: string,
    tenantId: string,
  ): Promise<{ review: SecurityReview; plan: PRValidationPayload }> {
    const review = await this.requireReview(reviewId, tenantId);

    if (!review.correlatedPR) {
      throw new Error('No correlated PR — link a PR first');
    }
    if (!review.answers?.length) {
      throw new Error('No security answers to validate');
    }

    // [Critical-2] Build sanitised Q&A payload
    const questionsAndAnswers = review.answers.map(a => {
      const q = review.questions.find(q => q.id === a.questionId);
      return {
        questionId:   a.questionId,
        questionText: (q?.question ?? a.questionId).slice(0, 200),
        answer:       this.sanitiseText(a.answer).slice(0, 1000),
      };
    });

    /* [WORKER-QUEUE] — uncomment to re-enable background worker dispatch
    if (!this.taskRepository || !this.workerQueue) {
      throw new Error('Task queue not configured');
    }
    const taskId = uuidv4();
    const runId  = uuidv4();
    await this.taskRepository.create({
      id:          taskId,
      tenantId,
      description: `PR validation for security review ${reviewId}`,
      tools:       ['pr-validation'],
      plan: {
        agentType:           'pr-validation',
        reviewId,
        tenantId,
        questionsAndAnswers,
        correlatedPR:        review.correlatedPR,
      } as any,
      status:    'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await this.workerQueue.enqueue({ taskId, runId, tenantId });
    */

    // [Medium-11] Audit log — no PII
    console.info(`[SecurityReview] triggerPRValidation: review=${reviewId} tenant=${tenantId} ts=${new Date().toISOString()}`);

    // Mark the review as running immediately so the UI shows a spinner
    const updatedReview = await this.repository.update(reviewId, tenantId, {
      prValidationReport: {
        status:          'running',
        findings:        [],
        additionalRisks: [],
        filesReviewed:   0,
        linesReviewed:   0,
      },
    });

    const plan: PRValidationPayload = {
      reviewId,
      tenantId,
      questionsAndAnswers,
      correlatedPR: review.correlatedPR,
    };

    return { review: updatedReview, plan };
  }

  private sanitiseText(input: string): string {
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Trigger on-demand PR correlation for a review.
   * Fetches candidate PRs from the connected integration and stores the best match.
   *
   * Security:
   *   [Critical-1]  Only integrations belonging to this tenant are fetched.
   *   [Critical-4]  authorEmail / authorName are never logged below.
   *   [High-6]      Rate-limiting is enforced at the HTTP layer (route middleware).
   *   [Medium-11]   Mutation is logged with tenantId and timestamp.
   */
  async correlatePR(
    id: string,
    tenantId: string,
    overridePrUrl?: string,
  ): Promise<{ review: SecurityReview; candidates: CorrelatedPR[] }> {
    const review = await this.requireReview(id, tenantId);

    // Manual link path: pin exact PR, skip scoring
    if (overridePrUrl) {
      return this.linkPR(id, tenantId, overridePrUrl).then(r => ({ review: r, candidates: [] }));
    }

    const integrations = await this.resolveIntegrationsForReview(tenantId, review);

    const { correlated, candidates, error } = await this.prCorrelationService.correlatePR(review, integrations);

    if (error && !correlated) {
      const updated = await this.repository.update(id, tenantId, {
        correlationAttemptedAt: new Date().toISOString(),
      });
      return { review: updated, candidates: [] };
    }

    // [Medium-11] Audit log — tenantId only, no PII
    console.info(`[SecurityReview] correlatePR: review=${id} tenant=${tenantId} score=${correlated?.correlationScore ?? 'none'} ts=${new Date().toISOString()}`);

    const updated = await this.repository.update(id, tenantId, {
      correlationAttemptedAt: new Date().toISOString(),
      ...(correlated && { correlatedPR: correlated }),
    });

    return { review: updated, candidates };
  }

  /**
   * Return PR candidates (score 40–59) for a review without persisting them.
   * Used for the "Possible matches" UI panel.
   */
  async getPRCandidates(
    id: string,
    tenantId: string,
  ): Promise<CorrelatedPR[]> {
    const review = await this.requireReview(id, tenantId);
    const integrations = await this.resolveIntegrationsForReview(tenantId, review);
    const { candidates } = await this.prCorrelationService.correlatePR(review, integrations);
    return candidates;
  }

  /**
   * Manually link a specific PR URL to a review (sets score=100, signals=[{signal:"manual"}]).
   *
   * Security:
   *   [Critical-1]  Tenant-scoped; only the review owner can link.
   *   [Medium-11]   Mutation logged with tenantId and timestamp (no PII).
   */
  async linkPR(
    id: string,
    tenantId: string,
    prUrl: string,
  ): Promise<SecurityReview> {
    const review = await this.requireReview(id, tenantId);
    const integrations = await this.resolveIntegrationsForReview(tenantId, review);

    if (integrations.length === 0) {
      throw new Error('No integration found for this repository');
    }

    // Use first suitable integration to fetch PR data
    let correlatedPR: CorrelatedPR | null = null;
    for (const integration of integrations) {
      try {
        correlatedPR = await this.prCorrelationService.fetchPRByUrl(prUrl, integration);
        break;
      } catch {
        // Try next integration
      }
    }

    if (!correlatedPR) {
      throw new Error('PR fetch failed');
    }

    // [Medium-11] Audit log — tenantId only, no PII
    console.info(`[SecurityReview] linkPR: review=${id} tenant=${tenantId} prUrl=[redacted] ts=${new Date().toISOString()}`);

    return this.repository.update(id, tenantId, {
      correlatedPR,
      correlationAttemptedAt: new Date().toISOString(),
    });
  }

  // ── Private: integration resolution ──────────────────────────────────────

  /**
   * Resolve the correct GitHub / GitLab integration for a review's repository.
   *
   * Logic:
   *  1. Parse provider + org/repo from review.repository or gitContext.remoteUrl.
   *  2. Load all custom integrations for this tenant.
   *  3. Match GitHub by type='code' with config.installationId.
   *  4. Match GitLab by type='code' with config.groupAccessToken.
   *
   * Security: [Critical-1] — always filters by tenantId; never cross-tenant.
   */
  private async resolveIntegrationsForReview(
    tenantId: string,
    review: SecurityReview,
  ): Promise<PRIntegration[]> {
    if (!this.customIntegrationRepository) return [];

    let parsed: { provider: string; owner: string; repo: string; slug: string } = { provider: 'unknown', owner: '', repo: '', slug: '' };
    if (review.repository) {
      // Try as "owner/repo" slug directly
      const parts = review.repository.split('/');
      if (parts.length === 2) {
        parsed = { provider: 'unknown', owner: parts[0], repo: parts[1], slug: review.repository };
      }
    }
    if (review.gitContext?.remoteUrl) {
      const fromUrl = parseRemoteUrl(review.gitContext.remoteUrl);
      if (fromUrl.provider !== 'unknown') parsed = fromUrl;
    }

    // Bare repo name (no owner in the slug): repo is the full review.repository value.
    // Owner will be filled per-integration below from cfg.accountLogin / cfg.groupId.
    const bareRepo = parsed.repo || review.repository || '';

    const integrations: PRIntegration[] = [];

    try {
      const allIntegrations = await this.customIntegrationRepository.getAll(tenantId, true);

      for (const integration of allIntegrations) {
        const cfg = integration.config as Record<string, string>;

        // GitHub App installation
        // cfg.accountLogin is the GitHub org/user that installed the App — use it as
        // the owner fallback when review.repository is a bare name (not "org/repo").
        if (cfg.installationId) {
          const gh = new GitHubIntegration({
            tenantId,
            installationId: cfg.installationId,
          });
          integrations.push(new GitHubPRIntegration(
            gh,
            parsed.owner || cfg.accountLogin || cfg.owner || review.humanResponsible,
            bareRepo,
          ));
        }

        // GitLab group access token
        if (cfg.groupAccessToken) {
          const gl = new GitLabIntegration({
            tenantId,
            groupAccessToken: cfg.groupAccessToken,
            groupId: cfg.groupId,
            baseUrl: cfg.baseUrl,
          });
          integrations.push(new GitLabPRIntegration(
            gl,
            parsed.owner || cfg.groupId,
            bareRepo,
          ));
        }
      }
    } catch {
      // Non-fatal — return whatever we have
    }

    return integrations;
  }

  /**
   * Return the distinct services registered for the tenant, derived from
   * the sourceServiceIds and sourceServiceNames across all stored business features.
   * Returns an array of human-readable service names (e.g. "api", "shared", "worker").
   * Returns an empty array when no FeatureService is available or on error.
   */
  async getAvailableServices(tenantId: string): Promise<string[]> {
    if (!this.featureService) return [];
    try {
      const summaries = await this.featureService.getFeaturesByTenant(tenantId as any);
      const serviceNames = new Set<string>();
      for (const s of summaries) {
        // Prefer sourceServiceNames if available; fall back to sourceServiceIds
        if (s.sourceServiceNames && s.sourceServiceNames.length > 0) {
          for (const name of s.sourceServiceNames) {
            if (name && name.trim()) {
              serviceNames.add(name.trim());
            }
          }
        } else if (s.sourceServiceIds && s.sourceServiceIds.length > 0) {
          // Fallback: extract the suffix after the last colon from IDs like "code_service:abc123"
          for (const id of s.sourceServiceIds) {
            const lastColon = id.lastIndexOf(':');
            if (lastColon > 0) {
              const suffix = id.substring(lastColon + 1);
              if (suffix) serviceNames.add(suffix);
            }
          }
        }
      }
      return [...serviceNames].sort();
    } catch {
      return [];
    }
  }

  async getAttestationSummary(id: string, tenantId: string) {
    const review = await this.requireReview(id, tenantId);

    const total = review.tasks.length;
    const handled = review.attestations.filter(a => a.handled).length;
    const unhandled = review.attestations.filter(a => !a.handled).length;
    const pending = total - review.attestations.length;

    const criticalUnhandled = review.tasks
      .filter(t => t.severity === 'critical')
      .filter(t => {
        const att = review.attestations.find(a => a.taskId === t.id);
        return att ? !att.handled : true;
      });

    return {
      reviewId: id,
      featureDescription: review.featureDescription,
      status: review.status,
      totalTasks: total,
      handledTasks: handled,
      unhandledTasks: unhandled,
      pendingTasks: pending,
      criticalUnhandledCount: criticalUnhandled.length,
      criticalUnhandled: criticalUnhandled.map(t => ({ id: t.id, title: t.title })),
      completedAt: review.completedAt,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async requireReview(id: string, tenantId: string): Promise<SecurityReview> {
    const review = await this.repository.getById(id, tenantId);
    if (!review) throw new Error(`SecurityReview not found: ${id}`);
    return review;
  }

  private deriveTasks(
    answers: SecurityReviewAnswer[],
    taskRules: PolicyTaskRule[] = TASK_RULES,
    baselineTasks: Omit<SecurityTask, 'id'>[] = BASELINE_TASKS,
  ): SecurityTask[] {
    const tasks: SecurityTask[] = [];

    for (const rule of taskRules) {
      const answer = answers.find(a => a.questionId === rule.questionId);
      if (answer && answer.answer.trim().toLowerCase().startsWith('yes')) {
        for (const taskDef of rule.tasks) {
          tasks.push({ id: uuidv4(), ...taskDef });
        }
      }
    }

    // Always include baseline tasks
    for (const taskDef of baselineTasks) {
      tasks.push({ id: uuidv4(), ...taskDef });
    }

    return tasks;
  }

  /**
   * Fetch all features for the tenant, filter to those whose sourceServiceNames (or
   * sourceServiceIds as a fallback for older records) overlap with the requested service
   * names, scoped to the given repository.
   *
   * Service matching strategy (in priority order):
   *   1. sourceServiceNames — human-readable names stored at index time (e.g. "api", "worker")
   *   2. sourceServiceIds   — opaque IDs (e.g. "code_service:5b4653f1…") — substring match as
   *                           last-resort fallback for features indexed before sourceServiceNames
   *                           was introduced.
   *
   * Repository matching strategy (in priority order):
   *   1. sourceRepositoryName — exact match (case-insensitive)
   *   2. sourceServiceIds     — terminal-segment substring fallback for pre-repository records
   */
  private async resolveMatchedFeatures(
    tenantId: string,
    services: string[],
    repository: string,
  ): Promise<FeatureContext[]> {
    // Normalize service names — take the terminal path segment and lowercase it
    const terms = services.map(s =>
      s.replace(/\\/g, '/').split('/').pop()!.toLowerCase()
    );

    // Normalize repository terminal segment for fallback substring matching on sourceServiceIds
    // (used only when features pre-date the sourceRepositoryName / sourceServiceNames fields).
    const repoTermFallback = repository.replace(/\\/g, '/').split('/').pop()!.toLowerCase();

    const summaries = await this.featureService!.getFeaturesByTenant(tenantId as any);

    const matchedSummaries = summaries.filter(f => {
      // ── Service match ────────────────────────────────────────────────────────
      // Preferred: match against stored human-readable service names
      const names = (f.sourceServiceNames ?? []).map(n => n.toLowerCase());
      const sids  = (f.sourceServiceIds  ?? []).map(sid => sid.toLowerCase());

      // When sourceServiceNames is present, use it for service matching.
      // When absent, try sid substring matching; if that also fails, skip the
      // service filter entirely and let the repository match be the sole gate
      // (features indexed before sourceServiceNames was introduced have no way
      // to match by package name).
      if (names.length > 0) {
        // sourceServiceNames available — require at least one to match a requested service term
        const nameMatch = names.some(n => terms.some(term => n.includes(term) || term.includes(n)));
        if (!nameMatch) return false;
      }
      // When sourceServiceNames is absent: skip service filtering entirely and rely on
      // repository matching below. Features indexed before sourceServiceNames was introduced
      // carry only opaque service IDs that cannot be matched against package names like "api".

      // ── Repository match ─────────────────────────────────────────────────────
      // Preferred: exact match on the stored sourceRepositoryName field
      if (f.sourceRepositoryName) {
        return f.sourceRepositoryName.toLowerCase() === repository.toLowerCase();
      }
      // Fallback: substring match on sourceServiceIds for pre-repository records
      return sids.some(sid => sid.includes(repoTermFallback));
    });

    // Fetch full features in parallel for the matched summaries
    const fullFeatures = await Promise.all(
      matchedSummaries.map(s => this.featureService!.getFeatureById(tenantId as any, s.id))
    );

    return fullFeatures
      .filter((f): f is BusinessFeature => f !== null)
      .map(f => ({
        id: f.id,
        name: f.name,
        businessValue: f.businessValue,
        description: f.description,
      }));
  }

  /**
   * Build the dynamic feature_scope question.  When known features are available
   * their names and IDs are listed inline so the agent can reference them precisely.
   *
   * We include the feature ID in square brackets next to the name so the agent can
   * select features by ID — which is unambiguous — rather than by fuzzy name matching.
   */
  private buildFeatureScopeQuestion(matchedFeatures: FeatureContext[]): SecurityReviewQuestion {
    if (matchedFeatures.length === 0) {
      return {
        id: 'feature_scope',
        question:
          'Does this change apply to an existing business feature or introduce a brand-new one? ' +
          'Describe which existing feature it extends, or reply "new feature" if it introduces new capability.',
        hint: 'Identifying the feature scope helps surface existing compliance and threat-model context.',
      };
    }

    const featureList = matchedFeatures
      .map((f, i) => `  ${i + 1}. [${f.id}] ${f.name} — ${f.description}`)
      .join('\n');

    return {
      id: 'feature_scope',
      question:
        'Does this change apply to one or more of the existing features listed below, ' +
        'or is it introducing a brand-new feature?\n\n' +
        'Known features in the affected services:\n' +
        featureList +
        '\n\nReply with the feature ID(s) (comma-separated, e.g. "abc123, def456") or ' +
        'feature name(s) if you prefer, or "new feature" ' +
        'if this introduces new capability not covered above.',
      hint:
        'Providing a feature ID (the value in square brackets) causes its compliance requirements, ' +
        'data classification, and data flow context to be included in the security task response. ' +
        'ID matching is preferred over name matching because it is unambiguous.',
    };
  }

  /**
   * Parse which existing matched features the agent referenced in its feature_scope answer.
   *
   * Matching priority:
   *   1. Exact feature ID substring match (preferred – unambiguous)
   *   2. Feature name substring match (fallback for agents that replied with the name)
   *
   * Returns empty array for "new feature" answers or when nothing can be matched.
   */
  private parseLinkedFeatureIds(
    answer: string,
    matchedFeatures: FeatureContext[],
  ): string[] {
    const normalized = answer.trim().toLowerCase();

    // Treat "new feature" / "new" as no existing feature link
    if (normalized.startsWith('new') || normalized.includes('new feature')) {
      return [];
    }

    const linked: string[] = [];
    const seen = new Set<string>();

    for (const feature of matchedFeatures) {
      if (seen.has(feature.id)) continue;
      // Primary: ID match (the agent may paste the bracketed ID directly)
      const idMatched = normalized.includes(feature.id.toLowerCase());
      // Fallback: feature name match
      const nameMatched = normalized.includes(feature.name.toLowerCase());
      if (idMatched || nameMatched) {
        linked.push(feature.id);
        seen.add(feature.id);
      }
    }
    return linked;
  }

  /**
   * Fetch full BusinessFeature records for the linked IDs and build enriched
   * FeatureSecurityContext objects to return alongside the security tasks.
   */
  private async buildFeatureSecurityContexts(
    tenantId: string,
    featureIds: string[],
  ): Promise<FeatureSecurityContext[]> {
    const contexts: FeatureSecurityContext[] = [];

    for (const featureId of featureIds) {
      const feature = await this.featureService!.getFeatureById(tenantId as any, featureId);
      if (!feature) continue;

      const nodeMap = this.buildNodeMap(feature);

      contexts.push({
        featureId: feature.id,
        featureName: feature.name,
        complianceConsiderations: feature.threatModel?.complianceConsiderations ?? [],
        dataClassificationSummary: (feature.threatModel?.dataClassificationSummary ?? []).map(c => ({
          classification: c.classification,
          dataTypes: c.dataTypes,
          protectionMechanisms: c.protectionMechanisms,
        })),
        dataFlowSummary: (feature.dataFlowDiagram?.flows ?? []).map(f => ({
          from: nodeMap[f.from] ?? f.from,
          to: nodeMap[f.to] ?? f.to,
          dataTypes: f.dataTypes,
          protocol: f.protocol,
          encrypted: f.encrypted,
          authRequired: f.authenticationRequired,
        })),
        overallRiskScore: feature.threatModel?.overallRiskScore ?? 0,
        securityRecommendations: feature.threatModel?.securityRecommendations ?? [],
        existingThreats: (feature.threatModel?.strideThreats ?? []).map(t => ({
          id: t.id,
          title: t.title,
          category: t.category,
          severity: t.severity,
          status: t.status,
        })),
      });
    }

    return contexts;
  }

  /**
   * Build a FeatureSecurityContext from the code_service entities' serviceDfd field.
   * Merges DFDs across all matched services into a single baseline entry that uses
   * the same type as the existing-feature path — no separate field or extraction needed.
   *
   * Classification: INTERNAL — serviceDfd contains only architectural metadata.
   *
   * Security (input_validation / injection): serviceNames are validated in
   * getCodeServicesByNames() before any use; they are never interpolated into
   * Qdrant filter expressions.
   */
  private async buildServiceDfdContext(
    tenantId: string,
    serviceNames: string[],
    repository?: string,
  ): Promise<FeatureSecurityContext | undefined> {
    let repositoryId: string | undefined;
    if (repository) {
      repositoryId = await this.featureService!.resolveRepositoryIdByName(tenantId as any, repository);
    }
    const services = await this.featureService!.getCodeServicesByNames(tenantId, serviceNames, repositoryId);
    if (services.length === 0) return undefined;

    // Key: "from||to" → merged edge accumulator
    const edgeMap = new Map<string, {
      dataTypes: Set<string>;
      protocol: string;
      encrypted: boolean;
      authRequired: boolean;
    }>();
    const servicesCovered: string[] = [];

    for (const svc of services) {
      const dfd = svc.serviceDfd?.dataFlowDiagram;
      if (!dfd) continue;
      servicesCovered.push(svc.name);

      // Build a label lookup for this service's DFD
      const labelMap: Record<string, string> = {};
      (dfd.actors ?? []).forEach(a => (labelMap[a.id] = a.label));
      (dfd.processes ?? []).forEach(p => (labelMap[p.id] = p.label));
      (dfd.dataStores ?? []).forEach(d => (labelMap[d.id] = d.label));

      // Merge flows
      for (const flow of dfd.flows ?? []) {
        const from = labelMap[flow.from] ?? flow.from;
        const to = labelMap[flow.to] ?? flow.to;
        const key = `${from}||${to}`;
        const existing = edgeMap.get(key);
        if (existing) {
          flow.dataTypes?.forEach(dt => existing.dataTypes.add(dt));
          if (!flow.encrypted) existing.encrypted = false;
          if (flow.authenticationRequired) existing.authRequired = true;
        } else {
          edgeMap.set(key, {
            dataTypes: new Set(flow.dataTypes ?? []),
            protocol: flow.protocol ?? 'unknown',
            encrypted: flow.encrypted ?? false,
            authRequired: flow.authenticationRequired ?? false,
          });
        }
      }
    }

    if (servicesCovered.length === 0) return undefined;

    const dataFlowSummary: FeatureDataFlowEntry[] = [];
    for (const [key, acc] of edgeMap) {
      const [from, to] = key.split('||');
      dataFlowSummary.push({
        from,
        to,
        dataTypes: Array.from(acc.dataTypes),
        protocol: acc.protocol,
        encrypted: acc.encrypted,
        authRequired: acc.authRequired,
      });
    }

    return {
      featureId: 'service-dfd',
      featureName: `Service DFD (${servicesCovered.join(', ')})`,
      complianceConsiderations: [],
      dataClassificationSummary: [],
      dataFlowSummary,
      overallRiskScore: 0,
      securityRecommendations: [],
      existingThreats: [],
    };
  }

  /** Build a map of DFD node ID → human-readable label for data flow rendering */
  private buildNodeMap(feature: BusinessFeature): Record<string, string> {
    const map: Record<string, string> = {};
    const dfd = feature.dataFlowDiagram;
    (dfd?.actors ?? []).forEach(a => (map[a.id] = a.label));
    (dfd?.processes ?? []).forEach(p => (map[p.id] = p.label));
    (dfd?.dataStores ?? []).forEach(d => (map[d.id] = d.label));
    return map;
  }

  // ── Architecture update validation ─────────────────────────────────────────

  /**
   * Validate that architecture updates reference only linked feature IDs and
   * that all array entries are well-formed.  Returns a sanitized copy.
   * Throws a descriptive (but generic to the caller) Error on invalid input.
   *
   * Security: addresses input_validation and injection tasks by enforcing type
   * constraints, capping string lengths, and rejecting unexpected fields.
   */
  private validateArchitectureUpdates(
    updates: AttestationArchitectureUpdate[],
    linkedIds: Set<string>,
  ): AttestationArchitectureUpdate[] {
    if (!Array.isArray(updates)) {
      throw new Error('Invalid architectureUpdates: must be an array');
    }
    if (updates.length > 50) {
      throw new Error('Invalid architectureUpdates: too many entries (max 50)');
    }

    return updates.map((u, i) => {
      if (!u || typeof u !== 'object') {
        throw new Error(`Invalid architectureUpdates[${i}]: must be an object`);
      }
      if (typeof u.featureId !== 'string' || !u.featureId.trim()) {
        throw new Error(`Invalid architectureUpdates[${i}].featureId: must be a non-empty string`);
      }
      if (!linkedIds.has(u.featureId)) {
        throw new Error(
          `Invalid architectureUpdates[${i}].featureId: '${u.featureId}' is not a linked feature`
        );
      }
      if (!Array.isArray(u.updatedDataFlowSummary)) {
        throw new Error(`Invalid architectureUpdates[${i}].updatedDataFlowSummary: must be an array`);
      }
      if (!Array.isArray(u.updatedDataClassification)) {
        throw new Error(`Invalid architectureUpdates[${i}].updatedDataClassification: must be an array`);
      }

      const rationale = typeof u.dfdChangeRationale === 'string'
        ? u.dfdChangeRationale.trim().slice(0, 1000)
        : '';

      return {
        featureId: u.featureId.trim().slice(0, 200),
        updatedDataFlowSummary: this.sanitizeDataFlowEntries(u.updatedDataFlowSummary),
        updatedDataClassification: this.sanitizeDataClassificationEntries(u.updatedDataClassification),
        dfdChangeRationale: rationale,
      };
    });
  }

  /** Sanitize and validate data flow entries (max string lengths, required fields) */
  private sanitizeDataFlowEntries(entries: unknown[]): FeatureDataFlowEntry[] {
    if (entries.length > 100) {
      throw new Error('updatedDataFlowSummary: too many entries (max 100)');
    }
    return entries.map((e: any, i) => {
      if (!e || typeof e !== 'object') throw new Error(`updatedDataFlowSummary[${i}]: must be an object`);
      if (typeof e.from !== 'string') throw new Error(`updatedDataFlowSummary[${i}].from: must be a string`);
      if (typeof e.to !== 'string') throw new Error(`updatedDataFlowSummary[${i}].to: must be a string`);
      if (typeof e.protocol !== 'string') throw new Error(`updatedDataFlowSummary[${i}].protocol: must be a string`);
      if (!Array.isArray(e.dataTypes)) throw new Error(`updatedDataFlowSummary[${i}].dataTypes: must be an array`);
      return {
        from: String(e.from).trim().slice(0, 200),
        to: String(e.to).trim().slice(0, 200),
        protocol: String(e.protocol).trim().slice(0, 50),
        dataTypes: (e.dataTypes as unknown[]).slice(0, 30).map(d => String(d).trim().slice(0, 100)),
        encrypted: Boolean(e.encrypted),
        authRequired: Boolean(e.authRequired),
      };
    });
  }

  /** Sanitize and validate data classification entries */
  private sanitizeDataClassificationEntries(entries: unknown[]): ReviewDataClassificationEntry[] {
    if (entries.length > 20) {
      throw new Error('updatedDataClassification: too many entries (max 20)');
    }
    return entries.map((e: any, i) => {
      if (!e || typeof e !== 'object') throw new Error(`updatedDataClassification[${i}]: must be an object`);
      if (typeof e.classification !== 'string') throw new Error(`updatedDataClassification[${i}].classification: must be a string`);
      if (!Array.isArray(e.dataTypes)) throw new Error(`updatedDataClassification[${i}].dataTypes: must be an array`);
      if (!Array.isArray(e.protectionMechanisms)) throw new Error(`updatedDataClassification[${i}].protectionMechanisms: must be an array`);
      return {
        classification: String(e.classification).trim().slice(0, 50),
        dataTypes: (e.dataTypes as unknown[]).slice(0, 30).map(d => String(d).trim().slice(0, 100)),
        protectionMechanisms: (e.protectionMechanisms as unknown[]).slice(0, 20).map(m => String(m).trim().slice(0, 200)),
      };
    });
  }

  // ── Architecture diff computation ──────────────────────────────────────────

  /**
   * Compute a structured diff between the baseline architecture context (from
   * featureSecurityContext) and the updated sections submitted at attest time.
   */
  private computeArchitectureDiff(
    updates: AttestationArchitectureUpdate[],
    featureContexts: FeatureSecurityContext[],
  ): ArchitectureDiff[] {
    const contextByFeatureId = new Map(featureContexts.map(c => [c.featureId, c]));

    return updates.map(update => {
      const context = contextByFeatureId.get(update.featureId);
      const baselineFlows: FeatureDataFlowEntry[] = context?.dataFlowSummary ?? [];
      const baselineClassifications: ReviewDataClassificationEntry[] = (context?.dataClassificationSummary ?? []).map(c => ({
        classification: c.classification,
        dataTypes: c.dataTypes,
        protectionMechanisms: c.protectionMechanisms,
      }));

      const dataFlowDiff = this.diffDataFlows(baselineFlows, update.updatedDataFlowSummary);
      const dataClassificationDiff = this.diffDataClassifications(
        baselineClassifications,
        update.updatedDataClassification,
      );

      const hasChanges =
        dataFlowDiff.some(d => d.changeType !== 'unchanged') ||
        dataClassificationDiff.some(d => d.changeType !== 'unchanged');

      return {
        featureId: update.featureId,
        featureName: context?.featureName ?? update.featureId,
        dataFlowDiff,
        dataClassificationDiff,
        hasChanges,
        ...(update.dfdChangeRationale ? { dfdChangeRationale: update.dfdChangeRationale } : {}),
      };
    });
  }

  /**
   * Diff two data flow lists.
   * Key = "from|to|protocol" — matches entries by routing tuple.
   */
  private diffDataFlows(
    baseline: FeatureDataFlowEntry[],
    updated: FeatureDataFlowEntry[],
  ): DataFlowDiffEntry[] {
    const key = (e: FeatureDataFlowEntry) =>
      `${e.from.toLowerCase()}|${e.to.toLowerCase()}|${e.protocol.toLowerCase()}`;

    const baselineMap = new Map(baseline.map(e => [key(e), e]));
    const updatedMap = new Map(updated.map(e => [key(e), e]));
    const result: DataFlowDiffEntry[] = [];

    // Check baseline entries
    for (const [k, b] of baselineMap) {
      const u = updatedMap.get(k);
      if (!u) {
        result.push({ changeType: 'removed', baseline: b, updated: null });
      } else if (this.dataFlowEntryChanged(b, u)) {
        result.push({ changeType: 'changed', baseline: b, updated: u });
      } else {
        result.push({ changeType: 'unchanged', baseline: b, updated: u });
      }
    }

    // Find added entries
    for (const [k, u] of updatedMap) {
      if (!baselineMap.has(k)) {
        result.push({ changeType: 'added', baseline: null, updated: u });
      }
    }

    return result;
  }

  private dataFlowEntryChanged(a: FeatureDataFlowEntry, b: FeatureDataFlowEntry): boolean {
    if (a.encrypted !== b.encrypted) return true;
    if (a.authRequired !== b.authRequired) return true;
    const aTypes = [...a.dataTypes].sort().join(',');
    const bTypes = [...b.dataTypes].sort().join(',');
    if (aTypes !== bTypes) return true;
    return false;
  }

  /**
   * Diff two data classification lists.
   * Key = classification level (case-insensitive).
   */
  private diffDataClassifications(
    baseline: ReviewDataClassificationEntry[],
    updated: ReviewDataClassificationEntry[],
  ): DataClassificationDiffEntry[] {
    const key = (e: ReviewDataClassificationEntry) => e.classification.toLowerCase();

    const baselineMap = new Map(baseline.map(e => [key(e), e]));
    const updatedMap = new Map(updated.map(e => [key(e), e]));
    const result: DataClassificationDiffEntry[] = [];

    for (const [k, b] of baselineMap) {
      const u = updatedMap.get(k);
      if (!u) {
        result.push({ changeType: 'removed', baseline: b, updated: null });
      } else if (this.dataClassificationEntryChanged(b, u)) {
        result.push({ changeType: 'changed', baseline: b, updated: u });
      } else {
        result.push({ changeType: 'unchanged', baseline: b, updated: u });
      }
    }

    for (const [k, u] of updatedMap) {
      if (!baselineMap.has(k)) {
        result.push({ changeType: 'added', baseline: null, updated: u });
      }
    }

    return result;
  }

  private dataClassificationEntryChanged(
    a: ReviewDataClassificationEntry,
    b: ReviewDataClassificationEntry,
  ): boolean {
    const aTypes = [...a.dataTypes].sort().join(',');
    const bTypes = [...b.dataTypes].sort().join(',');
    if (aTypes !== bTypes) return true;
    const aMechs = [...a.protectionMechanisms].sort().join(',');
    const bMechs = [...b.protectionMechanisms].sort().join(',');
    if (aMechs !== bMechs) return true;
    return false;
  }
}
