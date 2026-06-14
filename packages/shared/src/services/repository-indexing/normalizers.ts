import { createHash } from 'crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function deterministicId(input: string): string {
  return sha256(input).slice(0, 36);
}

export function repositoryId(tenantId: string, repositoryName: string): string {
  return deterministicId(`${tenantId}|code_repository|${repositoryName}`);
}

export function serviceId(tenantId: string, repositoryId: string, serviceName: string): string {
  return deterministicId(`${tenantId}|code_service|${repositoryId}|${serviceName}`);
}

export function featureId(tenantId: string, repositoryId: string, serviceNames: string[], featureName: string): string {
  return deterministicId(
    `${tenantId}|feature_analysis|${repositoryId}|${serviceNames.slice().sort().join(',')}|${featureName}`,
  );
}

export function moduleId(tenantId: string, repositoryId: string, filePath: string): string {
  return deterministicId(`${tenantId}|code_module|${repositoryId}|${filePath}`);
}

export function relationshipId(tenantId: string, sourceId: string, type: string, targetId: string): string {
  return deterministicId(`${tenantId}|relationship|${sourceId}|${type}|${targetId}`);
}

export function evidenceId(
  tenantId: string,
  subjectId: string,
  filePath: string,
  lineStart: number | undefined,
  rationale: string,
): string {
  return deterministicId(`${tenantId}|evidence|${subjectId}|${filePath}|${lineStart ?? ''}|${rationale}`);
}

export function contentHash(obj: unknown): string {
  return sha256(JSON.stringify(obj)).slice(0, 64);
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_/]/g, '');
}

export function normalizeServiceType(raw: string): 'api' | 'library' | 'worker' | 'other' {
  const valid: Array<'api' | 'library' | 'worker' | 'other'> = ['api', 'library', 'worker', 'other'];
  const v = raw?.toLowerCase()?.trim() as 'api' | 'library' | 'worker' | 'other';
  return valid.includes(v) ? v : 'other';
}

export function now(): string {
  return new Date().toISOString();
}
