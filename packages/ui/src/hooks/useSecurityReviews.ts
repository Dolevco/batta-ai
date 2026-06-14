import * as securityReviewService from '../services/security-reviews/securityReviewService';
import { useAPICall } from './useAPICall';

export function useSecurityReviews() {
  const { loading, error, execute: listReviews } = useAPICall(securityReviewService.listSecurityReviews);
  const { execute: getReview } = useAPICall(securityReviewService.getSecurityReview);
  const { execute: getAttestationSummary } = useAPICall(securityReviewService.getAttestationSummary);
  const { execute: explainSecurityRequirement } = useAPICall(securityReviewService.explainSecurityRequirement);
  const { execute: startReview } = useAPICall(securityReviewService.startSecurityReview);
  const { execute: submitAnswers } = useAPICall(securityReviewService.submitAnswers);
  const { execute: acknowledgeTasks } = useAPICall(securityReviewService.acknowledgeTasks);
  const { execute: submitAttestations } = useAPICall(securityReviewService.submitAttestations);
  const { execute: refreshSnapshot } = useAPICall(securityReviewService.refreshSnapshot);
  const { execute: correlatePR } = useAPICall(securityReviewService.correlatePR);
  const { execute: getPRCandidates } = useAPICall(securityReviewService.getPRCandidates);
  const { execute: linkPR } = useAPICall(securityReviewService.linkPR);
  const { execute: triggerPRValidation } = useAPICall(securityReviewService.triggerPRValidation);
  const { execute: previewWorkItem } = useAPICall(securityReviewService.previewWorkItem);
  const { execute: startWorkItemReview } = useAPICall(securityReviewService.startWorkItemReview);
  const { execute: retryWorkItemReview } = useAPICall(securityReviewService.retryWorkItemReview);
  const { execute: exportToJira } = useAPICall(securityReviewService.exportToJira);

  return {
    loading,
    error,
    listReviews,
    getReview,
    getAttestationSummary,
    explainSecurityRequirement,
    startReview,
    submitAnswers,
    acknowledgeTasks,
    submitAttestations,
    refreshSnapshot,
    correlatePR,
    getPRCandidates,
    linkPR,
    triggerPRValidation,
    previewWorkItem,
    startWorkItemReview,
    retryWorkItemReview,
    exportToJira,
  };
}
