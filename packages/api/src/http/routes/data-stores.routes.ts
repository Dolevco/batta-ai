import express from 'express';
import { DataStoreController } from '../../controllers/dataStoreController';

export function createDataStoresRouter(controller: DataStoreController): express.Router {
  const router = express.Router();

  router.get('/knowledge-base/data-stores/:id/relationships', controller.getDataStoreRelationships.bind(controller));
  router.get('/knowledge-base/data-stores/:id', controller.getDataStoreById.bind(controller));
  router.get('/knowledge-base/data-stores', controller.listDataStores.bind(controller));

  return router;
}
