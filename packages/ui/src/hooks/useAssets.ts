import { useState, useCallback } from 'react';
import type { Asset, AssetCategory, RepositoryArtifacts, ScanOptions, ScanRecord, ScanRepositoryInfo } from '../types';
import * as assetService from '../services/assetService';
import { useAuth } from './useAuth';

export function useAssets() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const getAssetCategories = useCallback(async (): Promise<AssetCategory[]> => {
    setLoading(true);
    setError(null);
    try {
      const categories = await assetService.getAssetCategories(acquireToken);
      return categories;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch asset categories';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getAssetsByCategory = useCallback(async (category: string): Promise<Asset[]> => {
    setLoading(true);
    setError(null);
    try {
      const assets = await assetService.getAssetsByCategory(acquireToken, category);
      return assets;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch assets';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getAssetById = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const asset = await assetService.getAssetById(acquireToken, id);
      return asset;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch asset details';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getAssetRelationships = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const relationships = await assetService.getAssetRelationships(acquireToken, id);
      return relationships;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch asset relationships';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const startScan = useCallback(async (options: ScanOptions): Promise<{ scanId: string; status: string; message: string }> => {
    setLoading(true);
    setError(null);
    try {
      return await assetService.triggerScan(acquireToken, options);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to start scan';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [acquireToken]);

  const getScanStatus = useCallback(async (scanId: string): Promise<ScanRecord> => {
    try {
      return await assetService.getScanStatus(acquireToken, scanId);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to fetch scan status');
    }
  }, [acquireToken]);

  const getScanHistory = useCallback(async (): Promise<ScanRecord[]> => {
    try {
      return await assetService.listScans(acquireToken);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to fetch scan history');
    }
  }, [acquireToken]);

  const listRepositories = useCallback(async (): Promise<ScanRepositoryInfo[]> => {
    try {
      return await assetService.listRepositories(acquireToken);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to list repositories');
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

  const getRepositoryArtifacts = useCallback(async (repositoryId: string): Promise<RepositoryArtifacts> => {
    try {
      return await assetService.getRepositoryArtifacts(acquireToken, repositoryId);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to get repository artifacts');
    }
  }, [acquireToken]);

  const getAssetExploitability = useCallback(async (id: string) => {
    try {
      return await assetService.getAssetExploitability(acquireToken, id);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to fetch exploitability analysis');
    }
  }, [acquireToken]);

  const deleteAllAssets = useCallback(async (): Promise<void> => {
    try {
      await assetService.deleteAllAssets(acquireToken);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete assets');
    }
  }, [acquireToken]);

  const pollScanUntilDone = useCallback(
    (
      scanId: string,
      onUpdate: (record: ScanRecord) => void
    ): (() => void) => {
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
