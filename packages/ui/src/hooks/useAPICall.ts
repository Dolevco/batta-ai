import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';

type AcquireToken = () => Promise<string | null>;

/**
 * Generic async hook factory for authenticated API calls.
 * Wraps any service function that accepts an acquireToken as its first arg,
 * exposing loading + error state and a stable execute callback.
 *
 * Usage:
 *   const { loading, error, execute: getAssets } = useAPICall(assetService.getAll);
 */
export function useAPICall<TArgs extends unknown[], TResult>(
  fn: (acquireToken: AcquireToken, ...args: TArgs) => Promise<TResult>
): {
  loading: boolean;
  error: string | null;
  execute: (...args: TArgs) => Promise<TResult>;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { acquireToken } = useAuth();

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setLoading(true);
      setError(null);
      try {
        return await fn(acquireToken, ...args);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acquireToken, fn]
  );

  return { loading, error, execute };
}
