/**
 * Node icon mapping for graph visualization
 * Maps node types to SVG icon paths for visual representation
 * This is UI-only logic and should not be in the core package
 */

// Valid node types from core package
export type GraphNodeType = 
  | 'CodeModule' 
  | 'CodeService' 
  | 'BuildArtifact' 
  | 'DeploymentArtifact'
  | 'CloudResource' 
  | 'AzureIdentity'
  | 'Dependency'
  | 'Vulnerability'
  | 'Threat'
  | 'TrustBoundary'
  | 'RiskLevel';

/**
 * Get icon path for a given node type
 * Returns a path to an SVG icon that visually represents the entity type
 */
export function getNodeIcon(nodeType: GraphNodeType | string, metadata?: Record<string, any>): string {
  // For Vulnerability nodes, infer icon from package manager
  if (nodeType === 'Vulnerability' && metadata) {
    const vulnIcon = getVulnerabilityIcon(metadata);
    if (vulnIcon) return vulnIcon;
  }
  
  // For CloudResource nodes, infer specific resource type from metadata
  if (nodeType === 'CloudResource' && metadata) {
    const specificIcon = getCloudResourceIcon(metadata);
    if (specificIcon) return specificIcon;
  }
  
  // For AzureIdentity nodes, infer specific identity type from metadata
  if (nodeType === 'AzureIdentity' && metadata) {
    const identityIcon = getAzureIdentityIcon(metadata);
    if (identityIcon) return identityIcon;
  }
  
  // For BuildArtifact, detect Docker builds
  if (nodeType === 'BuildArtifact' && metadata) {
    const buildType = (metadata?.buildType || '').toLowerCase();
    const name = (metadata?.name || '').toLowerCase();
    const codePath = (metadata?.codePath || metadata?.path || '').toLowerCase();
    if (
      buildType.includes('docker') ||
      name.includes('docker') ||
      codePath.includes('dockerfile') ||
      codePath.includes('docker')
    ) {
      return '/images/docker.svg';
    }
  }

  // For CodeService and CodeModule, infer specific technology from metadata
  if ((nodeType === 'CodeService' || nodeType === 'CodeModule') && metadata) {
    const techIcon = getTechnologyIcon(metadata);
    if (techIcon) return techIcon;
  }
  
  // Fall back to node type mapping
  const iconMap: Record<string, string> = {
    'CodeModule': '/images/Icons/npm.svg',
    'CodeService': '/images/Icons/api.svg',
    'BuildArtifact': '/images/Icons/worker.svg',
    'DeploymentArtifact': '/images/Icons/worker.svg',
    'CloudResource': '/images/Icons/Azure/10007-icon-service-Resource-Groups.svg',
    'AzureIdentity': '/images/Icons/Azure/10035-icon-service-App-Services.svg',
    'Dependency': '/images/Icons/npm.svg',
    'Vulnerability': '/images/Icons/vulnerability.svg',
    'Threat': '/images/Icons/vulnerability.svg',
    'TrustBoundary': '/images/Icons/Azure/10061-icon-service-Virtual-Networks.svg',
    'RiskLevel': '/images/Icons/vulnerability.svg',
  };

  return iconMap[nodeType] || '/images/Icons/Azure/10001-icon-service-All-Resources.svg';
}

/**
 * Get icon for AzureIdentity nodes based on identity kind.
 * - system_assigned managed identity → App Services icon (the identity belongs to a service)
 * - user_assigned managed identity   → Resource Groups icon (standalone, reusable across services)
 * - service_principal                → App Services icon (AAD app registration / enterprise app)
 * Falls back to null so the caller uses the default iconMap entry.
 */
function getAzureIdentityIcon(metadata: Record<string, any>): string | null {
  const kind = (metadata?.identityKind || '').toLowerCase();

  if (kind === 'service_principal') {
    // Service principals are AAD app registrations — use the App Services icon
    return '/images/Icons/Azure/02680-icon-service-Entra-Identity-Custom-Roles.svg';
  }

  if (kind === 'system_assigned') {
    // System-assigned — tightly coupled to a single resource (service-level identity)
    return '/images/Icons/Azure/10227-icon-service-Managed-Identities.svg';
  }

  if (kind === 'user_assigned') {
    // User-assigned — standalone reusable identity resource
    return '/images/Icons/Azure/10227-icon-service-Managed-Identities.svg';
  }

  return null;
}

/**
 * Get icon from resource type string
 * Handles formats like "microsoft.storage/storageaccounts" or "Microsoft.Compute/virtualMachines"
 */
function getIconFromResourceType(resourceType: string): string | null {
  const lowerType = resourceType.toLowerCase();
  
  // Virtual Machines
  if (lowerType.includes('virtualmachines') || lowerType.includes('compute/vm')) {
    return '/images/Icons/Azure/10021-icon-service-Virtual-Machine.svg';
  }
  // App Services / Web Apps
  if (lowerType.includes('sites') || lowerType.includes('webapps') || lowerType.includes('web/sites')) {
    return '/images/Icons/Azure/10035-icon-service-App-Services.svg';
  }
  // Functions
  if (lowerType.includes('function')) {
    return '/images/Icons/Azure/10029-icon-service-Function-Apps.svg';
  }
  // Container Instances
  if (lowerType.includes('containerinstances')) {
    return '/images/Icons/Azure/10104-icon-service-Container-Instances.svg';
  }
  // Kubernetes (AKS)
  if (lowerType.includes('managedclusters') || lowerType.includes('kubernetes')) {
    return '/images/Icons/Azure/10023-icon-service-Kubernetes-Services.svg';
  }
  // Container Registry
  if (lowerType.includes('containerregistries')) {
    return '/images/Icons/Azure/10105-icon-service-Container-Registries.svg';
  }
  // Storage Accounts
  if (lowerType.includes('storageaccounts') || lowerType.includes('storage/storage')) {
    return '/images/Icons/Azure/10086-icon-service-Storage-Accounts.svg';
  }
  // Databases
  if (lowerType.includes('sqlservers') || lowerType.includes('databases') || lowerType.includes('sql/servers')) {
    return '/images/Icons/Azure/10130-icon-service-SQL-Database.svg';
  }
  if (lowerType.includes('cosmosdb') || lowerType.includes('documentdb')) {
    return '/images/Icons/Azure/10121-icon-service-Azure-Cosmos-DB.svg';
  }
  if (lowerType.includes('mysql')) {
    return '/images/Icons/Azure/10122-icon-service-Azure-Database-MySQL-Server.svg';
  }
  if (lowerType.includes('postgresql')) {
    return '/images/Icons/Azure/10131-icon-service-Azure-Database-PostgreSQL-Server.svg';
  }
  // Key Vault
  if (lowerType.includes('vaults') || lowerType.includes('keyvault')) {
    return '/images/Icons/Azure/10245-icon-service-Key-Vaults.svg';
  }
  
  return null;
}

/**
 * Get icon for Vulnerability based on package manager
 * Infers the icon from packageManager field in metadata
 */
function getVulnerabilityIcon(metadata: Record<string, any>): string | null {
  const packageManager = metadata?.packageManager || '';
  
  // Map package managers to their icons
  if (packageManager.toLowerCase() === 'npm' || packageManager.toLowerCase() === 'yarn' || packageManager.toLowerCase() === 'pnpm') {
    return '/images/Icons/npm.svg';
  }
  if (packageManager.toLowerCase() === 'pip' || packageManager.toLowerCase() === 'python') {
    return '/images/Icons/python.svg';
  }
  if (packageManager.toLowerCase() === 'maven' || packageManager.toLowerCase() === 'gradle') {
    return '/images/Icons/java.svg';
  }
  if (packageManager.toLowerCase() === 'nuget' || packageManager.toLowerCase() === 'dotnet') {
    return '/images/Icons/dotnet.svg';
  }
  
  // Default to vulnerability icon if we can't determine package manager
  return null;
}

/**
 * Get icon for CloudResource based on resource metadata
 * Infers the specific cloud resource type from resource ID, tags, or other metadata
 */
function getCloudResourceIcon(metadata: Record<string, any>): string | null {
  const resourceId = metadata?.id || metadata?.resourceId || '';
  const resourceType = (metadata?.resourceType || metadata?.type || '').toLowerCase();
  
  // Check resourceType/type field first (e.g., "microsoft.storage/storageaccounts")
  if (resourceType) {
    const icon = getIconFromResourceType(resourceType);
    if (icon) return icon;
  }
  
  // Parse Azure resource IDs (format: /subscriptions/{sub}/resourceGroups/{rg}/providers/{provider}/{type}/{name})
  if (resourceId.includes('/providers/')) {
    const match = resourceId.match(/\/providers\/[^\/]+\/([^\/]+)/i);
    if (match) {
      const azureType = match[1].toLowerCase();
      
      // Virtual Machines
      if (azureType.includes('virtualmachines')) {
        return '/images/Icons/Azure/10021-icon-service-Virtual-Machine.svg';
      }
      // App Services / Web Apps
      if (azureType.includes('sites') || azureType.includes('webapps')) {
        return '/images/Icons/Azure/10035-icon-service-App-Services.svg';
      }
      // Functions
      if (azureType.includes('function')) {
        return '/images/Icons/Azure/10029-icon-service-Function-Apps.svg';
      }
      // Container Instances
      if (azureType.includes('containerinstances')) {
        return '/images/Icons/Azure/10104-icon-service-Container-Instances.svg';
      }
      // Kubernetes (AKS)
      if (azureType.includes('managedclusters') || azureType.includes('kubernetes')) {
        return '/images/Icons/Azure/10023-icon-service-Kubernetes-Services.svg';
      }
      // Container Registry
      if (azureType.includes('containerregistries')) {
        return '/images/Icons/Azure/10105-icon-service-Container-Registries.svg';
      }
      // Storage Accounts
      if (azureType.includes('storageaccounts')) {
        return '/images/Icons/Azure/10086-icon-service-Storage-Accounts.svg';
      }
      // Databases
      if (azureType.includes('sqlservers') || azureType.includes('databases')) {
        return '/images/Icons/Azure/10130-icon-service-SQL-Database.svg';
      }
      if (azureType.includes('cosmosdb')) {
        return '/images/Icons/Azure/10121-icon-service-Azure-Cosmos-DB.svg';
      }
      if (azureType.includes('mysql')) {
        return '/images/Icons/Azure/10122-icon-service-Azure-Database-MySQL-Server.svg';
      }
      if (azureType.includes('postgresql')) {
        return '/images/Icons/Azure/10131-icon-service-Azure-Database-PostgreSQL-Server.svg';
      }
      // Key Vault
      if (azureType.includes('vaults') || azureType.includes('keyvault')) {
        return '/images/Icons/Azure/10245-icon-service-Key-Vaults.svg';
      }
    }
  }
  
  // Parse AWS ARNs (format: arn:aws:service:region:account:resource)
  if (resourceId.startsWith('arn:aws:')) {
    const parts = resourceId.split(':');
    if (parts.length >= 3) {
      const awsService = parts[2].toLowerCase();
      
      // EC2
      if (awsService === 'ec2') {
        return '/images/Icons/Azure/10021-icon-service-Virtual-Machine.svg';
      }
      // Lambda
      if (awsService === 'lambda') {
        return '/images/Icons/Azure/10029-icon-service-Function-Apps.svg';
      }
      // ECS/EKS
      if (awsService === 'ecs' || awsService === 'eks') {
        return '/images/Icons/Azure/10023-icon-service-Kubernetes-Services.svg';
      }
      // S3
      if (awsService === 's3') {
        return '/images/Icons/Azure/10086-icon-service-Storage-Accounts.svg';
      }
      // RDS
      if (awsService === 'rds') {
        return '/images/Icons/Azure/10130-icon-service-SQL-Database.svg';
      }
      // Secrets Manager
      if (awsService === 'secretsmanager') {
        return '/images/Icons/Azure/10245-icon-service-Key-Vaults.svg';
      }
    }
  }
  
  // Check resourceType field for generic patterns
  const lowerType = resourceType.toLowerCase();
  if (lowerType.includes('vm') || lowerType.includes('virtualmachine')) {
    return '/images/Icons/Azure/10021-icon-service-Virtual-Machine.svg';
  }
  if (lowerType.includes('function')) {
    return '/images/Icons/Azure/10029-icon-service-Function-Apps.svg';
  }
  if (lowerType.includes('kubernetes') || lowerType.includes('k8s')) {
    return '/images/Icons/Azure/10023-icon-service-Kubernetes-Services.svg';
  }
  if (lowerType.includes('container')) {
    return '/images/Icons/Azure/10104-icon-service-Container-Instances.svg';
  }
  if (lowerType.includes('storage')) {
    return '/images/Icons/Azure/10086-icon-service-Storage-Accounts.svg';
  }
  if (lowerType.includes('database') || lowerType.includes('sql')) {
    return '/images/Icons/Azure/10130-icon-service-SQL-Database.svg';
  }
  if (lowerType.includes('vault') || lowerType.includes('secret')) {
    return '/images/Icons/Azure/10245-icon-service-Key-Vaults.svg';
  }
  
  return null;
}

/**
 * Get icon for code services/modules based on technology metadata
 * Infers the technology stack from metadata like language, framework, path, etc.
 */
function getTechnologyIcon(metadata: Record<string, any>): string | null {
  const path = metadata?.path || '';
  const codePath = metadata?.codePath || '';
  const language = (metadata?.language || '').toLowerCase();
  const framework = (metadata?.framework || '').toLowerCase();
  const name = (metadata?.name || '').toLowerCase();
  const serviceType = (metadata?.serviceType || '').toLowerCase();
  const allPaths = `${path} ${codePath}`.toLowerCase();
  
  // Check for React (check before general Node/TypeScript)
  if (framework.includes('react') || 
      allPaths.includes('react') ||
      name.includes('react') ||
      name.includes('/ui')) {
    return '/images/Icons/react.svg';
  }
  
  // Check for Docker
  if (allPaths.includes('dockerfile') || allPaths.includes('docker') || name.includes('docker')) {
    return '/images/Icons/docker.svg';
  }
  
  // Check for Node.js/TypeScript/JavaScript
  if (language.includes('javascript') || 
      language.includes('typescript') ||
      language.includes('node') ||
      allPaths.includes('package.json') ||
      framework.includes('node')) {
    return '/images/Icons/node.svg';
  }
  
  // Check for Python
  if (language.includes('python') || allPaths.includes('requirements.txt') || allPaths.includes('.py')) {
    return '/images/Icons/python.svg';
  }
  
  // Check service type
  if (serviceType === 'api' || serviceType === 'rest' || serviceType === 'graphql') {
    return '/images/Icons/api.svg';
  }
  if (serviceType === 'worker' || serviceType === 'job') {
    return '/images/Icons/worker.svg';
  }
  
  // Default to API icon for services
  return null;
}

