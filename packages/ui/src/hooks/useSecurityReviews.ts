import { useState, useCallback } from 'react';
import type {
  SecurityReview,
  SecurityReviewAnswer,
  SecurityAttestation,
  SecurityReviewAttestationSummary,
  CorrelatedPR,
} from '../types';
import * as securityReviewService from '../services/securityReviewService';
import { useAuth } from './useAuth';

export function useSecurityReviews() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const listReviews = useCallback(async (): Promise<SecurityReview[]> => {
    setLoading(true);
    setError(null);
    try {
      return await securityReviewService.listSecurityReviews(acquireToken);
    } catch (err: any) {
      const msg = err.message || 'Failed to load security reviews';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getReview = useCallback(async (id: string): Promise<SecurityReview> => {
    setLoading(true);
    setError(null);
    try {
      return await securityReviewService.getSecurityReview(acquireToken, id);
    } catch (err: any) {
      const msg = err.message || 'Failed to load security review';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getAttestationSummary = useCallback(
    async (id: string): Promise<SecurityReviewAttestationSummary> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.getAttestationSummary(acquireToken, id);
      } catch (err: any) {
        const msg = err.message || 'Failed to load attestation summary';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken]
  );

  const startReview = useCallback(
    async (featureDescription: string): Promise<SecurityReview> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.startSecurityReview(acquireToken, featureDescription);
      } catch (err: any) {
        const msg = err.message || 'Failed to start security review';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken]
  );

  const submitAnswers = useCallback(
    async (id: string, answers: SecurityReviewAnswer[]): Promise<SecurityReview> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.submitAnswers(acquireToken, id, answers);
      } catch (err: any) {
        const msg = err.message || 'Failed to submit answers';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken]
  );

  const acknowledgeTasks = useCallback(async (id: string): Promise<SecurityReview> => {
    setLoading(true);
    setError(null);
    try {
      return await securityReviewService.acknowledgeTasks(acquireToken, id);
    } catch (err: any) {
      const msg = err.message || 'Failed to acknowledge tasks';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const submitAttestations = useCallback(
    async (id: string, attestations: SecurityAttestation[]): Promise<SecurityReview> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.submitAttestations(acquireToken, id, attestations);
      } catch (err: any) {
        const msg = err.message || 'Failed to submit attestations';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken]
  );

  const refreshSnapshot = useCallback(async (id: string): Promise<SecurityReview> => {
    setLoading(true);
    setError(null);
    try {
      return await securityReviewService.refreshSnapshot(acquireToken, id);
    } catch (err: any) {
      const msg = err.message || 'Failed to refresh threat model snapshot';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const correlatePR = useCallback(
    async (id: string, prUrl?: string): Promise<{ review: SecurityReview; candidates: CorrelatedPR[] }> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.correlatePR(acquireToken, id, prUrl);
      } catch (err: any) {
        const msg = err.message || 'PR correlation failed';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken],
  );

  const getPRCandidates = useCallback(
    async (id: string): Promise<CorrelatedPR[]> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.getPRCandidates(acquireToken, id);
      } catch (err: any) {
        const msg = err.message || 'Failed to load PR candidates';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken],
  );

  const linkPR = useCallback(
    async (id: string, prUrl: string): Promise<SecurityReview> => {
      setLoading(true);
      setError(null);
      try {
        return await securityReviewService.linkPR(acquireToken, id, prUrl);
      } catch (err: any) {
        const msg = err.message || 'Failed to link PR';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken],
  );

  return {
    loading,
    error,
    listReviews,
    getReview,
    getAttestationSummary,
    startReview,
    submitAnswers,
    acknowledgeTasks,
    submitAttestations,
    refreshSnapshot,
    correlatePR,
    getPRCandidates,
    linkPR,
  };
}
