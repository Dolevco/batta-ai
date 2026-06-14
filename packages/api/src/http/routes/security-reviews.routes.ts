import express from 'express';
import { SecurityReviewController } from '../../controllers/securityReviewController';

export function createSecurityReviewRouter(controller: SecurityReviewController): express.Router {
  const router = express.Router();

  // Work-item routes must be registered before /:id routes so Express does not
  // treat the literal segment "work-item" as a review ID.
  router.post('/security-reviews/work-item/preview', controller.previewWorkItem.bind(controller));
  router.post('/security-reviews/work-item', controller.startWorkItemReview.bind(controller));
  router.post('/security-reviews/work-item/:id/retry', controller.retryWorkItemReview.bind(controller));

  router.post('/security-reviews', controller.startReview.bind(controller));
  router.get('/security-reviews', controller.listReviews.bind(controller));
  router.get('/security-reviews/:id', controller.getReview.bind(controller));
  router.post('/security-reviews/:id/answers', controller.submitAnswers.bind(controller));
  router.post('/security-reviews/:id/acknowledge', controller.acknowledgeTasks.bind(controller));
  router.post('/security-reviews/:id/attestations', controller.submitAttestations.bind(controller));
  router.get('/security-reviews/:id/attestation-summary', controller.getAttestationSummary.bind(controller));
  router.get('/security-reviews/:id/tasks/:taskId/explanation', controller.explainRequirement.bind(controller));
  router.post('/security-reviews/:id/export-to-jira', controller.exportToJira.bind(controller));

  return router;
}
