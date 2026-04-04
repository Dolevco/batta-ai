/**
 * Connector Types and Interfaces
 * 
 * Common types used across all connectors
 */

import { CanonicalEntity, Evidence } from '@ai-agent/shared';

/**
 * Discovery result from a connector
 */
export interface DiscoveryResult {
  entities: CanonicalEntity[];
  evidence: Evidence[];
  summary: DiscoverySummary;
}

/**
 * Summary of what was discovered
 */
export interface DiscoverySummary {
  entitiesDiscovered: number;
  evidenceCreated: number;
  resourceTypes: Record<string, number>;
  duration: number;
  errors: string[];
  warnings: string[];
}

/**
 * Base connector interface
 */
export interface Connector {
  /**
   * Connector name
   */
  name: string;

  /**
   * Discover and return entities and evidence
   * Note: tenantId is provided during connector construction
   */
  discover(): Promise<DiscoveryResult>;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;
}
