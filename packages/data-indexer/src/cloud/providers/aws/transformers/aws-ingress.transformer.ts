/**
 * AWS Ingress Transformer
 *
 * Converts raw ingress fetch output (CloudFront, ALB, API Gateway, WAF)
 * into typed, sanitised GraphNode objects.
 *
 * Security:
 *   - All raw values are coerced to primitives only — no objects stored directly.
 *   - Tag values are truncated to 256 chars to prevent oversized payloads.
 *   - ARNs are normalised to lower-case for consistent deduplication.
 *   - data Classification: ingress endpoints → 'internal'; WAF → 'confidential'.
 */

import * as crypto from 'crypto';
import {
  AWSIngressGraph,
  CloudFrontDistributionNode,
  ALBNode,
  ALBListenerNode,
  ALBTargetGroupNode,
  APIGatewayRestApiNode,
  APIGatewayV2ApiNode,
  WAFWebACLNode,
  AnyGraphNode,
} from '@batta/shared';

const MAX_TAG_VALUE_LEN = 256;

// ============================================================================
// Public surface
// ============================================================================

export function transformAWSIngressGraph(
  ingressGraph: AWSIngressGraph,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  for (const d of ingressGraph.cloudFrontDistributions) {
    const node: CloudFrontDistributionNode = {
      id: awsNodeId(tenantId, d.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'CloudFrontDistribution',
      providerResourceId: d.arn.toLowerCase(),
      displayName: d.domainName || d.id,
      region: 'global',
      tags: sanitizeTags({}),
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      domainName: String(d.domainName ?? '').toLowerCase(),
      aliases: (d.aliases ?? []).map(a => String(a).toLowerCase()),
      origins: (d.origins ?? []).map(o => ({
        id: String(o.id ?? ''),
        domainName: String(o.domainName ?? '').toLowerCase(),
        protocol: String(o.originProtocolPolicy ?? 'https-only'),
      })),
      wafWebAclId: d.webAclId ? String(d.webAclId).toLowerCase() : undefined,
      priceClass: String(d.priceClass ?? ''),
      enabled: d.enabled === true,
    };
    nodes.push(node);
  }

  for (const alb of ingressGraph.albs) {
    const node: ALBNode = {
      id: awsNodeId(tenantId, alb.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'ALB',
      providerResourceId: alb.arn.toLowerCase(),
      displayName: alb.name || alb.dnsName,
      region: alb.region,
      tags: sanitizeTags(alb.tags),
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      dnsName: String(alb.dnsName ?? '').toLowerCase(),
      scheme: (alb.scheme === 'internet-facing' ? 'internet-facing' : 'internal'),
      vpcId: String(alb.vpcId ?? '').toLowerCase(),
      subnetIds: (alb.availabilityZones ?? []).map(az => String(az.subnetId ?? '').toLowerCase()),
      securityGroupIds: (alb.securityGroups ?? []).map(s => String(s).toLowerCase()),
      type: (['application', 'network', 'gateway'].includes(alb.type) ? alb.type : 'application') as 'application' | 'network' | 'gateway',
    };
    nodes.push(node);
  }

  for (const listener of ingressGraph.albListeners) {
    const node: ALBListenerNode = {
      id: awsNodeId(tenantId, listener.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'ALBListener',
      providerResourceId: listener.arn.toLowerCase(),
      displayName: `${listener.protocol}:${listener.port}`,
      region: 'unknown', // listeners inherit region from ALB
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      albArn: String(listener.loadBalancerArn ?? '').toLowerCase(),
      port: Number(listener.port ?? 0),
      protocol: String(listener.protocol ?? ''),
      sslPolicy: listener.sslPolicy ?? undefined,
      defaultAction: String(listener.defaultActions?.[0]?.type ?? ''),
    };
    nodes.push(node);
  }

  for (const tg of ingressGraph.albTargetGroups) {
    const node: ALBTargetGroupNode = {
      id: awsNodeId(tenantId, tg.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'ALBTargetGroup',
      providerResourceId: tg.arn.toLowerCase(),
      displayName: tg.name,
      region: 'unknown',
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      protocol: String(tg.protocol ?? ''),
      port: Number(tg.port ?? 0),
      targetType: (['instance', 'ip', 'lambda', 'alb'].includes(tg.targetType) ? tg.targetType : 'instance') as 'instance' | 'ip' | 'lambda' | 'alb',
      vpcId: tg.vpcId ? String(tg.vpcId).toLowerCase() : undefined,
      healthCheckPath: tg.healthCheckPath ?? undefined,
    };
    nodes.push(node);
  }

  for (const api of ingressGraph.apiGatewayRestApis) {
    const node: APIGatewayRestApiNode = {
      id: awsNodeId(tenantId, `arn:aws:apigateway:${api.region}::restapis/${api.id}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'APIGatewayRestApi',
      providerResourceId: `arn:aws:apigateway:${api.region}::restapis/${api.id}`.toLowerCase(),
      displayName: api.name || api.id,
      region: api.region,
      tags: sanitizeTags(api.tags),
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      endpointTypes: api.endpointConfiguration?.types ?? [],
      vpcEndpointIds: api.endpointConfiguration?.vpcEndpointIds ?? undefined,
    };
    nodes.push(node);
  }

  for (const api of ingressGraph.apiGatewayV2Apis) {
    const node: APIGatewayV2ApiNode = {
      id: awsNodeId(tenantId, `arn:aws:apigateway:${api.region}::apis/${api.apiId}`),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'APIGatewayV2Api',
      providerResourceId: `arn:aws:apigateway:${api.region}::apis/${api.apiId}`.toLowerCase(),
      displayName: api.name || api.apiId,
      region: api.region,
      tags: sanitizeTags(api.tags),
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      protocolType: (api.protocolType === 'WEBSOCKET' ? 'WEBSOCKET' : 'HTTP'),
      apiEndpoint: String(api.apiEndpoint ?? '').toLowerCase(),
      corsEnabled: !!(api.corsConfiguration?.allowOrigins?.length),
    };
    nodes.push(node);
  }

  for (const acl of ingressGraph.wafWebAcls) {
    const node: WAFWebACLNode = {
      id: awsNodeId(tenantId, acl.arn),
      tenantId,
      cloudProvider: 'aws',
      nodeType: 'WAFWebACL',
      providerResourceId: acl.arn.toLowerCase(),
      displayName: acl.name,
      region: acl.region,
      tags: {},
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      scope: acl.scope === 'CLOUDFRONT' ? 'CLOUDFRONT' : 'REGIONAL',
      capacity: Number(acl.capacity ?? 0),
      managedRuleGroupCount: (acl.rules ?? []).filter((r: any) => r.Statement?.ManagedRuleGroupStatement).length,
      customRuleCount: (acl.rules ?? []).filter((r: any) => !r.Statement?.ManagedRuleGroupStatement).length,
    };
    nodes.push(node);
  }

  return nodes;
}

// ============================================================================
// Helpers
// ============================================================================

export function awsNodeId(tenantId: string, arn: string): string {
  const key = `tenantId=${tenantId}|entityType=aws_resource|resourceId=${arn.toLowerCase()}`;
  return `aws_resource:${crypto.createHash('sha256').update(key).digest('hex').substring(0, 16)}`;
}

function sanitizeTags(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof k === 'string' && typeof v === 'string') {
      result[k] = v.substring(0, MAX_TAG_VALUE_LEN);
    }
  }
  return result;
}
