import type { Request, Response } from 'express';
import type { SecurityReviewService } from '@ai-agent/shared';
import type { SecurityReviewAnswer, SecurityAttestation, AttestationArchitectureUpdate } from '@ai-agent/shared';

/**
 * Resolves the tenant ID for security review endpoints.
 * Priority: JWT auth context → request body → query string → X-Tenant-Id header → 'default'.
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
      const { featureDescription, repository } = req.body as { featureDescription?: string; repository?: string };

      if (!featureDescription?.trim()) {
        res.status(400).json({ error: 'featureDescription is required' });
        return;
      }

      // Sanitize optional repository field: trim whitespace, cap at 200 chars
      const sanitizedRepository = typeof repository === 'string'
        ? repository.trim().slice(0, 200) || undefined
        : undefined;

      const review = await this.service.startReview(tenantId, featureDescription.trim(), {
        repository: sanitizedRepository,
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
      const reviews = await this.service.listReviews(tenantId);
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
   * Placeholder for future threat model snapshot refresh.
   * Returns 501 until snapshot capture is implemented.
   */
  async refreshSnapshot(req: Request, res: Response): Promise<void> {
    res.status(501).json({ error: 'Threat model snapshot capture is not yet implemented' });
  }
}
