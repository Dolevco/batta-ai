import express from 'express';
import { PolicyController } from '../../controllers/policyController';

export function createPolicyRouter(controller: PolicyController): express.Router {
  const router = express.Router();

  router.get('/policies', controller.listPolicies.bind(controller));
  router.post('/policies/seed', controller.seedDefaults.bind(controller));
  router.post('/policies/reset/:type', controller.resetToDefaults.bind(controller));
  router.get('/policies/:id', controller.getPolicy.bind(controller));
  router.put('/policies/:id', controller.updatePolicy.bind(controller));

  return router;
}
