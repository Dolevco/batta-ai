/**
 * AWS Network Fetcher
 *
 * Fetches VPCs, subnets, security groups, VPC endpoints, VPC peering connections,
 * and NAT gateways across all configured accounts and regions.
 *
 * Security:
 *   - Credential providers are passed in; this fetcher never requests credentials.
 *   - Raw AWS API error bodies are never propagated — only error codes.
 */

import pLimit from 'p-limit';
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcPeeringConnectionsCommand,
  DescribeNatGatewaysCommand,
  type Vpc,
  type Subnet,
  type SecurityGroup,
  type VpcEndpoint,
  type VpcPeeringConnection,
  type NatGateway,
} from '@aws-sdk/client-ec2';
import type { Provider, AwsCredentialIdentity } from '@aws-sdk/types';
import {
  AWSNetworkTopology,
  RawVPC,
  RawAWSSubnet,
  RawSecurityGroup,
  RawVPCEndpoint,
  RawVPCPeering,
  RawNATGateway,
} from '@batta/shared';
import { AWSFetchError } from './aws-ingress.fetcher';

type CredentialProviderFn = (accountId: string) => Provider<AwsCredentialIdentity>;

// ============================================================================
// Public surface
// ============================================================================

export async function fetchAWSNetworkTopology(
  accountIds: string[],
  regions: string[],
  getCredentials: CredentialProviderFn,
): Promise<AWSNetworkTopology> {
  const limit = pLimit(5);

  const results = await Promise.all(
    accountIds.map(accountId =>
      limit(() => fetchNetworkForAccount(accountId, regions, getCredentials(accountId))),
    ),
  );

  return mergeNetworkTopologies(results);
}

// ============================================================================
// Per-account network fetch
// ============================================================================

async function fetchNetworkForAccount(
  accountId: string,
  regions: string[],
  credentials: Provider<AwsCredentialIdentity>,
): Promise<AWSNetworkTopology> {
  const regionLimit = pLimit(5);

  const results = await Promise.all(
    regions.map(region =>
      regionLimit(() => fetchNetworkForRegion(accountId, region, credentials)),
    ),
  );

  return mergeNetworkTopologies(results);
}

async function fetchNetworkForRegion(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<AWSNetworkTopology> {
  const [vpcs, subnets, securityGroups, vpcEndpoints, vpcPeerings, natGateways] = await Promise.all([
    fetchVPCs(accountId, region, credentials).catch(() => [] as RawVPC[]),
    fetchSubnets(accountId, region, credentials).catch(() => [] as RawAWSSubnet[]),
    fetchSecurityGroups(accountId, region, credentials).catch(() => [] as RawSecurityGroup[]),
    fetchVPCEndpoints(accountId, region, credentials).catch(() => [] as RawVPCEndpoint[]),
    fetchVPCPeerings(accountId, region, credentials).catch(() => [] as RawVPCPeering[]),
    fetchNATGateways(accountId, region, credentials).catch(() => [] as RawNATGateway[]),
  ]);

  return { vpcs, subnets, securityGroups, vpcEndpoints, vpcPeerings, natGateways };
}

// ============================================================================
// VPCs
// ============================================================================

async function fetchVPCs(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawVPC[]> {
  const client = new EC2Client({ region, credentials });
  const vpcs: RawVPC[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeVpcsCommand({ NextToken: nextToken }));
    } catch (err: any) {
      throw new AWSFetchError('VPC', err.name ?? 'UNKNOWN');
    }

    for (const vpc of (response.Vpcs ?? []) as Vpc[]) {
      vpcs.push({
        vpcId: vpc.VpcId ?? '',
        cidrBlock: vpc.CidrBlock ?? '',
        cidrBlockAssociationSet: (vpc.CidrBlockAssociationSet ?? []).map(a => ({
          cidrBlock: a.CidrBlock ?? '',
        })),
        isDefault: vpc.IsDefault ?? false,
        enableDnsSupport: true, // requires DescribeVpcAttribute — default to true
        enableDnsHostnames: false, // requires DescribeVpcAttribute — default to false
        region,
        accountId,
        tags: tagsToRecord(vpc.Tags),
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return vpcs;
}

// ============================================================================
// Subnets
// ============================================================================

async function fetchSubnets(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawAWSSubnet[]> {
  const client = new EC2Client({ region, credentials });
  const subnets: RawAWSSubnet[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeSubnetsCommand({ NextToken: nextToken }));
    } catch (err: any) {
      throw new AWSFetchError('Subnet', err.name ?? 'UNKNOWN');
    }

    for (const s of (response.Subnets ?? []) as Subnet[]) {
      subnets.push({
        subnetId: s.SubnetId ?? '',
        vpcId: s.VpcId ?? '',
        cidrBlock: s.CidrBlock ?? '',
        availabilityZone: s.AvailabilityZone ?? '',
        mapPublicIpOnLaunch: s.MapPublicIpOnLaunch ?? false,
        region,
        accountId,
        tags: tagsToRecord(s.Tags),
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return subnets;
}

// ============================================================================
// Security Groups
// ============================================================================

async function fetchSecurityGroups(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawSecurityGroup[]> {
  const client = new EC2Client({ region, credentials });
  const groups: RawSecurityGroup[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeSecurityGroupsCommand({ NextToken: nextToken }));
    } catch (err: any) {
      throw new AWSFetchError('SecurityGroup', err.name ?? 'UNKNOWN');
    }

    for (const sg of (response.SecurityGroups ?? []) as SecurityGroup[]) {
      groups.push({
        groupId: sg.GroupId ?? '',
        groupName: sg.GroupName ?? '',
        vpcId: sg.VpcId ?? '',
        inboundRules: (sg.IpPermissions ?? []).map(p => ({
          protocol: p.IpProtocol ?? '-1',
          fromPort: p.FromPort ?? -1,
          toPort: p.ToPort ?? -1,
          ipRanges: (p.IpRanges ?? []).map(r => r.CidrIp ?? '').filter(Boolean),
          prefixListIds: (p.PrefixListIds ?? []).map(pl => pl.PrefixListId ?? '').filter(Boolean),
          userIdGroupPairs: (p.UserIdGroupPairs ?? []).map(g => ({
            groupId: g.GroupId ?? '',
            description: g.Description ?? undefined,
          })),
        })),
        outboundRules: (sg.IpPermissionsEgress ?? []).map(p => ({
          protocol: p.IpProtocol ?? '-1',
          fromPort: p.FromPort ?? -1,
          toPort: p.ToPort ?? -1,
          ipRanges: (p.IpRanges ?? []).map(r => r.CidrIp ?? '').filter(Boolean),
          prefixListIds: (p.PrefixListIds ?? []).map(pl => pl.PrefixListId ?? '').filter(Boolean),
          userIdGroupPairs: (p.UserIdGroupPairs ?? []).map(g => ({ groupId: g.GroupId ?? '' })),
        })),
        region,
        accountId,
        tags: tagsToRecord(sg.Tags),
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return groups;
}

// ============================================================================
// VPC Endpoints
// ============================================================================

async function fetchVPCEndpoints(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawVPCEndpoint[]> {
  const client = new EC2Client({ region, credentials });
  const endpoints: RawVPCEndpoint[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeVpcEndpointsCommand({ NextToken: nextToken }));
    } catch (err: any) {
      console.warn(`[AWS Network] VPC endpoints fetch failed in ${accountId}/${region}: ${err.name ?? 'UNKNOWN'}`);
      return endpoints;
    }

    for (const ep of (response.VpcEndpoints ?? []) as VpcEndpoint[]) {
      endpoints.push({
        vpcEndpointId: ep.VpcEndpointId ?? '',
        vpcId: ep.VpcId ?? '',
        serviceName: ep.ServiceName ?? '',
        vpcEndpointType: ep.VpcEndpointType ?? 'Interface',
        subnetIds: ep.SubnetIds ?? [],
        privateDnsEnabled: ep.PrivateDnsEnabled ?? false,
        state: ep.State ?? '',
        region,
        accountId,
        tags: tagsToRecord(ep.Tags),
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return endpoints;
}

// ============================================================================
// VPC Peerings
// ============================================================================

async function fetchVPCPeerings(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawVPCPeering[]> {
  const client = new EC2Client({ region, credentials });
  const peerings: RawVPCPeering[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeVpcPeeringConnectionsCommand({ NextToken: nextToken }));
    } catch (err: any) {
      console.warn(`[AWS Network] VPC peerings fetch failed in ${accountId}/${region}: ${err.name ?? 'UNKNOWN'}`);
      return peerings;
    }

    for (const p of (response.VpcPeeringConnections ?? []) as VpcPeeringConnection[]) {
      peerings.push({
        vpcPeeringConnectionId: p.VpcPeeringConnectionId ?? '',
        requesterVpcId: p.RequesterVpcInfo?.VpcId ?? '',
        requesterAccountId: p.RequesterVpcInfo?.OwnerId ?? '',
        accepterVpcId: p.AccepterVpcInfo?.VpcId ?? '',
        accepterAccountId: p.AccepterVpcInfo?.OwnerId ?? '',
        status: p.Status?.Code ?? '',
        region,
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return peerings;
}

// ============================================================================
// NAT Gateways
// ============================================================================

async function fetchNATGateways(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawNATGateway[]> {
  const client = new EC2Client({ region, credentials });
  const gateways: RawNATGateway[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeNatGatewaysCommand({ NextToken: nextToken }));
    } catch (err: any) {
      console.warn(`[AWS Network] NAT gateways fetch failed in ${accountId}/${region}: ${err.name ?? 'UNKNOWN'}`);
      return gateways;
    }

    for (const ng of (response.NatGateways ?? []) as NatGateway[]) {
      gateways.push({
        natGatewayId: ng.NatGatewayId ?? '',
        vpcId: ng.VpcId ?? '',
        subnetId: ng.SubnetId ?? '',
        connectivityType: ng.ConnectivityType ?? 'public',
        natGatewayAddresses: (ng.NatGatewayAddresses ?? []).map(a => ({
          allocationId: a.AllocationId ?? undefined,
        })),
        region,
        accountId,
        tags: tagsToRecord(ng.Tags),
      });
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return gateways;
}

// ============================================================================
// Helpers
// ============================================================================

function tagsToRecord(tags?: { Key?: string; Value?: string }[]): Record<string, string> {
  if (!tags) return {};
  const result: Record<string, string> = {};
  for (const t of tags) {
    if (t.Key && typeof t.Value === 'string') result[t.Key] = t.Value;
  }
  return result;
}

function mergeNetworkTopologies(topologies: AWSNetworkTopology[]): AWSNetworkTopology {
  return {
    vpcs: topologies.flatMap(t => t.vpcs),
    subnets: topologies.flatMap(t => t.subnets),
    securityGroups: topologies.flatMap(t => t.securityGroups),
    vpcEndpoints: topologies.flatMap(t => t.vpcEndpoints),
    vpcPeerings: topologies.flatMap(t => t.vpcPeerings),
    natGateways: topologies.flatMap(t => t.natGateways),
  };
}
