import express from 'express';
import { FeatureController } from '../../controllers/featureController';

export function createFeaturesRouter(controller: FeatureController): express.Router {
  const router = express.Router();

  router.get('/knowledge-base/features/architecture-doc', controller.getArchitectureDoc.bind(controller));
  router.get('/knowledge-base/features/:id/history', controller.getFeatureHistory.bind(controller));
  router.get('/knowledge-base/features/:id', controller.getFeatureById.bind(controller));
  router.get('/knowledge-base/features', controller.listFeatures.bind(controller));

  return router;
}
