import express from 'express';
import { ScanController } from '../../controllers/scanController';

export function createScansRouter(controller: ScanController): express.Router {
  const router = express.Router();

  router.get('/knowledge-base/repositories', controller.listRepositories.bind(controller));
  router.post('/knowledge-base/scan/stream', controller.streamScan.bind(controller));
  router.post('/knowledge-base/scan', controller.triggerScan.bind(controller));
  router.get('/knowledge-base/scan', controller.listScanHistory.bind(controller));
  router.get('/knowledge-base/scan/:scanId', controller.getScanStatus.bind(controller));

  return router;
}
