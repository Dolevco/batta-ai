export interface AssetCategory {
  type: string;
  label: string;
  count: number;
}

export interface Asset {
  id: string;
  type: string;
  name: string;
  owner?: string;
  businessCriticality?: 'critical' | 'high' | 'medium' | 'low';
  riskScore?: number;
  metadata: Record<string, any>;
}
