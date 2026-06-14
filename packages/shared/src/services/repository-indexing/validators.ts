import type {
  RepositoryIndexingSubmission,
  RepositoryIndexingStage,
  RepositoryIndexingRunMetadata,
  ValidationError,
  DfdContextSubmission,
  ThreatModelContextSubmission,
  ServiceContextSubmission,
  EvidenceRef,
} from '../../types/repository-indexing.types';

const SECRET_VALUE_PATTERNS = [
  /password\s*[:=]\s*\S+/i,
  /secret\s*[:=]\s*\S+/i,
  /api[_-]?key\s*[:=]\s*\S+/i,
  /token\s*[:=]\s*\S+/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  // Bearer tokens in text
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/i,
  // JWT pattern (three base64url segments)
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  // Long base64-encoded blobs (likely raw secrets / encoded creds)
  /[A-Za-z0-9+/]{60,}={0,2}/,
];

// File paths that typically contain secret material
const SECRET_FILE_PATTERNS = [
  /\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\bid_rsa\b/i,
  /\bsecrets?\b/i,
];

function containsSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some(p => p.test(value));
}

function isSecretFilePath(filePath: string): boolean {
  return SECRET_FILE_PATTERNS.some(p => p.test(filePath));
}

function validateEvidenceRefs(refs: EvidenceRef[], path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const refPath = `${path}[${i}]`;
    if (!ref.filePath) {
      errors.push({ path: `${refPath}.filePath`, message: 'Evidence filePath is required', severity: 'error' });
    } else if (ref.filePath.startsWith('/') || ref.filePath.includes('..')) {
      errors.push({ path: `${refPath}.filePath`, message: 'Evidence filePath must be relative to the repository root', severity: 'error' });
    } else if (isSecretFilePath(ref.filePath)) {
      errors.push({ path: `${refPath}.filePath`, message: 'Evidence may not reference secret files (.env, .pem, .key, id_rsa, secrets). Reference config key names only.', severity: 'error' });
    }
    if (!ref.rationale) {
      errors.push({ path: `${refPath}.rationale`, message: 'Evidence rationale is required', severity: 'error' });
    } else if (containsSecretValue(ref.rationale)) {
      errors.push({ path: `${refPath}.rationale`, message: 'Evidence must not contain secret values', severity: 'error' });
    }
  }
  return errors;
}

function validateDfd(dfd: DfdContextSubmission, idx: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const base = `dfds[${idx}]`;

  if (!dfd.featureName) {
    errors.push({ path: `${base}.featureName`, message: 'featureName is required', severity: 'error' });
    return errors;
  }

  const diag = dfd.dataFlowDiagram;
  if (!diag) {
    errors.push({ path: `${base}.dataFlowDiagram`, message: 'dataFlowDiagram is required', severity: 'error' });
    return errors;
  }

  const nodeIds = new Set<string>();
  for (const a of diag.actors ?? []) nodeIds.add(a.id);
  for (const p of diag.processes ?? []) nodeIds.add(p.id);
  for (const d of diag.dataStores ?? []) nodeIds.add(d.id);

  for (let fi = 0; fi < (diag.flows ?? []).length; fi++) {
    const flow = diag.flows[fi];
    if (!nodeIds.has(flow.from)) {
      errors.push({
        path: `${base}.dataFlowDiagram.flows[${fi}].from`,
        message: `Flow source node '${flow.from}' does not exist in actors/processes/dataStores.`,
        severity: 'error',
      });
    }
    if (!nodeIds.has(flow.to)) {
      errors.push({
        path: `${base}.dataFlowDiagram.flows[${fi}].to`,
        message: `Flow target node '${flow.to}' does not exist in actors/processes/dataStores.`,
        severity: 'error',
      });
    }
  }

  if (dfd.evidence) {
    errors.push(...validateEvidenceRefs(dfd.evidence, `${base}.evidence`));
  }

  return errors;
}

function validateThreatModel(
  tm: ThreatModelContextSubmission,
  idx: number,
  knownFeatureNames: Set<string>,
  knownServiceNames: Set<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const base = `threatModels[${idx}]`;

  if (!tm.featureName) {
    errors.push({ path: `${base}.featureName`, message: 'featureName is required', severity: 'error' });
    return errors;
  }

  if (knownFeatureNames.size > 0 && !knownFeatureNames.has(tm.featureName)) {
    errors.push({
      path: `${base}.featureName`,
      message: `Feature '${tm.featureName}' was not found in the indexed features. Known feature names: ${[...knownFeatureNames].join(', ')}`,
      severity: 'error',
    });
  }

  for (let si = 0; si < (tm.serviceThreatModels ?? []).length; si++) {
    const stm = tm.serviceThreatModels[si];
    const stmBase = `${base}.serviceThreatModels[${si}]`;
    if (!stm.serviceName) {
      errors.push({ path: `${stmBase}.serviceName`, message: 'serviceName is required', severity: 'error' });
    } else if (knownServiceNames.size > 0 && !knownServiceNames.has(stm.serviceName)) {
      errors.push({
        path: `${stmBase}.serviceName`,
        message: `Service '${stm.serviceName}' was not found in the indexed services. Known service names: ${[...knownServiceNames].join(', ')}. The serviceName must match exactly (case-sensitive).`,
        severity: 'error',
      });
    }
    if (!stm.serviceDfd) {
      errors.push({ path: `${stmBase}.serviceDfd`, message: 'serviceDfd is required', severity: 'error' });
    }
  }

  const featureThreats = tm.featureThreatModel?.strideThreats ?? [];
  for (let ti = 0; ti < featureThreats.length; ti++) {
    const threat = featureThreats[ti];
    const threatBase = `${base}.featureThreatModel.strideThreats[${ti}]`;
    if (!threat.id) {
      errors.push({ path: `${threatBase}.id`, message: 'Threat id is required', severity: 'error' });
    }
    if (!threat.category) {
      errors.push({ path: `${threatBase}.category`, message: 'Threat category is required', severity: 'error' });
    }
  }

  return errors;
}

function validateService(svc: ServiceContextSubmission, idx: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const base = `services[${idx}]`;

  if (!svc.name) {
    errors.push({ path: `${base}.name`, message: 'Service name is required', severity: 'error' });
  }
  if (!svc.codePath) {
    errors.push({ path: `${base}.codePath`, message: 'Service codePath is required', severity: 'error' });
  }
  if (!svc.evidence || svc.evidence.length === 0) {
    errors.push({ path: `${base}.evidence`, message: 'At least one evidence ref is required per service', severity: 'error' });
  } else {
    errors.push(...validateEvidenceRefs(svc.evidence, `${base}.evidence`));
  }

  const validServiceTypes = ['api', 'library', 'worker', 'other'];
  if (!validServiceTypes.includes(svc.serviceType)) {
    errors.push({ path: `${base}.serviceType`, message: `serviceType must be one of: ${validServiceTypes.join(', ')}`, severity: 'error' });
  }

  return errors;
}

export function validateSubmission(
  submission: RepositoryIndexingSubmission,
  currentStage: RepositoryIndexingStage,
  meta?: RepositoryIndexingRunMetadata,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!submission.stage) {
    errors.push({ path: 'stage', message: 'stage discriminator is required', severity: 'error' });
    return errors;
  }

  if (submission.stage !== currentStage) {
    errors.push({
      path: 'stage',
      message: `Submission stage '${submission.stage}' does not match current session stage '${currentStage}'. Fix the stage field or resume the correct session.`,
      severity: 'error',
    });
    return errors;
  }

  const knownServiceNames = new Set(Object.keys(meta?.persistedIds?.serviceIds ?? {}));
  // Feature names: prefer persisted IDs (post-dfd_creation), fall back to drafts (during dfd_creation)
  const persistedFeatureNames = Object.keys(meta?.persistedIds?.featureIds ?? {});
  const draftFeatureNames = (meta?.drafts?.features ?? []).map(f => f.name).filter(Boolean);
  const knownFeatureNames = new Set(persistedFeatureNames.length > 0 ? persistedFeatureNames : draftFeatureNames);

  switch (submission.stage) {
    case 'repository_inventory': {
      const inv = submission.inventory;
      if (!inv.name) {
        errors.push({ path: 'inventory.name', message: 'Repository name is required', severity: 'error' });
      }
      if (!inv.languages || inv.languages.length === 0) {
        errors.push({ path: 'inventory.languages', message: 'At least one language is required', severity: 'warning' });
      }
      if (!inv.summary) {
        errors.push({ path: 'inventory.summary', message: 'Repository summary is required', severity: 'error' });
      }
      if (inv.evidence && inv.evidence.length > 0) {
        errors.push(...validateEvidenceRefs(inv.evidence, 'inventory.evidence'));
      }
      break;
    }

    case 'service_extraction': {
      if (!submission.services || submission.services.length === 0) {
        errors.push({ path: 'services', message: 'At least one service is required', severity: 'error' });
        break;
      }
      for (let i = 0; i < submission.services.length; i++) {
        errors.push(...validateService(submission.services[i], i));
      }
      break;
    }

    case 'feature_extraction': {
      if (!submission.features || submission.features.length === 0) {
        errors.push({ path: 'features', message: 'At least one feature is required', severity: 'warning' });
        break;
      }
      for (let i = 0; i < submission.features.length; i++) {
        const f = submission.features[i];
        const base = `features[${i}]`;
        if (!f.name) errors.push({ path: `${base}.name`, message: 'Feature name is required', severity: 'error' });
        if (!f.description) errors.push({ path: `${base}.description`, message: 'Feature description is required', severity: 'error' });
        if (!f.sourceServiceNames || f.sourceServiceNames.length === 0) {
          errors.push({ path: `${base}.sourceServiceNames`, message: 'At least one source service name is required', severity: 'error' });
        } else if (knownServiceNames.size > 0) {
          for (const svcName of f.sourceServiceNames) {
            if (!knownServiceNames.has(svcName)) {
              errors.push({
                path: `${base}.sourceServiceNames`,
                message: `Service '${svcName}' was not found in the indexed services. Known service names: ${[...knownServiceNames].join(', ')}. The name must match exactly (case-sensitive).`,
                severity: 'error',
              });
            }
          }
        }
        if (f.routeEvidence && f.routeEvidence.length > 0) {
          errors.push(...validateEvidenceRefs(f.routeEvidence, `${base}.routeEvidence`));
        }
      }
      break;
    }

    case 'dfd_creation': {
      if (!submission.dfds || submission.dfds.length === 0) {
        errors.push({ path: 'dfds', message: 'At least one DFD is required', severity: 'error' });
        break;
      }
      for (let i = 0; i < submission.dfds.length; i++) {
        const dfd = submission.dfds[i];
        if (dfd.featureName && knownFeatureNames.size > 0 && !knownFeatureNames.has(dfd.featureName)) {
          errors.push({
            path: `dfds[${i}].featureName`,
            message: `Feature '${dfd.featureName}' was not found in the indexed features. Known feature names: ${[...knownFeatureNames].join(', ')}.`,
            severity: 'error',
          });
        }
        errors.push(...validateDfd(dfd, i));
      }
      break;
    }

    case 'threat_model_creation': {
      if (!submission.threatModels || submission.threatModels.length === 0) {
        errors.push({ path: 'threatModels', message: 'At least one threat model is required', severity: 'error' });
        break;
      }
      for (let i = 0; i < submission.threatModels.length; i++) {
        errors.push(...validateThreatModel(submission.threatModels[i], i, knownFeatureNames, knownServiceNames));
      }
      break;
    }

    case 'relationship_correlation': {
      if (!submission.relationships || submission.relationships.length === 0) {
        errors.push({ path: 'relationships', message: 'No relationships submitted; submit an empty acceptedGaps completeness_check instead if relationships are unknown', severity: 'warning' });
      }
      for (let i = 0; i < (submission.relationships ?? []).length; i++) {
        const rel = submission.relationships[i];
        const base = `relationships[${i}]`;
        if (!rel.sourceKey) errors.push({ path: `${base}.sourceKey`, message: 'sourceKey is required', severity: 'error' });
        if (!rel.targetKey) errors.push({ path: `${base}.targetKey`, message: 'targetKey is required', severity: 'error' });
        if (!rel.relationshipType) errors.push({ path: `${base}.relationshipType`, message: 'relationshipType is required', severity: 'error' });
        if (rel.evidence && rel.evidence.length > 0) {
          errors.push(...validateEvidenceRefs(rel.evidence, `${base}.evidence`));
        }
      }
      break;
    }

    case 'completeness_check':
      break;
  }

  return errors.filter(e => e.severity === 'error');
}
