import * as policyService from '../services/policies/policyService';
import { useAPICall } from './useAPICall';

export function usePolicies() {
  const { loading, error, execute: listPolicies } = useAPICall(policyService.listPolicies);
  const { execute: getPolicy } = useAPICall(policyService.getPolicy);
  const { execute: updatePolicy } = useAPICall(policyService.updatePolicy);
  const { execute: resetToDefaults } = useAPICall(policyService.resetToDefaults);
  const { execute: seedDefaults } = useAPICall(policyService.seedDefaults);

  return { loading, error, listPolicies, getPolicy, updatePolicy, resetToDefaults, seedDefaults };
}
