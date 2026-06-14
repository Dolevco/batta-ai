import type {
  SecurityAttestation,
  SecurityReview,
  SecurityReviewAnswer,
  SecurityTask,
} from '@batta/shared';

export interface SecurityRequirementExplanation {
  reviewId: string;
  task: SecurityTask;
  policy: {
    type?: string;
    version?: number;
    source: 'question_rule' | 'baseline_task';
    questionId?: string;
  };
  triggeringAnswers: SecurityReviewAnswer[];
  relatedContext: {
    matchedFeatures: NonNullable<SecurityReview['matchedFeatures']>;
    linkedFeatureIds: string[];
    featureSecurityContext: NonNullable<SecurityReview['featureSecurityContext']>;
  };
  reason: string;
}

export function explainSecurityRequirement(
  review: SecurityReview,
  taskId: string,
): SecurityRequirementExplanation {
  const task = review.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error(`Security task not found: ${taskId}`);

  const rule = (review.snapshotTaskRules ?? []).find(candidate =>
    candidate.tasks.some(ruleTask => sameTask(ruleTask, task)),
  );
  const baselineMatch = (review.snapshotBaselineTasks ?? []).some(candidate => sameTask(candidate, task));
  const triggeringAnswers = rule
    ? review.answers.filter(answer => answer.questionId === rule.questionId)
    : [];
  const question = rule
    ? review.questions.find(candidate => candidate.id === rule.questionId)
    : undefined;

  const reason = rule
    ? `This task was generated because the answer to "${question?.question ?? rule.questionId}" indicated the change touches ${task.principle.toLowerCase()} concerns. The stored policy snapshot maps that answer to this requirement.`
    : baselineMatch
      ? 'This is a baseline security review task that applies to every review so the final record includes concrete implementation evidence.'
      : 'This task is present in the review record, but it could not be matched to the stored policy snapshot. It may come from an older policy version or a migrated review.';

  return {
    reviewId: review.id,
    task,
    policy: {
      type: review.policyTemplateType,
      version: review.policyTemplateVersion,
      source: rule ? 'question_rule' : 'baseline_task',
      ...(rule && { questionId: rule.questionId }),
    },
    triggeringAnswers,
    relatedContext: {
      matchedFeatures: review.matchedFeatures ?? [],
      linkedFeatureIds: review.linkedFeatureIds ?? [],
      featureSecurityContext: review.featureSecurityContext ?? [],
    },
    reason,
  };
}

export function validateSecurityAttestations(
  attestations: SecurityAttestation[],
  tasks: SecurityTask[],
): void {
  const taskIds = new Set(tasks.map(task => task.id));
  const seen = new Set<string>();

  attestations.forEach((attestation, index) => {
    if (!attestation || typeof attestation !== 'object') {
      throw new Error(`Invalid attestation at index ${index}: must be an object`);
    }
    if (typeof attestation.taskId !== 'string' || !taskIds.has(attestation.taskId)) {
      throw new Error(`Invalid attestation at index ${index}: taskId does not match a review task`);
    }
    if (seen.has(attestation.taskId)) {
      throw new Error(`Invalid attestation at index ${index}: duplicate taskId '${attestation.taskId}'`);
    }
    seen.add(attestation.taskId);
    if (typeof attestation.handled !== 'boolean') {
      throw new Error(`Invalid attestation for task '${attestation.taskId}': handled must be boolean`);
    }
    if (typeof attestation.notes !== 'string') {
      throw new Error(`Invalid attestation for task '${attestation.taskId}': notes must be a string`);
    }

    const notes = attestation.notes.trim();
    if (notes.length < 20) {
      throw new Error(`Invalid attestation for task '${attestation.taskId}': notes must include evidence detail`);
    }
    if (notes.length > 2000) {
      throw new Error(`Invalid attestation for task '${attestation.taskId}': notes exceed 2000 characters`);
    }
    if (containsSecretLikeContent(notes)) {
      throw new Error(`Invalid attestation for task '${attestation.taskId}': notes appear to contain a secret or raw environment value`);
    }
    if (!hasEvidenceLikeDetail(notes)) {
      throw new Error(
        `Invalid attestation for task '${attestation.taskId}': notes must reference evidence such as a file path, route, symbol, test, or config key`,
      );
    }
  });
}

function containsSecretLikeContent(value: string): boolean {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client_secret|private_key)\s*=\s*['"]?[^'"\s]{8,}/i,
    /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client_secret|private_key)\s*:\s*['"][^'"]{8,}['"]/i,
    /\b[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{10,}\b/,
    /\b(?:ghp|github_pat|sk|xox[baprs])-?[A-Za-z0-9_=-]{16,}\b/i,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  return patterns.some(pattern => pattern.test(value));
}

function hasEvidenceLikeDetail(value: string): boolean {
  const patterns = [
    /\b[\w.-]+\/[\w./-]+\.[A-Za-z0-9]+\b/,
    /\b[\w.-]+\.(ts|tsx|js|jsx|py|go|java|rb|rs|cs|yml|yaml|json|sql|md)\b/i,
    /\b(GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9/_:.-]+/i,
    /\b(test|spec|route|endpoint|handler|controller|service|middleware|schema|migration|config|env|policy)\b/i,
    /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/,
  ];
  return patterns.some(pattern => pattern.test(value));
}

function sameTask(a: Omit<SecurityTask, 'id'>, b: SecurityTask): boolean {
  return a.title === b.title && a.description === b.description && a.principle === b.principle;
}
