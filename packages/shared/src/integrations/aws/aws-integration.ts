import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  SecurityHubClient,
  GetFindingsCommand,
  type AwsSecurityFinding,
} from '@aws-sdk/client-securityhub';
import {
  GuardDutyClient,
  ListDetectorsCommand,
  ListFindingsCommand,
  GetFindingsCommand as GDGetFindingsCommand,
} from '@aws-sdk/client-guardduty';
import {
  ConfigServiceClient,
  DescribeComplianceByConfigRuleCommand,
} from '@aws-sdk/client-config-service';
import {
  AccessAnalyzerClient,
  ListAnalyzersCommand,
  ListFindingsCommand as AAListFindingsCommand,
} from '@aws-sdk/client-accessanalyzer';
import { fromNodeProviderChain, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { Provider, AwsCredentialIdentity } from '@aws-sdk/types';
import { Tool, ToolResult, ToolCategory } from '@batta/core';
import { CustomIntegrationHandler } from '../../types';

export const AWSCategory: ToolCategory = {
  name: 'amazon-aws',
  description: 'Amazon AWS security and compliance tools',
  keywords: ['security', 'aws', 'amazon', 'cloud', 'securityhub', 'guardduty', 'iam', 'compliance'],
};

export interface AWSConfig {
  tenantId: string;
  /** Comma-separated list of AWS account IDs */
  accountIds: string;
  /** Comma-separated list of AWS regions */
  regions: string;
  /** Cross-account role ARN. Omit to use ambient credential chain (IRSA / instance profile). */
  roleArn?: string;
  /** ExternalId for assume-role security */
  externalId?: string;
}

export class AWSIntegration implements CustomIntegrationHandler {
  id = 'amazon-aws';
  name = 'Amazon AWS';

  private primaryRegion: string;

  constructor(private readonly config: AWSConfig) {
    this.primaryRegion = config.regions.split(',').map(r => r.trim()).filter(Boolean)[0] ?? 'us-east-1';
  }

  // ============================================================================
  // Validation — uses STS GetCallerIdentity (no permissions required)
  // ============================================================================

  static async validate(config: AWSConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      const region = config.regions.split(',').map(r => r.trim()).filter(Boolean)[0] ?? 'us-east-1';
      const credentials = AWSIntegration.buildCredentials(config);
      const client = new STSClient({ region, credentials });
      await client.send(new GetCallerIdentityCommand({}));
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err?.message ?? String(err) };
    }
  }

  // ============================================================================
  // Agent tools
  // ============================================================================

  getTools(): Tool[] {
    return [
      this.makeListSecurityHubFindings(),
      this.makeGetSecurityHubFindingDetails(),
      this.makeListGuardDutyFindings(),
      this.makeGetGuardDutyFindingDetails(),
      this.makeListConfigCompliance(),
      this.makeListIAMAccessAnalyzerFindings(),
    ];
  }

  // ── Security Hub ──────────────────────────────────────────────────────────

  private makeListSecurityHubFindings(): Tool {
    return {
      name: 'listAWSSecurityHubFindings',
      category: AWSCategory,
      description: 'List active AWS Security Hub findings filtered by severity. Returns finding titles, resources affected, and remediation guidance.',
      parameters: [
        { name: 'severity', description: 'Severity label to filter by: CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL. Defaults to CRITICAL,HIGH.', required: false, type: 'string' },
        { name: 'region', description: 'AWS region to query. Defaults to the configured primary region.', required: false, type: 'string' },
        { name: 'maxResults', description: 'Maximum number of findings to return (1-100). Defaults to 50.', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const region = params.region || this.primaryRegion;
          const maxResults = Math.min(100, Math.max(1, Number(params.maxResults ?? 50)));
          const severities = (params.severity ?? 'CRITICAL,HIGH').split(',').map(s => s.trim().toUpperCase());

          const client = new SecurityHubClient({ region, credentials: this.getCredentials() });
          const response = await client.send(new GetFindingsCommand({
            Filters: {
              SeverityLabel: severities.map(v => ({ Value: v, Comparison: 'EQUALS' as const })),
              RecordState: [{ Value: 'ACTIVE', Comparison: 'EQUALS' as const }],
              WorkflowStatus: [{ Value: 'NEW', Comparison: 'EQUALS' as const }],
            },
            MaxResults: maxResults,
            SortCriteria: [{ Field: 'SeverityLabel', SortOrder: 'desc' as const }],
          }));

          const findings = (response.Findings ?? []).map((f: AwsSecurityFinding) => ({
            id: f.Id,
            title: f.Title,
            description: f.Description,
            severity: f.Severity?.Label,
            resourceType: f.Resources?.[0]?.Type,
            resourceId: f.Resources?.[0]?.Id,
            region: f.Region,
            remediationUrl: f.Remediation?.Recommendation?.Url,
            remediationText: f.Remediation?.Recommendation?.Text,
            updatedAt: f.UpdatedAt,
          }));

          return {
            success: true,
            message: `Found ${findings.length} Security Hub findings in ${region}`,
            result: findings,
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private makeGetSecurityHubFindingDetails(): Tool {
    return {
      name: 'getAWSSecurityHubFindingDetails',
      category: AWSCategory,
      description: 'Get full details of an AWS Security Hub finding including all resources, compliance status, and remediation steps.',
      parameters: [
        { name: 'findingId', description: 'The Security Hub finding ID (ARN format)', required: true, type: 'string' },
        { name: 'region', description: 'AWS region where the finding lives', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          if (!params.findingId) throw new Error('findingId is required');
          const region = params.region || this.primaryRegion;

          const client = new SecurityHubClient({ region, credentials: this.getCredentials() });
          const response = await client.send(new GetFindingsCommand({
            Filters: { Id: [{ Value: params.findingId, Comparison: 'EQUALS' as const }] },
            MaxResults: 1,
          }));

          const finding = response.Findings?.[0];
          if (!finding) return { success: false, message: `Finding ${params.findingId} not found`, error: 'NOT_FOUND' };

          return {
            success: true,
            message: `Finding details for ${params.findingId}`,
            result: {
              id: finding.Id,
              title: finding.Title,
              description: finding.Description,
              severity: finding.Severity,
              resources: finding.Resources?.map(r => ({ type: r.Type, id: r.Id, region: r.Region })),
              compliance: finding.Compliance,
              remediation: finding.Remediation,
              networkPath: finding.NetworkPath,
              updatedAt: finding.UpdatedAt,
              createdAt: finding.CreatedAt,
            },
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  // ── GuardDuty ─────────────────────────────────────────────────────────────

  private makeListGuardDutyFindings(): Tool {
    return {
      name: 'listAWSGuardDutyFindings',
      category: AWSCategory,
      description: 'List active AWS GuardDuty threat intelligence findings. Returns threat type, severity, and affected resources.',
      parameters: [
        { name: 'region', description: 'AWS region to query GuardDuty. Defaults to primary region.', required: false, type: 'string' },
        { name: 'minSeverity', description: 'Minimum severity (1-10). Defaults to 7 (HIGH).', required: false, type: 'string' },
        { name: 'maxResults', description: 'Maximum findings to return (1-50). Defaults to 25.', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const region = params.region || this.primaryRegion;
          const minSeverity = Number(params.minSeverity ?? 7);
          const maxResults = Math.min(50, Math.max(1, Number(params.maxResults ?? 25)));

          const client = new GuardDutyClient({ region, credentials: this.getCredentials() });

          const detectorsResp = await client.send(new ListDetectorsCommand({}));
          const detectorId = detectorsResp.DetectorIds?.[0];
          if (!detectorId) return { success: true, message: 'GuardDuty not enabled in this region', result: [] };

          const listResp = await client.send(new ListFindingsCommand({
            DetectorId: detectorId,
            FindingCriteria: {
              Criterion: {
                severity: { Gte: minSeverity },
                'service.archived': { Eq: ['false'] },
              },
            },
            MaxResults: maxResults,
            SortCriteria: { AttributeName: 'severity', OrderBy: 'DESC' as const },
          }));

          const findingIds = listResp.FindingIds ?? [];
          if (findingIds.length === 0) return { success: true, message: 'No GuardDuty findings found', result: [] };

          const getResp = await client.send(new GDGetFindingsCommand({
            DetectorId: detectorId,
            FindingIds: findingIds,
          }));

          const findings = (getResp.Findings ?? []).map(f => ({
            id: f.Id,
            title: f.Title,
            description: f.Description,
            severity: f.Severity,
            type: f.Type,
            accountId: f.AccountId,
            region: f.Region,
            resourceType: f.Resource?.ResourceType,
            updatedAt: f.UpdatedAt,
          }));

          return {
            success: true,
            message: `Found ${findings.length} GuardDuty findings in ${region}`,
            result: findings,
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  private makeGetGuardDutyFindingDetails(): Tool {
    return {
      name: 'getAWSGuardDutyFindingDetails',
      category: AWSCategory,
      description: 'Get full details of an AWS GuardDuty threat finding including service action, evidence, and actor details.',
      parameters: [
        { name: 'findingId', description: 'The GuardDuty finding ID', required: true, type: 'string' },
        { name: 'region', description: 'AWS region where the finding was created', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          if (!params.findingId) throw new Error('findingId is required');
          const region = params.region || this.primaryRegion;

          const client = new GuardDutyClient({ region, credentials: this.getCredentials() });
          const detectorsResp = await client.send(new ListDetectorsCommand({}));
          const detectorId = detectorsResp.DetectorIds?.[0];
          if (!detectorId) return { success: false, message: 'GuardDuty not enabled in this region', error: 'NOT_ENABLED' };

          const getResp = await client.send(new GDGetFindingsCommand({
            DetectorId: detectorId,
            FindingIds: [params.findingId],
          }));

          const finding = getResp.Findings?.[0];
          if (!finding) return { success: false, message: `Finding ${params.findingId} not found`, error: 'NOT_FOUND' };

          return {
            success: true,
            message: `GuardDuty finding details for ${params.findingId}`,
            result: {
              id: finding.Id,
              title: finding.Title,
              description: finding.Description,
              severity: finding.Severity,
              type: finding.Type,
              service: finding.Service,
              resource: finding.Resource,
              accountId: finding.AccountId,
              region: finding.Region,
            },
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  // ── AWS Config ────────────────────────────────────────────────────────────

  private makeListConfigCompliance(): Tool {
    return {
      name: 'listAWSConfigCompliance',
      category: AWSCategory,
      description: 'List AWS Config rule compliance status. Returns non-compliant rules and counts of compliant/non-compliant resources.',
      parameters: [
        { name: 'region', description: 'AWS region to query. Defaults to primary region.', required: false, type: 'string' },
        { name: 'complianceType', description: 'Filter by compliance type: NON_COMPLIANT, COMPLIANT, NOT_APPLICABLE. Defaults to NON_COMPLIANT.', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const region = params.region || this.primaryRegion;
          const complianceType = params.complianceType ?? 'NON_COMPLIANT';

          const client = new ConfigServiceClient({ region, credentials: this.getCredentials() });
          const response = await client.send(new DescribeComplianceByConfigRuleCommand({
            ComplianceTypes: [complianceType as any],
          }));

          const rules = (response.ComplianceByConfigRules ?? []).map(r => ({
            ruleName: r.ConfigRuleName,
            compliance: r.Compliance?.ComplianceType,
            compliantCount: (r.Compliance?.ComplianceContributorCount as any)?.CompliantResourceCount,
            nonCompliantCount: (r.Compliance?.ComplianceContributorCount as any)?.NonCompliantResourceCount,
          }));

          return {
            success: true,
            message: `Found ${rules.length} ${complianceType} Config rules in ${region}`,
            result: rules,
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  // ── IAM Access Analyzer ───────────────────────────────────────────────────

  private makeListIAMAccessAnalyzerFindings(): Tool {
    return {
      name: 'listAWSIAMAccessAnalyzerFindings',
      category: AWSCategory,
      description: 'List AWS IAM Access Analyzer findings that show external access to AWS resources. Identifies overly permissive IAM policies.',
      parameters: [
        { name: 'region', description: 'AWS region to query. Defaults to primary region.', required: false, type: 'string' },
        { name: 'analyzerArn', description: 'ARN of the Access Analyzer to query. If omitted, uses the first active analyzer found.', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const region = params.region || this.primaryRegion;
          const client = new AccessAnalyzerClient({ region, credentials: this.getCredentials() });

          let analyzerArn = params.analyzerArn;
          if (!analyzerArn) {
            const analyzersResp = await client.send(new ListAnalyzersCommand({ type: 'ACCOUNT' as any }));
            analyzerArn = analyzersResp.analyzers?.find(a => a.status === 'ACTIVE')?.arn ?? '';
            if (!analyzerArn) return { success: true, message: 'No active IAM Access Analyzer found', result: [] };
          }

          const response = await client.send(new AAListFindingsCommand({
            analyzerArn,
            filter: { status: { eq: ['ACTIVE'] } },
            maxResults: 50,
          }));

          const findings = (response.findings ?? []).map(f => ({
            id: f.id,
            resourceType: f.resourceType,
            resource: f.resource,
            action: f.action,
            principal: f.principal,
            condition: f.condition,
            isPublic: f.isPublic,
            status: f.status,
            updatedAt: f.updatedAt,
          }));

          return {
            success: true,
            message: `Found ${findings.length} IAM Access Analyzer findings`,
            result: findings,
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString?.() };
        }
      },
    };
  }

  // ============================================================================
  // Credential resolution
  // ============================================================================

  private getCredentials(): Provider<AwsCredentialIdentity> {
    return AWSIntegration.buildCredentials(this.config);
  }

  private static buildCredentials(config: AWSConfig): Provider<AwsCredentialIdentity> {
    if (config.roleArn) {
      return fromTemporaryCredentials({
        params: {
          RoleArn: config.roleArn,
          RoleSessionName: 'batta-ai-agent',
          ...(config.externalId && { ExternalId: config.externalId }),
          DurationSeconds: 3600,
        },
        clientConfig: { region: 'us-east-1' },
      });
    }
    return fromNodeProviderChain();
  }
}
