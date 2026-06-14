import express from 'express';
import { CapabilitiesController } from '../../controllers/capabilitiesController';

export function createCapabilitiesRouter(controller: CapabilitiesController): express.Router {
  const router = express.Router();

  router.get('/capabilities', controller.getCapabilities.bind(controller));

  return router;
}
