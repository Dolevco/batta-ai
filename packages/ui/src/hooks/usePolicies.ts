import { useState, useCallback } from 'react';
import type { PolicyTemplate, PolicyTemplateType } from '../types';
import * as policyService from '../services/policyService';
import { useAuth } from './useAuth';

export function usePolicies() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const listPolicies = useCallback(async (): Promise<PolicyTemplate[]> => {
    setLoading(true);
    setError(null);
    try {
      return await policyService.listPolicies(acquireToken);
    } catch (err: any) {
      const msg = err.message || 'Failed to load policies';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getPolicy = useCallback(async (id: string): Promise<PolicyTemplate> => {
    setLoading(true);
    setError(null);
    try {
      return await policyService.getPolicy(acquireToken, id);
    } catch (err: any) {
      const msg = err.message || 'Failed to load policy';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const updatePolicy = useCallback(async (
    id: string,
    updates: Partial<Pick<PolicyTemplate, 'name' | 'description' | 'questions' | 'taskRules' | 'baselineTasks' | 'isActive'>>
  ): Promise<PolicyTemplate> => {
    setLoading(true);
    setError(null);
    try {
      return await policyService.updatePolicy(acquireToken, id, updates);
    } catch (err: any) {
      const msg = err.message || 'Failed to update policy';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const resetToDefaults = useCallback(async (type: PolicyTemplateType): Promise<PolicyTemplate> => {
    setLoading(true);
    setError(null);
    try {
      return await policyService.resetToDefaults(acquireToken, type);
    } catch (err: any) {
      const msg = err.message || 'Failed to reset policy to defaults';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const seedDefaults = useCallback(async (): Promise<PolicyTemplate[]> => {
    setLoading(true);
    setError(null);
    try {
      return await policyService.seedDefaults(acquireToken);
    } catch (err: any) {
      const msg = err.message || 'Failed to seed default policies';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  return { loading, error, listPolicies, getPolicy, updatePolicy, resetToDefaults, seedDefaults };
}
