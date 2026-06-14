import axios from 'axios';
import { Tool, ToolResult, ToolCategory } from '@batta/core';
import { CustomIntegrationHandler } from '../../types';

export const MsDefenderCategory: ToolCategory = {
  name: 'microsoft-defender',
  description: 'Microsoft Azure Cloud tools',
  keywords: ['security', 'microsoft', 'defender', 'cloud', 'azure', 'assessment'],
};

export interface DefenderConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId?: string;
}

export class MicrosoftDefenderIntegration implements CustomIntegrationHandler {
  id = 'microsoft-defender-cloud';
  name = 'Microsoft Azure';

  constructor(private config: DefenderConfig) {
  }

  static async validate(config: DefenderConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      const inst = new MicrosoftDefenderIntegration(config);
      // attempt to call a lightweight API to verify credentials/config
      await inst.listAssessments();
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err?.message ?? String(err) };
    }
  }

  getTools(): Tool[] {
    const listAssessmentsTool: Tool = {
      name: 'listMDCAssessments',
      category: MsDefenderCategory,
      description: 'List Microsoft Defender security assessments',
      parameters: [
        { name: 'subscriptionId', description: 'Azure subscription id (optional, defaults to configured subscription)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const subscriptionId = params.subscriptionId ?? this.config.subscriptionId;
          const data = await this.listAssessments(subscriptionId);
          return { success: true, message: `Asessments fetched for subscription ${subscriptionId}`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };

    const getAssessmentDetailsTool: Tool = {
      name: 'getMDCAssessmentDetails',
      category: MsDefenderCategory,
      description: 'Get a full Microsoft Defender assessment details including remediations steps and its sub-assessments by assessment id. for code fixes tasks, we must get full details',
      parameters: [
        { name: 'assessmentId', description: '(string, required): Assessment resource id or assessment id segment', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const assessmentId = params.assessmentId;
          if (!assessmentId) throw new Error('assessmentId parameter is required');
          const data = await this.getAssessmentWithSubAssessments(assessmentId);
          return { success: true, message: `Assessment details fetched for ${assessmentId}`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };

    return [listAssessmentsTool, getAssessmentDetailsTool];
  }

  private async getAccessToken(): Promise<string> {
    const { tenantId, clientId, clientSecret } = this.config;
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams();
    body.append('grant_type', 'client_credentials');
    body.append('client_id', clientId);
    body.append('client_secret', clientSecret);
    body.append('scope', 'https://management.azure.com/.default');

    try {
      const res = await axios.post(tokenUrl, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      return (res.data as any).access_token as string;
    } catch (err: any) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : err?.message ?? String(err);
      throw new Error(`Failed to obtain access token: ${msg}`);
    }
  }

  async listAssessments(subscriptionId?: string): Promise<MDCSecurityAssessment[]> {
    const token = await this.getAccessToken();
    subscriptionId = subscriptionId ?? this.config.subscriptionId;

    // Query Microsoft Resource Graph with a Kusto query so we can control fields and filters
    const apiUrl = `https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01`;

    // Example Kusto query: fetch resources of type Microsoft.Security/assessments and project useful fields
    const kustoQuery = `securityresources
      | where type == "microsoft.security/assessments" and properties.status.code != "Healthy" and properties.status.code != "NotApplicable"
      | project id, properties
    `;

    const body = {
      query: kustoQuery,
      subscriptions: subscriptionId ? [subscriptionId] : undefined,
      options: { resultFormat: 'objectArray' },
    };

    try {
      const response = await axios.post(apiUrl, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const payload = response.data;

      // Normalize different possible Resource Graph response shapes into an array of objects
      const items: any[] = MicrosoftDefenderIntegration.normalizeResourceGraphPayload(payload);

      // Map each resource object to MDCSecurityAssessment using helper
      const assessments: MDCSecurityAssessment[] = items.map((it: any) => MicrosoftDefenderIntegration.mapToMDCAssessment(it, false));

      return assessments;
    } catch (err: any) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : err?.message ?? String(err);
      throw new Error(`Resource Graph query failed: ${msg}`);
    }
  }

  async getAssessmentWithSubAssessments(assessmentId: string): Promise<any> {
    const token = await this.getAccessToken();

    try {
      // Use a single Resource Graph Kusto query to fetch the assessment and any sub-assessments
      // The query matches assessment resources whose id ends with the provided segment (or full id)
      // and also fetches subAssessments that reference the assessment via properties.assessmentId.
      const sanitized = (assessmentId ?? '').replace(/"/g, '\\"');
      const rgApi = `https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01`;

      const kustoQuery = `securityresources
| where (tolower(type) == "microsoft.security/assessments" and tostring(id) endswith "${sanitized}")
   or (tolower(type) == "microsoft.security/assessments/subassessments" and tostring(id) contains "${sanitized}" and tolower(tostring(properties.status.code)) == 'unhealthy')
| project id, type, name, properties`;

      const body = { query: kustoQuery, options: { resultFormat: 'objectArray' } };

      const response = await axios.post(rgApi, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const payload = response.data;

      // Normalize Resource Graph response into an array
      const items: any[] = MicrosoftDefenderIntegration.normalizeResourceGraphPayload(payload);

      if (items.length === 0) throw new Error(`Assessment with id segment '${assessmentId}' not found`);

      // Partition results into the main assessment and sub-assessments
      const assessmentRaw = items.find((it: any) => {
        const t = (it.type ?? '').toString().toLowerCase();
        return t === 'microsoft.security/assessments' || t.endsWith('/assessments');
      });

      const subAssessmentRaws = items.filter((it: any) => {
        const t = (it.type ?? '').toString().toLowerCase();
        return t === 'microsoft.security/assessments/subassessments' || t.endsWith('/subassessments');
      });

      if (!assessmentRaw) throw new Error(`Assessment resource not found for '${assessmentId}'`);

      const assessment = MicrosoftDefenderIntegration.mapToMDCAssessment(assessmentRaw, true);
      const subAssessments = subAssessmentRaws.map((it: any) => MicrosoftDefenderIntegration.mapToMDCSubAssessment(it));

      return { assessment, subAssessments };
    } catch (err: any) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : err?.message ?? String(err);
      throw new Error(`Failed to fetch assessment details: ${msg}`);
    }
  }

  private static mapToMDCAssessment(it: any, includeRemediationSteps: boolean): MDCSecurityAssessment {
    const props = it.properties ?? it['properties'] ?? {};
    const resourceDetails = props.resourceDetails ?? {};

    const idParts = (it.id ?? '').toString().split('/');
    const id = idParts[idParts.length - 1] ?? '';
    const resourceId = resourceDetails.NativeResourceId ?? resourceDetails.ResourceId ?? it.id ?? '';
    const displayName = props.displayName ?? props.metadata?.displayName ?? it.name ?? '';
    const status = props.status?.code ?? props.status?.status ?? '';
    const severity = props.metadata?.severity ?? '';
    const description = props.metadata?.description ?? '';
    const remediationDescription = includeRemediationSteps ? (props.metadata?.remediationDescription) : undefined;
    const updateTime = props.status?.statusChangeDate ?? props.status?.firstEvaluationDate ?? '';

    return {
      id,
      resourceId,
      displayName,
      status,
      severity,
      description,
      remediationDescription,
      updateTime,
    } as MDCSecurityAssessment;
  }

  private static mapToMDCSubAssessment(it: any): MDCSecuritySubAssessment {
    const props = it.properties ?? it['properties'] ?? {};
    const resourceDetails = props.resourceDetails ?? props.resourcedetails ?? {};

    const idParts = (it.id ?? '').toString().split('/');
    const id = idParts[idParts.length - 1] ?? (props.id ?? it.id ?? '');

    // resource id: check different casings and common fields
    const resourceId = resourceDetails.nativeResourceId ?? resourceDetails.NativeResourceId ?? resourceDetails.id ?? resourceDetails.ResourceId ?? props.targetResource ?? it.id ?? '';

    const displayName = props.displayName ?? props.title ?? props.metadata?.displayName ?? it.name ?? '';

    // status and severity: status may be an object with code and severity
    const status = (props.status?.code ?? props.status?.status ?? props.status ?? '').toString();
    const severity = props.status?.severity ?? props.metadata?.severity ?? '';

    // description fields
    const description = props.description ?? props.details?.description ?? props.additionalData?.data?.RuleDescription ?? '';
    const data = props.additionalData?.data ?? '';

    // time fields
    const updateTime = props.timeGenerated ?? props.timestamp ?? props.status?.statusChangeDate ?? props.status?.firstEvaluationDate ?? '';

    return {
      id,
      resourceId,
      displayName,
      status,
      severity,
      description,
      data,
      updateTime,
    } as MDCSecuritySubAssessment;
  }

  private static normalizeResourceGraphPayload(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (payload.rows && Array.isArray(payload.rows) && Array.isArray(payload.columns)) {
      const colNames = payload.columns.map((c: any) => c.name);
      return payload.rows.map((row: any[]) => Object.fromEntries(row.map((v, i) => [colNames[i], v])));
    }
    if (Array.isArray(payload.value)) return payload.value;
    return [];
  }
}

interface MDCSecurityAssessment {
  id: string;
  resourceId: string;
  displayName: string;
  status: string;
  severity: string;
  description: string;
  remediationDescription: string;
  updateTime: string;
}

interface MDCSecuritySubAssessment {
  id: string;
  resourceId: string;
  displayName: string;
  status: string;
  severity: string;
  description: string;
  data: string;
  updateTime: string;
}