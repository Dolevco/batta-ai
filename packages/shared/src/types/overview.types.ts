export interface OverviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  asset: string;
  review: string;
  reviewId: string;
  owner: string;
}

export interface OverviewReviewEntry {
  id: string;
  title: string;
  status: 'completed' | 'in-progress';
  findings: number;
  date: string;
}

export interface OverviewAssetRisk {
  name: string;
  score: number;
  entityType?: string;
}

export interface OverviewStats {
  criticalFindings: number;
  reviewsCompleted: number;
  servicesScanned: number;
  servicesTotal: number;
  vulnerabilitiesResolved: number;
  findings: OverviewFinding[];
  recentReviews: OverviewReviewEntry[];
  assetRisks: OverviewAssetRisk[];
  funnelPhases: { label: string; count: number }[];
}
