import { useCallback } from 'react';
import type { ScanOptions, ScanRecord } from '../types/';
import * as assetService from '../services/assets/assetService';
import { useAuth } from './useAuth';
import { useAPICall } from './useAPICall';

export function useAssets() {
  const { acquireToken } = useAuth();

  const { loading, error, execute: getAssetCategories } = useAPICall(assetService.getAssetCategories);
  const { execute: getAssetsByCategory } = useAPICall(assetService.getAssetsByCategory);
  const { execute: getAssetById } = useAPICall(assetService.getAssetById);
  const { execute: getAssetRelationships } = useAPICall(assetService.getAssetRelationships);
  const { execute: getAssetExploitability } = useAPICall(assetService.getAssetExploitability);
  const { execute: startScan } = useAPICall(assetService.triggerScan);
  const { execute: deleteAllAssets } = useAPICall(assetService.deleteAllAssets);
  const { execute: getRepositoryArtifacts } = useAPICall(assetService.getRepositoryArtifacts);

  const getScanStatus = useCallback(async (scanId: string): Promise<ScanRecord> => {
    try {
      return await assetService.getScanStatus(acquireToken, scanId);
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : 'Failed to fetch scan status');
    }
  }, [acquireToken]);

  const getScanHistory = useCallback(async (): Promise<ScanRecord[]> => {
    try {
      return await assetService.listScans(acquireToken);
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : 'Failed to fetch scan history');
    }
  }, [acquireToken]);

  const listRepositories = useCallback(async () => {
    try {
      return await assetService.listRepositories(acquireToken);
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : 'Failed to list repositories');
    }
  }, [acquireToken]);

  const streamScan = useCallback(
    (
      options: ScanOptions,
      onUpdate: (record: ScanRecord) => void,
      onError: (message: string) => void
    ): (() => void) => {
      return assetService.streamScan(acquireToken, options, onUpdate, onError);
    },
    [acquireToken]
  );

  const pollScanUntilDone = useCallback(
    (scanId: string, onUpdate: (record: ScanRecord) => void): (() => void) => {
      return assetService.pollScanUntilDone(acquireToken, scanId, onUpdate);
    },
    [acquireToken]
  );

  return {
    loading,
    error,
    getAssetCategories,
    getAssetsByCategory,
    getAssetById,
    getAssetRelationships,
    getAssetExploitability,
    startScan,
    getScanStatus,
    getScanHistory,
    listRepositories,
    streamScan,
    pollScanUntilDone,
    deleteAllAssets,
    getRepositoryArtifacts,
  };
}
