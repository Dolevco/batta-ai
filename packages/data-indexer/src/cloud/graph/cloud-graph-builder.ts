/**
 * Cloud Graph Builder
 *
 * Assembles a CloudGraph from all fetched and transformed data.
 * This is a pure function — no I/O, no side effects.
 *
 * Steps:
 *  1. Emit INTERNET synthetic node.
 *  2. Emit ingress nodes + routing edges.
 *  3. Emit VNet topology nodes + CONTAINS, PEERED_WITH, PROTECTED_BY edges.
 *  4. Emit private endpoint edges (DEPLOYED_IN, HAS_PRIVATE_ENDPOINT, CONNECTS_TO).
 *  5. Emit firewall rule edges (HAS_FIREWALL_RULE, ACCESSIBLE_FROM, internetExposed flag).
 *  6. Emit identity edges (ASSIGNED_IDENTITY, HAS_ROLE).
 *  7. Derive internet exposure via BFS from INTERNET node.
 *  8. Deduplication pass.
 *
 * Security:
 *  - All nodes arrive pre-sanitised (via node-sanitizer).
 *  - No raw API data is used here.
 *  - SHA-256 via Node.js built-in crypto only.
 */

import * as crypto from 'crypto';
import {
  CloudGraph,
  AnyGraphNode,
  GraphRelationship,
  GraphRelationshipType,
  InternetNode,
  FrontDoorProfileNode,
  FrontDoorEndpointNode,
  FrontDoorRouteNode,
  FrontDoorOriginGroupNode,
  FrontDoorOriginNode,
  TrafficManagerProfileNode,
  TrafficManagerEndpointNode,
  APIManagementServiceNode,
  APIMApiNode,
  APIMBackendNode,
  VirtualNetworkNode,
  SubnetNode,
  NetworkSecurityGroupNode,
  PrivateEndpointNode,
  ManagedIdentityNode,
  ContainerAppNode,
  StorageAccountNode,
  WebAppNode,
  IngressGraph,
  NetworkTopology,
  IdentityGraph,
  RawResourceBatch,
  AWSIngressGraph,
  AWSNetworkTopology,
  AWSIdentityGraph,
  CloudFrontDistributionNode,
  ALBNode,
  ALBListenerNode,
  ALBTargetGroupNode,
  APIGatewayRestApiNode,
  APIGatewayV2ApiNode,
  WAFWebACLNode,
  VPCNode,
  AWSSubnetNode,
  SecurityGroupNode,
  VPCEndpointNode,
  VPCPeeringNode,
  NATGatewayNode,
  IAMRoleNode,
  IAMInstanceProfileNode,
  EC2InstanceNode,
  LambdaFunctionNode,
  ECSServiceNode,
} from '@batta/shared';
import { transformIngressGraph } from '../providers/azure/transformers/azure-ingress.transformer';
import { transformNetworkTopology } from '../providers/azure/transformers/azure-network.transformer';
import { transformIdentityGraph, resolveRoleAssignments } from '../providers/azure/transformers/azure-identity.transformer';
import { transformAWSIngressGraph } from '../providers/aws/transformers/aws-ingress.transformer';
import { transformAWSNetworkTopology } from '../providers/aws/transformers/aws-network.transformer';
import { transformAWSIdentityGraph } from '../providers/aws/transformers/aws-identity.transformer';
import { deduplicateRelationships } from './relationship-deduplicator';

// ============================================================================
// Types
// ============================================================================

export interface CloudGraphBuildInput {
  tenantId: string;
  resources: RawResourceBatch;
  ingressGraph: IngressGraph;
  networkTopology: NetworkTopology;
  identityGraph: IdentityGraph;
}

// ============================================================================
// Builder
// ============================================================================

export class CloudGraphBuilder {
  build(input: CloudGraphBuildInput): CloudGraph {
    const { tenantId, resources, ingressGraph, networkTopology, identityGraph } = input;
    const indexedAt = new Date().toISOString();

    const nodes: AnyGraphNode[] = [];
    const relationships: GraphRelationship[] = [];

    // ── Step 1: INTERNET node ─────────────────────────────────────────────
    const internet: InternetNode = {
      id: 'internet',
      tenantId,
      cloudProvider: 'synthetic',
      nodeType: 'InternetNode',
      providerResourceId: 'internet',
      displayName: 'INTERNET',
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'public',
      internetExposed: true,
    };
    nodes.push(internet);

    // ── Step 2: Ingress ───────────────────────────────────────────────────
    const ingressNodes = transformIngressGraph(ingressGraph, tenantId, indexedAt);
    nodes.push(...ingressNodes);
    relationships.push(...this.buildIngressEdges(internet.id, ingressNodes, tenantId));

    // ── Step 2b: Compute / PaaS nodes (Container Apps, Storage Accounts, Web Apps) ──
    const computeNodes = this.buildComputeNodes(resources.resources, tenantId, indexedAt);
    nodes.push(...computeNodes);

    relationships.push(...this.buildOriginBackendEdges(ingressNodes, computeNodes, resources.resources, tenantId));

    // ── Step 3: Network topology ──────────────────────────────────────────
    const rawVnets = resources.resources.filter(
      r => typeof r.type === 'string' && r.type.toLowerCase() === 'microsoft.network/virtualnetworks',
    );
    const networkNodes = transformNetworkTopology(networkTopology, rawVnets, tenantId, indexedAt);
    nodes.push(...networkNodes);
    relationships.push(...this.buildNetworkEdges(networkNodes, networkTopology, tenantId));

    // ── Step 4: Private endpoint edges ────────────────────────────────────
    relationships.push(...this.buildPrivateEndpointEdges(networkNodes, tenantId));

    // ── Step 5: Firewall rule edges ───────────────────────────────────────
    const { relationships: fwRelationships, updatedNodes } = this.buildFirewallEdges(
      nodes, networkTopology, tenantId,
    );
    relationships.push(...fwRelationships);
    // Apply internetExposed updates from firewall rules
    for (const upd of updatedNodes) {
      const idx = nodes.findIndex(n => n.id === upd.id);
      if (idx >= 0) nodes[idx] = upd;
    }

    // ── Step 6: Identity ──────────────────────────────────────────────────
    const identityNodes = transformIdentityGraph(identityGraph, tenantId, indexedAt);
    nodes.push(...identityNodes);
    relationships.push(...this.buildIdentityEdges(identityNodes, identityGraph, nodes, tenantId));

    // ── Step 7: Compute → Subnet DEPLOYED_IN edges ────────────────────────
    relationships.push(...this.buildComputeSubnetEdges(resources.resources, networkNodes, tenantId));

    // ── Step 8: Derive internet exposure ──────────────────────────────────
    this.deriveInternetExposure(nodes, relationships);

    // ── Step 9: Deduplication ─────────────────────────────────────────────
    const deduped = deduplicateRelationships(relationships);

    return { nodes, relationships: deduped };
  }

  // ============================================================================
  // AWS build entry point
  // ============================================================================

  buildAWS(input: {
    tenantId: string;
    resources: RawResourceBatch;
    ingressGraph: AWSIngressGraph;
    networkTopology: AWSNetworkTopology;
    identityGraph: AWSIdentityGraph;
  }): CloudGraph {
    const { tenantId, ingressGraph, networkTopology, identityGraph } = input;
    const indexedAt = new Date().toISOString();

    const nodes: AnyGraphNode[] = [];
    const relationships: GraphRelationship[] = [];

    // Step 1: INTERNET node (same synthetic node as Azure — shared across providers)
    const internet: InternetNode = {
      id: 'internet',
      tenantId,
      cloudProvider: 'synthetic',
      nodeType: 'InternetNode',
      providerResourceId: 'internet',
      displayName: 'INTERNET',
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'public',
      internetExposed: true,
    };
    nodes.push(internet);

    // Step 2: Ingress nodes + edges
    const ingressNodes = transformAWSIngressGraph(ingressGraph, tenantId, indexedAt);
    nodes.push(...ingressNodes);
    relationships.push(...this.buildAWSIngressEdges(internet.id, ingressNodes, tenantId));

    // Step 3: Network topology nodes + edges
    const networkNodes = transformAWSNetworkTopology(networkTopology, tenantId, indexedAt);
    nodes.push(...networkNodes);
    relationships.push(...this.buildAWSNetworkEdges(networkNodes, networkTopology, tenantId));

    // Step 4: Identity + compute nodes + edges
    const identityNodes = transformAWSIdentityGraph(identityGraph, tenantId, indexedAt);
    nodes.push(...identityNodes);
    relationships.push(...this.buildAWSIdentityEdges(identityNodes, networkNodes, tenantId));

    // Step 5: Internet exposure — public-scheme ALBs and internet-facing CloudFront
    this.deriveAWSInternetExposure(nodes, relationships);

    // Step 6: Deduplication
    const deduped = deduplicateRelationships(relationships);

    return { nodes, relationships: deduped };
  }

  // ============================================================================
  // AWS ingress edges
  // ============================================================================

  private buildAWSIngressEdges(
    internetId: string,
    ingressNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const byType = <T extends AnyGraphNode>(type: string) =>
      ingressNodes.filter((n): n is T => n.nodeType === type);

    // INTERNET → CloudFront (always internet-facing)
    for (const cf of byType<CloudFrontDistributionNode>('CloudFrontDistribution')) {
      rels.push(makeRel(internetId, cf.id, 'ROUTES_TO', tenantId, 'deterministic'));

      // CloudFront → WAFWebACL (PROTECTED_BY)
      if (cf.wafWebAclId) {
        const waf = ingressNodes.find(n => n.nodeType === 'WAFWebACL' && n.providerResourceId.includes(cf.wafWebAclId!));
        if (waf) rels.push(makeRel(cf.id, waf.id, 'PROTECTED_BY', tenantId, 'deterministic'));
      }

      // CloudFront → ALB/origin (DISTRIBUTES_TO) — heuristic by domain name match
      for (const alb of byType<ALBNode>('ALB')) {
        if (cf.origins?.some(o => o.domainName === alb.dnsName)) {
          rels.push(makeRel(cf.id, alb.id, 'DISTRIBUTES_TO', tenantId, 'heuristic'));
        }
      }
    }

    // INTERNET → internet-facing ALBs
    for (const alb of byType<ALBNode>('ALB')) {
      if (alb.scheme === 'internet-facing') {
        rels.push(makeRel(internetId, alb.id, 'ROUTES_TO', tenantId, 'deterministic'));
      }

      // ALB → ALBListener (HAS_LISTENER)
      for (const listener of byType<ALBListenerNode>('ALBListener')) {
        if (listener.albArn === alb.providerResourceId) {
          rels.push(makeRel(alb.id, listener.id, 'HAS_LISTENER', tenantId, 'deterministic'));
        }
      }

      // ALB → WAFWebACL (PROTECTED_BY) — regional WAF
      for (const waf of byType<WAFWebACLNode>('WAFWebACL')) {
        if (waf.scope === 'REGIONAL' && waf.region === alb.region) {
          rels.push(makeRel(alb.id, waf.id, 'PROTECTED_BY', tenantId, 'heuristic'));
        }
      }
    }

    // ALBListener → ALBTargetGroup (FORWARDS_TO)
    for (const listener of byType<ALBListenerNode>('ALBListener')) {
      const listenerAlbArn = listener.albArn;
      for (const tg of byType<ALBTargetGroupNode>('ALBTargetGroup')) {
        // Associate target groups in same VPC — heuristic since we don't have listener rules
        const alb = ingressNodes.find(
          n => n.nodeType === 'ALB' && n.providerResourceId === listenerAlbArn,
        ) as ALBNode | undefined;
        if (alb && tg.vpcId && alb.vpcId === tg.vpcId) {
          rels.push(makeRel(listener.id, tg.id, 'FORWARDS_TO', tenantId, 'heuristic'));
        }
      }
    }

    // INTERNET → public API Gateways (REST APIs with EDGE or REGIONAL endpoint)
    for (const api of byType<APIGatewayRestApiNode>('APIGatewayRestApi')) {
      if (!api.endpointTypes.includes('PRIVATE')) {
        rels.push(makeRel(internetId, api.id, 'ROUTES_TO', tenantId, 'deterministic'));
      }
    }

    // INTERNET → API Gateway v2 (HTTP) — always internet-facing unless in VPC
    for (const api of byType<APIGatewayV2ApiNode>('APIGatewayV2Api')) {
      rels.push(makeRel(internetId, api.id, 'ROUTES_TO', tenantId, 'deterministic'));
    }

    return rels;
  }

  // ============================================================================
  // AWS network edges
  // ============================================================================

  private buildAWSNetworkEdges(
    networkNodes: AnyGraphNode[],
    _topology: AWSNetworkTopology,
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const vpcs = networkNodes.filter((n): n is VPCNode => n.nodeType === 'VPC');
    const subnets = networkNodes.filter((n): n is AWSSubnetNode => n.nodeType === 'AWSSubnet');
    const sgs = networkNodes.filter((n): n is SecurityGroupNode => n.nodeType === 'SecurityGroup');
    const endpoints = networkNodes.filter((n): n is VPCEndpointNode => n.nodeType === 'VPCEndpoint');
    const peerings = networkNodes.filter((n): n is VPCPeeringNode => n.nodeType === 'VPCPeering');
    const natGateways = networkNodes.filter((n): n is NATGatewayNode => n.nodeType === 'NATGateway');

    const vpcById = new Map(vpcs.map(v => [v.providerResourceId, v]));
    const subnetById = new Map(subnets.map(s => [s.providerResourceId, s]));

    // VPC → Subnet (CONTAINS)
    for (const subnet of subnets) {
      const vpc = vpcById.get(subnet.vpcId);
      if (vpc) rels.push(makeRel(vpc.id, subnet.id, 'CONTAINS', tenantId, 'deterministic'));
    }

    // VPC → SecurityGroup (CONTAINS)
    for (const sg of sgs) {
      const vpc = vpcById.get(sg.vpcId);
      if (vpc) rels.push(makeRel(vpc.id, sg.id, 'CONTAINS', tenantId, 'deterministic'));
    }

    // VPC ↔ VPC (PEERED_WITH) — both directions
    for (const peering of peerings) {
      const req = vpcs.find(v => v.providerResourceId.includes(peering.requesterVpcId));
      const acc = vpcs.find(v => v.providerResourceId.includes(peering.accepterVpcId));
      if (req && acc) {
        rels.push(makeRel(req.id, acc.id, 'PEERED_WITH', tenantId, 'deterministic'));
        rels.push(makeRel(acc.id, req.id, 'PEERED_WITH', tenantId, 'deterministic'));
      }
    }

    // VPC → VPCEndpoint (HAS_VPC_ENDPOINT)
    for (const ep of endpoints) {
      const vpc = vpcById.get(ep.vpcId);
      if (vpc) rels.push(makeRel(vpc.id, ep.id, 'HAS_VPC_ENDPOINT', tenantId, 'deterministic'));

      // VPCEndpoint → service (CONNECTS_TO) — modelled via metadata
      rels.push({
        ...makeRel(ep.id, ep.id + '_svc', 'CONNECTS_TO', tenantId, 'deterministic'),
        targetId: ep.id + '_svc',
        metadata: { serviceName: ep.serviceName },
      });

      // VPCEndpoint subnets → DEPLOYED_IN
      for (const subnetId of ep.subnetIds) {
        const subnet = subnetById.get(subnetId);
        if (subnet) rels.push(makeRel(ep.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }
    }

    // VPC → NATGateway (CONTAINS), NATGateway → Subnet (DEPLOYED_IN)
    for (const ng of natGateways) {
      const vpc = vpcById.get(ng.vpcId);
      if (vpc) rels.push(makeRel(vpc.id, ng.id, 'CONTAINS', tenantId, 'deterministic'));
      const subnet = subnetById.get(ng.subnetId);
      if (subnet) rels.push(makeRel(ng.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
    }

    return rels;
  }

  // ============================================================================
  // AWS identity edges
  // ============================================================================

  private buildAWSIdentityEdges(
    identityNodes: AnyGraphNode[],
    networkNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const roles = identityNodes.filter((n): n is IAMRoleNode => n.nodeType === 'IAMRole');
    const profiles = identityNodes.filter((n): n is IAMInstanceProfileNode => n.nodeType === 'IAMInstanceProfile');
    const ec2s = identityNodes.filter((n): n is EC2InstanceNode => n.nodeType === 'EC2Instance');
    const lambdas = identityNodes.filter((n): n is LambdaFunctionNode => n.nodeType === 'LambdaFunction');
    const ecsSvcs = identityNodes.filter((n): n is ECSServiceNode => n.nodeType === 'ECSService');
    const subnets = networkNodes.filter((n): n is AWSSubnetNode => n.nodeType === 'AWSSubnet');
    const sgs = networkNodes.filter((n): n is SecurityGroupNode => n.nodeType === 'SecurityGroup');

    const roleByArn = new Map(roles.map(r => [r.roleArn, r]));
    const subnetById = new Map(subnets.map(s => [s.providerResourceId, s]));
    const sgById = new Map(sgs.map(s => [s.providerResourceId, s]));

    // IAMInstanceProfile → IAMRole (HAS_ROLE)
    for (const profile of profiles) {
      for (const roleArn of profile.roleArns) {
        const role = roleByArn.get(roleArn);
        if (role) rels.push(makeRel(profile.id, role.id, 'HAS_ROLE', tenantId, 'deterministic'));
      }
    }

    // EC2 → IAMInstanceProfile (ASSIGNED_IDENTITY)
    for (const ec2 of ec2s) {
      if (ec2.iamInstanceProfileArn) {
        const profile = profiles.find(p => p.instanceProfileArn === ec2.iamInstanceProfileArn);
        if (profile) rels.push(makeRel(ec2.id, profile.id, 'ASSIGNED_IDENTITY', tenantId, 'deterministic'));
      }

      // EC2 → Subnet (DEPLOYED_IN)
      const subnet = subnetById.get(ec2.subnetId);
      if (subnet) rels.push(makeRel(ec2.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));

      // EC2 → SecurityGroup (PROTECTED_BY)
      for (const sgId of ec2.securityGroupIds) {
        const sg = sgById.get(sgId);
        if (sg) rels.push(makeRel(ec2.id, sg.id, 'PROTECTED_BY', tenantId, 'deterministic'));
      }
    }

    // Lambda → IAMRole (ASSUMES_ROLE)
    for (const fn of lambdas) {
      const role = roleByArn.get(fn.roleArn);
      if (role) rels.push(makeRel(fn.id, role.id, 'ASSUMES_ROLE', tenantId, 'deterministic'));

      // Lambda VPC → Subnet (DEPLOYED_IN)
      for (const subnetId of fn.subnetIds ?? []) {
        const subnet = subnetById.get(subnetId);
        if (subnet) rels.push(makeRel(fn.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }

      // Lambda → SecurityGroup (PROTECTED_BY)
      for (const sgId of fn.securityGroupIds ?? []) {
        const sg = sgById.get(sgId);
        if (sg) rels.push(makeRel(fn.id, sg.id, 'PROTECTED_BY', tenantId, 'deterministic'));
      }
    }

    // ECS Service → Subnet (DEPLOYED_IN), → SecurityGroup (PROTECTED_BY)
    for (const svc of ecsSvcs) {
      for (const subnetId of svc.subnetIds ?? []) {
        const subnet = subnetById.get(subnetId);
        if (subnet) rels.push(makeRel(svc.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }
      for (const sgId of svc.securityGroupIds ?? []) {
        const sg = sgById.get(sgId);
        if (sg) rels.push(makeRel(svc.id, sg.id, 'PROTECTED_BY', tenantId, 'deterministic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // AWS internet-exposure derivation
  // ============================================================================

  private deriveAWSInternetExposure(nodes: AnyGraphNode[], relationships: GraphRelationship[]): void {
    // Mark public-scheme ALBs and their downstream targets
    for (const node of nodes) {
      if (node.nodeType === 'ALB' && (node as ALBNode).scheme === 'internet-facing') {
        (node as AnyGraphNode).internetExposed = true;
      }
      if (node.nodeType === 'CloudFrontDistribution') {
        (node as AnyGraphNode).internetExposed = true;
      }
      if (node.nodeType === 'APIGatewayRestApi') {
        const api = node as APIGatewayRestApiNode;
        if (!api.endpointTypes.includes('PRIVATE')) {
          (node as AnyGraphNode).internetExposed = true;
        }
      }
      if (node.nodeType === 'APIGatewayV2Api') {
        (node as AnyGraphNode).internetExposed = true;
      }
      // Subnets with mapPublicIpOnLaunch are public-facing
      if (node.nodeType === 'AWSSubnet' && (node as AWSSubnetNode).mapPublicIpOnLaunch) {
        (node as AnyGraphNode).internetExposed = true;
      }
      // Security groups allowing 0.0.0.0/0 inbound
      if (node.nodeType === 'SecurityGroup') {
        const sg = node as SecurityGroupNode;
        const hasPublicInbound = sg.inboundRules.some(r => r.cidrRanges.includes('0.0.0.0/0'));
        if (hasPublicInbound) (node as AnyGraphNode).internetExposed = true;
      }
    }

    // BFS propagation from internet-exposed ingress nodes through edges
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();
    const propagatingEdgeTypes = new Set<GraphRelationshipType>([
      'ROUTES_TO', 'DISTRIBUTES_TO', 'HAS_LISTENER', 'FORWARDS_TO',
      'RESOLVES_TO', 'DEPLOYED_IN', 'HAS_BACKEND',
    ]);

    for (const rel of relationships) {
      if (!propagatingEdgeTypes.has(rel.type)) continue;
      if (!adjacency.has(rel.sourceId)) adjacency.set(rel.sourceId, new Set());
      adjacency.get(rel.sourceId)!.add(rel.targetId);
    }

    const queue: string[] = nodes
      .filter(n => n.internetExposed)
      .map(n => n.id);
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (node && !node.internetExposed) (node as AnyGraphNode).internetExposed = true;

      for (const neighbour of adjacency.get(id) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
  }

  // ============================================================================
  // Ingress edges
  // ============================================================================

  private buildIngressEdges(
    internetId: string,
    ingressNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const byType = <T extends AnyGraphNode>(type: string) =>
      ingressNodes.filter((n): n is T => n.nodeType === type);

    // INTERNET → FrontDoorProfile
    for (const fd of byType<FrontDoorProfileNode>('FrontDoorProfile')) {
      rels.push(makeRel(internetId, fd.id, 'ROUTES_TO', tenantId, 'deterministic'));

      // FrontDoorProfile → FrontDoorEndpoint
      for (const ep of byType<FrontDoorEndpointNode>('FrontDoorEndpoint')) {
        if (ep.profileId === fd.providerResourceId.toLowerCase()) {
          rels.push(makeRel(fd.id, ep.id, 'HAS_ENDPOINT', tenantId, 'deterministic'));

          // FrontDoorEndpoint → FrontDoorRoute
          for (const route of byType<FrontDoorRouteNode>('FrontDoorRoute')) {
            if (route.endpointId === ep.providerResourceId.toLowerCase()) {
              rels.push(makeRel(ep.id, route.id, 'HAS_ROUTE', tenantId, 'deterministic'));
            }
          }
        }
      }

      // FrontDoorProfile → FrontDoorOriginGroup
      for (const og of byType<FrontDoorOriginGroupNode>('FrontDoorOriginGroup')) {
        if (og.profileId === fd.providerResourceId.toLowerCase()) {
          rels.push(makeRel(fd.id, og.id, 'HAS_ORIGIN_GROUP', tenantId, 'deterministic'));

          // FrontDoorOriginGroup → FrontDoorOrigin
          for (const origin of byType<FrontDoorOriginNode>('FrontDoorOrigin')) {
            if (origin.originGroupId === og.providerResourceId.toLowerCase()) {
              rels.push(makeRel(og.id, origin.id, 'HAS_ORIGIN', tenantId, 'deterministic'));
            }
          }
        }
      }

      // FrontDoorRoute → FrontDoorOriginGroup (ROUTES_TO)
      for (const route of byType<FrontDoorRouteNode>('FrontDoorRoute')) {
        const og = ingressNodes.find(
          n => n.nodeType === 'FrontDoorOriginGroup' &&
               n.providerResourceId.toLowerCase() === route.originGroupId,
        );
        if (og) {
          rels.push(makeRel(route.id, og.id, 'ROUTES_TO', tenantId, 'deterministic'));
        }
      }
    }

    // INTERNET → TrafficManagerProfile
    for (const tm of byType<TrafficManagerProfileNode>('TrafficManagerProfile')) {
      rels.push(makeRel(internetId, tm.id, 'ROUTES_TO', tenantId, 'deterministic'));

      // TrafficManagerProfile → TrafficManagerEndpoint
      for (const ep of byType<TrafficManagerEndpointNode>('TrafficManagerEndpoint')) {
        if (ep.profileId === tm.providerResourceId.toLowerCase()) {
          rels.push(makeRel(tm.id, ep.id, 'ROUTES_TO', tenantId, 'deterministic'));
        }
      }
    }

    // INTERNET → APIManagementService (when not internal VNet)
    for (const apim of byType<APIManagementServiceNode>('APIManagementService')) {
      if (apim.vnetType === 'None' || apim.vnetType === 'External') {
        rels.push(makeRel(internetId, apim.id, 'ROUTES_TO', tenantId, 'deterministic'));
      }

      // APIManagementService → APIMApi
      for (const api of byType<APIMApiNode>('APIMApi')) {
        if (api.apimServiceId === apim.providerResourceId.toLowerCase()) {
          rels.push(makeRel(apim.id, api.id, 'EXPOSES_API', tenantId, 'deterministic'));
        }
      }

      // APIMApi → APIMBackend (match by service — all backends belong to the service)
      for (const backend of byType<APIMBackendNode>('APIMBackend')) {
        if (backend.apimServiceId === apim.providerResourceId.toLowerCase()) {
          // Associate backends with all APIs in this service (conservative approach)
          for (const api of byType<APIMApiNode>('APIMApi')) {
            if (api.apimServiceId === apim.providerResourceId.toLowerCase()) {
              rels.push(makeRel(api.id, backend.id, 'HAS_BACKEND', tenantId, 'heuristic'));
            }
          }
        }
      }
    }

    return rels;
  }

  // ============================================================================
  // Compute / PaaS nodes — Container Apps, Storage Accounts, Web Apps
  // ============================================================================

  /**
   * Build first-class graph nodes for compute/PaaS resources that may be referenced
   * as Front Door or Traffic Manager backends. Only minimal, non-secret fields are
   * stored. All values are null-coerced from the unvalidated raw API response.
   *
   * Security: raw values are coerced to string/number/boolean primitives only;
   * no objects or arrays are stored directly, preventing prototype pollution.
   */
  private buildComputeNodes(
    rawResources: Record<string, any>[],
    tenantId: string,
    indexedAt: string,
  ): AnyGraphNode[] {
    const nodes: AnyGraphNode[] = [];

    for (const r of rawResources) {
      // Defensive: all field accesses null-coerced to prevent prototype pollution from raw API data
      const type = String(r.type ?? '').toLowerCase();
      const id: string = String(r.id ?? '');
      if (!id) continue;

      const base = {
        id: cloudResourceEntityId(tenantId, id),
        tenantId,
        cloudProvider: 'azure' as const,
        providerResourceId: id.toLowerCase(),
        displayName: String(r.name ?? id),
        region: String(r.location ?? ''),
        tags: sanitizeTags(r.tags),
        indexedAt,
        dataClassification: 'confidential' as const,
        internetExposed: false,
      };

      if (type === 'microsoft.app/containerapps') {
        const props = r.properties ?? {};
        const ingress = props.configuration?.ingress ?? {};
        const fqdn = String(ingress.fqdn ?? '').toLowerCase();
        const node: ContainerAppNode = {
          ...base,
          nodeType: 'ContainerApp',
          fqdn,
          environmentId: String(props.environmentId ?? '').toLowerCase(),
          externalIngress: ingress.external === true,
          targetPort: Number(ingress.targetPort ?? 0),
        };
        nodes.push(node);

      } else if (type === 'microsoft.storage/storageaccounts') {
        const props = r.properties ?? {};
        const endpoints = props.primaryEndpoints ?? {};
        const staticWebHostname = safeHostname(String(endpoints.web ?? ''));
        const blobHostname = safeHostname(String(endpoints.blob ?? ''));
        const node: StorageAccountNode = {
          ...base,
          nodeType: 'StorageAccount',
          staticWebHostname,
          blobHostname,
          sku: String(r.sku?.name ?? ''),
          kind: String(r.kind ?? ''),
          staticWebsiteEnabled: !!(props.staticWebsite?.enabled),
        };
        nodes.push(node);

      } else if (type === 'microsoft.web/sites') {
        const props = r.properties ?? {};
        const node: WebAppNode = {
          ...base,
          nodeType: 'WebApp',
          defaultHostname: String(props.defaultHostName ?? '').toLowerCase(),
          kind: String(r.kind ?? ''),
          vnetSubnetId: props.virtualNetworkSubnetId
            ? String(props.virtualNetworkSubnetId).toLowerCase()
            : undefined,
        };
        nodes.push(node);
      }
    }

    return nodes;
  }

  // ============================================================================
  // Origin → backend resource edges
  // ============================================================================

  private buildOriginBackendEdges(
    ingressNodes: AnyGraphNode[],
    computeNodes: AnyGraphNode[],
    rawResources: Record<string, any>[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    // Build hostname → graph node ID index from first-class compute nodes.
    // This allows Front Door origin hostnames to resolve directly to ContainerApp,
    // StorageAccount, or WebApp nodes in the graph.
    const hostToNodeId = new Map<string, string>();

    for (const node of computeNodes) {
      if (node.nodeType === 'ContainerApp') {
        const n = node as ContainerAppNode;
        if (n.fqdn) hostToNodeId.set(n.fqdn, n.id);
      } else if (node.nodeType === 'StorageAccount') {
        const n = node as StorageAccountNode;
        if (n.staticWebHostname) hostToNodeId.set(n.staticWebHostname, n.id);
        if (n.blobHostname) hostToNodeId.set(n.blobHostname, n.id);
      } else if (node.nodeType === 'WebApp') {
        const n = node as WebAppNode;
        if (n.defaultHostname) hostToNodeId.set(n.defaultHostname, n.id);
      }
    }

    // Also retain legacy cloud_resource fallback for any resource types not yet promoted to
    // first-class graph nodes, so existing edges are not broken.
    const hostToLegacyNodeId = new Map<string, string>();
    for (const r of rawResources) {
      const type = String(r.type ?? '').toLowerCase();
      const id: string = String(r.id ?? '');
      if (!id) continue;

      if (type === 'microsoft.app/containerapps') {
        const fqdn = String(r.properties?.configuration?.ingress?.fqdn ?? '').toLowerCase();
        if (fqdn && !hostToNodeId.has(fqdn)) hostToLegacyNodeId.set(fqdn, id);
      }
      if (type === 'microsoft.web/sites') {
        const h = String(r.properties?.defaultHostName ?? '').toLowerCase();
        if (h && !hostToNodeId.has(h)) hostToLegacyNodeId.set(h, id);
      }
      if (type === 'microsoft.storage/storageaccounts') {
        const webH = safeHostname(String(r.properties?.primaryEndpoints?.web ?? ''));
        if (webH && !hostToNodeId.has(webH)) hostToLegacyNodeId.set(webH, id);
        const blobH = safeHostname(String(r.properties?.primaryEndpoints?.blob ?? ''));
        if (blobH && !hostToNodeId.has(blobH)) hostToLegacyNodeId.set(blobH, id);
      }
    }

    // FrontDoorOrigin → backend graph node (RESOLVES_TO)
    for (const origin of ingressNodes.filter((n): n is FrontDoorOriginNode => n.nodeType === 'FrontDoorOrigin')) {
      const hostname = String(origin.hostName ?? '').toLowerCase();
      if (!hostname) continue;

      const graphNodeId = hostToNodeId.get(hostname);
      if (graphNodeId) {
        // Preferred: resolved to a first-class compute/PaaS graph node
        rels.push(makeRel(origin.id, graphNodeId, 'RESOLVES_TO', tenantId, 'deterministic'));
      } else {
        const legacyArmId = hostToLegacyNodeId.get(hostname);
        if (legacyArmId) {
          // Fallback: resolve to legacy cloud_resource entity for backward compatibility
          const backendNodeId = cloudResourceEntityId(tenantId, legacyArmId);
          rels.push(makeRel(origin.id, backendNodeId, 'RESOLVES_TO', tenantId, 'heuristic'));
        }
      }
    }

    // APIMBackend → backend graph node (RESOLVES_TO) when URL hostname matches a compute node
    for (const backend of ingressNodes.filter((n): n is APIMBackendNode => n.nodeType === 'APIMBackend')) {
      const backendHost = safeHostname(backend.url ?? '');
      if (!backendHost) continue;
      const graphNodeId = hostToNodeId.get(backendHost);
      if (graphNodeId) {
        rels.push(makeRel(backend.id, graphNodeId, 'RESOLVES_TO', tenantId, 'heuristic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // Network edges
  // ============================================================================

  private buildNetworkEdges(
    networkNodes: AnyGraphNode[],
    topology: NetworkTopology,
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const vnets = networkNodes.filter((n): n is VirtualNetworkNode => n.nodeType === 'VirtualNetwork');
    const subnets = networkNodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet');
    const nsgs = networkNodes.filter((n): n is NetworkSecurityGroupNode => n.nodeType === 'NetworkSecurityGroup');
    const vnetIndex = new Map(vnets.map(v => [v.providerResourceId, v]));
    const nsgIndex = new Map(nsgs.map(n => [n.providerResourceId, n]));

    // VirtualNetwork → Subnet (CONTAINS)
    for (const subnet of subnets) {
      const vnet = vnetIndex.get(subnet.vnetId) ??
        // Fallback: match by prefix of VNet ID
        [...vnetIndex.values()].find(v => subnet.providerResourceId.toLowerCase().startsWith(v.providerResourceId + '/'));
      if (vnet) {
        rels.push(makeRel(vnet.id, subnet.id, 'CONTAINS', tenantId, 'deterministic'));
      }

      // Subnet → NSG (PROTECTED_BY)
      if (subnet.nsgId) {
        const nsg = nsgIndex.get(subnet.nsgId) ??
          [...nsgIndex.values()].find(n => n.providerResourceId.toLowerCase() === subnet.nsgId);
        if (nsg) {
          rels.push(makeRel(subnet.id, nsg.id, 'PROTECTED_BY', tenantId, 'deterministic'));
        }
      }

      // Subnet → service type (HAS_SERVICE_ENDPOINT)
      for (const se of topology.serviceEndpoints) {
        if (se.subnetId.toLowerCase() === subnet.providerResourceId.toLowerCase()) {
          rels.push({
            ...makeRel(subnet.id, subnet.id, 'HAS_SERVICE_ENDPOINT', tenantId, 'deterministic'),
            // Override targetId with a synthetic value; metadata carries the service name
            targetId: subnet.id,
            metadata: { service: se.service },
          });
        }
      }
    }

    // VNet ↔ VNet (PEERED_WITH) — emit both directions
    for (const peering of topology.vnetPeerings) {
      if (peering.peeringState !== 'Connected') continue;
      const srcVnet = [...vnetIndex.values()].find(
        v => v.providerResourceId.toLowerCase() === peering.vnetId.toLowerCase(),
      );
      const dstVnet = [...vnetIndex.values()].find(
        v => v.providerResourceId.toLowerCase() === peering.remoteVnetId.toLowerCase(),
      );
      if (srcVnet && dstVnet) {
        rels.push(makeRel(srcVnet.id, dstVnet.id, 'PEERED_WITH', tenantId, 'deterministic', {
          allowGatewayTransit: peering.allowGatewayTransit,
          allowForwardedTraffic: peering.allowForwardedTraffic,
          useRemoteGateways: peering.useRemoteGateways,
        }));
        rels.push(makeRel(dstVnet.id, srcVnet.id, 'PEERED_WITH', tenantId, 'deterministic', {
          allowGatewayTransit: peering.allowGatewayTransit,
          allowForwardedTraffic: peering.allowForwardedTraffic,
          useRemoteGateways: peering.useRemoteGateways,
        }));
      }
    }

    return rels;
  }

  // ============================================================================
  // Private endpoint edges
  // ============================================================================

  private buildPrivateEndpointEdges(
    networkNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];
    const privateEndpoints = networkNodes.filter((n): n is PrivateEndpointNode => n.nodeType === 'PrivateEndpoint');
    const subnetIndex = new Map(
      networkNodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet')
        .map(s => [s.providerResourceId, s]),
    );

    for (const pe of privateEndpoints) {
      // PrivateEndpoint → Subnet (DEPLOYED_IN)
      const subnet = subnetIndex.get(pe.subnetId.toLowerCase()) ??
        [...subnetIndex.values()].find(s => s.providerResourceId.toLowerCase() === pe.subnetId.toLowerCase());
      if (subnet) {
        rels.push(makeRel(pe.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }

      // PaaS resource → PrivateEndpoint (HAS_PRIVATE_ENDPOINT)
      // The target resource ID is an ARM path; we emit the relationship using it as the source ID.
      // If the target node exists in the graph, it will resolve. If not, the edge is still emitted.
      if (pe.targetResourceId) {
        const targetNodeId = cloudResourceEntityId(tenantId, pe.targetResourceId);
        rels.push(makeRel(targetNodeId, pe.id, 'HAS_PRIVATE_ENDPOINT', tenantId, 'deterministic'));
        // CONNECTS_TO is the reverse semantic: PE connects to the PaaS resource
        rels.push(makeRel(pe.id, targetNodeId, 'CONNECTS_TO', tenantId, 'deterministic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // Firewall rule edges + internet exposure derivation from firewall rules
  // ============================================================================

  private buildFirewallEdges(
    nodes: AnyGraphNode[],
    topology: NetworkTopology,
    tenantId: string,
  ): { relationships: GraphRelationship[]; updatedNodes: AnyGraphNode[] } {
    const rels: GraphRelationship[] = [];
    const updatedNodes: AnyGraphNode[] = [];

    const subnetIndex = new Map(
      nodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet')
        .map(s => [s.providerResourceId, s]),
    );

    for (const fw of topology.firewallRules) {
      const resourceNodeId = cloudResourceEntityId(tenantId, fw.id);

      // HAS_FIREWALL_RULE (stored in edge metadata, no separate node)
      rels.push({
        id: relId(tenantId, 'HAS_FIREWALL_RULE', resourceNodeId, resourceNodeId + '_fw'),
        tenantId,
        type: 'HAS_FIREWALL_RULE',
        sourceId: resourceNodeId,
        targetId: resourceNodeId + '_fw', // synthetic target for inline rule
        confidence: 'deterministic',
        metadata: {
          defaultAction: fw.defaultAction,
          ipRules: fw.ipRules,
          vnetRules: fw.vnetRules,
          bypass: fw.bypass,
        },
      });

      // Derive internet exposure
      if (fw.defaultAction === 'Allow') {
        const node = nodes.find(n => n.id === resourceNodeId);
        if (node) {
          updatedNodes.push({ ...node, internetExposed: true });
        }
      } else {
        // Check if any IP rule is 0.0.0.0/0
        const hasPublicIpRule = fw.ipRules.some(r => r.value === '0.0.0.0/0');
        if (hasPublicIpRule) {
          const node = nodes.find(n => n.id === resourceNodeId);
          if (node) {
            updatedNodes.push({ ...node, internetExposed: true });
          }
        }
      }

      // ACCESSIBLE_FROM — heuristic: match vnet rules to subnets
      for (const vnetRule of fw.vnetRules) {
        const subnetId = vnetRule.id ?? vnetRule.vnetId ?? '';
        const subnet = [...subnetIndex.values()].find(
          s => s.providerResourceId.toLowerCase() === subnetId.toLowerCase(),
        );
        if (subnet) {
          rels.push(makeRel(resourceNodeId, subnet.id, 'ACCESSIBLE_FROM', tenantId, 'heuristic'));
        }
      }
    }

    return { relationships: rels, updatedNodes };
  }

  // ============================================================================
  // Identity edges
  // ============================================================================

  private buildIdentityEdges(
    identityNodes: AnyGraphNode[],
    identityGraph: IdentityGraph,
    _allNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];
    const miIndex = new Map(
      identityNodes.filter((n): n is ManagedIdentityNode => n.nodeType === 'ManagedIdentity')
        .map(m => [m.principalId, m]),
    );

    // ASSIGNED_IDENTITY: Compute → ManagedIdentity
    for (const sa of identityGraph.systemAssignedIdentities) {
      const mi = miIndex.get(sa.principalId);
      if (!mi) continue;
      const computeNodeId = cloudResourceEntityId(tenantId, sa.resourceId);
      rels.push(makeRel(computeNodeId, mi.id, 'ASSIGNED_IDENTITY', tenantId, 'deterministic'));
    }

    // HAS_ROLE: ManagedIdentity → scope resource
    const resolved = resolveRoleAssignments(identityGraph.roleAssignments);
    for (const ra of resolved) {
      const mi = miIndex.get(ra.principalId);
      if (!mi) continue; // Only emit for known managed identities

      const scopeNodeId = cloudResourceEntityId(tenantId, ra.scope);
      rels.push(makeRel(mi.id, scopeNodeId, 'HAS_ROLE', tenantId, 'deterministic', {
        roleName: ra.roleName,
        roleDefinitionId: ra.roleDefinitionId,
        principalType: ra.principalType,
        scope: ra.scope,
      }));
    }

    return rels;
  }

  // ============================================================================
  // Compute → Subnet DEPLOYED_IN edges
  // ============================================================================

  private buildComputeSubnetEdges(
    rawResources: Record<string, any>[],
    networkNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];
    const subnetIndex = new Map(
      networkNodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet')
        .map(s => [s.providerResourceId, s]),
    );

    const computeTypes = [
      'microsoft.compute/virtualmachines',
      'microsoft.web/sites',
      'microsoft.app/containerapps',
      'microsoft.app/jobs',
      'microsoft.containerservice/managedclusters',
    ];

    for (const resource of rawResources) {
      if (!computeTypes.includes((resource.type ?? '').toLowerCase())) continue;

      const computeNodeId = cloudResourceEntityId(tenantId, resource.id);
      const subnetId = extractSubnetId(resource);
      if (!subnetId) continue;

      const subnet = [...subnetIndex.values()].find(
        s => s.providerResourceId.toLowerCase() === subnetId.toLowerCase(),
      );
      if (subnet) {
        rels.push(makeRel(computeNodeId, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // Internet exposure derivation — BFS from INTERNET node
  // ============================================================================

  private deriveInternetExposure(nodes: AnyGraphNode[], relationships: GraphRelationship[]): void {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();
    const ingressEdgeTypes = new Set<GraphRelationshipType>([
      'ROUTES_TO', 'HAS_ENDPOINT', 'HAS_ROUTE', 'HAS_ORIGIN_GROUP', 'HAS_ORIGIN',
      'EXPOSES_API', 'HAS_BACKEND', 'RESOLVES_TO', 'DEPLOYED_IN', 'HAS_PRIVATE_ENDPOINT',
    ]);

    for (const rel of relationships) {
      if (!ingressEdgeTypes.has(rel.type)) continue;
      if (!adjacency.has(rel.sourceId)) adjacency.set(rel.sourceId, new Set());
      adjacency.get(rel.sourceId)!.add(rel.targetId);
    }

    // BFS
    const visited = new Set<string>();
    const queue: string[] = ['internet'];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const node = nodeMap.get(id);
      if (node && !node.internetExposed) {
        (node as AnyGraphNode).internetExposed = true;
      }

      for (const neighbour of adjacency.get(id) ?? []) {
        if (!visited.has(neighbour)) queue.push(neighbour);
      }
    }

    // Additionally: NSG rule check — if inbound Allow * from Internet/*, mark subnet exposed
    const nsgs = nodes.filter((n): n is NetworkSecurityGroupNode => n.nodeType === 'NetworkSecurityGroup');
    for (const nsg of nsgs) {
      const isPubliclyExposed = nsg.inboundRules.some(
        r => r.access === 'Allow' &&
          (r.sourceServiceTag === 'Internet' || r.sourceServiceTag === '*' ||
           r.sourceCidrs.includes('0.0.0.0/0')),
      );
      if (isPubliclyExposed) {
        nsg.internetExposed = true;
      }
    }
  }
}

// ============================================================================
// Utility helpers
// ============================================================================

/**
 * Generate the cloud_resource entity ID that matches the legacy EntityIdUtils.cloudResourceId()
 * format used by the Azure Resource Graph connector and stored in the persistence layer.
 * Format: cloud_resource:<hash> where hash is derived from sorted key fields.
 */
function cloudResourceEntityId(tenantId: string, armId: string): string {
  const fields = {
    tenantId,
    entityType: 'cloud_resource',
    provider: 'azure',
    resourceId: armId.toLowerCase(),
  };
  const sortedKeys = Object.keys(fields).sort();
  const keyString = sortedKeys.map(k => `${k}=${(fields as Record<string, string>)[k]}`).join('|');
  const hash = crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  return `cloud_resource:${hash}`;
}

function relId(tenantId: string, type: string, sourceId: string, targetId: string): string {
  return crypto
    .createHash('sha256')
    .update(`rel:${tenantId}:${type}:${sourceId}:${targetId}`)
    .digest('hex')
    .substring(0, 16);
}

function makeRel(
  sourceId: string,
  targetId: string,
  type: GraphRelationshipType,
  tenantId: string,
  confidence: GraphRelationship['confidence'],
  metadata: Record<string, any> = {},
): GraphRelationship {
  return {
    id: relId(tenantId, type, sourceId, targetId),
    tenantId,
    type,
    sourceId,
    targetId,
    confidence,
    metadata,
  };
}

/**
 * Safely extract the hostname from a URL string.
 * Returns empty string if the URL is malformed — never throws.
 * Security: URL objects do not execute scripts; this is a parse-only operation.
 */
function safeHostname(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Sanitize raw Azure resource tags: keep only string key/value pairs,
 * reject any non-primitive values to prevent prototype pollution.
 * Secret-pattern detection is handled by node-sanitizer upstream;
 * this function only type-narrows to Record<string, string>.
 */
function sanitizeTags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string') {
      result[k] = v;
    }
  }
  return result;
}

function extractSubnetId(resource: Record<string, any>): string | null {
  const props = resource.properties ?? {};
  const type = (resource.type ?? '').toLowerCase();

  // VMs: networkProfile → networkInterfaces → ipConfigurations → subnet
  if (type === 'microsoft.compute/virtualmachines') {
    const nics: any[] = props.networkProfile?.networkInterfaces ?? [];
    for (const nic of nics) {
      const ipConfigs: any[] = nic.properties?.ipConfigurations ?? [];
      for (const ip of ipConfigs) {
        if (ip.properties?.subnet?.id) return ip.properties.subnet.id;
      }
    }
  }

  // Web/Function App: virtualNetworkSubnetId or vnetContentShareEnabled
  if (type === 'microsoft.web/sites') {
    if (props.virtualNetworkSubnetId) return props.virtualNetworkSubnetId;
  }

  // Container Apps
  if (type === 'microsoft.app/containerapps' || type === 'microsoft.app/jobs') {
    if (props.environmentId) return null; // resolves via managed environment
  }

  return null;
}
