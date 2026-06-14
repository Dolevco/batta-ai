/**
 * Stage 4.7: Data Store Consolidation
 *
 * Collects raw data-store evidence from CodeService and BusinessFeature entities
 * and promotes them into first-class DataStore canonical entities.
 *
 * Clustering strategy
 * ───────────────────
 * Evidence is clustered by (technologyFamily, serviceId) — NOT by raw name.
 * Multiple evidence sources (static-analysis + DFD) that refer to the same
 * logical technology for the same service are merged into one DataStore entity.
 *
 * Display name priority: DFD label > dep.name > dep.resourceName > tech family.
 *
 * Security notes:
 *   - Entity IDs are deterministic sha256 hashes (tenantId | 'data_store' | key).
 *   - Store names originate from schema-constrained LLM output — never raw user input.
 *   - No external network calls; operates entirely on in-memory pipeline state.
 *   - Tenant-scoped: all entities are stamped with the provided tenantId.
 */

import crypto from 'crypto';
import type {
  TenantId,
  CanonicalEntity,
  CodeService,
  DataStore,
  DataStoreServiceAccess,
  BusinessFeature,
  Relationship,
  RelationshipType,
} from '@batta/shared';
import type { DataStoreConsolidationOutput, ExtractionError } from '../pipeline.types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function deterministicId(tenantId: TenantId, ...parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update([tenantId, 'data_store', ...parts].join('|'))
    .digest('hex')
    .slice(0, 40);
}

/**
 * Map any technology string or store label to a canonical family name.
 * This is the sole clustering key — evidence with the same family+serviceId merges.
 */
function technologyFamily(input: string): string {
  const s = input.toLowerCase();
  if (s.includes('mongo')) return 'mongodb';
  if (s.includes('redis')) return 'redis';
  if (s.includes('postgres') || s === 'pg') return 'postgresql';
  if (s.includes('mysql')) return 'mysql';
  if (s.includes('mssql') || s.includes('sqlserver') || s.includes('sql server')) return 'mssql';
  if (s.includes('cosmos')) return 'cosmosdb';
  if (s.includes('neo4j')) return 'neo4j';
  if (s.includes('dynamo')) return 'dynamodb';
  if (s.includes('sqlite')) return 'sqlite';
  if (s.includes('elastic')) return 'elasticsearch';
  if (s.includes('redis')) return 'redis';
  if (s.includes('memcache')) return 'memcached';
  if (s.includes('disk') || s.includes('sails-disk') || s.includes('local') || s === 'disk storage') return 'disk';
  if (s.includes('blob') || s.includes('azure-blob') || s.includes('azure-storage') || s === 's3' || s === 'gcs') return 'blob_storage';
  if (s.includes('servicebus') || s.includes('kafka') || s.includes('rabbitmq') || s.includes('sqs') || s.includes('queue')) return 'queue';
  if (s.includes('session')) return 'session_store';
  // For unknowns, normalise to the raw input so they don't all merge
  return s.replace(/[^a-z0-9]/g, '_');
}

const CLASSIFICATION_ORDER = ['public', 'internal', 'confidential', 'restricted'] as const;
type DataClassification = (typeof CLASSIFICATION_ORDER)[number];

function maxClassification(
  a?: DataClassification,
  b?: DataClassification,
): DataClassification | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return CLASSIFICATION_ORDER.indexOf(a) >= CLASSIFICATION_ORDER.indexOf(b) ? a : b;
}

function makeRelationship(
  tenantId: TenantId,
  type: RelationshipType,
  sourceId: string,
  targetId: string,
): Relationship {
  const id = crypto
    .createHash('sha256')
    .update([tenantId, type, sourceId, targetId].join('|'))
    .digest('hex')
    .slice(0, 40);
  return {
    id,
    tenantId,
    type,
    sourceId,
    targetId,
    validFrom: new Date().toISOString(),
    confidence: 'heuristic',
    metadata: {},
  };
}

function inferStoreType(family: string): DataStore['storeType'] {
  if (['mongodb', 'postgresql', 'mysql', 'mssql', 'cosmosdb', 'neo4j', 'dynamodb', 'sqlite', 'elasticsearch'].includes(family))
    return 'database';
  if (['redis', 'memcached'].includes(family)) return 'cache';
  if (family === 'blob_storage') return 'blob_storage';
  if (family === 'queue') return 'queue';
  if (family === 'disk') return 'file_system';
  return 'other';
}

/** Human-readable display name for a technology family */
function familyDisplayName(family: string): string {
  const map: Record<string, string> = {
    mongodb: 'MongoDB', redis: 'Redis', postgresql: 'PostgreSQL',
    mysql: 'MySQL', mssql: 'SQL Server', cosmosdb: 'CosmosDB',
    neo4j: 'Neo4j', dynamodb: 'DynamoDB', sqlite: 'SQLite',
    elasticsearch: 'Elasticsearch', memcached: 'Memcached',
    blob_storage: 'Blob Storage', queue: 'Queue',
    disk: 'Disk Storage', session_store: 'Session Store',
  };
  return map[family] ?? family;
}

// ── Evidence record ───────────────────────────────────────────────────────────

interface EvidenceRecord {
  /** Canonical family used as cluster key */
  family: string;
  /** Preferred display name (DFD label > dep.name > dep.resourceName) */
  displayName: string;
  /** Raw resource/instance name for detail context (e.g. table names, db name) */
  instanceName?: string;
  serviceId?: string;
  serviceName?: string;
  featureId?: string;
  featureName?: string;
  dataTypes?: string[];
  dataClassification?: DataClassification;
  encryptionAtRest?: boolean;
  accessPattern?: 'read' | 'write' | 'read_write';
  tableNames?: string[];
  source: 'dfd' | 'static_analysis';
}

// ── Main Stage ─────────────────────────────────────────────────────────────────

export class DataStoreConsolidationStage {
  run(
    tenantId: TenantId,
    entities: CanonicalEntity[],
  ): DataStoreConsolidationOutput {
    const errors: ExtractionError[] = [];
    const now = new Date().toISOString();

    const services = entities.filter(e => e.entityType === 'code_service') as CodeService[];
    // feature_analysis entities store the full BusinessFeature inside `metadata`
    const features = (entities as any[])
      .filter((e: any) => e.entityType === 'feature_analysis')
      .map((e: any) => (e.metadata?.dataFlowDiagram !== undefined ? { ...e.metadata, id: e.id } : e)) as BusinessFeature[];
    const cloudResources = entities.filter(e => e.entityType === 'cloud_resource');

    // ── Step 1: Collect evidence ─────────────────────────────────────────────
    const evidence: EvidenceRecord[] = [];

    for (const svc of services) {
      const svcAny = svc as any;

      // serviceDependencyMap.databases[]
      for (const db of (svcAny.serviceDependencyMap?.databases ?? []) as any[]) {
        if (!db.technology && !db.resourceName) continue;
        const family = technologyFamily(db.technology ?? db.resourceName ?? '');
        evidence.push({
          family,
          displayName: db.technology ?? db.resourceName ?? family,
          instanceName: db.resourceName,
          tableNames: db.tableNames,
          dataClassification: db.dataClassification,
          serviceId: svc.id,
          serviceName: svc.name,
          source: 'static_analysis',
        });
      }

      // serviceDependencyMap.storageAccess[]
      for (const s of (svcAny.serviceDependencyMap?.storageAccess ?? []) as any[]) {
        const provider = s.provider ?? 'blob';
        const family = technologyFamily(provider);
        evidence.push({
          family,
          displayName: provider,
          instanceName: s.bucket ?? s.container,
          dataClassification: s.dataClassification,
          serviceId: svc.id,
          serviceName: svc.name,
          accessPattern: s.access === 'read' ? 'read' : s.access === 'write' ? 'write' : 'read_write',
          source: 'static_analysis',
        });
      }

      // externalDeps (from ServiceAnalyzer surface pass and serviceExternalSurface)
      const allExternalDeps: any[] = [
        ...(svcAny.serviceExternalSurface?.externalDeps ?? []),
        ...(svcAny.externalDeps ?? []),
      ];
      const seenFamilies = new Set<string>();
      for (const dep of allExternalDeps) {
        if (!['database', 'cache', 'storage'].includes(dep.type)) continue;
        const family = technologyFamily(dep.name ?? dep.resourceName ?? dep.type ?? '');
        if (seenFamilies.has(family)) continue;
        seenFamilies.add(family);
        evidence.push({
          family,
          // dep.name is the technology ("MongoDB"), dep.resourceName is the instance ("mongo")
          displayName: dep.name ?? dep.resourceName ?? familyDisplayName(family),
          instanceName: dep.resourceName !== dep.name ? dep.resourceName : undefined,
          dataClassification: dep.dataClassification,
          serviceId: svc.id,
          serviceName: svc.name,
          source: 'static_analysis',
        });
      }
    }

    // From BusinessFeature DFDs
    for (const feat of features) {
      const featAny = feat as any;
      const dfd = featAny.dataFlowDiagram;
      if (!dfd) continue;
      const dfdStores: any[] = dfd.dataStores ?? [];
      const flows: any[] = dfd.flows ?? [];
      const processes: any[] = dfd.processes ?? [];
      const featureName: string = featAny.name ?? '';
      const featureServiceIds: string[] = featAny.sourceServiceIds ?? [];
      const featureServiceNames: string[] = featAny.sourceServiceNames ?? [];

      for (const store of dfdStores) {
        if (!store.label) continue;

        const family = technologyFamily(store.technology ?? store.nodeType ?? store.label);

        // DFD flows use `from`/`to` (store node id), not `sourceId`/`targetId`
        const relatedFlows = flows.filter((f: any) => f.to === store.id || f.from === store.id);
        const dataTypes = [...new Set(relatedFlows.flatMap((f: any) => f.dataTypes ?? []))] as string[];

        // Infer accessPattern from related flows
        const hasRead = relatedFlows.some((f: any) => f.from === store.id);
        const hasWrite = relatedFlows.some((f: any) => f.to === store.id);
        const accessPattern: 'read' | 'write' | 'read_write' =
          hasRead && hasWrite ? 'read_write' : hasRead ? 'read' : hasWrite ? 'write' : 'read_write';

        // Service attribution: process at the other end of the flow, or feature's service
        const processOnOtherEnd = processes.find((p: any) =>
          relatedFlows.some((f: any) => f.from === p.id || f.to === p.id),
        );
        const serviceId = processOnOtherEnd?.serviceId ?? featureServiceIds[0];
        const serviceName = processOnOtherEnd?.serviceName ?? featureServiceNames[0];

        evidence.push({
          family,
          // DFD label is the authoritative display name
          displayName: store.label,
          dataClassification: store.dataClassification,
          encryptionAtRest: store.encryptionAtRest,
          featureId: featAny.id,
          featureName,
          serviceId,
          serviceName,
          dataTypes,
          accessPattern,
          source: 'dfd',
        });
      }
    }

    if (evidence.length === 0) {
      return { dataStores: [], relationships: [], errors };
    }

    // ── Step 2: Cluster by (family, serviceId) ────────────────────────────────
    // Each unique (technology family, service) pair → one DataStore entity.
    // This means the same MongoDB accessed by two services becomes two entities
    // (intentional: they may have different access patterns and data types).
    // If serviceId is unknown, use '__unknown__' so they still cluster.
    const clusters = new Map<string, EvidenceRecord[]>();
    for (const ev of evidence) {
      const key = `${ev.family}::${ev.serviceId ?? '__unknown__'}`;
      const existing = clusters.get(key);
      if (existing) {
        existing.push(ev);
      } else {
        clusters.set(key, [ev]);
      }
    }

    // ── Step 3: Build DataStore entities + relationships ─────────────────────
    const dataStores: CanonicalEntity[] = [];
    const relationships: Relationship[] = [];

    for (const [key, evs] of clusters) {
      const family = evs[0].family;

      // Display name: prefer DFD source, then longest static-analysis name
      const dfdEv = evs.find(e => e.source === 'dfd');
      const bestName = dfdEv?.displayName
        ?? evs.reduce((best, e) => e.displayName.length > best.length ? e.displayName : best, '');

      const technology = familyDisplayName(family);
      const storeId = deterministicId(tenantId, key);

      // Aggregate service accesses (one per service)
      const serviceMap = new Map<string, DataStoreServiceAccess>();
      for (const ev of evs) {
        if (!ev.serviceId || !ev.serviceName) continue;
        const existing = serviceMap.get(ev.serviceId);
        if (!existing) {
          serviceMap.set(ev.serviceId, {
            serviceId: ev.serviceId,
            serviceName: ev.serviceName,
            accessPattern: ev.accessPattern ?? 'read_write',
            dataTypes: ev.dataTypes ?? [],
            resourceNames: ev.tableNames,
            featureIds: ev.featureId ? [ev.featureId] : [],
            evidence: ev.source,
          });
        } else {
          const order = ['read', 'write', 'read_write'];
          const ei = order.indexOf(existing.accessPattern);
          const ni = ev.accessPattern ? order.indexOf(ev.accessPattern) : -1;
          if (ni > ei) existing.accessPattern = ev.accessPattern!;
          for (const dt of (ev.dataTypes ?? [])) {
            if (!existing.dataTypes.includes(dt)) existing.dataTypes.push(dt);
          }
          if (ev.featureId && !existing.featureIds.includes(ev.featureId)) {
            existing.featureIds.push(ev.featureId);
          }
          if (ev.source === 'static_analysis' && existing.evidence === 'dfd') existing.evidence = 'both';
          else if (ev.source === 'dfd' && existing.evidence === 'static_analysis') existing.evidence = 'both';
          if (ev.tableNames) {
            existing.resourceNames = [...new Set([...(existing.resourceNames ?? []), ...ev.tableNames])];
          }
        }
      }
      const serviceAccess = Array.from(serviceMap.values());

      const allDataTypes = [...new Set(evs.flatMap(e => e.dataTypes ?? []))];

      const featureMap = new Map<string, string>();
      for (const ev of evs) {
        if (ev.featureId) featureMap.set(ev.featureId, ev.featureName ?? ev.featureId);
      }
      const featureIds = [...featureMap.keys()];
      const featureNames = [...featureMap.values()];

      let dataClassification: DataClassification | undefined;
      for (const ev of evs) {
        dataClassification = maxClassification(dataClassification, ev.dataClassification as DataClassification);
      }

      const encryptionAtRest = evs.some(e => e.encryptionAtRest === true) ? true : undefined;

      // ── Step 4: Correlate to CloudResource ────────────────────────────────
      let cloudResourceId: string | undefined;
      let cloudResourceName: string | undefined;
      const famLower = family.toLowerCase();
      // Collect all instance names for name matching
      const instanceNames = [...new Set(evs.map(e => e.instanceName).filter(Boolean) as string[])];

      for (const cr of cloudResources) {
        const crAny = cr as any;
        const crName = (crAny.displayName ?? crAny.name ?? crAny.resourceName ?? '').toLowerCase();
        const crType = (crAny.resourceType ?? crAny.nodeType ?? '').toLowerCase();

        const techMatches =
          (famLower === 'redis' && (crType.includes('redis') || crType.includes('cache'))) ||
          (famLower === 'blob_storage' && crType.includes('storage')) ||
          (['postgresql', 'mysql', 'cosmosdb', 'mongodb', 'mssql'].includes(famLower) &&
            (crType.includes('sql') || crType.includes('cosmos') || crType.includes('database')));

        // Only match by name if a specific instance name appears in the cloud resource name
        const nameMatches = instanceNames.some(n => n.length >= 6 && crName.includes(n.toLowerCase()));

        if (techMatches && nameMatches) {
          cloudResourceId = cr.id;
          cloudResourceName = crAny.displayName ?? crAny.name ?? crAny.resourceName;
          break;
        }
      }

      const ds: DataStore = {
        id: storeId,
        tenantId,
        entityType: 'data_store',
        createdAt: now,
        updatedAt: now,
        confidence: 'heuristic',
        metadata: { source: 'consolidation-stage' },
        lastIndexedAt: now,
        name: bestName,
        storeType: inferStoreType(family),
        technology,
        dataClassification,
        encryptionAtRest,
        cloudResourceId,
        cloudResourceName,
        serviceAccess,
        dataTypes: allDataTypes,
        featureIds,
        featureNames,
      };

      dataStores.push(ds as unknown as CanonicalEntity);

      for (const sa of serviceAccess) {
        const relType: RelationshipType =
          sa.accessPattern === 'read' ? 'READS_FROM_STORE'
          : sa.accessPattern === 'write' ? 'WRITES_TO_STORE'
          : 'ACCESSES_STORE';
        relationships.push(makeRelationship(tenantId, relType, sa.serviceId, storeId));
      }

      if (cloudResourceId) {
        relationships.push(makeRelationship(tenantId, 'BACKED_BY', storeId, cloudResourceId));
      }

      for (const fid of featureIds) {
        relationships.push(makeRelationship(tenantId, 'FEATURE_USES_STORE', fid, storeId));
      }
    }

    console.log(
      `[DataStoreConsolidation] Consolidated ${evidence.length} evidence records ` +
      `into ${dataStores.length} data stores, ${relationships.length} relationships`,
    );

    return { dataStores, relationships, errors };
  }
}
