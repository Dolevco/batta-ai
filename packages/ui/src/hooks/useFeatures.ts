import * as featureService from '../services/features/featureService';
import { useAPICall } from './useAPICall';

export function useFeatures() {
  const { loading, error, execute: listFeatures } = useAPICall(featureService.listFeatures);
  const { execute: getFeatureById } = useAPICall(featureService.getFeatureById);
  const { execute: getArchitectureDoc } = useAPICall(featureService.getArchitectureDoc);

  return { loading, error, listFeatures, getFeatureById, getArchitectureDoc };
}
