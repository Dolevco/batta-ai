/**
 * Node Sanitizer
 *
 * All raw API responses MUST pass through sanitizeNode() before any graph node
 * is created or persisted.
 *
 * Rules applied in order:
 *  1. Parse through the supplied Zod schema (strict mode — unknown fields stripped).
 *  2. Redact any string value whose key matches the secret-field pattern.
 *  3. Normalise ARM IDs to lower-case.
 *  4. Validate CIDR strings.
 *  5. Truncate tag values to 512 chars.
 *
 * Security:
 *  - NodeSanitizationError only exposes { nodeType, fieldName, errorCode } — never
 *    the raw value that caused the error.
 *  - The redaction pattern is additive; it catches anything the Zod schema misses.
 */

import { z, ZodSchema } from 'zod';
import {
  GraphNode,
  GraphNodeType,
  NsgRule,
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
  VirtualNetworkNode,
  SubnetNode,
  NetworkSecurityGroupNode,
  PrivateEndpointNode,
  ManagedIdentityNode,
} from '@batta/shared';

// ============================================================================
// Error type
// ============================================================================

class NodeSanitizationError extends Error {
  constructor(
    public readonly nodeType: GraphNodeType,
    public readonly fieldName: string,
    public readonly errorCode: string,
  ) {
    super(`NodeSanitizationError: nodeType=${nodeType} field=${fieldName} code=${errorCode}`);
    this.name = 'NodeSanitizationError';
  }
}

// ============================================================================
// Secret-field redaction
// ============================================================================

/** Keys whose string values must be redacted regardless of schema type */
const SECRET_KEY_PATTERN = /password|secret|key|token|credential|connectionstring|sas/i;

function redactSecretFields<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(item => redactSecretFields(item)) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key) && typeof value === 'string') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecretFields(value);
      }
    }
    return result as T;
  }
  return obj;
}

// ============================================================================
// CIDR validation
// ============================================================================

const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

function normalizeCidr(value: string): string {
  return CIDR_RE.test(value) ? value : 'invalid-cidr';
}

// ============================================================================
// ARM ID normalisation
// ============================================================================

function normalizeArmId(value: string): string {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

// ============================================================================
// Tag truncation
// ============================================================================

function truncateTags(tags: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    result[k] = typeof v === 'string' && v.length > 512 ? v.substring(0, 512) : v;
  }
  return result;
}

// ============================================================================
// Core sanitizer
// ============================================================================

/**
 * Validate and sanitise a raw value against the given Zod schema.
 * Throws NodeSanitizationError if validation fails.
 */
export function sanitizeNode<T extends GraphNode>(
  raw: unknown,
  schema: ZodSchema<T>,
  nodeType: GraphNodeType,
): T {
  // 1. Redact secret fields before Zod parse (prevent secrets leaking in error messages)
  const redacted = redactSecretFields(raw);

  // 2. Zod parse (strict schemas strip unknown fields)
  const result = schema.safeParse(redacted);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new NodeSanitizationError(
      nodeType,
      firstIssue?.path?.join('.') ?? 'unknown',
      firstIssue?.code ?? 'PARSE_ERROR',
    );
  }

  let node = result.data;

  // 3. Normalise ARM ID
  node = {
    ...node,
    providerResourceId: normalizeArmId(node.providerResourceId),
  };

  // 4. Truncate tags
  if (node.tags && typeof node.tags === 'object') {
    node = { ...node, tags: truncateTags(node.tags) };
  }

  return node;
}

// ============================================================================
// Base node schema (reused by all subtypes)
// ============================================================================

const baseNodeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  cloudProvider: z.enum(['azure', 'aws', 'gcp', 'synthetic']),
  nodeType: z.string(),
  providerResourceId: z.string(),
  displayName: z.string(),
  region: z.string(),
  tags: z.record(z.string(), z.string()).default({}),
  indexedAt: z.string(),
  dataClassification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  internetExposed: z.boolean().default(false),
});

// ============================================================================
// Per-node-type schemas
// ============================================================================

export const FrontDoorProfileSchema = baseNodeSchema.extend({
  nodeType: z.literal('FrontDoorProfile'),
  sku: z.enum(['Standard_AzureFrontDoor', 'Premium_AzureFrontDoor']),
  wafPolicyId: z.string().optional(),
}) as ZodSchema<FrontDoorProfileNode>;

export const FrontDoorEndpointSchema = baseNodeSchema.extend({
  nodeType: z.literal('FrontDoorEndpoint'),
  profileId: z.string(),
  fqdn: z.string(),
  enabled: z.boolean(),
}) as ZodSchema<FrontDoorEndpointNode>;

export const FrontDoorRouteSchema = baseNodeSchema.extend({
  nodeType: z.literal('FrontDoorRoute'),
  endpointId: z.string(),
  patternsToMatch: z.array(z.string()),
  acceptedProtocols: z.array(z.enum(['Http', 'Https'])),
  httpsRedirect: z.boolean(),
  originGroupId: z.string(),
}) as ZodSchema<FrontDoorRouteNode>;

export const FrontDoorOriginGroupSchema = baseNodeSchema.extend({
  nodeType: z.literal('FrontDoorOriginGroup'),
  profileId: z.string(),
  loadBalancingSettings: z.object({
    sampleSize: z.number(),
    successfulSamplesRequired: z.number(),
  }),
  healthProbeSettings: z.object({
    path: z.string(),
    protocol: z.string(),
    intervalInSeconds: z.number(),
  }).optional(),
}) as ZodSchema<FrontDoorOriginGroupNode>;

export const FrontDoorOriginSchema = baseNodeSchema.extend({
  nodeType: z.literal('FrontDoorOrigin'),
  originGroupId: z.string(),
  hostName: z.string(),
  httpPort: z.number(),
  httpsPort: z.number(),
  priority: z.number(),
  weight: z.number(),
  enabledState: z.enum(['Enabled', 'Disabled']),
  resolvedResourceId: z.string().optional(),
}) as ZodSchema<FrontDoorOriginNode>;

export const TrafficManagerProfileSchema = baseNodeSchema.extend({
  nodeType: z.literal('TrafficManagerProfile'),
  dnsName: z.string(),
  routingMethod: z.enum(['Priority', 'Weighted', 'Performance', 'Geographic', 'MultiValue', 'Subnet']),
  monitorProtocol: z.string(),
  monitorPort: z.number(),
  monitorPath: z.string(),
  ttl: z.number(),
}) as ZodSchema<TrafficManagerProfileNode>;

export const TrafficManagerEndpointSchema = baseNodeSchema.extend({
  nodeType: z.literal('TrafficManagerEndpoint'),
  profileId: z.string(),
  endpointType: z.enum(['AzureEndpoints', 'ExternalEndpoints', 'NestedEndpoints']),
  target: z.string(),
  weight: z.number().optional(),
  priority: z.number().optional(),
  endpointStatus: z.enum(['Enabled', 'Disabled']),
  resolvedResourceId: z.string().optional(),
}) as ZodSchema<TrafficManagerEndpointNode>;

export const APIManagementServiceSchema = baseNodeSchema.extend({
  nodeType: z.literal('APIManagementService'),
  gatewayUrl: z.string(),
  developerPortalUrl: z.string().optional(),
  sku: z.string(),
  vnetType: z.enum(['None', 'External', 'Internal']),
  subnetId: z.string().optional(),
  publicIpAddresses: z.array(z.string()),
}) as ZodSchema<APIManagementServiceNode>;

export const APIMApiSchema = baseNodeSchema.extend({
  nodeType: z.literal('APIMApi'),
  apimServiceId: z.string(),
  apiPath: z.string(),
  protocols: z.array(z.enum(['http', 'https', 'ws', 'wss'])),
  subscriptionRequired: z.boolean(),
  authType: z.string(),
}) as ZodSchema<APIMApiNode>;

export const APIMBackendSchema = baseNodeSchema.extend({
  nodeType: z.literal('APIMBackend'),
  apimServiceId: z.string(),
  url: z.string(),
  protocol: z.enum(['http', 'soap']),
  resolvedResourceId: z.string().optional(),
}) as ZodSchema<APIMBackendNode>;

export const AppGatewaySchema = baseNodeSchema.extend({
  nodeType: z.literal('AppGateway'),
  sku: z.string(),
  wafEnabled: z.boolean(),
  frontendIPs: z.array(z.string()),
  listeners: z.array(z.object({
    protocol: z.string(),
    port: z.number(),
    hostNames: z.array(z.string()),
  })),
  backendPools: z.array(z.object({
    name: z.string(),
    fqdns: z.array(z.string()),
    ipAddresses: z.array(z.string()),
  })),
}) as ZodSchema<AppGatewayNode>;

export const VirtualNetworkSchema = baseNodeSchema.extend({
  nodeType: z.literal('VirtualNetwork'),
  addressSpaces: z.array(z.string()),
  dnsServers: z.array(z.string()),
  enableDdosProtection: z.boolean(),
}) as ZodSchema<VirtualNetworkNode>;

export const SubnetSchema = baseNodeSchema.extend({
  nodeType: z.literal('Subnet'),
  vnetId: z.string(),
  cidr: z.string().transform(normalizeCidr),
  delegatedTo: z.string().optional(),
  serviceEndpoints: z.array(z.string()),
  nsgId: z.string().optional(),
  routeTableId: z.string().optional(),
}) as ZodSchema<SubnetNode>;

const nsgRuleSchema: ZodSchema<NsgRule> = z.object({
  name: z.string(),
  priority: z.number(),
  protocol: z.enum(['Tcp', 'Udp', 'Icmp', '*']),
  access: z.enum(['Allow', 'Deny']),
  sourceCidrs: z.array(z.string()),
  sourceServiceTag: z.string().optional(),
  destinationCidrs: z.array(z.string()),
  destinationServiceTag: z.string().optional(),
  destinationPorts: z.array(z.string()),
});

export const NetworkSecurityGroupSchema = baseNodeSchema.extend({
  nodeType: z.literal('NetworkSecurityGroup'),
  inboundRules: z.array(nsgRuleSchema),
  outboundRules: z.array(nsgRuleSchema),
}) as ZodSchema<NetworkSecurityGroupNode>;

export const PrivateEndpointSchema = baseNodeSchema.extend({
  nodeType: z.literal('PrivateEndpoint'),
  subnetId: z.string(),
  targetResourceId: z.string(),
  groupIds: z.array(z.string()),
  privateIpAddress: z.string(),
  dnsZoneGroupIds: z.array(z.string()),
}) as ZodSchema<PrivateEndpointNode>;

export const ManagedIdentitySchema = baseNodeSchema.extend({
  nodeType: z.literal('ManagedIdentity'),
  principalId: z.string(),
  clientId: z.string(),
  identityKind: z.enum(['SystemAssigned', 'UserAssigned']),
  assignedToResourceIds: z.array(z.string()),
}) as ZodSchema<ManagedIdentityNode>;
