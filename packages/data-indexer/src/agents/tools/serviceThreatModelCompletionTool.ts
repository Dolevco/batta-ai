/**
 * ServiceThreatModelCompletionTool
 *
 * Completion tool for the "Service-Level Threat Model" step.
 * The LLM calls this tool to submit the STRIDE threat model for the
 * entire service, based on the synthesized service-level DFD.
 *
 * This replaces the per-feature threat model; the resulting model captures
 * the holistic security posture of the service rather than individual features.
 *
 * Security: All enum values are allow-list validated. Threat IDs must be unique.
 * No workspace paths or secret values may appear in any field.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { FeatureThreatModel } from '@ai-agent/shared';
import { VALID_TRUST_BOUNDARY_TYPES } from '@ai-agent/shared';

const VALID_STRIDE = [
  'Spoofing',
  'Tampering',
  'Repudiation',
  'InformationDisclosure',
  'DenialOfService',
  'ElevationOfPrivilege',
];
const VALID_SEVERITY = ['critical', 'high', 'medium', 'low'];
const VALID_STATUS = ['identified', 'mitigated', 'accepted', 'transferred'];
const VALID_CLASSIFICATION = ['public', 'internal', 'confidential', 'restricted'];
const VALID_RISK_RATING = ['critical', 'high', 'medium', 'low'];

export interface ServiceThreatModelInput extends Record<string, unknown> {
  serviceName: string;
  threatModel: FeatureThreatModel;
  reasoning: string;
}

export class ServiceThreatModelCompletionTool extends BaseTool<ServiceThreatModelInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the completed STRIDE threat model for the entire service (based on the service-level DFD). ' +
    'Provide at least one threat per trust-boundary-crossing flow covering all applicable STRIDE categories. ' +
    'overallRiskScore must be an integer 0–100. All enum values are case-sensitive. ' +
    'Validation errors are returned so you can fix and retry.';

  parameters: ToolParameter[] = [
    {
      name: 'serviceName',
      description: 'The name of the service this threat model covers (non-empty string).',
      required: true,
      type: 'string',
    },
    {
      name: 'threatModel',
      description:
        'FeatureThreatModel object. All arrays are required (may be [] except strideThreats which must be non-empty):\n' +
        '  strideThreats[]: { id (unique, e.g. T-SVC-001), title, category: (Spoofing|Tampering|Repudiation|InformationDisclosure|DenialOfService|ElevationOfPrivilege), description, affectedComponents: string[], affectedFlows: string[], severity: (critical|high|medium|low), likelihoodScore: int 1-5, impactScore: int 1-5, mitigations: string[] (non-empty), status: (identified|mitigated|accepted|transferred), cvssVector?: string }\n' +
        `  trustBoundaryAnalysis[]: { name: (${VALID_TRUST_BOUNDARY_TYPES.join('|')}), crossingFlows: string[], controlsRequired: string[], controlsInPlace: string[], riskRating: (critical|high|medium|low) }\n` +
        '  dataClassificationSummary[]: { classification: (public|internal|confidential|restricted), dataTypes: string[], storageLocations: string[], transmissionPaths: string[], protectionMechanisms: string[] }\n' +
        '  overallRiskScore: integer 0–100 (NOT a string).\n' +
        '  complianceConsiderations: string[].\n' +
        '  attackVectors: string[].\n' +
        '  securityRecommendations: string[].\n' +
        'IMPORTANT: likelihoodScore and impactScore must be JSON numbers, not strings. ' +
        'The threat model must reflect the service as a whole — include threats from all trust-boundary crossings.',
      required: true,
      type: 'any',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of the overall service risk assessment and key threat drivers (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceThreatModelInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Service threat model validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      const tm = input.threatModel as FeatureThreatModel;
      await this.notify(
        `✅ Service threat model complete for "${input.serviceName}": ` +
          `${tm.strideThreats.length} threats, risk score ${tm.overallRiskScore}/100`
      );
      return {
        success: true,
        message: `Service threat model for "${input.serviceName}" validated (${tm.strideThreats.length} threats, risk ${tm.overallRiskScore}).`,
        requiredOutput: {
          serviceName: input.serviceName,
          threatModel: input.threatModel,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ServiceThreatModelInput): string[] {
    const errors: string[] = [];
    if (!input.serviceName?.trim()) errors.push('`serviceName` is required.');
    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    const tm = input.threatModel as FeatureThreatModel;
    if (!tm || typeof tm !== 'object') {
      errors.push('`threatModel` must be an object.');
      return errors;
    }

    if (!Array.isArray(tm.strideThreats)) errors.push('`threatModel.strideThreats` must be an array.');
    if (!Array.isArray(tm.trustBoundaryAnalysis)) errors.push('`threatModel.trustBoundaryAnalysis` must be an array.');
    if (!Array.isArray(tm.dataClassificationSummary)) errors.push('`threatModel.dataClassificationSummary` must be an array.');
    if (!Array.isArray(tm.complianceConsiderations)) errors.push('`threatModel.complianceConsiderations` must be an array.');
    if (!Array.isArray(tm.attackVectors)) errors.push('`threatModel.attackVectors` must be an array.');
    if (!Array.isArray(tm.securityRecommendations)) errors.push('`threatModel.securityRecommendations` must be an array.');

    const riskScore = tm.overallRiskScore;
    if (typeof riskScore !== 'number' || riskScore < 0 || riskScore > 100)
      errors.push('`threatModel.overallRiskScore` must be a number between 0 and 100.');

    if (errors.length > 0) return errors;

    if (tm.strideThreats.length === 0) errors.push('`threatModel.strideThreats` must not be empty.');

    // Validate STRIDE threats
    const seenIds = new Set<string>();
    tm.strideThreats.forEach((t, i) => {
      const prefix = `strideThreats[${i}]`;
      if (!t.id?.trim()) errors.push(`${prefix}.id is required.`);
      if (seenIds.has(t.id)) errors.push(`${prefix}.id "${t.id}" is duplicated.`);
      seenIds.add(t.id);
      if (!t.title?.trim()) errors.push(`${prefix}.title is required.`);
      if (!VALID_STRIDE.includes(t.category))
        errors.push(`${prefix}.category "${t.category}" is invalid. Must be one of: ${VALID_STRIDE.join(', ')}`);
      if (!VALID_SEVERITY.includes(t.severity))
        errors.push(`${prefix}.severity "${t.severity}" is invalid.`);
      if (!VALID_STATUS.includes(t.status))
        errors.push(`${prefix}.status "${t.status}" is invalid.`);
      if (typeof t.likelihoodScore !== 'number' || t.likelihoodScore < 1 || t.likelihoodScore > 5)
        errors.push(`${prefix}.likelihoodScore must be 1–5.`);
      if (typeof t.impactScore !== 'number' || t.impactScore < 1 || t.impactScore > 5)
        errors.push(`${prefix}.impactScore must be 1–5.`);
      if (!Array.isArray(t.mitigations) || t.mitigations.length === 0)
        errors.push(`${prefix}.mitigations must be a non-empty array.`);
      if (!Array.isArray(t.affectedComponents))
        errors.push(`${prefix}.affectedComponents must be an array.`);
    });

    // Validate trust boundary analysis
    tm.trustBoundaryAnalysis.forEach((b, i) => {
      const prefix = `trustBoundaryAnalysis[${i}]`;
      if (!b.name?.trim()) errors.push(`${prefix}.name is required.`);
      if (!VALID_RISK_RATING.includes(b.riskRating))
        errors.push(`${prefix}.riskRating "${b.riskRating}" is invalid.`);
      if (!Array.isArray(b.crossingFlows)) errors.push(`${prefix}.crossingFlows must be an array.`);
      if (!Array.isArray(b.controlsRequired)) errors.push(`${prefix}.controlsRequired must be an array.`);
      if (!Array.isArray(b.controlsInPlace)) errors.push(`${prefix}.controlsInPlace must be an array.`);
    });

    // Validate data classification summary
    tm.dataClassificationSummary.forEach((d, i) => {
      const prefix = `dataClassificationSummary[${i}]`;
      if (!VALID_CLASSIFICATION.includes(d.classification))
        errors.push(`${prefix}.classification "${d.classification}" is invalid.`);
      if (!Array.isArray(d.dataTypes)) errors.push(`${prefix}.dataTypes must be an array.`);
      if (!Array.isArray(d.storageLocations)) errors.push(`${prefix}.storageLocations must be an array.`);
      if (!Array.isArray(d.transmissionPaths)) errors.push(`${prefix}.transmissionPaths must be an array.`);
      if (!Array.isArray(d.protectionMechanisms)) errors.push(`${prefix}.protectionMechanisms must be an array.`);
    });

    return errors;
  }
}
