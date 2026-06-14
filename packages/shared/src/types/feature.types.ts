export interface FeatureContext {
  id: string;
  name: string;
  businessValue: string;
  description: string;
}

/**
 * @deprecated Use FeatureContext (slim) for matchedFeatures in start_security_review.
 * Full DFD data is now carried by FeatureSecurityContext returned from submit_security_answers.
 * Kept for backwards-compat with stored reviews that include the old shape.
 * @removal-target v1.0
 */
export interface FeatureContextFull extends FeatureContext {
  userStories: string[];
  dataFlowSummary: FeatureDataFlowEntry[];
  dataClassificationSummary: Array<{
    classification: string;
    dataTypes: string[];
    protectionMechanisms: string[];
  }>;
}

export interface FeatureDataFlowEntry {
  from: string;
  to: string;
  dataTypes: string[];
  protocol: string;
  encrypted: boolean;
  authRequired: boolean;
}

export interface ReviewDataClassificationEntry {
  classification: string;
  dataTypes: string[];
  protectionMechanisms: string[];
}

export interface DataClassificationDiffEntry {
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  baseline: ReviewDataClassificationEntry | null;
  updated: ReviewDataClassificationEntry | null;
}

export interface DataFlowDiffEntry {
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  baseline: FeatureDataFlowEntry | null;
  updated: FeatureDataFlowEntry | null;
}

export interface ArchitectureDiff {
  featureId: string;
  featureName: string;
  dataClassificationDiff: DataClassificationDiffEntry[];
  dataFlowDiff: DataFlowDiffEntry[];
  hasChanges: boolean;
  dfdChangeRationale?: string;
}

export interface FeatureSecurityContext {
  featureId: string;
  featureName: string;
  complianceConsiderations: string[];
  dataClassificationSummary: Array<{
    classification: string;
    dataTypes: string[];
    protectionMechanisms: string[];
  }>;
  dataFlowSummary: FeatureDataFlowEntry[];
  overallRiskScore: number;
  securityRecommendations: string[];
  existingThreats: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    status: string;
  }>;
}

export interface AttestationArchitectureUpdate {
  featureId: string;
  updatedDataFlowSummary: FeatureDataFlowEntry[];
  updatedDataClassification: ReviewDataClassificationEntry[];
  /**
   * Concise explanation (1-3 sentences) of why the data flows or classifications changed.
   * Written by the agent; shown to security architects as the human-readable justification.
   */
  dfdChangeRationale: string;
}
