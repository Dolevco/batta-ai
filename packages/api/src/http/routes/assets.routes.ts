import express from 'express';
import { AssetController } from '../../controllers/assetController';

export function createAssetsRouter(controller: AssetController): express.Router {
  const router = express.Router();

  router.delete('/knowledge-base/assets', controller.deleteAllAssets.bind(controller));
  router.get('/knowledge-base/assets/categories', controller.getAssetCategories.bind(controller));
  router.get('/knowledge-base/asset/*/relationships', controller.getAssetRelationships.bind(controller));
  router.get('/knowledge-base/asset/*/artifacts', controller.getRepositoryArtifacts.bind(controller));
  router.get('/knowledge-base/asset/*/exploitability', controller.getAssetExploitability.bind(controller));
  router.get('/knowledge-base/asset/*', controller.getAssetById.bind(controller));
  router.get('/knowledge-base/assets/:category', controller.getAssetsByCategory.bind(controller));

  return router;
}
