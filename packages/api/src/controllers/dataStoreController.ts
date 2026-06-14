/**
 * Data Store Controller
 *
 * Provides REST endpoints for the Data Stores knowledge-base view.
 * All routes are protected by the existing authMiddleware (JWT, tenantId from req.auth).
 * Input IDs are validated server-side in AssetService.getDataStoreById to prevent injection.
 * Error responses are generic — details are logged server-side only.
 */
import type { Request, Response } from 'express';
import type { AssetService } from '@batta/shared';

export class DataStoreController {
  constructor(private readonly assetService: AssetService) {}

  /** GET /api/data-stores — list all DataStore summaries for tenant */
  async listDataStores(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const stores = await this.assetService.getDataStores(tenantId);
      res.json(stores);
    } catch (error) {
      console.error('[DataStoreController] listDataStores error:', error);
      res.status(500).json({ error: 'Failed to list data stores' });
    }
  }

  /** GET /api/data-stores/:id — get a single DataStore detail */
  async getDataStoreById(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Data store ID is required' });
        return;
      }
      const store = await this.assetService.getDataStoreById(tenantId, id);
      if (!store) {
        res.status(404).json({ error: 'Data store not found' });
        return;
      }
      res.json(store);
    } catch (error) {
      console.error('[DataStoreController] getDataStoreById error:', error);
      res.status(500).json({ error: 'Failed to get data store' });
    }
  }

  /** GET /api/data-stores/:id/relationships — relationship graph for a DataStore */
  async getDataStoreRelationships(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Data store ID is required' });
        return;
      }
      const graph = await this.assetService.getDataStoreRelationships(tenantId, id);
      res.json(graph);
    } catch (error) {
      console.error('[DataStoreController] getDataStoreRelationships error:', error);
      res.status(500).json({ error: 'Failed to get data store relationships' });
    }
  }
}
