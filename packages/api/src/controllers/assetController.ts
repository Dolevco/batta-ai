import { AssetService } from '@batta/shared';
import { Request, Response } from 'express';

export class AssetController {
  private assetService: AssetService;

  constructor(assetService: AssetService) {
    this.assetService = assetService;
  }

  async getAssetCategories(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const categories = await this.assetService.getAssetCategories(tenantId);
      res.json(categories);
    } catch (error) {
      console.error('Error getting asset categories:', error);
      res.status(500).json({ error: 'Failed to get asset categories' });
    }
  }

  async getAssetsByCategory(req: Request, res: Response): Promise<void> {
    try {
      const { category } = req.params;
      const tenantId = req.auth!.tenantId;
      
      if (!category) {
        res.status(400).json({ error: 'Category is required' });
        return;
      }

      const assets = await this.assetService.getAssetsByCategory(tenantId, category);
      res.json(assets);
    } catch (error) {
      console.error('Error getting assets by category:', error);
      res.status(500).json({ error: 'Failed to get assets' });
    }
  }

  async getAssetById(req: Request, res: Response): Promise<void> {
    try {
      const id = (req.params as any)[0] ?? req.params.id;
      const tenantId = req.auth!.tenantId;

      console.log('[AssetController] getAssetById called with id:', id, 'tenantId:', tenantId);
      
      if (!id) {
        res.status(400).json({ error: 'Asset ID is required' });
        return;
      }

      const asset = await this.assetService.getAssetById(tenantId, id);
      
      if (!asset) {
        console.log('[AssetController] Asset not found for id:', id);
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      
      console.log('[AssetController] Returning asset:', asset.name);
      res.json(asset);
    } catch (error) {
      console.error('[AssetController] Error getting asset by ID:', error);
      res.status(500).json({ error: 'Failed to get asset details' });
    }
  }

  async deleteAllAssets(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      await this.assetService.deleteAllAssets(tenantId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting all assets:', error);
      res.status(500).json({ error: 'Failed to delete assets' });
    }
  }

  async getAssetRelationships(req: Request, res: Response): Promise<void> {
    try {
      const id = (req.params as any)[0] ?? req.params.id;
      const tenantId = req.auth!.tenantId;
      
      if (!id) {
        res.status(400).json({ error: 'Asset ID is required' });
        return;
      }

      const relationships = await this.assetService.getAssetRelationships(tenantId, id);
      res.json(relationships);
    } catch (error) {
      console.error('Error getting asset relationships:', error);
      res.status(500).json({ error: 'Failed to get asset relationships' });
    }
  }

  async getRepositoryArtifacts(req: Request, res: Response): Promise<void> {
    try {
      const id = (req.params as any)[0] ?? req.params.id;
      const tenantId = req.auth!.tenantId;

      if (!id) {
        res.status(400).json({ error: 'Repository ID is required' });
        return;
      }

      const artifacts = await this.assetService.getRepositoryArtifacts(tenantId, id);
      res.json(artifacts);
    } catch (error) {
      console.error('Error getting repository artifacts:', error);
      res.status(500).json({ error: 'Failed to get repository artifacts' });
    }
  }

  async getAssetExploitability(req: Request, res: Response): Promise<void> {
    try {
      const id = (req.params as any)[0] ?? req.params.id;
      const tenantId = req.auth!.tenantId;

      if (!id) {
        res.status(400).json({ error: 'Asset ID is required' });
        return;
      }

      const asset = await this.assetService.getAssetById(tenantId, id);
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }

      const fullEntity = asset.fullEntity as any;
      const exploitabilityAnalysis = fullEntity.exploitabilityAnalysis ?? null;
      if (exploitabilityAnalysis) {
        const identifiedThreats: Array<{ id: string; description: string }> =
          fullEntity.threatModel?.identifiedThreats ?? [];
        const strideThreats: Array<{ id: string; title?: string; description: string }> =
          fullEntity.serviceThreatModel?.strideThreats ?? [];
        const descriptionById = new Map<string, string>([
          ...identifiedThreats.map((t): [string, string] => [t.id, t.description]),
          ...strideThreats.map((t): [string, string] => [t.id, t.title ? `${t.title}: ${t.description}` : t.description]),
        ]);
        exploitabilityAnalysis.results = exploitabilityAnalysis.results.map((r: any) => ({
          ...r,
          threatDescription: descriptionById.get(r.threatId) ?? undefined,
        }));
      }
      res.json(exploitabilityAnalysis);
    } catch (error) {
      console.error('Error getting asset exploitability:', error);
      res.status(500).json({ error: 'Failed to get exploitability analysis' });
    }
  }
}
