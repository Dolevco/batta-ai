/**
 * AWS Identity Transformer
 *
 * Converts raw IAM roles, instance profiles, EC2 instances, Lambda functions,
 * and ECS services into typed, sanitised GraphNode objects.
 *
 * Security:
 *   - IAM policy documents are never stored in graph nodes — only principal types.
 *   - Role ARNs stored in nodes but not logged.
 *   - Private IP addresses stored in EC2 nodes with 'confidential' classification.
 *   - Public IP addresses stored only when present (they're already public knowledge).
 */

import {
  AWSIdentityGraph,
  IAMRoleNode,
  IAMInstanceProfileNode,
  EC2InstanceNode,
  LambdaFunctionNode,
  ECSServiceNode,
  AnyGraphNode,
} from '@batta/shared';
import { awsNodeId } from './aws-ingress.transformer';

// ============================================================================
// Public surface
// ============================================================================

export function transformAWSIdentityGraph(
  identityGraph: AWSIdentityGraph,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  for (const role of identityGraph.iamRoles) {
    const node: IAMRoleNode = {
      id: awsNodeId(tenantId, role.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'IAMRole',
      providerResourceId: role.arn.toLowerCase(),
      displayName: role.roleName,
      region: 'global',
      tags: sanitizeTags(role.tags),
      indexedAt,
      dataClassification: 'restricted',
      internetExposed: false,
      roleArn: role.arn.toLowerCase(),
      trustedPrincipalTypes: role.trustedPrincipalTypes ?? [],
      attachedPolicies: (role.attachedPolicies ?? []).map(p => p.policyName),
      maxSessionDuration: Number(role.maxSessionDuration ?? 3600),
    };
    nodes.push(node);
  }

  for (const ip of identityGraph.instanceProfiles) {
    const node: IAMInstanceProfileNode = {
      id: awsNodeId(tenantId, ip.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'IAMInstanceProfile',
      providerResourceId: ip.arn.toLowerCase(),
      displayName: ip.instanceProfileName,
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'restricted',
      internetExposed: false,
      instanceProfileArn: ip.arn.toLowerCase(),
      roleArns: (ip.roles ?? []).map(r => r.arn.toLowerCase()),
    };
    nodes.push(node);
  }

  for (const inst of identityGraph.ec2Instances) {
    const node: EC2InstanceNode = {
      id: awsNodeId(tenantId, `arn:aws:ec2:${inst.region}:${inst.accountId}:instance/${inst.instanceId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'EC2Instance',
      providerResourceId: `arn:aws:ec2:${inst.region}:${inst.accountId}:instance/${inst.instanceId}`.toLowerCase(),
      displayName: inst.tags['Name'] || inst.instanceId,
      region: inst.region,
      tags: sanitizeTags(inst.tags),
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      instanceType: String(inst.instanceType ?? ''),
      subnetId: `arn:aws:ec2:${inst.region}:${inst.accountId}:subnet/${inst.subnetId}`.toLowerCase(),
      vpcId: `arn:aws:ec2:${inst.region}:${inst.accountId}:vpc/${inst.vpcId}`.toLowerCase(),
      privateIpAddress: String(inst.privateIpAddress ?? ''),
      publicIpAddress: inst.publicIpAddress ? String(inst.publicIpAddress) : undefined,
      iamInstanceProfileArn: inst.iamInstanceProfile?.arn?.toLowerCase() ?? undefined,
      securityGroupIds: (inst.securityGroups ?? []).map(sg =>
        `arn:aws:ec2:${inst.region}:${inst.accountId}:security-group/${sg.groupId}`.toLowerCase(),
      ),
    };
    nodes.push(node);
  }

  for (const fn of identityGraph.lambdaFunctions) {
    const node: LambdaFunctionNode = {
      id: awsNodeId(tenantId, fn.functionArn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'LambdaFunction',
      providerResourceId: fn.functionArn.toLowerCase(),
      displayName: fn.functionName,
      region: fn.region,
      tags: sanitizeTags(fn.tags),
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      runtime: String(fn.runtime ?? ''),
      handler: String(fn.handler ?? ''),
      roleArn: String(fn.role ?? '').toLowerCase(),
      vpcId: fn.vpcConfig?.vpcId
        ? `arn:aws:ec2:${fn.region}:${fn.accountId}:vpc/${fn.vpcConfig.vpcId}`.toLowerCase()
        : undefined,
      subnetIds: fn.vpcConfig?.subnetIds?.map(s =>
        `arn:aws:ec2:${fn.region}:${fn.accountId}:subnet/${s}`.toLowerCase(),
      ) ?? undefined,
      securityGroupIds: fn.vpcConfig?.securityGroupIds?.map(s =>
        `arn:aws:ec2:${fn.region}:${fn.accountId}:security-group/${s}`.toLowerCase(),
      ) ?? undefined,
    };
    nodes.push(node);
  }

  for (const svc of identityGraph.ecsServices) {
    const netConfig = svc.networkConfiguration?.awsvpcConfiguration;
    const node: ECSServiceNode = {
      id: awsNodeId(tenantId, svc.serviceArn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'ECSService',
      providerResourceId: svc.serviceArn.toLowerCase(),
      displayName: svc.serviceName,
      region: svc.region,
      tags: sanitizeTags(svc.tags),
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      clusterArn: String(svc.clusterArn ?? '').toLowerCase(),
      taskDefinitionArn: String(svc.taskDefinition ?? '').toLowerCase(),
      launchType: (['EC2', 'FARGATE', 'EXTERNAL'].includes(svc.launchType) ? svc.launchType : 'EC2') as 'EC2' | 'FARGATE' | 'EXTERNAL',
      vpcId: undefined, // resolved during graph build from subnet → VPC
      subnetIds: netConfig?.subnets?.map(s =>
        `arn:aws:ec2:${svc.region}:${svc.accountId}:subnet/${s}`.toLowerCase(),
      ) ?? undefined,
      securityGroupIds: netConfig?.securityGroups?.map(s =>
        `arn:aws:ec2:${svc.region}:${svc.accountId}:security-group/${s}`.toLowerCase(),
      ) ?? undefined,
    };
    nodes.push(node);
  }

  return nodes;
}

// ============================================================================
// Helpers
// ============================================================================

function sanitizeTags(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof k === 'string' && typeof v === 'string') {
      result[k] = v.substring(0, 256);
    }
  }
  return result;
}
