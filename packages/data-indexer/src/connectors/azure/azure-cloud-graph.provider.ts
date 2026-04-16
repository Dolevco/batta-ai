/**
 * Azure Cloud Graph Provider
 *
 * Implements CloudGraphProvider for Azure using:
 *   - azure-resources.fetcher (base resources — delegates to existing connector)
 *   - azure-ingress.fetcher  (Front Door, TM, APIM, App Gateway)
 *   - azure-network.fetcher  (VNet peerings, NSG rules, Private Link, firewall rules)
 *   - azure-identity.fetcher (MI, SP, role assignments)
 *
 * Authentication:
 *   - The provider obtains its OAuth2 token via the existing credential flow
 *     (client_credentials grant) — credentials come from environment variables,
 *     never from code.
 *   - Tokens are short-lived and refreshed automatically; never persisted to disk.
 *
 * Least-privilege:
 *   - Required roles: Reader + Network Reader on each subscription.
 *   - No write permissions are ever requested.
 */

import { CloudProvider, IngressGraph, NetworkTopology, IdentityGraph, RawResourceBatch } from '@ai-agent/shared';
import { CloudGraphProvider, ProviderScope } from '../cloud-graph-provider.interface';
import { fetchAzureIngressGraph, CloudGraphFetchError } from './fetchers/azure-ingress.fetcher';
import { fetchAzureNetworkTopology } from './fetchers/azure-network.fetcher';
import { fetchAzureIdentityGraph } from './fetchers/azure-identity.fetcher';

export interface AzureCloudGraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class AzureCloudGraphProvider implements CloudGraphProvider {
  readonly cloudProvider: CloudProvider = 'azure';

  private config: AzureCloudGraphConfig;
  private cachedToken?: string;
  private tokenExpiry?: number;

  constructor(config: AzureCloudGraphConfig) {
    this.config = config;
  }

  // ============================================================================
  // CloudGraphProvider interface
  // ============================================================================

  async fetchResources(scope: ProviderScope): Promise<RawResourceBatch> {
    if (scope.provider !== 'azure') throw new CloudGraphFetchError('azure', 'fetchResources', 'WRONG_PROVIDER');
    const token = await this.getToken();
    const subscriptionIds = scope.subscriptionIds;
    const resources = await this.queryAllResources(token, subscriptionIds);
    return { resources };
  }

  async fetchIngressGraph(scope: ProviderScope): Promise<IngressGraph> {
    if (scope.provider !== 'azure') throw new CloudGraphFetchError('azure', 'fetchIngressGraph', 'WRONG_PROVIDER');
    const token = await this.getToken();
    return fetchAzureIngressGraph(token, scope.subscriptionIds);
  }

  async fetchNetworkTopology(scope: ProviderScope): Promise<NetworkTopology> {
    if (scope.provider !== 'azure') throw new CloudGraphFetchError('azure', 'fetchNetworkTopology', 'WRONG_PROVIDER');
    const token = await this.getToken();
    return fetchAzureNetworkTopology(token, scope.subscriptionIds);
  }

  async fetchIdentityGraph(scope: ProviderScope): Promise<IdentityGraph> {
    if (scope.provider !== 'azure') throw new CloudGraphFetchError('azure', 'fetchIdentityGraph', 'WRONG_PROVIDER');
    const token = await this.getToken();
    return fetchAzureIdentityGraph(token, scope.subscriptionIds);
  }

  // ============================================================================
  // Token management — token never persisted beyond in-memory cache
  // ============================================================================

  async getToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const endpoint = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://management.azure.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      // Never include response body — it may contain tenant details.
      throw new CloudGraphFetchError('azure', 'getToken', `HTTP_${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.cachedToken = data.access_token;
    // Subtract 60 s to avoid race conditions at expiry boundary
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60_000;
    return this.cachedToken as string;
  }

  // ============================================================================
  // Resource Graph query — all resource types needed by graph builder
  // ============================================================================

  private async queryAllResources(token: string, subscriptionIds: string[]): Promise<Record<string, any>[]> {
    const query = `
      resources
      | project id, name, type, resourceGroup, location, tags, properties, identity
    `;

    const response = await fetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(subscriptionIds.length > 0 && { subscriptions: subscriptionIds }),
          query,
          options: { resultFormat: 'objectArray' },
        }),
      },
    );

    if (!response.ok) {
      throw new CloudGraphFetchError('azure', 'queryAllResources', `HTTP_${response.status}`);
    }

    const data = await response.json() as { data: Record<string, any>[] };
    return data.data ?? [];
  }
}
