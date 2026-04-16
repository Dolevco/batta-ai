/**
 * Azure Ingress Transformer
 *
 * Converts raw fetcher output (RawFrontDoorProfile, RawTMProfile, RawAPIMService,
 * RawAppGateway) into validated GraphNode objects.
 *
 * Each node is run through sanitizeNode() which applies:
 *   - Zod schema validation (strict)
 *   - Secret-field redaction
 *   - ARM ID normalisation
 *   - Tag value truncation
 *
 * dataClassification:
 *   - Ingress endpoints (FQDNs exposed to internet) → 'internal'
 *   - APIM API paths/backends → 'internal'
 *   - origin hostnames/TM targets → 'internal'
 */

import * as crypto from 'crypto';
import {
  AnyGraphNode,
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
  AppGatewayNode,
  IngressGraph,
  RawFrontDoorProfile,
  RawFrontDoorOriginGroup,
  RawTMProfile,
  RawAPIMService,
  RawAppGateway,
} from '@ai-agent/shared';
import {
  sanitizeNode,
  FrontDoorProfileSchema,
  FrontDoorEndpointSchema,
  FrontDoorRouteSchema,
  FrontDoorOriginGroupSchema,
  FrontDoorOriginSchema,
  TrafficManagerProfileSchema,
  TrafficManagerEndpointSchema,
  APIManagementServiceSchema,
  APIMApiSchema,
  APIMBackendSchema,
  AppGatewaySchema,
} from '../../../graph/node-sanitizer';

// ============================================================================
// Public surface
// ============================================================================

export function transformIngressGraph(
  ingressGraph: IngressGraph,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  for (const fd of ingressGraph.frontDoorProfiles) {
    nodes.push(...transformFrontDoorProfile(fd, tenantId, indexedAt));
  }
  for (const tm of ingressGraph.trafficManagerProfiles) {
    nodes.push(...transformTMProfile(tm, tenantId, indexedAt));
  }
  for (const apim of ingressGraph.apimServices) {
    nodes.push(...transformAPIMService(apim, tenantId, indexedAt));
  }
  for (const ag of ingressGraph.appGateways) {
    nodes.push(transformAppGateway(ag, tenantId, indexedAt));
  }

  return nodes;
}

// ============================================================================
// ID helpers
// ============================================================================

function nodeId(tenantId: string, armId: string): string {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}:${armId.toLowerCase()}`)
    .digest('hex')
    .substring(0, 16);
}

// ============================================================================
// Front Door
// ============================================================================

function transformFrontDoorProfile(
  fd: RawFrontDoorProfile,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  const profileNode = sanitizeNode<FrontDoorProfileNode>(
    {
      id: nodeId(tenantId, fd.id),
      tenantId,
      cloudProvider: 'azure',
      nodeType: 'FrontDoorProfile',
      providerResourceId: fd.id,
      displayName: fd.name,
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: true,
      sku: fd.sku.includes('Premium') ? 'Premium_AzureFrontDoor' : 'Standard_AzureFrontDoor',
      wafPolicyId: fd.wafPolicyId,
    },
    FrontDoorProfileSchema,
    'FrontDoorProfile',
  );
  nodes.push(profileNode);

  for (const ep of fd.endpoints) {
    const epNode = sanitizeNode<FrontDoorEndpointNode>(
      {
        id: nodeId(tenantId, ep.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'FrontDoorEndpoint',
        providerResourceId: ep.id,
        displayName: ep.name,
        region: 'global',
        tags: {},
        indexedAt,
        dataClassification: 'internal',
        internetExposed: true,
        profileId: fd.id.toLowerCase(),
        fqdn: ep.fqdn,
        enabled: ep.enabled,
      },
      FrontDoorEndpointSchema,
      'FrontDoorEndpoint',
    );
    nodes.push(epNode);

    for (const route of ep.routes) {
      const routeNode = sanitizeNode<FrontDoorRouteNode>(
        {
          id: nodeId(tenantId, route.id),
          tenantId,
          cloudProvider: 'azure',
          nodeType: 'FrontDoorRoute',
          providerResourceId: route.id,
          displayName: route.name,
          region: 'global',
          tags: {},
          indexedAt,
          dataClassification: 'internal',
          internetExposed: false,
          endpointId: ep.id.toLowerCase(),
          patternsToMatch: route.patternsToMatch,
          acceptedProtocols: normalizeProtocols(route.acceptedProtocols),
          httpsRedirect: route.httpsRedirect,
          originGroupId: route.originGroupId.toLowerCase(),
        },
        FrontDoorRouteSchema,
        'FrontDoorRoute',
      );
      nodes.push(routeNode);
    }
  }

  // Emit origin group nodes once per profile (deduplicated by ID across all routes)
  const seenOgIds = new Set<string>();
  for (const ep of fd.endpoints) {
    for (const route of ep.routes) {
      for (const og of route.originGroups) {
        if (!seenOgIds.has(og.id.toLowerCase())) {
          seenOgIds.add(og.id.toLowerCase());
          nodes.push(...transformOriginGroup(og, fd.id, tenantId, indexedAt));
        }
      }
    }
  }

  return nodes;
}

function transformOriginGroup(
  og: RawFrontDoorOriginGroup,
  profileId: string,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  const ogNode = sanitizeNode<FrontDoorOriginGroupNode>(
    {
      id: nodeId(tenantId, og.id),
      tenantId,
      cloudProvider: 'azure',
      nodeType: 'FrontDoorOriginGroup',
      providerResourceId: og.id,
      displayName: og.name,
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: false,
      profileId: profileId.toLowerCase(),
      loadBalancingSettings: {
        sampleSize: Number(og.loadBalancingSettings?.sampleSize ?? 4),
        successfulSamplesRequired: Number(og.loadBalancingSettings?.successfulSamplesRequired ?? 3),
      },
      healthProbeSettings: og.healthProbeSettings
        ? {
            path: og.healthProbeSettings.probePath ?? og.healthProbeSettings.path ?? '/',
            protocol: og.healthProbeSettings.probeProtocol ?? og.healthProbeSettings.protocol ?? 'Https',
            intervalInSeconds: Number(og.healthProbeSettings.probeIntervalInSeconds ?? og.healthProbeSettings.intervalInSeconds ?? 100),
          }
        : undefined,
    },
    FrontDoorOriginGroupSchema,
    'FrontDoorOriginGroup',
  );
  nodes.push(ogNode);

  for (const origin of og.origins) {
    const originNode = sanitizeNode<FrontDoorOriginNode>(
      {
        id: nodeId(tenantId, origin.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'FrontDoorOrigin',
        providerResourceId: origin.id,
        displayName: origin.name,
        region: 'global',
        tags: {},
        indexedAt,
        dataClassification: 'internal',
        internetExposed: false,
        originGroupId: og.id.toLowerCase(),
        hostName: origin.hostName,
        httpPort: origin.httpPort,
        httpsPort: origin.httpsPort,
        priority: origin.priority,
        weight: origin.weight,
        enabledState: origin.enabledState === 'Enabled' ? 'Enabled' : 'Disabled',
      },
      FrontDoorOriginSchema,
      'FrontDoorOrigin',
    );
    nodes.push(originNode);
  }

  return nodes;
}

function normalizeProtocols(protocols: string[]): ('Http' | 'Https')[] {
  return protocols
    .map(p => {
      const normalized = p.toLowerCase();
      if (normalized === 'http') return 'Http';
      if (normalized === 'https') return 'Https';
      return null;
    })
    .filter((p): p is 'Http' | 'Https' => p !== null);
}

// ============================================================================
// Traffic Manager
// ============================================================================

function transformTMProfile(
  tm: RawTMProfile,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  const validMethods = ['Priority', 'Weighted', 'Performance', 'Geographic', 'MultiValue', 'Subnet'];
  const routingMethod = validMethods.includes(tm.routingMethod)
    ? (tm.routingMethod as TrafficManagerProfileNode['routingMethod'])
    : 'Priority';

  const profileNode = sanitizeNode<TrafficManagerProfileNode>(
    {
      id: nodeId(tenantId, tm.id),
      tenantId,
      cloudProvider: 'azure',
      nodeType: 'TrafficManagerProfile',
      providerResourceId: tm.id,
      displayName: tm.name,
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: true,
      dnsName: tm.dnsName,
      routingMethod,
      monitorProtocol: tm.monitorProtocol,
      monitorPort: tm.monitorPort,
      monitorPath: tm.monitorPath,
      ttl: tm.ttl,
    },
    TrafficManagerProfileSchema,
    'TrafficManagerProfile',
  );
  nodes.push(profileNode);

  for (const ep of tm.endpoints) {
    const validEndpointTypes = ['AzureEndpoints', 'ExternalEndpoints', 'NestedEndpoints'];
    const endpointType = validEndpointTypes.includes(ep.endpointType)
      ? (ep.endpointType as TrafficManagerEndpointNode['endpointType'])
      : 'ExternalEndpoints';

    const epNode = sanitizeNode<TrafficManagerEndpointNode>(
      {
        id: nodeId(tenantId, ep.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'TrafficManagerEndpoint',
        providerResourceId: ep.id,
        displayName: ep.name,
        region: 'global',
        tags: {},
        indexedAt,
        dataClassification: 'internal',
        internetExposed: false,
        profileId: tm.id.toLowerCase(),
        endpointType,
        target: ep.target,
        weight: ep.weight,
        priority: ep.priority,
        endpointStatus: ep.endpointStatus === 'Enabled' ? 'Enabled' : 'Disabled',
      },
      TrafficManagerEndpointSchema,
      'TrafficManagerEndpoint',
    );
    nodes.push(epNode);
  }

  return nodes;
}

// ============================================================================
// APIM
// ============================================================================

function transformAPIMService(
  apim: RawAPIMService,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  const vnetType = (['None', 'External', 'Internal'].includes(apim.virtualNetworkType)
    ? apim.virtualNetworkType
    : 'None') as 'None' | 'External' | 'Internal';

  const serviceNode = sanitizeNode<APIManagementServiceNode>(
    {
      id: nodeId(tenantId, apim.id),
      tenantId,
      cloudProvider: 'azure',
      nodeType: 'APIManagementService',
      providerResourceId: apim.id,
      displayName: apim.name,
      region: apim.location,
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: vnetType === 'None' || vnetType === 'External',
      gatewayUrl: apim.gatewayUrl,
      developerPortalUrl: apim.developerPortalUrl,
      sku: apim.sku,
      vnetType,
      subnetId: apim.virtualNetworkSubnetId,
      publicIpAddresses: apim.publicIpAddresses,
    },
    APIManagementServiceSchema,
    'APIManagementService',
  );
  nodes.push(serviceNode);

  for (const api of apim.apis) {
    const apiNode = sanitizeNode<APIMApiNode>(
      {
        id: nodeId(tenantId, api.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'APIMApi',
        providerResourceId: api.id,
        displayName: api.name,
        region: apim.location,
        tags: {},
        indexedAt,
        dataClassification: 'internal',
        internetExposed: false,
        apimServiceId: apim.id.toLowerCase(),
        apiPath: api.path,
        protocols: normalizeAPIMProtocols(api.protocols),
        subscriptionRequired: api.subscriptionRequired,
        authType: api.authType,
      },
      APIMApiSchema,
      'APIMApi',
    );
    nodes.push(apiNode);
  }

  for (const backend of apim.backends) {
    const backendNode = sanitizeNode<APIMBackendNode>(
      {
        id: nodeId(tenantId, backend.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'APIMBackend',
        providerResourceId: backend.id,
        displayName: backend.name,
        region: apim.location,
        tags: {},
        indexedAt,
        dataClassification: 'internal',
        internetExposed: false,
        apimServiceId: apim.id.toLowerCase(),
        url: backend.url,
        protocol: backend.protocol === 'soap' ? 'soap' : 'http',
      },
      APIMBackendSchema,
      'APIMBackend',
    );
    nodes.push(backendNode);
  }

  return nodes;
}

function normalizeAPIMProtocols(protocols: string[]): ('http' | 'https' | 'ws' | 'wss')[] {
  const valid = ['http', 'https', 'ws', 'wss'];
  return protocols
    .map(p => p.toLowerCase())
    .filter((p): p is 'http' | 'https' | 'ws' | 'wss' => valid.includes(p));
}

// ============================================================================
// Application Gateway
// ============================================================================

function transformAppGateway(
  ag: RawAppGateway,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode {
  return sanitizeNode<AppGatewayNode>(
    {
      id: nodeId(tenantId, ag.id),
      tenantId,
      cloudProvider: 'azure',
      nodeType: 'AppGateway',
      providerResourceId: ag.id,
      displayName: ag.name,
      region: ag.location,
      tags: {},
      indexedAt,
      dataClassification: 'internal',
      internetExposed: true,
      sku: ag.sku,
      wafEnabled: ag.wafEnabled,
      frontendIPs: ag.frontendIPs,
      listeners: ag.listeners.map(l => ({
        protocol: l.protocol,
        port: l.port,
        hostNames: l.hostNames,
      })),
      backendPools: ag.backendPools.map(p => ({
        name: p.name,
        fqdns: p.fqdns,
        ipAddresses: p.ipAddresses,
      })),
    },
    AppGatewaySchema,
    'AppGateway',
  );
}
