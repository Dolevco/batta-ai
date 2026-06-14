/**
 * AWS Ingress Fetcher
 *
 * Fetches CloudFront distributions, ALBs, API Gateway REST + HTTP APIs,
 * and WAFv2 Web ACLs across all configured accounts and regions.
 *
 * Security:
 *   - Credential providers are passed in; this fetcher never requests credentials.
 *   - Raw AWS API error bodies are never propagated — only error codes.
 *   - Concurrency per account+region pair bounded to 5 via p-limit.
 *
 * Global services (CloudFront, WAF CLOUDFRONT scope) are fetched once per account
 * from us-east-1, regardless of the configured regions list.
 */

import pLimit from 'p-limit';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  type DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeListenersCommand,
  DescribeTargetGroupsCommand,
  type LoadBalancer,
  type Listener,
  type TargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  APIGatewayClient,
  GetRestApisCommand,
} from '@aws-sdk/client-api-gateway';
import {
  ApiGatewayV2Client,
  GetApisCommand,
} from '@aws-sdk/client-apigatewayv2';
import {
  WAFV2Client,
  ListWebACLsCommand,
  type WebACLSummary,
} from '@aws-sdk/client-wafv2';
import type { Provider } from '@aws-sdk/types';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import {
  AWSIngressGraph,
  RawCloudFrontDistribution,
  RawALB,
  RawALBListener,
  RawALBTargetGroup,
  RawAPIGatewayRestApi,
  RawAPIGatewayV2Api,
  RawWAFWebACL,
} from '@batta/shared';

// ============================================================================
// Error type — never includes raw AWS response bodies
// ============================================================================

export class AWSFetchError extends Error {
  constructor(
    readonly resourceType: string,
    readonly errorCode: string,
  ) {
    super(`aws:${resourceType} fetch failed (${errorCode})`);
    this.name = 'AWSFetchError';
  }
}

type CredentialProviderFn = (accountId: string) => Provider<AwsCredentialIdentity>;

// ============================================================================
// Public surface
// ============================================================================

export async function fetchAWSIngressGraph(
  accountIds: string[],
  regions: string[],
  getCredentials: CredentialProviderFn,
): Promise<AWSIngressGraph> {
  const limit = pLimit(5);

  const results = await Promise.all(
    accountIds.map(accountId =>
      limit(() => fetchIngressForAccount(accountId, regions, getCredentials(accountId))),
    ),
  );

  return mergeIngressGraphs(results);
}

// ============================================================================
// Per-account ingress fetch
// ============================================================================

async function fetchIngressForAccount(
  accountId: string,
  regions: string[],
  credentials: Provider<AwsCredentialIdentity>,
): Promise<AWSIngressGraph> {
  const regionLimit = pLimit(5);

  // CloudFront and WAF CLOUDFRONT scope are global — fetch once from us-east-1
  const [cfDistributions, globalWafAcls, ...regionalResults] = await Promise.all([
    fetchCloudFrontDistributions(accountId, credentials).catch(err => {
      console.warn(`[AWS] CloudFront fetch failed for account ${accountId}: ${(err as AWSFetchError).errorCode ?? err.message}`);
      return [] as RawCloudFrontDistribution[];
    }),
    fetchWAFWebACLs(accountId, 'us-east-1', 'CLOUDFRONT', credentials).catch(() => [] as RawWAFWebACL[]),
    ...regions.map(region =>
      regionLimit(() => fetchIngressForRegion(accountId, region, credentials)),
    ),
  ]);

  const regional = mergeIngressGraphs(regionalResults);

  return {
    cloudFrontDistributions: cfDistributions,
    albs: regional.albs,
    albListeners: regional.albListeners,
    albTargetGroups: regional.albTargetGroups,
    apiGatewayRestApis: regional.apiGatewayRestApis,
    apiGatewayV2Apis: regional.apiGatewayV2Apis,
    wafWebAcls: [...globalWafAcls, ...regional.wafWebAcls],
  };
}

async function fetchIngressForRegion(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<AWSIngressGraph> {
  const [albs, albListeners, albTargetGroups, restApis, v2Apis, regionalWaf] = await Promise.all([
    fetchALBs(accountId, region, credentials).catch(() => [] as RawALB[]),
    fetchALBListeners(accountId, region, credentials).catch(() => [] as RawALBListener[]),
    fetchALBTargetGroups(accountId, region, credentials).catch(() => [] as RawALBTargetGroup[]),
    fetchAPIGatewayRestApis(accountId, region, credentials).catch(() => [] as RawAPIGatewayRestApi[]),
    fetchAPIGatewayV2Apis(accountId, region, credentials).catch(() => [] as RawAPIGatewayV2Api[]),
    fetchWAFWebACLs(accountId, region, 'REGIONAL', credentials).catch(() => [] as RawWAFWebACL[]),
  ]);

  return {
    cloudFrontDistributions: [],
    albs,
    albListeners,
    albTargetGroups,
    apiGatewayRestApis: restApis,
    apiGatewayV2Apis: v2Apis,
    wafWebAcls: regionalWaf,
  };
}

// ============================================================================
// CloudFront — global service, fetched from us-east-1
// ============================================================================

async function fetchCloudFrontDistributions(
  _accountId: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawCloudFrontDistribution[]> {
  const client = new CloudFrontClient({ region: 'us-east-1', credentials });
  const distributions: RawCloudFrontDistribution[] = [];
  let marker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new ListDistributionsCommand({ Marker: marker }));
    } catch (err: any) {
      throw new AWSFetchError('CloudFrontDistribution', err.name ?? err.$metadata?.httpStatusCode ?? 'UNKNOWN');
    }

    const items: DistributionSummary[] = response.DistributionList?.Items ?? [];
    for (const d of items) {
      distributions.push({
        id: d.Id ?? '',
        arn: d.ARN ?? '',
        domainName: d.DomainName ?? '',
        aliases: d.Aliases?.Items ?? [],
        origins: (d.Origins?.Items ?? []).map(o => ({
          id: o.Id ?? '',
          domainName: o.DomainName ?? '',
          originProtocolPolicy: o.CustomOriginConfig?.OriginProtocolPolicy ?? 'https-only',
        })),
        webAclId: d.WebACLId || undefined,
        priceClass: d.PriceClass ?? '',
        enabled: d.Enabled ?? false,
        region: 'global',
      });
    }

    marker = response.DistributionList?.NextMarker;
  } while (marker);

  return distributions;
}

// ============================================================================
// ALB / NLB
// ============================================================================

async function fetchALBs(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawALB[]> {
  const client = new ElasticLoadBalancingV2Client({ region, credentials });
  const albs: RawALB[] = [];
  let marker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeLoadBalancersCommand({ Marker: marker }));
    } catch (err: any) {
      throw new AWSFetchError('ALB', err.name ?? 'UNKNOWN');
    }

    for (const lb of (response.LoadBalancers ?? []) as LoadBalancer[]) {
      albs.push({
        arn: lb.LoadBalancerArn ?? '',
        name: lb.LoadBalancerName ?? '',
        dnsName: lb.DNSName ?? '',
        scheme: (lb.Scheme as 'internet-facing' | 'internal') ?? 'internal',
        vpcId: lb.VpcId ?? '',
        availabilityZones: (lb.AvailabilityZones ?? []).map(az => ({
          subnetId: az.SubnetId ?? '',
          zoneName: az.ZoneName ?? '',
        })),
        securityGroups: lb.SecurityGroups ?? [],
        type: lb.Type ?? 'application',
        region,
        accountId,
        tags: {},
      });
    }

    marker = response.NextMarker;
  } while (marker);

  return albs;
}

async function fetchALBListeners(
  _accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawALBListener[]> {
  const client = new ElasticLoadBalancingV2Client({ region, credentials });
  const listeners: RawALBListener[] = [];

  // Fetch all load balancers first to get their ARNs
  let lbMarker: string | undefined;
  const lbArns: string[] = [];
  do {
    let lbResp;
    try {
      lbResp = await client.send(new DescribeLoadBalancersCommand({ Marker: lbMarker }));
    } catch {
      return [];
    }
    lbArns.push(...(lbResp.LoadBalancers ?? []).map((lb: LoadBalancer) => lb.LoadBalancerArn ?? '').filter(Boolean));
    lbMarker = lbResp.NextMarker;
  } while (lbMarker);

  const limit = pLimit(5);
  const perLb = await Promise.all(
    lbArns.map(lbArn =>
      limit(async () => {
        let listenerMarker: string | undefined;
        const lbListeners: RawALBListener[] = [];
        do {
          let resp;
          try {
            resp = await client.send(new DescribeListenersCommand({
              LoadBalancerArn: lbArn,
              Marker: listenerMarker,
            }));
          } catch {
            break;
          }
          for (const l of (resp.Listeners ?? []) as Listener[]) {
            lbListeners.push({
              arn: l.ListenerArn ?? '',
              loadBalancerArn: l.LoadBalancerArn ?? '',
              port: l.Port ?? 0,
              protocol: l.Protocol ?? '',
              sslPolicy: l.SslPolicy ?? undefined,
              defaultActions: (l.DefaultActions ?? []).map(a => ({
                type: a.Type ?? '',
                targetGroupArn: a.TargetGroupArn ?? undefined,
              })),
            });
          }
          listenerMarker = resp.NextMarker;
        } while (listenerMarker);
        return lbListeners;
      }),
    ),
  );

  for (const batch of perLb) listeners.push(...batch);
  return listeners;
}

async function fetchALBTargetGroups(
  _accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawALBTargetGroup[]> {
  const client = new ElasticLoadBalancingV2Client({ region, credentials });
  const tgs: RawALBTargetGroup[] = [];
  let marker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeTargetGroupsCommand({ Marker: marker }));
    } catch {
      return tgs;
    }

    for (const tg of (response.TargetGroups ?? []) as TargetGroup[]) {
      tgs.push({
        arn: tg.TargetGroupArn ?? '',
        name: tg.TargetGroupName ?? '',
        protocol: tg.Protocol ?? '',
        port: tg.Port ?? 0,
        targetType: (tg.TargetType as 'instance' | 'ip' | 'lambda' | 'alb') ?? 'instance',
        vpcId: tg.VpcId || undefined,
        healthCheckPath: tg.HealthCheckPath || undefined,
      });
    }

    marker = response.NextMarker;
  } while (marker);

  return tgs;
}

// ============================================================================
// API Gateway v1 (REST)
// ============================================================================

async function fetchAPIGatewayRestApis(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawAPIGatewayRestApi[]> {
  const client = new APIGatewayClient({ region, credentials });
  const apis: RawAPIGatewayRestApi[] = [];
  let position: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new GetRestApisCommand({ position, limit: 500 }));
    } catch {
      return apis;
    }

    for (const api of response.items ?? []) {
      apis.push({
        id: api.id ?? '',
        name: api.name ?? '',
        endpointConfiguration: {
          types: api.endpointConfiguration?.types ?? [],
          vpcEndpointIds: api.endpointConfiguration?.vpcEndpointIds ?? undefined,
        },
        region,
        accountId,
        tags: (api.tags as Record<string, string>) ?? {},
      });
    }

    position = response.position;
  } while (position);

  return apis;
}

// ============================================================================
// API Gateway v2 (HTTP / WebSocket)
// ============================================================================

async function fetchAPIGatewayV2Apis(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawAPIGatewayV2Api[]> {
  const client = new ApiGatewayV2Client({ region, credentials });
  const apis: RawAPIGatewayV2Api[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new GetApisCommand({ NextToken: nextToken, MaxResults: '500' }));
    } catch {
      return apis;
    }

    for (const api of response.Items ?? []) {
      apis.push({
        apiId: api.ApiId ?? '',
        name: api.Name ?? '',
        protocolType: (api.ProtocolType as 'HTTP' | 'WEBSOCKET') ?? 'HTTP',
        apiEndpoint: api.ApiEndpoint ?? '',
        corsConfiguration: api.CorsConfiguration
          ? { allowOrigins: api.CorsConfiguration.AllowOrigins ?? [] }
          : undefined,
        region,
        accountId,
        tags: (api.Tags as Record<string, string>) ?? {},
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return apis;
}

// ============================================================================
// WAF v2
// ============================================================================

async function fetchWAFWebACLs(
  accountId: string,
  region: string,
  scope: 'CLOUDFRONT' | 'REGIONAL',
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawWAFWebACL[]> {
  const client = new WAFV2Client({ region, credentials });
  const acls: RawWAFWebACL[] = [];
  let nextMarker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new ListWebACLsCommand({
        Scope: scope,
        NextMarker: nextMarker,
        Limit: 100,
      }));
    } catch {
      return acls;
    }

    for (const acl of (response.WebACLs ?? []) as WebACLSummary[]) {
      acls.push({
        id: acl.Id ?? '',
        name: acl.Name ?? '',
        arn: acl.ARN ?? '',
        scope,
        capacity: 0, // capacity requires a separate GetWebACL call — omit to avoid throttling
        rules: [],
        region,
        accountId,
      });
    }

    nextMarker = response.NextMarker;
  } while (nextMarker);

  return acls;
}

// ============================================================================
// Merge helpers
// ============================================================================

function mergeIngressGraphs(graphs: AWSIngressGraph[]): AWSIngressGraph {
  return {
    cloudFrontDistributions: graphs.flatMap(g => g.cloudFrontDistributions),
    albs: graphs.flatMap(g => g.albs),
    albListeners: graphs.flatMap(g => g.albListeners),
    albTargetGroups: graphs.flatMap(g => g.albTargetGroups),
    apiGatewayRestApis: graphs.flatMap(g => g.apiGatewayRestApis),
    apiGatewayV2Apis: graphs.flatMap(g => g.apiGatewayV2Apis),
    wafWebAcls: graphs.flatMap(g => g.wafWebAcls),
  };
}
