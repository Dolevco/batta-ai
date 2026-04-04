import { useState, useCallback } from 'react';
import type { BusinessFeatureSummary, BusinessFeature } from '../types';
import * as featureService from '../services/featureService';
import { useAuth } from './useAuth';

export function useFeatures() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const listFeatures = useCallback(async (): Promise<BusinessFeatureSummary[]> => {
    setLoading(true);
    setError(null);
    try {
      return await featureService.listFeatures(acquireToken);
    } catch (err: any) {
      const msg = err.message || 'Failed to fetch business features';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getFeatureById = useCallback(
    async (id: string): Promise<BusinessFeature> => {
      setLoading(true);
      setError(null);
      try {
        return await featureService.getFeatureById(acquireToken, id);
      } catch (err: any) {
        const msg = err.message || 'Failed to fetch business feature';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [acquireToken]
  );

  const getArchitectureDoc = useCallback(async (): Promise<{ markdown: string; featureCount: number }> => {
    setLoading(true);
    setError(null);
    try {
      return await featureService.getArchitectureDoc(acquireToken);
    } catch (err: any) {
      const msg = err.message || 'Failed to fetch architecture document';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  return { loading, error, listFeatures, getFeatureById, getArchitectureDoc };
}
