import type { Request, Response } from 'express';
import type { SecurityReviewService } from '@ai-agent/shared';
import type { SecurityReviewAnswer, SecurityAttestation, AttestationArchitectureUpdate } from '@ai-agent/shared';

/**
 * Resolves the tenant ID for security review endpoints.
 * Priority: JWT auth context → throws.
 *
 * Security: [Critical-1] — tenantId always comes from verified JWT; never from agent input.
 */
function resolveTenantId(req: Request): string {
  if (req.auth?.tenantId) {
    return req.auth?.tenantId;
  }

  throw new Error('Cannot fetch tenantId');
}

export class SecurityReviewController {
  constructor(
    private service: SecurityReviewService,
  ) {}

  async startReview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const {
        featureDescription,
        repository,
        agentName,
        title,
        services,
        prLink,
        gitContext,
      } = req.body as {
        featureDescription?: string;
        repository?: string;
        agentName?: string;
        title?: string;
        services?: string[];
        prLink?: string;
        gitContext?: Record<string, unknown>;
      };

      if (!featureDescription?.trim()) {
        res.status(400).json({ error: 'featureDescription is required' });
        return;
      }

      // Sanitize optional repository field: trim whitespace, cap at 200 chars
      const sanitizedRepository = typeof repository === 'string'
        ? repository.trim().slice(0, 200) || undefined
        : undefined;

      // Sanitize prLink: must be a valid https:// URL
      let sanitizedPrLink: string | undefined;
      if (typeof prLink === 'string' && prLink.trim()) {
        try {
          const url = new URL(prLink.trim());
          if (url.protocol === 'https:') sanitizedPrLink = url.href.slice(0, 500);
        } catch { /* discard invalid URL */ }
      }

      const review = await this.service.startReview(tenantId, featureDescription.trim(), {
        repository: sanitizedRepository,
        agentName: typeof agentName === 'string' ? agentName.trim().slice(0, 100) : undefined,
        title: typeof title === 'string' ? title.trim().slice(0, 200) : undefined,
        services: Array.isArray(services) ? services : undefined,
        prLink: sanitizedPrLink,
        // gitContext is sanitised inside startReview via sanitiseGitContext()
        gitContext: gitContext && typeof gitContext === 'object' ? gitContext : undefined,
      });

      res.status(201).json(review);
    } catch (error) {
      console.error('[SecurityReview] startReview error:', error);
      res.status(500).json({ error: 'Failed to start security review' });
    }
  }

  async submitAnswers(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const { answers } = req.body as { answers?: SecurityReviewAnswer[] };

      if (!Array.isArray(answers) || answers.length === 0) {
        res.status(400).json({ error: 'answers array is required' });
        return;
      }

      const review = await this.service.submitAnswers(id, tenantId, answers);
      res.json(review);
    } catch (error: any) {
      const isValidation = error.message?.startsWith('Missing answers') ||
        error.message?.startsWith('Cannot submit');
      console.error('[SecurityReview] submitAnswers error:', error);
      res.status(isValidation ? 400 : 500).json({ error: error.message || 'Failed to submit answers' });
    }
  }

  async acknowledgeTasks(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      const review = await this.service.acknowledgeTasks(id, tenantId);
      res.json(review);
    } catch (error: any) {
      const isValidation = error.message?.startsWith('Cannot acknowledge');
      console.error('[SecurityReview] acknowledgeTasks error:', error);
      res.status(isValidation ? 400 : 500).json({ error: error.message || 'Failed to acknowledge tasks' });
    }
  }

  async submitAttestations(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const { attestations, architectureUpdates } = req.body as {
        attestations?: SecurityAttestation[];
        architectureUpdates?: AttestationArchitectureUpdate[];
      };

      if (!Array.isArray(attestations) || attestations.length === 0) {
        res.status(400).json({ error: 'attestations array is required' });
        return;
      }

      const review = await this.service.submitAttestations(id, tenantId, attestations, architectureUpdates);
      res.json(review);
    } catch (error: any) {
      const isValidation = error.message?.startsWith('Missing attestations') ||
        error.message?.startsWith('Cannot attest') ||
        error.message?.startsWith('Invalid architecture');
      console.error('[SecurityReview] submitAttestations error:', error);
      res.status(isValidation ? 400 : 500).json({ error: error.message || 'Failed to submit attestations' });
    }
  }

  async getReview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      const review = await this.service.getReview(id, tenantId);
      if (!review) {
        res.status(404).json({ error: 'Security review not found' });
        return;
      }
      res.json(review);
    } catch (error) {
      console.error('[SecurityReview] getReview error:', error);
      res.status(500).json({ error: 'Failed to get security review' });
    }
  }

  async listReviews(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);

      // Query-string filters for PR correlation lookup
      // [Critical-2] All filter values are sanitised: trimmed and capped
      const rawPrUrl = typeof req.query.prUrl === 'string' ? req.query.prUrl.trim().slice(0, 500) : undefined;
      const rawBranchName = typeof req.query.branchName === 'string' ? req.query.branchName.trim().slice(0, 255) : undefined;
      const rawRepository = typeof req.query.repository === 'string' ? req.query.repository.trim().slice(0, 200) : undefined;

      // Validate prUrl is a proper https:// URL when provided
      let sanitizedPrUrl: string | undefined;
      if (rawPrUrl) {
        try {
          const url = new URL(rawPrUrl);
          if (url.protocol === 'https:') sanitizedPrUrl = url.href;
        } catch { /* discard invalid URL */ }
      }

      const hasFilters = sanitizedPrUrl || rawBranchName || rawRepository;
      const reviews = await this.service.listReviews(
        tenantId,
        hasFilters ? { prUrl: sanitizedPrUrl, branchName: rawBranchName, repository: rawRepository } : undefined,
      );
      res.json(reviews);
    } catch (error) {
      console.error('[SecurityReview] listReviews error:', error);
      res.status(500).json({ error: 'Failed to list security reviews' });
    }
  }

  async getAttestationSummary(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      const summary = await this.service.getAttestationSummary(id, tenantId);
      res.json(summary);
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      console.error('[SecurityReview] getAttestationSummary error:', error);
      res.status(isNotFound ? 404 : 500).json({ error: error.message || 'Failed to get attestation summary' });
    }
  }

  /**
   * POST /security-reviews/:id/correlate-pr
   * Trigger on-demand PR correlation for a review.
   *
   * Security:
   *   [Critical-1] Tenant-scoped via resolveTenantId.
   *   [High-6]     Rate-limited at route level (10 req/min per tenant).
   */
  async correlatePR(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      // Optional prUrl override: must be a valid https:// URL
      const rawPrUrl = typeof req.body?.prUrl === 'string' ? req.body.prUrl.trim() : undefined;
      let sanitizedPrUrl: string | undefined;
      if (rawPrUrl) {
        try {
          const url = new URL(rawPrUrl);
          if (url.protocol === 'https:') sanitizedPrUrl = url.href.slice(0, 500);
        } catch { /* discard */ }
      }

      const { review, candidates } = await this.service.correlatePR(id, tenantId, sanitizedPrUrl);
      res.json({ review, candidates });
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      // [Medium-12] Generic error — do not expose upstream API error details
      console.error('[SecurityReview] correlatePR error:', error);
      res.status(isNotFound ? 404 : 500).json({ error: isNotFound ? error.message : 'PR correlation failed' });
    }
  }

  /**
   * GET /security-reviews/:id/pr-candidates
   * Return PR candidates (score 40–59) for a review without persisting them.
   *
   * Security: [Critical-1] Tenant-scoped.
   */
  async getPRCandidates(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      const candidates = await this.service.getPRCandidates(id, tenantId);
      res.json({ candidates });
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      console.error('[SecurityReview] getPRCandidates error:', error);
      res.status(isNotFound ? 404 : 500).json({ error: isNotFound ? error.message : 'Failed to get PR candidates' });
    }
  }

  /**
   * PUT /security-reviews/:id/correlated-pr
   * Manually link a specific PR to a review.
   *
   * Security:
   *   [Critical-1] Tenant-scoped.
   *   [Critical-2] prUrl validated as https:// before use.
   *   [Medium-11]  Mutation logged in service layer.
   */
  async linkPR(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const rawPrUrl = typeof req.body?.prUrl === 'string' ? req.body.prUrl.trim() : '';

      if (!rawPrUrl) {
        res.status(400).json({ error: 'prUrl is required' });
        return;
      }

      // Validate URL: must be https://
      let sanitizedPrUrl: string;
      try {
        const url = new URL(rawPrUrl);
        if (url.protocol !== 'https:') throw new Error('must be https');
        sanitizedPrUrl = url.href.slice(0, 500);
      } catch {
        res.status(400).json({ error: 'prUrl must be a valid https:// URL' });
        return;
      }

      const review = await this.service.linkPR(id, tenantId, sanitizedPrUrl);
      res.json(review);
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      const isValidation = error.message?.startsWith('prUrl') || error.message?.startsWith('No integration');
      // [Medium-12] Generic error messages — never expose upstream API errors
      console.error('[SecurityReview] linkPR error:', error);
      res.status(isNotFound ? 404 : isValidation ? 400 : 500).json({
        error: isNotFound ? error.message : isValidation ? error.message : 'PR link failed',
      });
    }
  }

  /**
   * Placeholder for future threat model snapshot refresh.
   * Returns 501 until snapshot capture is implemented.
   */
  async refreshSnapshot(req: Request, res: Response): Promise<void> {
    res.status(501).json({ error: 'Threat model snapshot capture is not yet implemented' });
  }
}
