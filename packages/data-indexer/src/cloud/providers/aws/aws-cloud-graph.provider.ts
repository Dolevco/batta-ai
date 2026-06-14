/**
 * AWS Cloud Graph Provider
 *
 * Implements CloudGraphProvider for AWS using:
 *   - aws-config.fetcher   (AWS Config Advanced Query — primary inventory, ARG equivalent)
 *   - aws-ingress.fetcher  (CloudFront, ALB, API Gateway, WAF — topology detail)
 *   - aws-network.fetcher  (VPC, subnets, security groups, VPC endpoints, peerings)
 *   - aws-identity.fetcher (IAM roles, instance profiles, EC2, Lambda, ECS)
 *
 * Authentication (credential provider chain, in order):
 *   1. STS AssumeRole — when roleArn is configured (cross-account hub-spoke)
 *   2. Environment variables — AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *   3. IRSA / EC2 instance profile — automatic SDK resolution
 *
 * Least-privilege:
 *   - Required: AWSConfigUserAccess + SecurityAudit + EC2ReadOnly + CloudFrontReadOnly
 *     + ELBReadOnly + APIGatewayReadOnly + WAFReadOnly + IAMReadOnly
 *   - No write permissions are ever requested.
 *
 * Security:
 *   - Credentials are never stored beyond the SDK credential object lifetime.
 *   - STS tokens are refreshed automatically by the SDK credential provider.
 *   - Error bodies from AWS APIs are never propagated — only error codes.
 */

import { fromTemporaryCredentials, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, Provider } from '@aws-sdk/types';
import type {
  CloudProvider,
  RawResourceBatch,
  AWSIngressGraph,
  AWSNetworkTopology,
  AWSIdentityGraph,
} from '@batta/shared';
import { CloudGraphProvider, ProviderScope } from '../../cloud-graph-provider.interface';
import { fetchAWSConfigResources } from './fetchers/aws-config.fetcher';
import { fetchAWSIngressGraph } from './fetchers/aws-ingress.fetcher';
import { fetchAWSNetworkTopology } from './fetchers/aws-network.fetcher';
import { fetchAWSIdentityGraph } from './fetchers/aws-identity.fetcher';
import { AWSFetchError } from './fetchers/aws-ingress.fetcher';
import { transformConfigResources } from './transformers/aws-config.transformer';

export interface AWSCloudGraphConfig {
  accountIds: string[];
  regions: string[];
  /** ARN of the cross-account role to assume. Omit to use the ambient credential chain. */
  roleArn?: string;
  /** ExternalId for third-party assume-role security. */
  externalId?: string;
  /**
   * Name of an existing AWS Config Aggregator.  When set, fetchResources() issues
   * a single SelectAggregateResourceConfig query instead of per-account-per-region
   * queries — significantly faster for large multi-account environments.
   */
  configAggregatorName?: string;
}

export class AWSCloudGraphProvider implements CloudGraphProvider {
  readonly cloudProvider: CloudProvider = 'aws';

  constructor(private readonly config: AWSCloudGraphConfig) {}

  // ============================================================================
  // CloudGraphProvider interface
  // ============================================================================

  /**
   * Primary inventory — uses AWS Config Advanced Query (the ARG equivalent).
   * Returns all resource types across all configured accounts and regions.
   * When configAggregatorName is set, a single cross-account aggregator query
   * is used; otherwise falls back to per-account per-region queries.
   */
  async fetchResources(scope: ProviderScope): Promise<RawResourceBatch> {
    if (scope.provider !== 'aws') {
      throw new AWSFetchError('fetchResources', 'WRONG_PROVIDER');
    }
    const { accountIds, regions } = scope;
    const raw = await fetchAWSConfigResources(
      accountIds,
      regions,
      this.getCredentialProvider.bind(this),
      this.config.configAggregatorName,
    );
    const resources = transformConfigResources(raw);
    return { resources };
  }

  async fetchIngressGraph(scope: ProviderScope): Promise<AWSIngressGraph> {
    if (scope.provider !== 'aws') {
      throw new AWSFetchError('fetchIngressGraph', 'WRONG_PROVIDER');
    }
    const { accountIds, regions } = scope;
    return fetchAWSIngressGraph(accountIds, regions, this.getCredentialProvider.bind(this));
  }

  async fetchNetworkTopology(scope: ProviderScope): Promise<AWSNetworkTopology> {
    if (scope.provider !== 'aws') {
      throw new AWSFetchError('fetchNetworkTopology', 'WRONG_PROVIDER');
    }
    const { accountIds, regions } = scope;
    return fetchAWSNetworkTopology(accountIds, regions, this.getCredentialProvider.bind(this));
  }

  async fetchIdentityGraph(scope: ProviderScope): Promise<AWSIdentityGraph> {
    if (scope.provider !== 'aws') {
      throw new AWSFetchError('fetchIdentityGraph', 'WRONG_PROVIDER');
    }
    const { accountIds, regions } = scope;
    return fetchAWSIdentityGraph(accountIds, regions, this.getCredentialProvider.bind(this));
  }

  // ============================================================================
  // Credential resolution — never stores credentials beyond provider lifetime
  // ============================================================================

  /**
   * Returns a credential provider for the given account.
   * When roleArn is configured, uses STS AssumeRole (cross-account).
   * Otherwise falls back to the default Node.js credential provider chain
   * (IRSA → instance profile → env vars).
   */
  getCredentialProvider(accountId: string): Provider<AwsCredentialIdentity> {
    if (this.config.roleArn) {
      // Interpolate account ID into the role ARN if it contains the placeholder
      const resolvedArn = this.config.roleArn.includes('{accountId}')
        ? this.config.roleArn.replace('{accountId}', accountId)
        : this.config.roleArn;

      return fromTemporaryCredentials({
        params: {
          RoleArn: resolvedArn,
          RoleSessionName: `batta-ai-discovery-${accountId}`,
          ...(this.config.externalId && { ExternalId: this.config.externalId }),
          DurationSeconds: 3600,
        },
        clientConfig: { region: 'us-east-1' },
      });
    }

    return fromNodeProviderChain();
  }
}
