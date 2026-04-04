import { Request, Response } from 'express';
import { FeatureService } from '@ai-agent/shared';

export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  /** GET /knowledge-base/features */
  async listFeatures(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const features = await this.featureService.getFeaturesByTenant(tenantId);
      res.json(features);
    } catch (error) {
      console.error('[FeatureController] listFeatures error:', error);
      res.status(500).json({ error: 'Failed to list business features' });
    }
  }

  /** GET /knowledge-base/features/:id */
  async getFeatureById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;

      // Validate ID format: 36-char hex string (UUID-style from sha256 slice)
      if (!id || !/^[0-9a-f]{36}$/.test(id)) {
        res.status(400).json({ error: 'Invalid feature ID format.' });
        return;
      }

      const feature = await this.featureService.getFeatureById(tenantId, id);
      if (!feature) {
        res.status(404).json({ error: 'Feature not found' });
        return;
      }

      res.json(feature);
    } catch (error) {
      console.error('[FeatureController] getFeatureById error:', error);
      res.status(500).json({ error: 'Failed to get business feature' });
    }
  }

  /** GET /knowledge-base/features/:id/history */
  async getFeatureHistory(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;

      if (!id || !/^[0-9a-f]{36}$/.test(id)) {
        res.status(400).json({ error: 'Invalid feature ID format.' });
        return;
      }

      const history = await this.featureService.getFeatureHistory(tenantId, id);
      if (history.length === 0) {
        res.status(404).json({ error: 'Feature not found' });
        return;
      }

      res.json(history);
    } catch (error) {
      console.error('[FeatureController] getFeatureHistory error:', error);
      res.status(500).json({ error: 'Failed to get feature history' });
    }
  }

  /** GET /knowledge-base/features/architecture-doc */
  async getArchitectureDoc(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const summaries = await this.featureService.getFeaturesByTenant(tenantId);

      if (summaries.length === 0) {
        res.status(404).json({ error: 'No business features found — run a scan with Feature Extraction enabled first.' });
        return;
      }

      // Fetch full features to compose the document
      const fullFeatures = await Promise.all(
        summaries.map(s => this.featureService.getFeatureById(tenantId, s.id))
      );
      const validFeatures = fullFeatures.filter((f): f is NonNullable<typeof f> => f !== null);

      const markdown = this.featureService.composeArchitectureDoc(validFeatures);

      const format = req.query['format'] as string | undefined;
      if (format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send(markdown);
        return;
      }

      res.json({ markdown, featureCount: validFeatures.length });
    } catch (error) {
      console.error('[FeatureController] getArchitectureDoc error:', error);
      res.status(500).json({ error: 'Failed to compose architecture document' });
    }
  }
}
