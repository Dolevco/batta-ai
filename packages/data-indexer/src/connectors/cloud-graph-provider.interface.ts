/**
 * Cloud Graph Provider Interface
 *
 * Defines the contract that every cloud provider (Azure, AWS, GCP) must implement.
 * The graph builder, sanitiser, deduplicator, and persistence layer are
 * provider-agnostic — they depend only on this interface.
 */

import {
  CloudProvider,
  IngressGraph,
  NetworkTopology,
  IdentityGraph,
  RawResourceBatch,
} from '@ai-agent/shared';

// ============================================================================
// Provider scope — typed per cloud
// ============================================================================

export type ProviderScope =
  | { provider: 'azure'; subscriptionIds: string[] }
  | { provider: 'aws'; accountIds: string[]; regions: string[] }
  | { provider: 'gcp'; projectIds: string[] };

// ============================================================================
// Provider interface
// ============================================================================

/**
 * CloudGraphProvider
 *
 * Each implementation is responsible for:
 *   1. Authenticating against its cloud API.
 *   2. Fetching raw resource data as typed batches.
 *   3. NOT transforming or sanitising — that is the transformer's responsibility.
 *
 * Security:
 *   - Credentials are never stored on the provider instance beyond the request.
 *   - Tokens are obtained via the platform's identity mechanism (Managed Identity,
 *     Instance Profile, Workload Identity) — never from code or config files.
 */
export interface CloudGraphProvider {
  readonly cloudProvider: CloudProvider;

  /**
   * Fetch all base resources (compute, storage, networking as a flat list).
   * These map to the existing CloudResource shape and drive the legacy pipeline.
   */
  fetchResources(scope: ProviderScope): Promise<RawResourceBatch>;

  /**
   * Fetch ingress topology: CDN/WAF fronts, load balancers, API gateways with
   * their routing rules.
   */
  fetchIngressGraph(scope: ProviderScope): Promise<IngressGraph>;

  /**
   * Fetch network topology: VNets/VPCs, subnets, peerings, NSG rules,
   * private endpoints, service endpoints, and resource-level firewall rules.
   */
  fetchNetworkTopology(scope: ProviderScope): Promise<NetworkTopology>;

  /**
   * Fetch identity graph: managed identities, service principals, and role
   * assignments.
   */
  fetchIdentityGraph(scope: ProviderScope): Promise<IdentityGraph>;
}
