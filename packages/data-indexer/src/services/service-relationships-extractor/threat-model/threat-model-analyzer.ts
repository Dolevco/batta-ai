import type { ILLMApiHandler, Message } from '@ai-agent/core';
import type {
  CloudResource,
  CodeService,
  EntryPoint,
  Relationship,
  ThreatModelData,
} from '@ai-agent/shared';
import { PersistenceHelper } from '../helpers/persistence';

/**
 * Step 7 – Service Threat Model Analysis
 *
 * Analyses each service's security posture using the full relationship graph
 * from Steps 2–6. Updates the service's threatModel field and persists the
 * result to Qdrant.
 */
export class ThreatModelAnalyzer {
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly persistence: PersistenceHelper,
  ) {}

  async analyzeServiceThreatModels(
    repositoryPath: string,
    services: CodeService[],
    cloudResources: CloudResource[],
    tenantId: string,
  ): Promise<CodeService[]> {
    const updated: CodeService[] = [];

    for (const service of services) {
      console.log(`   [SRE]   🔒 Threat model: ${service.name}`);

      // Fetch cloud relationships and dependent services independently from Neo4j.
      const serviceRels = await this.persistence.getCloudRelationshipsForService(tenantId, service.id);
      const dependentServices = await this.persistence.getDependentServices(tenantId, service.id);

      const relatedResources = serviceRels
        .filter(r => r.sourceId === service.id && (r.type === 'DEPLOYED_TO' || r.type === 'USES'))
        .map(r => cloudResources.find(cr => cr.id === r.targetId))
        .filter((r): r is CloudResource => r !== undefined);

      try {
        const threatModelData = await this.extractThreatModelData(
          service, relatedResources, serviceRels, repositoryPath, dependentServices,
        );

        const updatedService: CodeService = {
          ...service,
          threatModel: { ...service.threatModel, ...threatModelData },
        };

        await this.persistence.persistServiceThreatModel(updatedService);
        updated.push(updatedService);
        console.log(`   [SRE]     ✅ ${service.name}: threat model updated`);
      } catch (err) {
        console.error(
          `   [SRE]     ❌ ${service.name}: threat model analysis failed:`,
          err instanceof Error ? err.message : String(err),
        );
        updated.push(service);
      }
    }

    return updated;
  }

  /**
   * Extract structured threat model data for a single service via LLM.
   *
   * Security: the LLM response is parsed with a regex+JSON.parse guard and
   * each field is validated individually before being stored — never stored raw.
   */
  private async extractThreatModelData(
    service: CodeService,
    relatedResources: CloudResource[],
    relationships: Relationship[],
    repositoryPath: string,
    dependentServices: CodeService[],
  ): Promise<Partial<ThreatModelData>> {
    const context = this.buildThreatModelContext(service, relatedResources, relationships, dependentServices);

    const systemPrompt = `You are a security analyst specialising in threat modelling and STRIDE analysis.
Analyse the service described below and return a JSON object with a "threatModel" key.
Only include fields you can confidently determine from evidence — do NOT guess.
Evidence must cite specific files or config keys; never include actual secret values.

OUTPUT FORMAT:
{
  "threatModel": {
    "internetExposed": boolean,
    "publicEndpoint": string,
    "authenticationMethod": string,
    "authorizationModel": string,
    "identityProviders": string[],
    "privilegeLevel": string,
    "dataClassification": string,
    "dataAtRest": { "enabled": boolean, "method": string, "keyManagement": string },
    "dataInTransit": { "enabled": boolean, "method": string },
    "sensitiveDataTypes": string[],
    "securityControls": [{ "id": string, "type": string, "name": string, "implemented": boolean, "effectiveness": string }],
    "identifiedThreats": [{ "id": string, "category": string, "description": string, "severity": string, "mitigations": string[], "status": string }],
    "riskScore": number,
    "complianceRequirements": string[],
    "mitreAttackTactics": string[],
    "mitreAttackTechniques": string[]
  },
  "reasoning": string,
  "evidenceFiles": string[]
}`;

    const userPrompt = `${context}

Read the service source files, deployment configs, and related cloud resource settings.
Apply STRIDE threat modelling. Calculate riskScore 0-100 based on:
  +20 internet-exposed, +30 sensitive data, +25 missing auth, +15 missing encryption,
  +10 per critical/high threat, -5 per effective mitigation.

Return the JSON response.`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.api.createCompletion(messages);
    return this.parseThreatModelResponse(response.content);
  }

  private buildThreatModelContext(
    service: CodeService,
    relatedResources: CloudResource[],
    relationships: Relationship[],
    dependentServices: CodeService[],
  ): string {
    const parts: string[] = [
      '=== SERVICE ===',
      `Name: ${service.name}`,
      `ID: ${service.id}`,
      `Type: ${service.serviceType}`,
      `Path: ${service.codePath}`,
      `Language: ${service.language}`,
      `Tech Stack: ${service.techStack?.join(', ') || 'Unknown'}`,
      ...(service.responsibility ? [`Description: ${service.responsibility}`] : []),
      ...(service.dependencies?.length ? [`Dependencies: ${service.dependencies.join(', ')}`] : []),
    ];

    if (service.threatModel) {
      const tm = service.threatModel;
      parts.push('', '=== EXISTING SECURITY DATA (static analysis) ===');
      if (tm.entryPoints?.length) {
        parts.push('Entry Points:');
        tm.entryPoints.forEach((ep: EntryPoint) =>
          parts.push(`  - ${ep.type}: ${ep.path ?? 'N/A'} ${ep.method ?? ''} | public:${ep.isPublic} auth:${ep.authenticationRequired}`),
        );
      }
      if (tm.externalConnections?.length) {
        parts.push('External Connections:');
        tm.externalConnections.forEach((c: any) =>
          parts.push(`  - ${c.target} (${c.protocol}) purpose:${c.purpose} encrypted:${c.encrypted}`),
        );
      }
      if (tm.attackSurface) {
        parts.push(
          `Attack Surface: public:${tm.attackSurface.publicEndpoints} ` +
          `private:${tm.attackSurface.privateEndpoints} ` +
          `extDeps:${tm.attackSurface.externalDependencies}`,
        );
      }
      if (tm.sensitiveDataTypes?.length) {
        parts.push(`Sensitive Data: ${tm.sensitiveDataTypes.join(', ')}`);
      }
    }

    if (relatedResources.length > 0) {
      parts.push('', '=== RELATED CLOUD RESOURCES ===');
      relatedResources.forEach(r => {
        const rels = relationships.filter(rel =>
          (rel.sourceId === service.id && rel.targetId === r.id) ||
          (rel.targetId === service.id && rel.sourceId === r.id),
        );
        parts.push(`${r.name} (${r.resourceType}, ${r.cloudProvider}) via ${rels.map(rel => rel.type).join(', ')}`);
        if (r.threatModel?.internetExposed !== undefined) parts.push(`  Internet exposed: ${r.threatModel.internetExposed}`);
        if (r.threatModel?.dataClassification) parts.push(`  Data class: ${r.threatModel.dataClassification}`);
        if (r.threatModel?.dataAtRest) parts.push(`  Encryption at rest: ${r.threatModel.dataAtRest.enabled}`);
        if (r.threatModel?.networkAccess) parts.push(`  Network: ${JSON.stringify(r.threatModel.networkAccess)}`);
      });
    }

    if (relationships.length > 0) {
      parts.push('', '=== RELATIONSHIPS ===');
      relationships.forEach(r => {
        const dir = r.sourceId === service.id ? 'out' : 'in';
        const other = r.sourceId === service.id ? r.targetId : r.sourceId;
        parts.push(`${r.type} (${dir}) → ${other}`);
        if (r.metadata?.reason) parts.push(`  Reason: ${r.metadata.reason}`);
      });
    }

    if (dependentServices.length > 0) {
      parts.push('', '=== DEPENDENT SERVICES ===');
      dependentServices.forEach(s => {
        parts.push(`${s.name} (${s.serviceType})`);
        if (s.responsibility) parts.push(`  Responsibility: ${s.responsibility}`);
        if (s.externalDeps?.length) {
          s.externalDeps.forEach(d =>
            parts.push(`  External dep: ${d.name} (${d.type}, ${d.dataFlow}) — ${d.purpose}`),
          );
        }
      });
    }

    return parts.join('\n');
  }

  /**
   * Parse the LLM threat-model response.
   * Each field is validated individually — the raw response is never stored.
   *
   * Security: uses regex+JSON.parse to extract JSON, then validates every
   * field type before accepting it. Clamps riskScore to [0, 100].
   */
  private parseThreatModelResponse(response: string): Partial<ThreatModelData> {
    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return {};
      const parsed = JSON.parse(match[0]);
      const tm = parsed.threatModel ?? {};
      const out: Partial<ThreatModelData> = {};

      if (typeof tm.internetExposed === 'boolean') out.internetExposed = tm.internetExposed;
      if (typeof tm.publicEndpoint === 'string') out.publicEndpoint = tm.publicEndpoint;
      if (typeof tm.authenticationMethod === 'string') out.authenticationMethod = tm.authenticationMethod;
      if (typeof tm.authorizationModel === 'string') out.authorizationModel = tm.authorizationModel;
      if (Array.isArray(tm.identityProviders)) out.identityProviders = tm.identityProviders;
      if (typeof tm.privilegeLevel === 'string') out.privilegeLevel = tm.privilegeLevel as any;
      if (typeof tm.dataClassification === 'string') out.dataClassification = tm.dataClassification as any;
      if (tm.dataAtRest && typeof tm.dataAtRest === 'object') out.dataAtRest = tm.dataAtRest;
      if (tm.dataInTransit && typeof tm.dataInTransit === 'object') out.dataInTransit = tm.dataInTransit;
      if (Array.isArray(tm.sensitiveDataTypes)) out.sensitiveDataTypes = tm.sensitiveDataTypes;
      if (Array.isArray(tm.securityControls)) out.securityControls = tm.securityControls;
      if (Array.isArray(tm.identifiedThreats)) out.identifiedThreats = tm.identifiedThreats;
      if (typeof tm.riskScore === 'number') out.riskScore = Math.min(100, Math.max(0, tm.riskScore));
      if (Array.isArray(tm.complianceRequirements)) out.complianceRequirements = tm.complianceRequirements;
      if (Array.isArray(tm.mitreAttackTactics)) out.mitreAttackTactics = tm.mitreAttackTactics;
      if (Array.isArray(tm.mitreAttackTechniques)) out.mitreAttackTechniques = tm.mitreAttackTechniques;

      out.lastAssessment = new Date().toISOString();
      out.assessmentMethod = 'llm';
      return out;
    } catch {
      return {};
    }
  }
}
