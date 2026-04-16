/**
 * Azure Ingress Fetcher
 *
 * Fetches Azure Front Door (CDN/AFD v2), Traffic Manager, API Management,
 * and Application Gateway topology from Azure Resource Graph + ARM API.
 *
 * Security:
 *  - The bearer token is passed in; this fetcher never requests credentials.
 *  - Raw ARM API error bodies are never propagated — only HTTP status codes.
 *  - Concurrency per profile is bounded to 5 via p-limit to avoid throttling.
 */

import pLimit from 'p-limit';
import {
  IngressGraph,
  RawFrontDoorProfile,
  RawFrontDoorEndpoint,
  RawFrontDoorRoute,
  RawFrontDoorOriginGroup,
  RawFrontDoorOrigin,
  RawTMProfile,
  RawTMEndpoint,
  RawAPIMService,
  RawAPIMApi,
  RawAPIMBackend,
  RawAppGateway,
} from '@ai-agent/shared';

const ARM_BASE = 'https://management.azure.com';
const AFD_API = '2024-02-01';
const APIM_API = '2022-08-01';

type AnyRecord = Record<string, any>;

// ============================================================================
// Public surface
// ============================================================================

/**
 * Fetch all ingress topology data for the given subscriptions.
 * @param token  Azure AD bearer token with Reader permissions.
 * @param subscriptionIds  List of subscription IDs to query.
 */
export async function fetchAzureIngressGraph(
  token: string,
  subscriptionIds: string[],
): Promise<IngressGraph> {
  const [rawFD, rawTM, rawAPIM, rawAG] = await Promise.all([
    fetchFrontDoorData(token, subscriptionIds),
    fetchTrafficManagerData(token, subscriptionIds),
    fetchAPIMData(token, subscriptionIds),
    fetchAppGatewayData(token, subscriptionIds),
  ]);

  const result: IngressGraph = {
    frontDoorProfiles: rawFD,
    trafficManagerProfiles: rawTM,
    apimServices: rawAPIM,
    appGateways: rawAG,
  };
  return result;
}

// ============================================================================
// Internal helpers — ARG query
// ============================================================================

async function argQuery(token: string, subscriptionIds: string[], query: string): Promise<AnyRecord[]> {
  const response = await fetch(
    `${ARM_BASE}/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(subscriptionIds.length > 0 && { subscriptions: subscriptionIds }), query, options: { resultFormat: 'objectArray' } }),
    },
  );
  if (!response.ok) {
    throw new CloudGraphFetchError('azure', 'ingressGraph', `HTTP_${response.status}`);
  }
  const data = await response.json() as { data: AnyRecord[] };
  return data.data ?? [];
}

async function armGet(token: string, url: string): Promise<AnyRecord> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new CloudGraphFetchError('azure', 'armGet', `HTTP_${response.status}`);
  }
  return response.json() as Promise<AnyRecord>;
}

async function armGetList(token: string, url: string): Promise<AnyRecord[]> {
  const data = await armGet(token, url);
  return (data.value as AnyRecord[]) ?? [];
}

// ============================================================================
// Front Door
// ============================================================================

async function fetchFrontDoorData(token: string, subscriptionIds: string[]): Promise<RawFrontDoorProfile[]> {
  const query = `
    resources
    | where type =~ 'microsoft.cdn/profiles'
    | where sku.name in~ ('Standard_AzureFrontDoor', 'Premium_AzureFrontDoor')
    | project id, name, resourceGroup, location, sku, properties
  `;

  const rows = await argQuery(token, subscriptionIds, query);
  const limit = pLimit(5);

  return Promise.all(
    rows.map(row =>
      limit(() => fetchFrontDoorProfileDetail(token, row)),
    ),
  );
}

async function fetchFrontDoorProfileDetail(token: string, row: AnyRecord): Promise<RawFrontDoorProfile> {
  const id: string = row.id;
  const [sub, rg, name] = parseArmId(id);

  const baseUrl = `${ARM_BASE}/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cdn/profiles/${name}`;
  const wafPolicyId = row.properties?.webApplicationFirewallPolicyLink?.id as string | undefined;

  // Fan out: endpoints, origin groups
  const [endpointItems, ogItems] = await Promise.all([
    armGetList(token, `${baseUrl}/afdEndpoints?api-version=${AFD_API}`),
    armGetList(token, `${baseUrl}/originGroups?api-version=${AFD_API}`),
  ]);

  const limit = pLimit(5);

  // Build origin groups map (with origins)
  const ogMap = new Map<string, RawFrontDoorOriginGroup>();
  await Promise.all(
    ogItems.map(og =>
      limit(async () => {
        const ogId: string = og.id;
        const ogName: string = og.name;
        const originsUrl = `${baseUrl}/originGroups/${ogName}/origins?api-version=${AFD_API}`;
        const originItems = await armGetList(token, originsUrl);

        const rawOrigins: RawFrontDoorOrigin[] = originItems.map(o => ({
          id: o.id,
          name: o.name,
          hostName: o.properties?.hostName ?? '',
          httpPort: Number(o.properties?.httpPort ?? 80),
          httpsPort: Number(o.properties?.httpsPort ?? 443),
          priority: Number(o.properties?.priority ?? 1),
          weight: Number(o.properties?.weight ?? 1000),
          enabledState: o.properties?.enabledState ?? 'Enabled',
          originGroupId: ogId,
        }));

        ogMap.set(ogId.toLowerCase(), {
          id: ogId,
          name: ogName,
          profileId: id,
          loadBalancingSettings: og.properties?.loadBalancingSettings ?? { sampleSize: 4, successfulSamplesRequired: 3 },
          healthProbeSettings: og.properties?.healthProbeSettings,
          origins: rawOrigins,
        });
      }),
    ),
  );

  // Fetch routes per endpoint
  const endpoints: RawFrontDoorEndpoint[] = await Promise.all(
    endpointItems.map(ep =>
      limit(async () => {
        const epId: string = ep.id;
        const epName: string = ep.name;
        const routesUrl = `${baseUrl}/afdEndpoints/${epName}/routes?api-version=${AFD_API}`;
        const routeItems = await armGetList(token, routesUrl);

        const routes: RawFrontDoorRoute[] = routeItems.map(r => {
          const ogRefRaw: string = r.properties?.originGroup?.id ?? '';
          // The route's originGroup.id may be a relative ARM path (no /subscriptions/ prefix),
          // e.g. "/resourceGroups/rg/providers/Microsoft.Cdn/Profiles/p/OriginGroups/og-name".
          // ogMap keys are full ARM IDs from a separate API call. Match by lowercased full ID
          // first, then fall back to matching by the origin group name (last path segment).
          const ogRefLower = ogRefRaw.toLowerCase();
          const ogName = ogRefLower.split('/origingroups/')[1] ?? '';
          const ogEntry = ogMap.get(ogRefLower)
            ?? (ogName ? [...ogMap.values()].find(og => og.name.toLowerCase() === ogName) : null)
            ?? null;
          const ogRef = ogEntry?.id ?? ogRefRaw;
          return {
            id: r.id,
            name: r.name,
            patternsToMatch: r.properties?.patternsToMatch ?? [],
            acceptedProtocols: r.properties?.supportedProtocols ?? ['Https'],
            httpsRedirect: r.properties?.httpsRedirect === 'Enabled',
            originGroupId: ogRef,
            originGroups: ogEntry ? [ogEntry] : [],
          };
        });

        return {
          id: epId,
          name: epName,
          fqdn: ep.properties?.hostName ?? '',
          enabled: ep.properties?.enabledState === 'Enabled',
          routes,
        } satisfies RawFrontDoorEndpoint;
      }),
    ),
  );

  return {
    id,
    name: row.name,
    resourceGroup: row.resourceGroup,
    sku: row.sku?.name ?? 'Standard_AzureFrontDoor',
    wafPolicyId,
    endpoints,
  };
}

// ============================================================================
// Traffic Manager
// ============================================================================

async function fetchTrafficManagerData(token: string, subscriptionIds: string[]): Promise<RawTMProfile[]> {
  const query = `
    resources
    | where type =~ 'microsoft.network/trafficmanagerprofiles'
    | project id, name, resourceGroup,
        dnsConfig     = properties.dnsConfig,
        routingMethod = properties.trafficRoutingMethod,
        monitorConfig = properties.monitorConfig,
        endpoints     = properties.endpoints
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  return rows.map(row => {
    const endpoints: RawTMEndpoint[] = ((row.endpoints as AnyRecord[]) ?? []).map(ep => ({
      id: ep.id ?? '',
      name: ep.name ?? '',
      profileId: row.id,
      endpointType: ep.type?.split('/')?.pop() ?? 'ExternalEndpoints',
      target: ep.properties?.target ?? ep.properties?.targetResourceId ?? '',
      weight: ep.properties?.weight != null ? Number(ep.properties.weight) : undefined,
      priority: ep.properties?.priority != null ? Number(ep.properties.priority) : undefined,
      endpointStatus: ep.properties?.endpointStatus ?? 'Enabled',
    }));

    return {
      id: row.id,
      name: row.name,
      resourceGroup: row.resourceGroup,
      dnsName: row.dnsConfig?.relativeName ? `${row.dnsConfig.relativeName}.trafficmanager.net` : '',
      routingMethod: row.routingMethod ?? 'Priority',
      monitorProtocol: row.monitorConfig?.protocol ?? 'HTTPS',
      monitorPort: Number(row.monitorConfig?.port ?? 443),
      monitorPath: row.monitorConfig?.path ?? '/',
      ttl: Number(row.dnsConfig?.ttl ?? 30),
      endpoints,
    } satisfies RawTMProfile;
  });
}

// ============================================================================
// APIM
// ============================================================================

async function fetchAPIMData(token: string, subscriptionIds: string[]): Promise<RawAPIMService[]> {
  const query = `
    resources
    | where type =~ 'microsoft.apimanagement/service'
    | project id, name, resourceGroup, location,
        sku                    = sku.name,
        gatewayUrl             = properties.gatewayUrl,
        developerPortalUrl     = properties.developerPortalUrl,
        virtualNetworkType     = properties.virtualNetworkType,
        virtualNetworkSubnetId = properties.virtualNetworkConfiguration.subnetResourceId,
        publicIpAddresses      = properties.publicIPAddresses
  `;

  const rows = await argQuery(token, subscriptionIds, query);
  const limit = pLimit(5);

  return Promise.all(
    rows.map(row =>
      limit(() => fetchAPIMDetail(token, row)),
    ),
  );
}

async function fetchAPIMDetail(token: string, row: AnyRecord): Promise<RawAPIMService> {
  const id: string = row.id;
  const [sub, rg, name] = parseArmId(id);
  const baseUrl = `${ARM_BASE}/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.ApiManagement/service/${name}`;

  const [apiItems, backendItems] = await Promise.all([
    armGetList(token, `${baseUrl}/apis?api-version=${APIM_API}`),
    armGetList(token, `${baseUrl}/backends?api-version=${APIM_API}`),
  ]);

  const apis: RawAPIMApi[] = apiItems.map(api => ({
    id: api.id,
    name: api.name,
    path: api.properties?.path ?? '',
    protocols: api.properties?.protocols ?? ['https'],
    subscriptionRequired: api.properties?.subscriptionRequired !== false,
    authType: api.properties?.authenticationSettings?.openidAuthenticationSettings?.length > 0
      ? 'OpenID'
      : api.properties?.authenticationSettings?.oAuth2AuthenticationSettings?.length > 0
        ? 'OAuth2'
        : api.properties?.subscriptionRequired === false
          ? 'None'
          : 'SubscriptionKey',
  }));

  const backends: RawAPIMBackend[] = backendItems.map(b => ({
    id: b.id,
    name: b.name,
    url: b.properties?.url ?? '',
    protocol: b.properties?.protocol ?? 'http',
  }));

  return {
    id,
    name: row.name,
    resourceGroup: row.resourceGroup,
    location: row.location,
    sku: row.sku ?? '',
    gatewayUrl: row.gatewayUrl ?? '',
    developerPortalUrl: row.developerPortalUrl,
    virtualNetworkType: row.virtualNetworkType ?? 'None',
    virtualNetworkSubnetId: row.virtualNetworkSubnetId,
    publicIpAddresses: Array.isArray(row.publicIpAddresses) ? row.publicIpAddresses : [],
    apis,
    backends,
  };
}

// ============================================================================
// Application Gateway
// ============================================================================

async function fetchAppGatewayData(token: string, subscriptionIds: string[]): Promise<RawAppGateway[]> {
  const query = `
    resources
    | where type =~ 'microsoft.network/applicationgateways'
    | project id, name, resourceGroup, location,
        sku                 = properties.sku.name,
        wafEnabled          = properties.webApplicationFirewallConfiguration.enabled,
        frontendIPConfigs   = properties.frontendIPConfigurations,
        httpListeners       = properties.httpListeners,
        backendAddressPools = properties.backendAddressPools
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    resourceGroup: row.resourceGroup,
    location: row.location,
    sku: row.sku ?? '',
    wafEnabled: row.wafEnabled === true,
    frontendIPs: ((row.frontendIPConfigs as AnyRecord[]) ?? [])
      .map((f: AnyRecord) => f.properties?.privateIPAddress ?? f.properties?.publicIPAddress?.id ?? '')
      .filter(Boolean),
    listeners: ((row.httpListeners as AnyRecord[]) ?? []).map((l: AnyRecord) => ({
      protocol: l.properties?.protocol ?? 'Https',
      port: Number(l.properties?.frontendPort?.id?.split('/')?.pop() ?? 443),
      hostNames: l.properties?.hostNames ?? (l.properties?.hostName ? [l.properties.hostName] : []),
    })),
    backendPools: ((row.backendAddressPools as AnyRecord[]) ?? []).map((p: AnyRecord) => ({
      name: p.name ?? '',
      fqdns: ((p.properties?.backendAddresses as AnyRecord[]) ?? [])
        .map((a: AnyRecord) => a.fqdn).filter(Boolean),
      ipAddresses: ((p.properties?.backendAddresses as AnyRecord[]) ?? [])
        .map((a: AnyRecord) => a.ipAddress).filter(Boolean),
    })),
  } satisfies RawAppGateway));
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse an Azure ARM resource ID into [subscriptionId, resourceGroup, resourceName].
 * Throws CloudGraphFetchError if the ID is not a valid ARM path.
 */
function parseArmId(id: string): [string, string, string] {
  const lower = id.toLowerCase();
  const subMatch = lower.match(/\/subscriptions\/([0-9a-f-]{36})/);
  const rgMatch = lower.match(/\/resourcegroups\/([^/]+)/);
  const nameMatch = id.split('/').pop();

  if (!subMatch || !rgMatch || !nameMatch) {
    throw new CloudGraphFetchError('azure', 'parseArmId', 'INVALID_ARM_ID');
  }
  return [subMatch[1], rgMatch[1], nameMatch];
}

/**
 * Structured fetch error — never includes raw API response bodies.
 * Exposed at the provider level so the orchestrator can aggregate errors without
 * leaking subscription IDs or resource paths to external consumers.
 */
export class CloudGraphFetchError extends Error {
  constructor(
    public readonly provider: string,
    public readonly resourceType: string,
    public readonly errorCode: string,
  ) {
    super(`CloudGraphFetchError: provider=${provider} resourceType=${resourceType} code=${errorCode}`);
    this.name = 'CloudGraphFetchError';
  }
}
