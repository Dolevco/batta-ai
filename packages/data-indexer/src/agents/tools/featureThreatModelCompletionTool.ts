/**
 * FeatureThreatModelCompletionTool
 *
 * Completion tool for Step 3 of the business feature extraction pipeline.
 * The LLM calls this tool to submit the STRIDE threat model for one
 * business feature.  Validates STRIDE categories, severities, risk score,
 * and that threat IDs are unique.
 */

import { BaseTool, TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { FeatureThreatModel } from '@batta/shared';
import { VALID_TRUST_BOUNDARY_TYPES } from '@batta/shared';

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

export interface ThreatModelInput extends Record<string, unknown> {
  featureName: string;
  threatModel: FeatureThreatModel;
  reasoning: string;
}

export class FeatureThreatModelCompletionTool extends BaseTool<ThreatModelInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the completed STRIDE threat model for this business feature. ' +
    'Provide at least one threat per trust-boundary-crossing flow covering all applicable STRIDE categories. ' +
    'overallRiskScore must be an integer 0–100. All enum values are case-sensitive. ' +
    'Validation errors are returned so you can fix and retry.';

  parameters: ToolParameter[] = [
    {
      name: 'featureName',
      description: 'The name of the business feature this threat model covers (non-empty string).',
      required: true,
      type: 'string',
    },
    {
      name: 'threatModel',
      description:
        'FeatureThreatModel object. All arrays are required (may be [] except strideThreats which must be non-empty):\n' +
        '  strideThreats[]: { id (unique, e.g. T-AUTH-001), title, category: (Spoofing|Tampering|Repudiation|InformationDisclosure|DenialOfService|ElevationOfPrivilege), description, affectedComponents: string[], affectedFlows: string[], severity: (critical|high|medium|low), likelihoodScore: int 1-5, impactScore: int 1-5, mitigations: string[] (non-empty), status: (identified|mitigated|accepted|transferred), cvssVector?: string }\n' +
        `  trustBoundaryAnalysis[]: { name: (${VALID_TRUST_BOUNDARY_TYPES.join('|')}), crossingFlows: string[], controlsRequired: string[], controlsInPlace: string[], riskRating: (critical|high|medium|low) }\n` +
        '  dataClassificationSummary[]: { classification: (public|internal|confidential|restricted), dataTypes: string[], storageLocations: string[], transmissionPaths: string[], protectionMechanisms: string[] }\n' +
        '  overallRiskScore: integer 0–100 (NOT a string).\n' +
        '  complianceConsiderations: string[].\n' +
        '  attackVectors: string[].\n' +
        '  securityRecommendations: string[].\n' +
        'IMPORTANT: likelihoodScore and impactScore must be JSON numbers, not strings.',
      required: true,
      type: 'any',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of the overall risk assessment and key threat drivers (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ThreatModelInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Threat model validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      const tm = input.threatModel as FeatureThreatModel;
      await this.notify(
        `✅ Threat model complete for "${input.featureName}": ` +
          `${tm.strideThreats.length} threats, risk score ${tm.overallRiskScore}/100`
      );
      return {
        success: true,
        message: `Threat model for "${input.featureName}" validated (${tm.strideThreats.length} threats, risk ${tm.overallRiskScore}).`,
        requiredOutput: {
          featureName: input.featureName,
          threatModel: input.threatModel,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ThreatModelInput): string[] {
    const errors: string[] = [];
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

    if (errors.length > 0) return errors; // bail early if structure is wrong

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
      if (!b.name?.trim()) errors.push(`trustBoundaryAnalysis[${i}].name is required.`);
      // Allow-list validation — name must be one of the canonical TrustBoundaryType values
      if (b.name && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(b.name))
        errors.push(
          `trustBoundaryAnalysis[${i}].name "${b.name}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`,
        );
      if (!VALID_RISK_RATING.includes(b.riskRating))
        errors.push(`trustBoundaryAnalysis[${i}].riskRating "${b.riskRating}" is invalid.`);
    });

    // Validate data classification summary
    tm.dataClassificationSummary.forEach((c, i) => {
      if (!VALID_CLASSIFICATION.includes(c.classification))
        errors.push(`dataClassificationSummary[${i}].classification "${c.classification}" is invalid.`);
    });

    return errors;
  }
}
