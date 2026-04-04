/**
 * Example: Complete Security Indexing Flow
 * 
 * This example demonstrates the full data indexer pipeline with security extraction,
 * showing how to index a repository and produce a graph-ready security index.
 */

import {
  CodeIndexingPipeline,
  CodeIndexerConfig,
  SecurityExtractor,
  SecurityExtractorConfig,
} from '@ai-agent/data-indexer';
import {
  GitHubIntegration,
  QdrantAdapter,
  Neo4jAdapter,
} from '@ai-agent/shared';
import { OpenAILLMHandler } from '@ai-agent/core';

/**
 * Example: Index a repository and extract security data
 */
async function indexRepositoryWithSecurity() {
  // 1. Setup integrations
  const githubIntegration = new GitHubIntegration({
    id: 'github-integration',
    name: 'GitHub Integration',
    enabled: true,
    tenantId: 'tenant-001',
    type: 'custom',
    config: {
      token: process.env.GITHUB_TOKEN || '',
      owner: 'example',
      repo: 'my-app',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // 2. Setup vector and graph databases
  const qdrantAdapter = new QdrantAdapter({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: 'security-index',
  });

  const neo4jAdapter = new Neo4jAdapter({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  });

  // 3. Setup LLM handler
  const llmHandler = new OpenAILLMHandler({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4',
  });

  // 4. Configure the indexing pipeline
  const config: CodeIndexerConfig = {
    cloneDir: './workspaces/repos',
    localPath: './workspaces/repos/my-app',
    enableCloudDiscovery: true,
    cloudDiscovery: {
      azure: {
        enabled: true,
        subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
        tenantId: process.env.AZURE_TENANT_ID,
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
      },
    },
    api: llmHandler,
    qdrant: qdrantAdapter,
    neo4j: neo4jAdapter,
  };

  // 5. Create and run the pipeline
  const pipeline = new CodeIndexingPipeline('tenant-001', githubIntegration, config);

  console.log('🚀 Starting security indexing pipeline...\n');

  const result = await pipeline.run('tenant-001', {
    repositories: ['example/my-app'],
    branches: ['main'],
  });

  // 6. Display results
  console.log('\n📊 Indexing Results:');
  console.log('='.repeat(50));
  console.log(`Duration: ${result.summary.duration}ms`);
  console.log(`Total Entities: ${result.summary.entitiesDiscovered}`);
  console.log(`Total Relationships: ${result.summary.relationshipsDiscovered}`);
  console.log(`Semantic Documents: ${result.summary.semanticDocumentsCreated}`);

  // 7. Break down entities by type
  const entityCounts = result.entities.reduce((acc, entity) => {
    acc[entity.entityType] = (acc[entity.entityType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n📦 Entities by Type:');
  Object.entries(entityCounts)
    .sort(([, a], [, b]) => b - a)
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  // 8. Break down relationships by type
  const relationshipCounts = result.relationships.reduce((acc, rel) => {
    acc[rel.type] = (acc[rel.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n🔗 Relationships by Type:');
  Object.entries(relationshipCounts)
    .sort(([, a], [, b]) => b - a)
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  // 9. Security-specific metrics
  const services = result.entities.filter(e => e.entityType === 'code_service');
  const apiEndpoints = result.entities.filter(e => e.entityType === 'api_endpoint');
  const identities = result.entities.filter(e => e.entityType === 'identity');
  const dataStores = result.entities.filter(e => e.entityType === 'data_store');
  const externalDeps = result.entities.filter(e => e.entityType === 'external_dependency');
  const networkSegments = result.entities.filter(e => e.entityType === 'network_segment');
  const trustBoundaries = result.entities.filter(e => e.entityType === 'trust_boundary');

  console.log('\n🔒 Security Metrics:');
  console.log(`  Services: ${services.length}`);
  console.log(`  API Endpoints: ${apiEndpoints.length}`);
  console.log(`  Identities: ${identities.length}`);
  console.log(`  Data Stores: ${dataStores.length}`);
  console.log(`  External Dependencies: ${externalDeps.length}`);
  console.log(`  Network Segments: ${networkSegments.length}`);
  console.log(`  Trust Boundaries: ${trustBoundaries.length}`);

  // 10. Threat analysis
  const entitiesWithThreats = result.entities.filter(
    e => e.threatModel?.identifiedThreats && e.threatModel.identifiedThreats.length > 0
  );

  const allThreats = entitiesWithThreats.flatMap(
    e => e.threatModel!.identifiedThreats!
  );

  const threatsBySeverity = allThreats.reduce((acc, threat) => {
    acc[threat.severity] = (acc[threat.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n⚠️  Identified Threats:');
  console.log(`  Total: ${allThreats.length}`);
  console.log(`  Critical: ${threatsBySeverity.critical || 0}`);
  console.log(`  High: ${threatsBySeverity.high || 0}`);
  console.log(`  Medium: ${threatsBySeverity.medium || 0}`);
  console.log(`  Low: ${threatsBySeverity.low || 0}`);
  console.log(`  Info: ${threatsBySeverity.info || 0}`);

  // 11. Risk assessment
  const entitiesWithRisk = result.entities.filter(e => e.threatModel?.riskScore);
  const avgRiskScore = entitiesWithRisk.length > 0
    ? entitiesWithRisk.reduce((sum, e) => sum + (e.threatModel!.riskScore || 0), 0) / entitiesWithRisk.length
    : 0;

  const highRiskEntities = entitiesWithRisk.filter(e => (e.threatModel!.riskScore || 0) > 60);

  console.log('\n📈 Risk Assessment:');
  console.log(`  Average Risk Score: ${avgRiskScore.toFixed(1)}`);
  console.log(`  High Risk Entities (>60): ${highRiskEntities.length}`);

  // 12. Internet exposure
  const internetExposed = result.entities.filter(
    e => e.threatModel?.internetExposed === true
  );

  console.log('\n🌐 Internet Exposure:');
  console.log(`  Internet-Exposed Entities: ${internetExposed.length}`);
  internetExposed.forEach(entity => {
    console.log(`    - ${entity.entityType}: ${entity.name || entity.id}`);
    if (entity.threatModel?.publicEndpoint) {
      console.log(`      Endpoint: ${entity.threatModel.publicEndpoint}`);
    }
  });

  // 13. Data classification
  const classifiedData = result.entities.filter(
    e => e.threatModel?.dataClassification
  );

  const dataByClassification = classifiedData.reduce((acc, entity) => {
    const classification = entity.threatModel!.dataClassification!;
    acc[classification] = (acc[classification] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n📁 Data Classification:');
  Object.entries(dataByClassification)
    .sort(([, a], [, b]) => b - a)
    .forEach(([classification, count]) => {
      console.log(`  ${classification}: ${count}`);
    });

  // 14. Compliance requirements
  const complianceReqs = new Set<string>();
  result.entities
    .filter(e => e.threatModel?.complianceRequirements)
    .forEach(e => {
      e.threatModel!.complianceRequirements!.forEach(req => complianceReqs.add(req));
    });

  console.log('\n📋 Compliance Requirements:');
  console.log(`  Frameworks: ${Array.from(complianceReqs).join(', ') || 'None'}`);

  // 15. Attack surface
  const totalPublicEndpoints = result.entities
    .filter(e => e.threatModel?.attackSurface)
    .reduce((sum, e) => sum + (e.threatModel!.attackSurface!.publicEndpoints || 0), 0);

  const totalExternalDeps = result.entities
    .filter(e => e.threatModel?.attackSurface)
    .reduce((sum, e) => sum + (e.threatModel!.attackSurface!.externalDependencies || 0), 0);

  console.log('\n🎯 Attack Surface:');
  console.log(`  Public Endpoints: ${totalPublicEndpoints}`);
  console.log(`  External Dependencies: ${totalExternalDeps}`);

  console.log('\n✅ Security indexing complete!\n');

  return result;
}

/**
 * Example: Query the security index for attack paths
 */
async function findAttackPaths() {
  console.log('🔍 Analyzing attack paths...\n');

  const neo4j = new Neo4jAdapter({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  });

  // Find paths from internet to sensitive data stores
  const query = `
    MATCH path = (internet:trust_boundary {boundaryType: 'external'})
      -[:EXPOSED_TO_INTERNET|CONTAINS|ASSUMES_ROLE|WRITES_TO|READS_FROM*1..10]->
      (dataStore:data_store {dataClassification: 'confidential'})
    RETURN path
    LIMIT 10
  `;

  const result = await neo4j.query(query);

  console.log(`Found ${result.length} attack paths from internet to confidential data\n`);

  result.forEach((record, index) => {
    console.log(`Attack Path ${index + 1}:`);
    // Display path nodes and relationships
    // (Simplified for example)
    console.log(`  ${JSON.stringify(record, null, 2)}\n`);
  });

  await neo4j.close();
}

/**
 * Example: Generate STRIDE threat report
 */
async function generateStrideReport() {
  console.log('📝 Generating STRIDE threat report...\n');

  const qdrant = new QdrantAdapter({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    collectionName: 'security-index',
  });

  // Search for entities with threats
  const results = await qdrant.search({
    query: 'threats security risks vulnerabilities',
    limit: 100,
    filter: {
      must: [
        { key: 'threatModel.identifiedThreats', match: { exists: true } },
      ],
    },
  });

  const threatsByCategory: Record<string, any[]> = {
    spoofing: [],
    tampering: [],
    repudiation: [],
    'information-disclosure': [],
    'denial-of-service': [],
    'elevation-of-privilege': [],
    other: [],
  };

  results.forEach(result => {
    const entity = result.metadata;
    if (entity.threatModel?.identifiedThreats) {
      entity.threatModel.identifiedThreats.forEach((threat: any) => {
        threatsByCategory[threat.category].push({
          entity: entity.name || entity.id,
          entityType: entity.entityType,
          threat,
        });
      });
    }
  });

  console.log('STRIDE Threat Report');
  console.log('='.repeat(50));

  Object.entries(threatsByCategory).forEach(([category, threats]) => {
    if (threats.length > 0) {
      console.log(`\n${category.toUpperCase()} (${threats.length} threats):`);
      threats.forEach(({ entity, entityType, threat }) => {
        console.log(`\n  Entity: ${entity} (${entityType})`);
        console.log(`  Threat: ${threat.description}`);
        console.log(`  Severity: ${threat.severity}`);
        console.log(`  Status: ${threat.status}`);
        if (threat.mitigations && threat.mitigations.length > 0) {
          console.log(`  Mitigations: ${threat.mitigations.join(', ')}`);
        }
      });
    }
  });

  console.log('\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    // 1. Index the repository
    const result = await indexRepositoryWithSecurity();

    // 2. Find attack paths
    await findAttackPaths();

    // 3. Generate STRIDE report
    await generateStrideReport();

    console.log('🎉 All done!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { indexRepositoryWithSecurity, findAttackPaths, generateStrideReport };
