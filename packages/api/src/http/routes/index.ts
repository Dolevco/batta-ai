import express from 'express';
import type { AppContext } from '../../app/createContext';
import { authMiddleware } from '../../middleware/auth';
import { createAssetsRouter } from './assets.routes';
import { createCapabilitiesRouter } from './capabilities.routes';
import { createChatRouter } from './chat.routes';
import { createDataStoresRouter } from './data-stores.routes';
import { createFeaturesRouter } from './features.routes';
import { createIntegrationsRouter } from './integrations.routes';
import { createPolicyRouter } from './policies.routes';
import { createScansRouter } from './scans.routes';
import { createSecurityReviewRouter } from './security-reviews.routes';

export function createRestRouter(context: AppContext): express.Router {
  const router = express.Router();
  const { controllers } = context;

  router.use(authMiddleware);
  router.use(createCapabilitiesRouter(controllers.capabilities));
  router.use(createSecurityReviewRouter(controllers.securityReview));
  router.use(createPolicyRouter(controllers.policy));
  router.use(createIntegrationsRouter(controllers));
  router.use(createAssetsRouter(controllers.asset));
  router.use(createScansRouter(controllers.scan));
  router.use(createFeaturesRouter(controllers.feature));
  router.use(createDataStoresRouter(controllers.dataStore));
  router.use(createChatRouter(controllers.chat));

  return router;
}
