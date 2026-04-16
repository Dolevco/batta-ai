/**
 * Cloud Graph Types — Wiz-style security graph
 *
 * All node types for the cloud security graph. Edges (Relationship) are
 * defined in canonical.types.ts.  Every node extends GraphNode which carries
 * the common fields required for graph traversal, persistence, and security
 * classification.
 *
 * Classification: CONFIDENTIAL — network topology; RESTRICTED — identity/RBAC.
 * Never log raw values from these types.
 */

// ============================================================================
// Cloud Provider Discriminant
// ============================================================================

export type CloudProvider = 'azure' | 'aws' | 'gcp' | 'synthetic';

// ============================================================================
// Data Classification
// ============================================================================

export type NodeDataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

// ============================================================================
// Base Graph Node
// ============================================================================

export interface GraphNode {
  /** Deterministic SHA-256 of (providerResourceId + tenantId), hex-truncated to 16 chars */
  id: string;
  tenantId: string;
  cloudProvider: CloudProvider;
  /** Discriminant — used by the graph builder to route to the correct persistence handler */
  nodeType: GraphNodeType;
  /**
   * Cloud provider's resource ID (ARM ID / ARN / GCP resource name).
   * Normalised to lower-case.
   */
  providerResourceId: string;
  displayName: string;
  region: string;
  /** Resource tags; secret-pattern values are redacted by node-sanitizer */
  tags: Record<string, string>;
  /** ISO 8601 timestamp when this node was last indexed */
  indexedAt: string;
  dataClassification: NodeDataClassification;
  /**
   * Set to true by CloudGraphBuilder.deriveInternetExposure() after BFS from INTERNET node.
   * Never set manually by fetchers/transformers.
   */
  internetExposed: boolean;
}

// ============================================================================
// All graph node types (discriminant values)
// ============================================================================

export type GraphNodeType =
  // Synthetic
  | 'InternetNode'
  // Ingress
  | 'FrontDoorProfile'
  | 'FrontDoorEndpoint'
  | 'FrontDoorRoute'
  | 'FrontDoorOriginGroup'
  | 'FrontDoorOrigin'
  | 'TrafficManagerProfile'
  | 'TrafficManagerEndpoint'
  | 'APIManagementService'
  | 'APIMApi'
  | 'APIMBackend'
  | 'AppGateway'
  // Networking
  | 'VirtualNetwork'
  | 'Subnet'
  | 'NetworkSecurityGroup'
  | 'PrivateEndpoint'
  // Identity
  | 'ManagedIdentity'
  | 'ServicePrincipal';

// ============================================================================
// Synthetic / Utility nodes
// ============================================================================

export interface InternetNode extends GraphNode {
  nodeType: 'InternetNode';
  cloudProvider: 'synthetic';
}

// ============================================================================
// Ingress — Front Door (CDN/AFD v2)
// ============================================================================

export interface FrontDoorProfileNode extends GraphNode {
  nodeType: 'FrontDoorProfile';
  sku: 'Standard_AzureFrontDoor' | 'Premium_AzureFrontDoor';
  wafPolicyId?: string;
}

export interface FrontDoorEndpointNode extends GraphNode {
  nodeType: 'FrontDoorEndpoint';
  profileId: string;
  fqdn: string;
  enabled: boolean;
}

export interface FrontDoorRouteNode extends GraphNode {
  nodeType: 'FrontDoorRoute';
  endpointId: string;
  patternsToMatch: string[];
  acceptedProtocols: ('Http' | 'Https')[];
  httpsRedirect: boolean;
  originGroupId: string;
}

export interface FrontDoorOriginGroupNode extends GraphNode {
  nodeType: 'FrontDoorOriginGroup';
  profileId: string;
  loadBalancingSettings: { sampleSize: number; successfulSamplesRequired: number };
  healthProbeSettings?: { path: string; protocol: string; intervalInSeconds: number };
}

export interface FrontDoorOriginNode extends GraphNode {
  nodeType: 'FrontDoorOrigin';
  originGroupId: string;
  /** FQDN of the backend, e.g. api-app.azurewebsites.net */
  hostName: string;
  httpPort: number;
  httpsPort: number;
  priority: number;
  weight: number;
  enabledState: 'Enabled' | 'Disabled';
  /** ARM ID of the resolved Compute/PaaS resource — set during graph build */
  resolvedResourceId?: string;
}

// ============================================================================
// Ingress — Traffic Manager
// ============================================================================

export interface TrafficManagerProfileNode extends GraphNode {
  nodeType: 'TrafficManagerProfile';
  dnsName: string;
  routingMethod: 'Priority' | 'Weighted' | 'Performance' | 'Geographic' | 'MultiValue' | 'Subnet';
  monitorProtocol: string;
  monitorPort: number;
  monitorPath: string;
  ttl: number;
}

export interface TrafficManagerEndpointNode extends GraphNode {
  nodeType: 'TrafficManagerEndpoint';
  profileId: string;
  endpointType: 'AzureEndpoints' | 'ExternalEndpoints' | 'NestedEndpoints';
  target: string;
  weight?: number;
  priority?: number;
  endpointStatus: 'Enabled' | 'Disabled';
  /** ARM ID of the resolved Compute/PaaS resource — set during graph build */
  resolvedResourceId?: string;
}

// ============================================================================
// Ingress — API Management
// ============================================================================

export interface APIManagementServiceNode extends GraphNode {
  nodeType: 'APIManagementService';
  gatewayUrl: string;
  developerPortalUrl?: string;
  sku: string;
  vnetType: 'None' | 'External' | 'Internal';
  subnetId?: string;
  publicIpAddresses: string[];
}

export interface APIMApiNode extends GraphNode {
  nodeType: 'APIMApi';
  apimServiceId: string;
  apiPath: string;
  protocols: ('http' | 'https' | 'ws' | 'wss')[];
  subscriptionRequired: boolean;
  authType: string;
}

export interface APIMBackendNode extends GraphNode {
  nodeType: 'APIMBackend';
  apimServiceId: string;
  url: string;
  protocol: 'http' | 'soap';
  /** ARM ID of the resolved Compute/PaaS resource — set during graph build */
  resolvedResourceId?: string;
}

// ============================================================================
// Ingress — Application Gateway
// ============================================================================

export interface AppGatewayNode extends GraphNode {
  nodeType: 'AppGateway';
  sku: string;
  wafEnabled: boolean;
  frontendIPs: string[];
  listeners: { protocol: string; port: number; hostNames: string[] }[];
  backendPools: { name: string; fqdns: string[]; ipAddresses: string[] }[];
}

// ============================================================================
// Networking
// ============================================================================

export interface VirtualNetworkNode extends GraphNode {
  nodeType: 'VirtualNetwork';
  addressSpaces: string[];
  dnsServers: string[];
  enableDdosProtection: boolean;
}

export interface SubnetNode extends GraphNode {
  nodeType: 'Subnet';
  vnetId: string;
  cidr: string;
  delegatedTo?: string;
  serviceEndpoints: string[];
  nsgId?: string;
  routeTableId?: string;
}

// NSG rules are embedded in the NSG node (not separate graph nodes).
export interface NsgRule {
  name: string;
  priority: number;
  protocol: 'Tcp' | 'Udp' | 'Icmp' | '*';
  access: 'Allow' | 'Deny';
  sourceCidrs: string[];
  sourceServiceTag?: string;
  destinationCidrs: string[];
  destinationServiceTag?: string;
  destinationPorts: string[];
}

export interface NetworkSecurityGroupNode extends GraphNode {
  nodeType: 'NetworkSecurityGroup';
  inboundRules: NsgRule[];
  outboundRules: NsgRule[];
}

export interface PrivateEndpointNode extends GraphNode {
  nodeType: 'PrivateEndpoint';
  subnetId: string;
  targetResourceId: string;
  groupIds: string[];
  privateIpAddress: string;
  dnsZoneGroupIds: string[];
}

// ============================================================================
// Identity
// ============================================================================

export interface ManagedIdentityNode extends GraphNode {
  nodeType: 'ManagedIdentity';
  principalId: string;
  clientId: string;
  identityKind: 'SystemAssigned' | 'UserAssigned';
  assignedToResourceIds: string[];
}

export interface ServicePrincipalNode extends GraphNode {
  nodeType: 'ServicePrincipal';
  appId: string;
  servicePrincipalType: 'Application' | 'ManagedIdentity' | 'Legacy';
}

// ============================================================================
// Discriminated union of all graph nodes
// ============================================================================

export type AnyGraphNode =
  | InternetNode
  | FrontDoorProfileNode
  | FrontDoorEndpointNode
  | FrontDoorRouteNode
  | FrontDoorOriginGroupNode
  | FrontDoorOriginNode
  | TrafficManagerProfileNode
  | TrafficManagerEndpointNode
  | APIManagementServiceNode
  | APIMApiNode
  | APIMBackendNode
  | AppGatewayNode
  | VirtualNetworkNode
  | SubnetNode
  | NetworkSecurityGroupNode
  | PrivateEndpointNode
  | ManagedIdentityNode
  | ServicePrincipalNode;

// ============================================================================
// Provider-level raw data shapes (output of fetchers, input to transformers)
// ============================================================================

// Raw shapes use `any` intentionally — they represent unvalidated API responses.
// They are validated and sanitised by node-sanitizer before graph nodes are created.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RawFrontDoorProfile {
  id: string;
  name: string;
  resourceGroup: string;
  sku: string;
  wafPolicyId?: string;
  endpoints: RawFrontDoorEndpoint[];
}

export interface RawFrontDoorEndpoint {
  id: string;
  name: string;
  fqdn: string;
  enabled: boolean;
  routes: RawFrontDoorRoute[];
}

export interface RawFrontDoorRoute {
  id: string;
  name: string;
  patternsToMatch: string[];
  acceptedProtocols: string[];
  httpsRedirect: boolean;
  originGroupId: string;
  originGroups: RawFrontDoorOriginGroup[];
}

export interface RawFrontDoorOriginGroup {
  id: string;
  name: string;
  profileId: string;
  loadBalancingSettings: any;
  healthProbeSettings?: any;
  origins: RawFrontDoorOrigin[];
}

export interface RawFrontDoorOrigin {
  id: string;
  name: string;
  hostName: string;
  httpPort: number;
  httpsPort: number;
  priority: number;
  weight: number;
  enabledState: string;
  originGroupId: string;
}

export interface RawTMProfile {
  id: string;
  name: string;
  resourceGroup: string;
  dnsName: string;
  routingMethod: string;
  monitorProtocol: string;
  monitorPort: number;
  monitorPath: string;
  ttl: number;
  endpoints: RawTMEndpoint[];
}

export interface RawTMEndpoint {
  id: string;
  name: string;
  profileId: string;
  endpointType: string;
  target: string;
  weight?: number;
  priority?: number;
  endpointStatus: string;
}

export interface RawAPIMService {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: string;
  gatewayUrl: string;
  developerPortalUrl?: string;
  virtualNetworkType: string;
  virtualNetworkSubnetId?: string;
  publicIpAddresses: string[];
  apis: RawAPIMApi[];
  backends: RawAPIMBackend[];
}

export interface RawAPIMApi {
  id: string;
  name: string;
  path: string;
  protocols: string[];
  subscriptionRequired: boolean;
  authType: string;
}

export interface RawAPIMBackend {
  id: string;
  name: string;
  url: string;
  protocol: string;
}

export interface RawAppGateway {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: string;
  wafEnabled: boolean;
  frontendIPs: string[];
  listeners: any[];
  backendPools: any[];
}

export interface RawVNetPeering {
  vnetId: string;
  peeringState: string;
  remoteVnetId: string;
  allowGatewayTransit: boolean;
  allowForwardedTraffic: boolean;
  useRemoteGateways: boolean;
}

export interface RawNsgRuleSet {
  nsgId: string;
  nsgName: string;
  rules: RawNsgRule[];
}

export interface RawNsgRule {
  ruleName: string;
  direction: string;
  priority: number;
  protocol: string;
  access: string;
  srcPrefix: string;
  srcPrefixes: string[];
  dstPrefix: string;
  dstPrefixes: string[];
  dstPort: string;
  dstPorts: string[];
}

export interface RawPrivateEndpoint {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  subnetId: string;
  privateLinkConnections: any[];
  networkInterfaces: any[];
}

export interface RawServiceEndpoint {
  vnetId: string;
  subnetId: string;
  service: string;
}

export interface RawFirewallRules {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  defaultAction: 'Allow' | 'Deny';
  ipRules: Array<{ value: string }>;
  vnetRules: Array<{ id: string; vnetId?: string }>;
  bypass?: string;
}

// ============================================================================
// Aggregate fetch output types
// ============================================================================

export interface IngressGraph {
  frontDoorProfiles: RawFrontDoorProfile[];
  trafficManagerProfiles: RawTMProfile[];
  apimServices: RawAPIMService[];
  appGateways: RawAppGateway[];
}

export interface NetworkTopology {
  vnetPeerings: RawVNetPeering[];
  nsgRules: RawNsgRuleSet[];
  privateEndpoints: RawPrivateEndpoint[];
  serviceEndpoints: RawServiceEndpoint[];
  firewallRules: RawFirewallRules[];
}

export interface RawIdentityResource {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  principalId: string;
  clientId: string;
  tenantId: string;
}

export interface RawSystemIdentityResource {
  resourceId: string;
  resourceType: string;
  resourceName: string;
  principalId: string;
  identityType: string;
}

export interface RawRoleAssignment {
  id: string;
  roleDefinitionId: string;
  principalId: string;
  principalType: string;
  scope: string;
  createdAt: string;
}

export interface IdentityGraph {
  userAssignedIdentities: RawIdentityResource[];
  systemAssignedIdentities: RawSystemIdentityResource[];
  roleAssignments: RawRoleAssignment[];
}

export interface RawResourceBatch {
  resources: any[];
}

// ============================================================================
// CloudGraph — final assembled output of CloudGraphBuilder
// ============================================================================

export interface GraphRelationship {
  id: string;
  tenantId: string;
  type: GraphRelationshipType;
  sourceId: string;
  targetId: string;
  confidence: 'deterministic' | 'heuristic';
  metadata: Record<string, any>;
}

export type GraphRelationshipType =
  // Ingress
  | 'ROUTES_TO'
  | 'HAS_ENDPOINT'
  | 'HAS_ROUTE'
  | 'HAS_ORIGIN_GROUP'
  | 'HAS_ORIGIN'
  | 'EXPOSES_API'
  | 'HAS_BACKEND'
  | 'RESOLVES_TO'
  // Networking
  | 'CONTAINS'
  | 'PEERED_WITH'
  | 'PROTECTED_BY'
  | 'HAS_PRIVATE_ENDPOINT'
  | 'HAS_SERVICE_ENDPOINT'
  | 'DEPLOYED_IN'
  | 'EXPOSED_VIA'
  | 'HAS_FIREWALL_RULE'
  | 'ACCESSIBLE_FROM'
  // Identity
  | 'ASSIGNED_IDENTITY'
  | 'HAS_ROLE'
  // Connectivity
  | 'CONNECTS_TO';

export interface CloudGraph {
  nodes: AnyGraphNode[];
  relationships: GraphRelationship[];
}
