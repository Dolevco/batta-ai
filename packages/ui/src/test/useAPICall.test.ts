import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAPICall } from '../hooks/useAPICall';

// Minimal AuthContext mock
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ acquireToken: vi.fn().mockResolvedValue('test-token') }),
}));

type AcquireToken = () => Promise<string | null>;

describe('useAPICall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with loading=false and no error', () => {
    const fn = vi.fn<[AcquireToken], Promise<void>>();
    const { result } = renderHook(() => useAPICall(fn));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=true during execution and false after', async () => {
    let resolve!: (value: string) => void;
    const fn = vi.fn<[AcquireToken], Promise<string>>(
      () => new Promise<string>(r => { resolve = r; })
    );

    const { result } = renderHook(() => useAPICall(fn));

    let execPromise!: Promise<string>;
    act(() => {
      execPromise = result.current.execute();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve('done');
      await execPromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('returns the resolved value', async () => {
    const fn = vi.fn<[AcquireToken], Promise<string>>().mockResolvedValue('hello');
    const { result } = renderHook(() => useAPICall(fn));

    let value!: string;
    await act(async () => {
      value = await result.current.execute();
    });

    expect(value).toBe('hello');
    expect(result.current.error).toBeNull();
  });

  it('sets error state and rethrows on failure', async () => {
    const fn = vi.fn<[AcquireToken], Promise<void>>().mockRejectedValue(new Error('oops'));
    const { result } = renderHook(() => useAPICall(fn));

    await act(async () => {
      await result.current.execute().catch(() => {});
    });

    expect(result.current.error).toBe('oops');
    expect(result.current.loading).toBe(false);
  });
});
