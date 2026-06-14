import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAPICall } from './useAPICall';
import * as capabilityService from '../services/capabilities/capabilityService';
import type { CapabilitiesResponse, Capability } from '../types';

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const { loading, error, execute } = useAPICall(capabilityService.getCapabilities);

  const refresh = useCallback(async () => {
    const next = await execute();
    setCapabilities(next);
    return next;
  }, [execute]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, Capability>();
    capabilities?.capabilities.forEach(capability => map.set(capability.id, capability));
    return map;
  }, [capabilities]);

  return { capabilities, byId, loading, error, refresh };
}
