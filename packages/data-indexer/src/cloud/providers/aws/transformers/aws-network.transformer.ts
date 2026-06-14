/**
 * AWS Network Transformer
 *
 * Converts raw AWS network fetch output (VPCs, subnets, security groups,
 * VPC endpoints, peerings, NAT gateways) into typed, sanitised GraphNode objects.
 *
 * Security:
 *   - CIDR blocks are stored as-is (needed for internet-exposure derivation).
 *   - Security group rule CIDRs are stored with classification 'confidential'.
 *   - No IP addresses from individual EC2 instances are stored here.
 */

import {
  AWSNetworkTopology,
  VPCNode,
  AWSSubnetNode,
  SecurityGroupNode,
  SecurityGroupRule,
  VPCEndpointNode,
  VPCPeeringNode,
  NATGatewayNode,
  AnyGraphNode,
} from '@batta/shared';
import { awsNodeId } from './aws-ingress.transformer';

// ============================================================================
// Public surface
// ============================================================================

export function transformAWSNetworkTopology(
  topology: AWSNetworkTopology,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  for (const vpc of topology.vpcs) {
    const node: VPCNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${vpc.region}:${vpc.accountId}:vpc/${vpc.vpcId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'VPC',
      providerResourceId: `arn:aws:ec2:${vpc.region}:${vpc.accountId}:vpc/${vpc.vpcId}`.toLowerCase(),
      displayName: vpc.tags['Name'] || vpc.vpcId,
      region: vpc.region,
      tags: sanitizeTags(vpc.tags),
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      cidrBlock: vpc.cidrBlock,
      additionalCidrs: (vpc.cidrBlockAssociationSet ?? []).map(a => a.cidrBlock).filter(c => c !== vpc.cidrBlock),
      isDefault: vpc.isDefault ?? false,
      enableDnsSupport: vpc.enableDnsSupport ?? true,
      enableDnsHostnames: vpc.enableDnsHostnames ?? false,
    };
    nodes.push(node);
  }

  for (const subnet of topology.subnets) {
    const node: AWSSubnetNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${subnet.region}:${subnet.accountId}:subnet/${subnet.subnetId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'AWSSubnet',
      providerResourceId: `arn:aws:ec2:${subnet.region}:${subnet.accountId}:subnet/${subnet.subnetId}`.toLowerCase(),
      displayName: subnet.tags['Name'] || subnet.subnetId,
      region: subnet.region,
      tags: sanitizeTags(subnet.tags),
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      vpcId: `arn:aws:ec2:${subnet.region}:${subnet.accountId}:vpc/${subnet.vpcId}`.toLowerCase(),
      cidrBlock: subnet.cidrBlock,
      availabilityZone: subnet.availabilityZone,
      mapPublicIpOnLaunch: subnet.mapPublicIpOnLaunch ?? false,
    };
    nodes.push(node);
  }

  for (const sg of topology.securityGroups) {
    const node: SecurityGroupNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${sg.region}:${sg.accountId}:security-group/${sg.groupId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'SecurityGroup',
      providerResourceId: `arn:aws:ec2:${sg.region}:${sg.accountId}:security-group/${sg.groupId}`.toLowerCase(),
      displayName: sg.groupName || sg.groupId,
      region: sg.region,
      tags: sanitizeTags(sg.tags),
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      vpcId: `arn:aws:ec2:${sg.region}:${sg.accountId}:vpc/${sg.vpcId}`.toLowerCase(),
      inboundRules: sg.inboundRules.map(r => transformSGRule(r)),
      outboundRules: sg.outboundRules.map(r => transformSGRule(r)),
    };
    nodes.push(node);
  }

  for (const ep of topology.vpcEndpoints) {
    if (ep.state !== 'available' && ep.state !== 'pending') continue;
    const node: VPCEndpointNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${ep.region}:${ep.accountId}:vpc-endpoint/${ep.vpcEndpointId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'VPCEndpoint',
      providerResourceId: `arn:aws:ec2:${ep.region}:${ep.accountId}:vpc-endpoint/${ep.vpcEndpointId}`.toLowerCase(),
      displayName: ep.serviceName.split('.').slice(-2).join('.') || ep.vpcEndpointId,
      region: ep.region,
      tags: sanitizeTags(ep.tags),
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      vpcId: `arn:aws:ec2:${ep.region}:${ep.accountId}:vpc/${ep.vpcId}`.toLowerCase(),
      serviceName: ep.serviceName,
      endpointType: (['Interface', 'Gateway', 'GatewayLoadBalancer'].includes(ep.vpcEndpointType)
        ? ep.vpcEndpointType : 'Interface') as 'Interface' | 'Gateway' | 'GatewayLoadBalancer',
      subnetIds: ep.subnetIds.map(s => `arn:aws:ec2:${ep.region}:${ep.accountId}:subnet/${s}`.toLowerCase()),
      privateDnsEnabled: ep.privateDnsEnabled ?? false,
    };
    nodes.push(node);
  }

  for (const p of topology.vpcPeerings) {
    if (p.status !== 'active') continue;
    const node: VPCPeeringNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${p.region}::vpc-peering-connection/${p.vpcPeeringConnectionId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'VPCPeering',
      providerResourceId: `arn:aws:ec2:${p.region}::vpc-peering-connection/${p.vpcPeeringConnectionId}`.toLowerCase(),
      displayName: p.vpcPeeringConnectionId,
      region: p.region,
      tags: {},
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      requesterVpcId: p.requesterVpcId,
      requesterAccountId: p.requesterAccountId,
      accepterVpcId: p.accepterVpcId,
      accepterAccountId: p.accepterAccountId,
      status: p.status,
    };
    nodes.push(node);
  }

  for (const ng of topology.natGateways) {
    const node: NATGatewayNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${ng.region}:${ng.accountId}:natgateway/${ng.natGatewayId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'NATGateway',
      providerResourceId: `arn:aws:ec2:${ng.region}:${ng.accountId}:natgateway/${ng.natGatewayId}`.toLowerCase(),
      displayName: ng.tags['Name'] || ng.natGatewayId,
      region: ng.region,
      tags: sanitizeTags(ng.tags),
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      vpcId: `arn:aws:ec2:${ng.region}:${ng.accountId}:vpc/${ng.vpcId}`.toLowerCase(),
      subnetId: `arn:aws:ec2:${ng.region}:${ng.accountId}:subnet/${ng.subnetId}`.toLowerCase(),
      natType: ng.connectivityType === 'private' ? 'private' : 'public',
      elasticIpId: ng.natGatewayAddresses?.[0]?.allocationId ?? undefined,
    };
    nodes.push(node);
  }

  return nodes;
}

// ============================================================================
// Helpers
// ============================================================================

function transformSGRule(raw: {
  protocol: string;
  fromPort: number;
  toPort: number;
  ipRanges: string[];
  prefixListIds: string[];
  userIdGroupPairs: { groupId: string; description?: string }[];
}): SecurityGroupRule {
  const pairs = raw.userIdGroupPairs ?? [];
  return {
    protocol: String(raw.protocol ?? '-1'),
    fromPort: Number(raw.fromPort ?? -1),
    toPort: Number(raw.toPort ?? -1),
    cidrRanges: (raw.ipRanges ?? []).map(c => String(c)),
    prefixListIds: (raw.prefixListIds ?? []).map(p => String(p)),
    referencedGroupIds: pairs.length > 0 ? pairs.map(p => p.groupId) : undefined,
    description: pairs[0]?.description ?? undefined,
  };
}

function sanitizeTags(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof k === 'string' && typeof v === 'string') {
      result[k] = v.substring(0, 256);
    }
  }
  return result;
}
