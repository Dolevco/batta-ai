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
  // Ingress — Azure
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
  // Networking — Azure
  | 'VirtualNetwork'
  | 'Subnet'
  | 'NetworkSecurityGroup'
  | 'PrivateEndpoint'
  // Compute / PaaS — Azure backend targets
  | 'ContainerApp'
  | 'StorageAccount'
  | 'WebApp'
  // Identity — Azure
  | 'ManagedIdentity'
  | 'ServicePrincipal'
  // Ingress — AWS
  | 'CloudFrontDistribution'
  | 'ALB'
  | 'ALBListener'
  | 'ALBTargetGroup'
  | 'APIGatewayRestApi'
  | 'APIGatewayV2Api'
  | 'WAFWebACL'
  // Networking — AWS
  | 'VPC'
  | 'AWSSubnet'
  | 'SecurityGroup'
  | 'VPCEndpoint'
  | 'VPCPeering'
  | 'NATGateway'
  // Compute — AWS backend targets
  | 'EC2Instance'
  | 'LambdaFunction'
  | 'ECSService'
  // Identity — AWS
  | 'IAMRole'
  | 'IAMInstanceProfile';

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
// Compute / PaaS — backend targets
// ============================================================================

/**
 * Azure Container App backend.
 * Classification: CONFIDENTIAL — exposes network ingress FQDN and environment topology.
 * Never log hostName or environmentId raw values.
 */
export interface ContainerAppNode extends GraphNode {
  nodeType: 'ContainerApp';
  /** External FQDN assigned by Container Apps ingress, e.g. <app>.<env>.<region>.azurecontainerapps.io */
  fqdn: string;
  /** ARM ID of the Container Apps environment */
  environmentId: string;
  /** Whether external ingress is enabled */
  externalIngress: boolean;
  /** Target port of the container app */
  targetPort: number;
}

/**
 * Azure Storage Account backend.
 * Classification: CONFIDENTIAL — exposes storage endpoint hostnames.
 * Never log endpoint URLs raw.
 */
export interface StorageAccountNode extends GraphNode {
  nodeType: 'StorageAccount';
  /** Static-website endpoint hostname, e.g. <account>.z<n>.web.core.windows.net */
  staticWebHostname: string;
  /** Blob endpoint hostname, e.g. <account>.blob.core.windows.net */
  blobHostname: string;
  sku: string;
  kind: string;
  /** Whether static website hosting is enabled */
  staticWebsiteEnabled: boolean;
}

/**
 * Azure Web App (App Service) backend.
 * Classification: CONFIDENTIAL — exposes default hostname.
 */
export interface WebAppNode extends GraphNode {
  nodeType: 'WebApp';
  /** Default hostname assigned by App Service, e.g. <app>.azurewebsites.net */
  defaultHostname: string;
  kind: string;
  /** VNet integration subnet ARM ID, if configured */
  vnetSubnetId?: string;
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

// ============================================================================
// AWS — Ingress nodes
// ============================================================================

export interface CloudFrontDistributionNode extends GraphNode {
  nodeType: 'CloudFrontDistribution';
  cloudProvider: 'aws';
  domainName: string;
  aliases: string[];
  origins: { id: string; domainName: string; protocol: string }[];
  wafWebAclId?: string;
  priceClass: string;
  enabled: boolean;
}

export interface ALBNode extends GraphNode {
  nodeType: 'ALB';
  cloudProvider: 'aws';
  dnsName: string;
  scheme: 'internet-facing' | 'internal';
  vpcId: string;
  subnetIds: string[];
  securityGroupIds: string[];
  type: 'application' | 'network' | 'gateway';
}

export interface ALBListenerNode extends GraphNode {
  nodeType: 'ALBListener';
  cloudProvider: 'aws';
  albArn: string;
  port: number;
  protocol: string;
  sslPolicy?: string;
  defaultAction: string;
}

export interface ALBTargetGroupNode extends GraphNode {
  nodeType: 'ALBTargetGroup';
  cloudProvider: 'aws';
  protocol: string;
  port: number;
  targetType: 'instance' | 'ip' | 'lambda' | 'alb';
  vpcId?: string;
  healthCheckPath?: string;
}

export interface APIGatewayRestApiNode extends GraphNode {
  nodeType: 'APIGatewayRestApi';
  cloudProvider: 'aws';
  endpointTypes: string[];
  vpcEndpointIds?: string[];
}

export interface APIGatewayV2ApiNode extends GraphNode {
  nodeType: 'APIGatewayV2Api';
  cloudProvider: 'aws';
  protocolType: 'HTTP' | 'WEBSOCKET';
  apiEndpoint: string;
  corsEnabled: boolean;
}

export interface WAFWebACLNode extends GraphNode {
  nodeType: 'WAFWebACL';
  cloudProvider: 'aws';
  scope: 'CLOUDFRONT' | 'REGIONAL';
  capacity: number;
  managedRuleGroupCount: number;
  customRuleCount: number;
}

// ============================================================================
// AWS — Networking nodes
// ============================================================================

export interface VPCNode extends GraphNode {
  nodeType: 'VPC';
  cloudProvider: 'aws';
  cidrBlock: string;
  additionalCidrs: string[];
  isDefault: boolean;
  enableDnsSupport: boolean;
  enableDnsHostnames: boolean;
}

export interface AWSSubnetNode extends GraphNode {
  nodeType: 'AWSSubnet';
  cloudProvider: 'aws';
  vpcId: string;
  cidrBlock: string;
  availabilityZone: string;
  /** true if subnet auto-assigns a public IPv4 address — used for internet-exposure derivation */
  mapPublicIpOnLaunch: boolean;
  routeTableId?: string;
}

export interface SecurityGroupRule {
  protocol: string;
  fromPort: number;
  toPort: number;
  cidrRanges: string[];
  prefixListIds: string[];
  /** All security groups that are referenced as sources/destinations for this rule. */
  referencedGroupIds?: string[];
  description?: string;
}

export interface SecurityGroupNode extends GraphNode {
  nodeType: 'SecurityGroup';
  cloudProvider: 'aws';
  vpcId: string;
  inboundRules: SecurityGroupRule[];
  outboundRules: SecurityGroupRule[];
}

export interface VPCEndpointNode extends GraphNode {
  nodeType: 'VPCEndpoint';
  cloudProvider: 'aws';
  vpcId: string;
  serviceName: string;
  endpointType: 'Interface' | 'Gateway' | 'GatewayLoadBalancer';
  subnetIds: string[];
  privateDnsEnabled: boolean;
}

export interface VPCPeeringNode extends GraphNode {
  nodeType: 'VPCPeering';
  cloudProvider: 'aws';
  requesterVpcId: string;
  requesterAccountId: string;
  accepterVpcId: string;
  accepterAccountId: string;
  status: string;
}

export interface NATGatewayNode extends GraphNode {
  nodeType: 'NATGateway';
  cloudProvider: 'aws';
  vpcId: string;
  subnetId: string;
  natType: 'public' | 'private';
  elasticIpId?: string;
}

// ============================================================================
// AWS — Compute nodes (backend targets)
// ============================================================================

export interface EC2InstanceNode extends GraphNode {
  nodeType: 'EC2Instance';
  cloudProvider: 'aws';
  instanceType: string;
  subnetId: string;
  vpcId: string;
  privateIpAddress: string;
  publicIpAddress?: string;
  iamInstanceProfileArn?: string;
  securityGroupIds: string[];
}

export interface LambdaFunctionNode extends GraphNode {
  nodeType: 'LambdaFunction';
  cloudProvider: 'aws';
  runtime: string;
  handler: string;
  roleArn: string;
  vpcId?: string;
  subnetIds?: string[];
  securityGroupIds?: string[];
}

export interface ECSServiceNode extends GraphNode {
  nodeType: 'ECSService';
  cloudProvider: 'aws';
  clusterArn: string;
  taskDefinitionArn: string;
  launchType: 'EC2' | 'FARGATE' | 'EXTERNAL';
  vpcId?: string;
  subnetIds?: string[];
  securityGroupIds?: string[];
}

// ============================================================================
// AWS — Identity nodes
// ============================================================================

export interface IAMRoleNode extends GraphNode {
  nodeType: 'IAMRole';
  cloudProvider: 'aws';
  roleArn: string;
  /** Principal types that can assume this role (Service, Account, Federated) */
  trustedPrincipalTypes: string[];
  attachedPolicies: string[];
  maxSessionDuration: number;
}

export interface IAMInstanceProfileNode extends GraphNode {
  nodeType: 'IAMInstanceProfile';
  cloudProvider: 'aws';
  instanceProfileArn: string;
  roleArns: string[];
}

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
  | ContainerAppNode
  | StorageAccountNode
  | WebAppNode
  | ManagedIdentityNode
  | ServicePrincipalNode
  // AWS nodes
  | CloudFrontDistributionNode
  | ALBNode
  | ALBListenerNode
  | ALBTargetGroupNode
  | APIGatewayRestApiNode
  | APIGatewayV2ApiNode
  | WAFWebACLNode
  | VPCNode
  | AWSSubnetNode
  | SecurityGroupNode
  | VPCEndpointNode
  | VPCPeeringNode
  | NATGatewayNode
  | EC2InstanceNode
  | LambdaFunctionNode
  | ECSServiceNode
  | IAMRoleNode
  | IAMInstanceProfileNode;

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
// AWS Config raw shapes — output of aws-config.fetcher, input to aws-config.transformer
// ============================================================================

/**
 * A single resource record returned by AWS Config SelectResourceConfig /
 * SelectAggregateResourceConfig.  The `configuration` field is the raw
 * Config configuration JSON for the resource — structure varies per resourceType.
 */
export interface RawConfigResource {
  resourceId: string;
  resourceType: string;           // e.g. 'AWS::EC2::Instance', 'AWS::S3::Bucket'
  resourceName: string;
  accountId: string;
  region: string;                 // 'us-east-1', etc.  IAM/global resources → 'global'
  arn: string;
  tags: Record<string, string>;
  configuration: Record<string, unknown>;
  supplementaryConfiguration: Record<string, unknown>;
}

export type RawConfigResourceBatch = RawConfigResource[];

// ============================================================================
// AWS raw data shapes — output of fetchers, input to transformers
// ============================================================================

export interface RawCloudFrontDistribution {
  id: string;
  arn: string;
  domainName: string;
  aliases: string[];
  origins: { id: string; domainName: string; originProtocolPolicy: string }[];
  webAclId?: string;
  priceClass: string;
  enabled: boolean;
  region: string;
}

export interface RawALB {
  arn: string;
  name: string;
  dnsName: string;
  scheme: string;
  vpcId: string;
  availabilityZones: { subnetId: string; zoneName: string }[];
  securityGroups: string[];
  type: string;
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawALBListener {
  arn: string;
  loadBalancerArn: string;
  port: number;
  protocol: string;
  sslPolicy?: string;
  defaultActions: { type: string; targetGroupArn?: string }[];
}

export interface RawALBTargetGroup {
  arn: string;
  name: string;
  protocol: string;
  port: number;
  targetType: string;
  vpcId?: string;
  healthCheckPath?: string;
}

export interface RawAPIGatewayRestApi {
  id: string;
  name: string;
  endpointConfiguration: { types: string[]; vpcEndpointIds?: string[] };
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawAPIGatewayV2Api {
  apiId: string;
  name: string;
  protocolType: string;
  apiEndpoint: string;
  corsConfiguration?: { allowOrigins?: string[] };
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawWAFWebACL {
  id: string;
  name: string;
  arn: string;
  scope: string;
  capacity: number;
  rules: any[];
  region: string;
  accountId: string;
}

export interface RawVPC {
  vpcId: string;
  cidrBlock: string;
  cidrBlockAssociationSet: { cidrBlock: string }[];
  isDefault: boolean;
  enableDnsSupport: boolean;
  enableDnsHostnames: boolean;
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawAWSSubnet {
  subnetId: string;
  vpcId: string;
  cidrBlock: string;
  availabilityZone: string;
  mapPublicIpOnLaunch: boolean;
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawSecurityGroup {
  groupId: string;
  groupName: string;
  vpcId: string;
  inboundRules: {
    protocol: string;
    fromPort: number;
    toPort: number;
    ipRanges: string[];
    prefixListIds: string[];
    userIdGroupPairs: { groupId: string; description?: string }[];
  }[];
  outboundRules: {
    protocol: string;
    fromPort: number;
    toPort: number;
    ipRanges: string[];
    prefixListIds: string[];
    userIdGroupPairs: { groupId: string }[];
  }[];
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawVPCEndpoint {
  vpcEndpointId: string;
  vpcId: string;
  serviceName: string;
  vpcEndpointType: string;
  subnetIds: string[];
  privateDnsEnabled: boolean;
  state: string;
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawVPCPeering {
  vpcPeeringConnectionId: string;
  requesterVpcId: string;
  requesterAccountId: string;
  accepterVpcId: string;
  accepterAccountId: string;
  status: string;
  region: string;
}

export interface RawNATGateway {
  natGatewayId: string;
  vpcId: string;
  subnetId: string;
  connectivityType: string;
  natGatewayAddresses: { allocationId?: string }[];
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawEC2Instance {
  instanceId: string;
  instanceType: string;
  subnetId: string;
  vpcId: string;
  privateIpAddress: string;
  publicIpAddress?: string;
  iamInstanceProfile?: { arn: string };
  securityGroups: { groupId: string }[];
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawLambdaFunction {
  functionArn: string;
  functionName: string;
  runtime: string;
  handler: string;
  role: string;
  vpcConfig?: { vpcId: string; subnetIds: string[]; securityGroupIds: string[] };
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawECSService {
  serviceArn: string;
  serviceName: string;
  clusterArn: string;
  taskDefinition: string;
  launchType: string;
  networkConfiguration?: {
    awsvpcConfiguration?: { subnets: string[]; securityGroups: string[] };
  };
  region: string;
  accountId: string;
  tags: Record<string, string>;
}

export interface RawIAMRole {
  roleId: string;
  roleName: string;
  arn: string;
  assumeRolePolicyDocument: any;
  attachedPolicies: { policyArn: string; policyName: string }[];
  maxSessionDuration: number;
  accountId: string;
  tags: Record<string, string>;
  /** Derived from the trust policy — e.g. 'Service', 'AWS', 'Federated' */
  trustedPrincipalTypes?: string[];
}

export interface RawIAMInstanceProfile {
  instanceProfileId: string;
  instanceProfileName: string;
  arn: string;
  roles: { arn: string }[];
  accountId: string;
}

// ============================================================================
// AWS aggregate fetch output types
// ============================================================================

export interface AWSIngressGraph {
  cloudFrontDistributions: RawCloudFrontDistribution[];
  albs: RawALB[];
  albListeners: RawALBListener[];
  albTargetGroups: RawALBTargetGroup[];
  apiGatewayRestApis: RawAPIGatewayRestApi[];
  apiGatewayV2Apis: RawAPIGatewayV2Api[];
  wafWebAcls: RawWAFWebACL[];
}

export interface AWSNetworkTopology {
  vpcs: RawVPC[];
  subnets: RawAWSSubnet[];
  securityGroups: RawSecurityGroup[];
  vpcEndpoints: RawVPCEndpoint[];
  vpcPeerings: RawVPCPeering[];
  natGateways: RawNATGateway[];
}

export interface AWSIdentityGraph {
  iamRoles: RawIAMRole[];
  instanceProfiles: RawIAMInstanceProfile[];
  ec2Instances: RawEC2Instance[];
  lambdaFunctions: RawLambdaFunction[];
  ecsServices: RawECSService[];
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
  | 'CONNECTS_TO'
  // AWS-specific
  | 'DISTRIBUTES_TO'
  | 'HAS_LISTENER'
  | 'FORWARDS_TO'
  | 'CONNECTED_VIA'
  | 'HAS_VPC_ENDPOINT'
  | 'ASSUMES_ROLE';

export interface CloudGraph {
  nodes: AnyGraphNode[];
  relationships: GraphRelationship[];
}
