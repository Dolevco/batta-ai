import type { Request, Response } from 'express';
import type { SecurityReviewService, AssetService } from '@ai-agent/shared';
import type { SecurityReview, OverviewStats, OverviewFinding, OverviewReviewEntry, OverviewAssetRisk } from '@ai-agent/shared';

function resolveTenantId(req: Request): string {
  if (req.auth?.tenantId) return req.auth.tenantId;
  throw new Error('Cannot fetch tenantId');
}

function mapReviewStatus(status: SecurityReview['status']): 'completed' | 'in-progress' {
  return status === 'attested' ? 'completed' : 'in-progress';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export class OverviewController {
  constructor(
    private service: SecurityReviewService,
    private assetService?: AssetService,
  ) {}

  private async buildEntityTypeMap(tenantId: string, names: string[]): Promise<Record<string, string>> {
    if (!this.assetService || names.length === 0) return {};
    try {
      const nameSet = new Set(names);
      const entityTypes = [
        'code_service', 'code_repository', 'code_module', 'code_artifact', 'code_component',
        'build_artifact', 'deployment_artifact',
        'cloud_resource', 'azure_identity', 'iam_role_assignment', 'identity',
        'data_store', 'api_endpoint', 'network_segment', 'external_dependency',
        'trust_boundary', 'dependency',
      ];
      const map: Record<string, string> = {};
      for (const entityType of entityTypes) {
        const assets = await this.assetService.getAssetsByCategory(tenantId, entityType);
        for (const asset of assets) {
          if (nameSet.has(asset.name)) {
            map[asset.name] = entityType;
          }
        }
      }
      return map;
    } catch {
      return {};
    }
  }

  async getOverview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const reviews = await this.service.listReviews(tenantId);

      // Collect all unhandled tasks across reviews
      const findings: OverviewFinding[] = [];
      const assetTaskCounts: Record<string, number> = {};

      for (const review of reviews) {
        const handledIds = new Set(
          review.attestations.filter(a => a.handled).map(a => a.taskId)
        );

        for (const task of review.tasks) {
          if (handledIds.has(task.id)) continue;

          const asset = review.services?.[0] ?? 'unknown';

          // Accumulate unhandled task count per service
          for (const svc of review.services ?? [asset]) {
            assetTaskCounts[svc] = (assetTaskCounts[svc] ?? 0) + 1;
          }

          if (task.severity === 'critical' || task.severity === 'high' || task.severity === 'medium') {
            findings.push({
              id: task.id,
              severity: task.severity,
              title: task.title,
              asset,
              review: review.featureDescription,
              reviewId: review.id,
              owner: review.agentName ?? 'unknown',
            });
          }
        }
      }

      // Sort findings: critical first, then high, then medium
      const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      findings.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));

      // Stats — compute total before truncating to top 10 for display
      const criticalFindings = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
      findings.splice(10);
      const reviewsCompleted = reviews.filter(r => r.status === 'attested').length;
      const vulnerabilitiesResolved = reviews.reduce((sum, r) => sum + r.attestations.filter(a => a.handled).length, 0);

      // Distinct services across all reviews
      const allServices = new Set<string>();
      for (const r of reviews) {
        for (const svc of r.services ?? []) allServices.add(svc);
      }
      const servicesTotal = allServices.size;
      const scannedServices = new Set<string>();
      for (const r of reviews) {
        if (r.status === 'attested' || r.status === 'tasks_acknowledged' || r.status === 'questionnaire_answered') {
          for (const svc of r.services ?? []) scannedServices.add(svc);
        }
      }
      const servicesScanned = scannedServices.size;

      // Recent reviews (sorted by updatedAt desc, max 5)
      const recentReviews: OverviewReviewEntry[] = [...reviews]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5)
        .map(r => ({
          id: r.id,
          title: r.featureDescription,
          status: mapReviewStatus(r.status),
          findings: r.tasks.length,
          date: formatDate(r.updatedAt),
        }));

      // Build name → entityType map from asset store (best-effort)
      const entityTypeMap = await this.buildEntityTypeMap(tenantId, Object.keys(assetTaskCounts));

      // Asset risk scores: score = min(100, unhandledTaskCount * 12)
      const assetRisks: OverviewAssetRisk[] = Object.entries(assetTaskCounts)
        .map(([name, count]) => ({
          name,
          score: Math.min(100, count * 12),
          entityType: entityTypeMap[name],
        }))
        .sort((a, b) => b.score - a.score);

      // Risk funnel — all counts are task counts so the funnel narrows correctly
      const totalTasks = reviews.reduce((s, r) => s + r.tasks.length, 0);
      const tasksInAcknowledgedReviews = reviews
        .filter(r => r.status === 'tasks_acknowledged' || r.status === 'attested')
        .reduce((s, r) => s + r.tasks.length, 0);
      const tasksInAttestedReviews = reviews
        .filter(r => r.status === 'attested')
        .reduce((s, r) => s + r.tasks.length, 0);

      const funnelPhases = [
        { label: 'Raw Scan',   count: totalTasks },
        { label: 'Tasks',      count: tasksInAcknowledgedReviews },
        { label: 'Likelihood', count: tasksInAttestedReviews },
        { label: 'Critical',   count: criticalFindings },
      ];

      const stats: OverviewStats = {
        criticalFindings,
        reviewsCompleted,
        servicesScanned,
        servicesTotal,
        vulnerabilitiesResolved,
        findings,
        recentReviews,
        assetRisks,
        funnelPhases,
      };

      res.json(stats);
    } catch (error) {
      console.error('[Overview] getOverview error:', error);
      res.status(500).json({ error: 'Failed to load overview data' });
    }
  }
}
