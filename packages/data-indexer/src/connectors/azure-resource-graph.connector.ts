/**
 * Azure Resource Graph Connector
 * 
 * Fetches cloud resources from Azure using Azure Resource Graph API
 */

import { CloudResource, TenantId, ThreatModelData } from '@ai-agent/shared';
import { EntityIdUtils } from '../utils/id-generator';

export interface AzureResourceGraphConfig {
  subscriptionId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface AzureResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string;
  tags?: Record<string, string>;
  properties?: any;
  /** Top-level identity block (system/user-assigned managed identities) */
  identity?: {
    type?: string;          // "SystemAssigned" | "UserAssigned" | "SystemAssigned, UserAssigned" | "None"
    principalId?: string;   // Object ID of the system-assigned identity
    tenantId?: string;      // AAD tenant of the system-assigned identity
    clientId?: string;      // Client ID of the system-assigned identity
    userAssignedIdentities?: Record<string, {
      principalId?: string;
      clientId?: string;
    }>;
  };
}

/**
 * Azure Resource Graph Connector
 */
export class AzureResourceGraphConnector {
  private config: AzureResourceGraphConfig;
  private accessToken?: string;
  private tokenExpiry?: number;
  private idUtils: EntityIdUtils;

  constructor(config: AzureResourceGraphConfig, idUtils?: EntityIdUtils) {
    this.config = config;
    this.idUtils = idUtils ?? new EntityIdUtils();
  }

  /**
   * Fetch all cloud resources from Azure subscription
   */
  async fetchCloudResources(tenantId: TenantId): Promise<CloudResource[]> {
    const token = await this.getAccessToken();
    const resources = await this.queryResourceGraph(token);
    
    return resources.map(resource => this.transformToCloudResource(resource, tenantId));
  }

  /**
   * Get Azure AD access token
   */
  private async getAccessToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const tokenEndpoint = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://management.azure.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get Azure access token: ${response.statusText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Subtract 1 minute for safety
    
    return this.accessToken as string;
  }

  /**
   * Get all accessible Azure subscriptions
   */
  private async getSubscriptions(token: string): Promise<string[]> {
    const response = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get Azure subscriptions: ${response.statusText}`);
    }

    const data = await response.json() as { value: Array<{ subscriptionId: string }> };
    return data.value.map(sub => sub.subscriptionId);
  }

  /**
   * Query Azure Resource Graph for all resources (including identity blocks)
   */
  private async queryResourceGraph(token: string): Promise<AzureResource[]> {
    //const subscriptions = await this.getSubscriptions(token);
    
    // Include the top-level `identity` block so managed identity info is available
    const query = `resources | project id, name, type, resourceGroup, location, tags, properties, identity`;

    const response = await fetch('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriptions: [],
        query,
        options: { resultFormat: 'objectArray' }
      }),
    });

    if (!response.ok) {
      // Do NOT include the raw response body — it may contain subscription IDs,
      // resource paths, or internal detail. Status code is sufficient for diagnosis.
      throw new Error(`Failed to query Azure Resource Graph: HTTP ${response.status}`);
    }

    const data = await response.json() as { data: AzureResource[] };
    return data.data || [];
  }

  /**
   * Query Azure Resource Graph for managed identities
   * (Microsoft.ManagedIdentity/userAssignedIdentities)
   */
  async fetchManagedIdentityResources(token: string): Promise<AzureResource[]> {
    const query = `
      resources
      | where type =~ 'microsoft.managedidentity/userassignedidentities'
      | project id, name, type, resourceGroup, location, tags, properties
    `;

    const response = await fetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscriptions: [],
          query,
          options: { resultFormat: 'objectArray' },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to query managed identities: HTTP ${response.status}`);
    }

    const data = await response.json() as { data: AzureResource[] };
    return data.data || [];
  }

  /**
   * Query Azure Resource Graph for role assignments
   * (Microsoft.Authorization/roleAssignments)
   */
  async fetchRoleAssignmentResources(token: string): Promise<AzureResource[]> {
    const query = `
      authorizationresources
      | where type =~ 'microsoft.authorization/roleassignments'
      | project id, name, type, resourceGroup, location = '', properties
    `;

    const response = await fetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscriptions: [],
          query,
          options: { resultFormat: 'objectArray' },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to query role assignments: HTTP ${response.status}`);
    }

    const data = await response.json() as { data: AzureResource[] };
    return data.data || [];
  }

  /**
   * Expose the access-token getter for use by CloudDiscoveryStage
   * when it needs to make secondary queries.
   */
  async getToken(): Promise<string> {
    return this.getAccessToken();
  }

  /**
   * Transform Azure resource to canonical CloudResource
   */
  private transformToCloudResource(resource: AzureResource, tenantId: TenantId): CloudResource {
    const now = new Date().toISOString();
    const threatModel = this.extractThreatModel(resource);
    // Validate the ARM resource ID before using it as a natural key
    const armId = typeof resource.id === 'string' && resource.id.length > 0
      ? resource.id
      : `unknown-${resource.name}-${resource.type}`;

    return {
      // Use a deterministic hash-based ID (not the raw ARM path) so that entity IDs
      // are safe to embed in UI URLs without breaking routing or encoding.
      id: this.idUtils.cloudResourceId(tenantId, 'azure', armId),
      tenantId,
      entityType: 'cloud_resource',
      resourceType: this.mapResourceType(resource.type),
      cloudProvider: 'azure',
      name: resource.name,
      // Preserve the original ARM resource path for reference / cross-linking
      resourceId: armId,
      region: resource.location,
      threatModel,
      createdAt: now,
      updatedAt: now,
      confidence: 'deterministic',
      metadata: {
        resourceGroup: resource.resourceGroup,
        type: resource.type,
        tags: resource.tags || {},
        properties: resource.properties,
      },
    };
  }

  /**
   * Extract threat model data from Azure resource properties
   */
  private extractThreatModel(resource: AzureResource): ThreatModelData | undefined {
    const props = resource.properties || {};
    const resourceType = resource.type.toLowerCase();
    const threatModel: ThreatModelData = {
      trustBoundaries: [],
      identifiedThreats: [],
    };

    // Check for internet exposure based on resource type
    if (resourceType.includes('publicipaddress') || resourceType.includes('frontdoor') || 
        resourceType.includes('applicationgateway') || resourceType.includes('cdn')) {
      threatModel.internetExposed = true;
      threatModel.publicEndpoint = props.ipAddress || props.hostname || props.fqdn;
      threatModel.trustBoundaries?.push({
        name: 'Internet',
        type: 'EXTERNAL',
        description: 'Resource is exposed to the public internet',
      });
    }

    // Check for databases
    if (resourceType.includes('sql') || resourceType.includes('cosmos') || resourceType.includes('mysql') || 
        resourceType.includes('postgresql') || resourceType.includes('redis')) {
      const publicNetworkAccess = props.publicNetworkAccess?.toLowerCase();
      threatModel.internetExposed = publicNetworkAccess === 'enabled';
      
      if (threatModel.internetExposed) {
        threatModel.trustBoundaries?.push({
          name: 'Internet',
          type: 'EXTERNAL',
          description: 'Database allows public network access',
        });
      }

      // Check encryption
      threatModel.dataAtRest = {
        enabled: props.encryption?.status?.toLowerCase() === 'enabled' || 
                 props.encryption?.keyVaultProperties !== undefined,
        method: props.encryption?.keyVaultProperties ? 'Customer Managed Keys' : 'Platform Managed Keys',
        keyManagement: props.encryption?.keyVaultProperties ? 'Azure Key Vault' : 'Azure Platform',
      };

      threatModel.dataInTransit = {
        enabled: props.minimalTlsVersion !== undefined,
        method: props.minimalTlsVersion ? `TLS ${props.minimalTlsVersion}` : 'TLS 1.2',
      };

      threatModel.dataClassification = resource.tags?.['data-classification'] as any || 'internal';
    }

    // Check for storage accounts
    if (resourceType.includes('storageaccounts')) {
      threatModel.internetExposed = props.networkAcls?.defaultAction?.toLowerCase() === 'allow' || 
                                      props.allowBlobPublicAccess === true;
      
      if (threatModel.internetExposed) {
        threatModel.trustBoundaries?.push({
          name: 'Internet',
          type: 'EXTERNAL',
          description: 'Storage account allows public access',
        });
      }

      threatModel.dataAtRest = {
        enabled: props.encryption?.services !== undefined,
        method: props.encryption?.keySource === 'Microsoft.Keyvault' ? 'Customer Managed Keys' : 'Platform Managed Keys',
        keyManagement: props.encryption?.keySource === 'Microsoft.Keyvault' ? 'Azure Key Vault' : 'Azure Platform',
      };

      threatModel.dataInTransit = {
        enabled: props.supportsHttpsTrafficOnly === true,
        method: 'TLS 1.2',
      };
    }

    // Check for compute resources
    if (resourceType.includes('virtualmachines') || resourceType.includes('containerinstances')) {
      const hasPublicIP = props.networkProfile?.networkInterfaces?.some((nic: any) => 
        nic.properties?.ipConfigurations?.some((ip: any) => ip.properties?.publicIPAddress)
      );
      
      threatModel.internetExposed = hasPublicIP || false;
      
      if (threatModel.internetExposed) {
        threatModel.trustBoundaries?.push({
          name: 'Internet',
          type: 'EXTERNAL',
          description: 'Compute resource has public IP address',
        });
      }
    }

    // Check for web apps and APIs
    if (resourceType.includes('websites') || resourceType.includes('functionapp') || 
        resourceType.includes('webapp') || resourceType.includes('apimanagement')) {
      threatModel.internetExposed = true;
      threatModel.publicEndpoint = props.defaultHostName || props.hostNames?.[0];
      
      threatModel.trustBoundaries?.push({
        name: 'Internet',
        type: 'EXTERNAL',
        description: 'Web application is publicly accessible',
      });

      threatModel.authenticationMethod = props.siteAuthEnabled ? 'oauth' : 
                                         props.clientAffinityEnabled ? 'session' : 'none';

      threatModel.dataInTransit = {
        enabled: props.httpsOnly === true,
        method: 'TLS 1.2',
      };
    }

    // Generate threats based on exposure and configuration
    this.generateThreats(threatModel, resourceType, props);

    // Calculate risk score
    threatModel.riskScore = this.calculateRiskScore(threatModel);

    return Object.keys(threatModel).length > 2 ? threatModel : undefined;
  }

  /**
   * Generate threats based on resource configuration
   */
  private generateThreats(threatModel: ThreatModelData, resourceType: string, props: any): void {
    // Internet exposure threats
    if (threatModel.internetExposed) {
      threatModel.identifiedThreats?.push({
        id: 'STRIDE-S1',
        category: 'spoofing',
        description: 'Resource is exposed to the internet and may be vulnerable to spoofing attacks',
        severity: 'high',
        mitigations: ['Implement strong authentication', 'Use managed identities', 'Enable MFA'],
        status: 'identified',
      });

      threatModel.identifiedThreats?.push({
        id: 'STRIDE-D1',
        category: 'denial-of-service',
        description: 'Public endpoint may be targeted for DDoS attacks',
        severity: 'medium',
        mitigations: ['Enable Azure DDoS Protection', 'Implement rate limiting', 'Use WAF'],
        status: 'identified',
      });
    }

    // Data at rest encryption
    if (resourceType.includes('sql') || resourceType.includes('storage')) {
      if (!threatModel.dataAtRest?.enabled) {
        threatModel.identifiedThreats?.push({
          id: 'STRIDE-I1',
          category: 'information-disclosure',
          description: 'Data at rest is not encrypted, risking information disclosure',
          severity: 'critical',
          mitigations: ['Enable encryption at rest', 'Use customer-managed keys'],
          status: 'identified',
        });
      }
    }

    // Data in transit encryption
    if (!threatModel.dataInTransit?.enabled) {
      threatModel.identifiedThreats?.push({
        id: 'STRIDE-I2',
        category: 'information-disclosure',
        description: 'Data in transit is not encrypted, risking interception',
        severity: 'high',
        mitigations: ['Enforce HTTPS only', 'Use TLS 1.2 or higher'],
        status: 'identified',
      });
    }

    // Authentication issues
    if (threatModel.authenticationMethod === 'none' && threatModel.internetExposed) {
      threatModel.identifiedThreats?.push({
        id: 'STRIDE-E1',
        category: 'elevation-of-privilege',
        description: 'No authentication configured for internet-exposed resource',
        severity: 'critical',
        mitigations: ['Implement authentication', 'Use Azure AD integration', 'Enable API keys'],
        status: 'identified',
      });
    }
  }

  /**
   * Calculate risk score based on threat model
   */
  private calculateRiskScore(threatModel: ThreatModelData): number {
    let score = 0;

    // Internet exposure adds risk
    if (threatModel.internetExposed) score += 30;

    // Threats by severity
    threatModel.identifiedThreats?.forEach(threat => {
      if (threat.status === 'identified') {
        switch (threat.severity) {
          case 'critical': score += 25; break;
          case 'high': score += 15; break;
          case 'medium': score += 8; break;
          case 'low': score += 3; break;
        }
      }
    });

    // Lack of encryption
    if (!threatModel.dataAtRest?.enabled) score += 20;
    if (!threatModel.dataInTransit?.enabled) score += 15;

    // Cap at 100
    return Math.min(score, 100);
  }

  /**
   * Map Azure resource type to canonical resource type
   */
  private mapResourceType(azureType: string): CloudResource['resourceType'] {
    const lowerType = azureType.toLowerCase();
    
    if (lowerType.includes('compute') || lowerType.includes('virtualmachines') || 
        lowerType.includes('containerinstances') || lowerType.includes('kubernetes')) {
      return 'compute';
    }
    
    if (lowerType.includes('sql') || lowerType.includes('cosmos') || 
        lowerType.includes('database')) {
      return 'database';
    }
    
    if (lowerType.includes('storage') || lowerType.includes('blob')) {
      return 'storage';
    }
    
    if (lowerType.includes('network') || lowerType.includes('virtualnetwork') ||
        lowerType.includes('loadbalancer')) {
      return 'network';
    }
    
    if (lowerType.includes('queue') || lowerType.includes('servicebus') ||
        lowerType.includes('eventgrid') || lowerType.includes('eventhub')) {
      return 'queue';
    }
    
    if (lowerType.includes('redis') || lowerType.includes('cache')) {
      return 'cache';
    }
    
    return lowerType;
  }
}
