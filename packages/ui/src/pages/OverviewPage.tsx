import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { T, D, dk } from '../theme';
import { useOverview } from '../hooks/useOverview';
import type { OverviewFinding, OverviewReviewEntry, OverviewAssetRisk } from '../types';
import {
  WarningOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  SafetyOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  GithubOutlined,
  ApiOutlined,
  ClusterOutlined,
} from '@ant-design/icons';

// ── Types ──────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'low';
type Finding = OverviewFinding;
type ReviewEntry = OverviewReviewEntry;
type ReviewStatus = 'completed' | 'in-progress';

interface AssetRisk extends OverviewAssetRisk {
  type: string;
  icon: React.ReactNode;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  code_service:        'Service',
  code_repository:     'Repository',
  code_module:         'Module',
  code_artifact:       'Code Artifact',
  code_component:      'Component',
  build_artifact:      'Build Artifact',
  deployment_artifact: 'Deployment Artifact',
  cloud_resource:      'Cloud Resource',
  azure_identity:      'Identity',
  iam_role_assignment: 'IAM Role',
  identity:            'Identity',
  data_store:          'Data Store',
  api_endpoint:        'API Endpoint',
  network_segment:     'Network',
  external_dependency: 'External Dep',
  trust_boundary:      'Trust Boundary',
  dependency:          'Dependency',
};

// Assign icon + display type based on entityType from the API
function enrichAsset(a: OverviewAssetRisk): AssetRisk {
  const typeLabel = a.entityType ? (ENTITY_TYPE_LABELS[a.entityType] ?? a.entityType) : 'Service';
  const icon = a.entityType === 'cloud_resource' || a.entityType === 'azure_identity' || a.entityType === 'iam_role_assignment' || a.entityType === 'identity' ? <CloudOutlined />
    : a.entityType === 'code_repository' ? <GithubOutlined />
    : a.entityType === 'api_endpoint' ? <ApiOutlined />
    : a.entityType === 'code_service' && a.name === 'core' ? <ClusterOutlined />
    : a.entityType === 'build_artifact' || a.entityType === 'deployment_artifact' || a.entityType === 'code_artifact' ? <ClusterOutlined />
    : a.entityType === 'code_service' || a.entityType === 'code_module' || a.entityType === 'code_component' || a.entityType === 'dependency' ? <ApiOutlined />
    : <CloudOutlined />;
  return { ...a, type: typeLabel, icon };
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ width, height, borderRadius = 4, isDark }: { width: number | string; height: number | string; borderRadius?: number; isDark: boolean }) {
  const bg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const shimmer = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  return (
    <div style={{
      width, height, borderRadius,
      background: `linear-gradient(90deg, ${bg} 25%, ${shimmer} 50%, ${bg} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'skeletonShimmer 1.4s infinite',
      flexShrink: 0,
    }} />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OverviewPage() {
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';
  const navigate = useNavigate();
  const { data, loading } = useOverview();

  const pageBg    = dk(isDark, T.stone100, D.bg);
  const cardBg    = dk(isDark, T.white,    D.bgCard);
  const border    = dk(isDark, T.stone200, D.border);
  const text      = dk(isDark, T.stone900, D.text);
  const textMuted = dk(isDark, T.stone500, D.textMuted);
  const textFaint = dk(isDark, T.stone400, D.textFaint);

  const scannedPct = data && data.servicesTotal > 0
    ? Math.round((data.servicesScanned / data.servicesTotal) * 100)
    : 0;

  const enrichedAssets: AssetRisk[] = (data?.assetRisks ?? []).map(enrichAsset);

  const funnelPhases = data?.funnelPhases ?? [
    { label: 'Raw Scan', count: 0 },
    { label: 'Tasks', count: 0 },
    { label: 'Likelihood', count: 0 },
    { label: 'Critical', count: 0 },
  ];

  return (
    <div style={{ minHeight: '100%', background: pageBg }}>
      <style>{`@keyframes skeletonShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* Page header */}
      <div style={{ padding: '28px 28px 0', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: text, lineHeight: 1.2 }}>
          Overview
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: textMuted }}>
          Security posture at a glance — last updated just now
        </p>
      </div>

      <div style={{ padding: '0 28px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Stats row ──────────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>

          <StatCard isDark={isDark} cardBg={cardBg} border={border} textMuted={textMuted} textFaint={textFaint}
            loading={loading}
            icon={<WarningOutlined />} iconColor={T.red} iconBg={dk(isDark, T.redLight, D.redLight)}
            label="Critical Findings" value={data?.criticalFindings ?? 0} valueColor={T.red}
            badge={loading ? null : <DeltaBadge value={String(data?.criticalFindings ?? 0)} label="unresolved" up={false} color={T.red} bg={dk(isDark, T.redLight, D.redLight)} />}
          />

          <StatCard isDark={isDark} cardBg={cardBg} border={border} textMuted={textMuted} textFaint={textFaint}
            loading={loading}
            icon={<CheckCircleOutlined />} iconColor={T.orange} iconBg={dk(isDark, T.orangeLight, D.orangeLight)}
            label="Reviews Completed" value={data?.reviewsCompleted ?? 0} valueColor={text}
            badge={loading ? null : <DeltaBadge value={String(data?.reviewsCompleted ?? 0)} label="attested" up={true} color={T.green} bg={dk(isDark, T.greenLight, D.greenLight)} />}
          />

          <StatCard isDark={isDark} cardBg={cardBg} border={border} textMuted={textMuted} textFaint={textFaint}
            loading={loading}
            icon={<CloudOutlined />} iconColor={T.blue} iconBg={dk(isDark, T.blueLight, D.blueLight)}
            label="Services Covered" value={data?.servicesScanned ?? 0} valueColor={text} valueSuffix={!loading && data ? `/ ${data.servicesTotal}` : ''}
            badge={loading ? null : <ProgressBadge pct={scannedPct} isDark={isDark} textFaint={textFaint} />}
          />

          <StatCard isDark={isDark} cardBg={cardBg} border={border} textMuted={textMuted} textFaint={textFaint}
            loading={loading}
            icon={<SafetyOutlined />} iconColor={T.green} iconBg={dk(isDark, T.greenLight, D.greenLight)}
            label="Tasks Resolved" value={data?.vulnerabilitiesResolved ?? 0} valueColor={text}
            badge={loading ? null : <DeltaBadge value={String(data?.vulnerabilitiesResolved ?? 0)} label="handled" up={true} color={T.green} bg={dk(isDark, T.greenLight, D.greenLight)} />}
          />
        </div>

        {/* ── Row 2: Critical Findings + Recent Reviews ───────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* Critical Findings list */}
          <SectionCard isDark={isDark} cardBg={cardBg} border={border} text={text} textMuted={textMuted}
            title="Critical Findings" subtitle={loading ? 'Loading…' : `${data?.criticalFindings ?? 0} unresolved${(data?.criticalFindings ?? 0) > 10 ? ' — showing top 10' : ''}`}
          >
            <FindingsList findings={data?.findings ?? []} loading={loading} isDark={isDark} border={border} text={text} textMuted={textMuted} textFaint={textFaint}
              onClickReview={(reviewId) => navigate(`/knowledge-base/security-reviews/${reviewId}`)}
            />
          </SectionCard>

          {/* Recent Security Reviews */}
          <SectionCard isDark={isDark} cardBg={cardBg} border={border} text={text} textMuted={textMuted}
            title="Security Reviews" subtitle="Recent activity"
          >
            <ReviewTimeline reviews={data?.recentReviews ?? []} loading={loading} isDark={isDark} text={text} textFaint={textFaint}
              onClickReview={(id) => navigate(`/knowledge-base/security-reviews/${id}`)}
            />
          </SectionCard>
        </div>

        {/* ── Row 3: Burn Chart + Asset Risk Scores ───────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* Risk Funnel */}
          <SectionCard isDark={isDark} cardBg={cardBg} border={border} text={text} textMuted={textMuted}
            title="Risk Funnel" subtitle="Vulnerabilities filtered through scan → tasks → likelihood → critical"
          >
            <FunnelChart phases={funnelPhases} loading={loading} isDark={isDark} />
          </SectionCard>

          {/* Asset Risk Scores */}
          <SectionCard isDark={isDark} cardBg={cardBg} border={border} text={text} textMuted={textMuted}
            title="Asset Risk Scores" subtitle="By package / service"
          >
            <AssetRiskBars assets={enrichedAssets} loading={loading} isDark={isDark} text={text} textMuted={textMuted} textFaint={textFaint} border={border} />
          </SectionCard>
        </div>

      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SectionCard({ isDark, cardBg, border, text, textMuted, title, subtitle, children }: {
  isDark: boolean; cardBg: string; border: string; text: string; textMuted: string;
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${border}`,
      borderRadius: 12,
      boxShadow: isDark
        ? '0 1px 3px rgba(0,0,0,0.3)'
        : '0 1px 3px rgba(28,25,23,0.06), 0 1px 2px rgba(28,25,23,0.04)',
    }}>
      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${border}` }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: text, letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: 12, color: textMuted, marginTop: 1 }}>{subtitle}</div>
      </div>
      <div style={{ padding: '0' }}>
        {children}
      </div>
    </div>
  );
}

// ── Critical Findings list ────────────────────────────────────────────────────

const SEV_CONFIG: Partial<Record<Severity, { label: string; color: string; bg: (isDark: boolean) => string; dot: string }>> = {
  critical: { label: 'Critical', color: T.red,   bg: (d) => d ? D.redLight   : T.redLight,   dot: T.red   },
  high:     { label: 'High',     color: T.amber,  bg: (d) => d ? D.amberLight : T.amberLight, dot: T.amber },
  medium:   { label: 'Medium',   color: T.blue,   bg: (d) => d ? D.blueLight  : T.blueLight,  dot: T.blue  },
  low:      { label: 'Low',      color: T.stone400, bg: () => 'transparent',                  dot: T.stone400 },
};

function FindingsList({ findings, loading, isDark, border, text, textMuted, textFaint, onClickReview }: {
  findings: Finding[]; loading?: boolean; isDark: boolean; border: string; text: string;
  textMuted: string; textFaint: string; onClickReview: (id: string) => void;
}) {
  const hoverBg = dk(isDark, T.stone50, '#333');

  return (
    <div>
      {/* Header row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '90px 1fr 90px 160px 110px',
        padding: '8px 20px', gap: 12,
        borderBottom: `1px solid ${border}`,
      }}>
        {['Severity', 'Finding', 'Asset', 'Review', 'Owner'].map(h => (
          <span key={h} style={{ fontSize: 11, fontWeight: 600, color: textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
        ))}
      </div>

      {loading && Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '90px 1fr 90px 160px 110px',
          padding: '12px 20px', gap: 12, alignItems: 'center',
          borderBottom: i < 4 ? `1px solid ${border}` : 'none',
        }}>
          <Skeleton width={60} height={20} borderRadius={99} isDark={isDark} />
          <Skeleton width="85%" height={14} isDark={isDark} />
          <Skeleton width={50} height={14} isDark={isDark} />
          <Skeleton width={100} height={14} isDark={isDark} />
          <Skeleton width={70} height={14} isDark={isDark} />
        </div>
      ))}

      {!loading && findings.map((f, i) => {
        const cfg = SEV_CONFIG[f.severity] ?? SEV_CONFIG.low!;
        return (
          <div
            key={f.id}
            onClick={() => onClickReview(f.reviewId)}
            style={{
              display: 'grid', gridTemplateColumns: '90px 1fr 90px 160px 110px',
              padding: '10px 20px', gap: 12, alignItems: 'center',
              borderBottom: i < findings.length - 1 ? `1px solid ${border}` : 'none',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = hoverBg}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            {/* Severity badge */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '2px 8px', borderRadius: 99,
              fontSize: 11, fontWeight: 600,
              color: cfg.color, background: cfg.bg(isDark),
              width: 'fit-content',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0, display: 'inline-block' }} />
              {cfg.label}
            </span>

            {/* Title */}
            <span style={{ fontSize: 13, color: text, lineHeight: 1.4, fontWeight: 400 }}>{f.title}</span>

            {/* Asset */}
            <span style={{ fontSize: 12, color: textMuted, fontFamily: 'monospace' }}>{f.asset}</span>

            {/* Review — clickable hint */}
            <span style={{ fontSize: 12, color: T.orange, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.review}
            </span>

            {/* Owner */}
            <span style={{ fontSize: 12, color: textFaint }}>{f.owner}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Review Timeline ───────────────────────────────────────────────────────────

const STATUS_DOT: Record<ReviewStatus, string> = {
  completed:     T.green,
  'in-progress': T.orange,
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  completed:     'Completed',
  'in-progress': 'In Progress',
};

function ReviewTimeline({ reviews, loading, isDark, text, textFaint, onClickReview }: {
  reviews: ReviewEntry[]; loading?: boolean; isDark: boolean; text: string;
  textFaint: string; onClickReview: (id: string) => void;
}) {
  const hoverBg = dk(isDark, T.stone50, '#333');
  const trackColor = dk(isDark, T.stone200, D.borderSub);

  if (loading) {
    return (
      <div style={{ padding: '8px 0' }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0, padding: '10px 0' }}>
              <Skeleton width={10} height={10} borderRadius={99} isDark={isDark} />
              {i < 3 && <div style={{ width: 1, flex: 1, minHeight: 20, background: trackColor, marginTop: 3 }} />}
            </div>
            <div style={{ flex: 1, padding: '8px 16px 8px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width="75%" height={14} isDark={isDark} />
              <Skeleton width="45%" height={11} isDark={isDark} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {reviews.map((r, i) => {
        const dotColor = STATUS_DOT[r.status];
        const isLast = i === reviews.length - 1;
        return (
          <div
            key={r.id}
            onClick={() => onClickReview(r.id)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 0,
              cursor: 'pointer', transition: 'background 0.15s',
              borderRadius: 6,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = hoverBg}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            {/* Timeline track */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0, padding: '10px 0' }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
                boxShadow: r.status === 'in-progress' ? `0 0 0 3px ${dotColor}33` : 'none',
              }} />
              {!isLast && (
                <div style={{ width: 1, flex: 1, minHeight: 20, background: trackColor, marginTop: 3 }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, padding: '8px 16px 8px 4px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: text, lineHeight: 1.3, marginBottom: 3 }}>
                {r.title}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: dotColor, fontWeight: 600 }}>{STATUS_LABEL[r.status]}</span>
                {r.findings > 0 && (
                  <span style={{ fontSize: 11, color: textFaint }}>
                    {r.findings} finding{r.findings !== 1 ? 's' : ''}
                  </span>
                )}
                <span style={{ fontSize: 11, color: textFaint, marginLeft: 'auto' }}>{r.date}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Risk Funnel (pure SVG) ────────────────────────────────────────────────────

function FunnelChart({ phases, loading, isDark }: {
  phases: { label: string; count: number }[]; loading?: boolean; isDark: boolean;
}) {
  const W = 580, H = 210;
  const PAD = { top: 56, right: 24, bottom: 20, left: 20 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const cy = PAD.top + chartH / 2;

  // X positions: 4 phase start markers + 1 endpoint where funnel tapers to tip
  const phaseRatios = [0, 0.28, 0.56, 0.80, 1.0];
  const xPts = phaseRatios.map(r => PAD.left + r * chartW);

  // Band half-heights at each of the 5 x-points (outer → inner)
  const bandDefs = [
    { h: [82, 52, 28, 7,  1.2], alpha: 0.14 },
    { h: [68, 43, 22, 5.5, 1.0], alpha: 0.20 },
    { h: [54, 34, 17, 4.2, 0.8], alpha: 0.26 },
    { h: [40, 25, 12, 3.2, 0.7], alpha: 0.33 },
    { h: [26, 16, 7.5, 2.2, 0.6], alpha: 0.44 },
    { h: [13, 8,  3.8, 1.4, 0.5], alpha: 0.62 },
  ];

  // Smooth cubic-bezier path for a band (top arc → bottom arc → close)
  const makePath = (heights: number[]) => {
    // Top edge: left → right
    let d = `M${xPts[0]},${cy - heights[0]}`;
    for (let i = 1; i < xPts.length; i++) {
      const dx = (xPts[i] - xPts[i - 1]) * 0.5;
      d += ` C${xPts[i-1]+dx},${cy-heights[i-1]} ${xPts[i]-dx},${cy-heights[i]} ${xPts[i]},${cy-heights[i]}`;
    }
    // Bottom edge: right → left
    d += ` L${xPts[xPts.length-1]},${cy+heights[heights.length-1]}`;
    for (let i = xPts.length - 2; i >= 0; i--) {
      const dx = (xPts[i+1] - xPts[i]) * 0.5;
      d += ` C${xPts[i+1]-dx},${cy+heights[i+1]} ${xPts[i]+dx},${cy+heights[i]} ${xPts[i]},${cy+heights[i]}`;
    }
    return d + ' Z';
  };

  const divColor   = dk(isDark, 'rgba(28,25,23,0.35)', 'rgba(245,245,244,0.2)');
  const labelColor = dk(isDark, D.textMuted, T.stone600);
  const countColor   = dk(isDark, D.textFaint, T.stone400);


  return (
    <div style={{ padding: '0 20px 16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>

        {/* Funnel bands (outermost first so inner layers render on top) */}
        {bandDefs.map((band, i) => (
          <path key={i} d={makePath(band.h)} fill={`rgba(220,38,38,${band.alpha})`} />
        ))}

        {/* Vertical divider lines at phase boundaries (skip first and last) */}
        {xPts.slice(1, -1).map((x, i) => (
          <line key={i} x1={x} y1={PAD.top - 8} x2={x} y2={PAD.top + chartH + 4}
            stroke={divColor} strokeWidth={1} />
        ))}

        {/* Phase labels: numbered circle + label + count */}
        {phases.map((phase, i) => {
          const x = xPts[i];
          return (
            <g key={i}>
              {/* Phase name */}
              <text x={x} y={15} textAnchor="start" dominantBaseline="middle"
                fontSize={11} fill={labelColor} fontWeight="500">
                {phase.label}
              </text>
              {/* Count below label area */}
              {loading
                ? <rect x={x - 12} y={28} width={24} height={10} rx={3} fill={countColor} opacity={0.3} />
                : <text x={x} y={36} textAnchor="middle" fontSize={10} fill={countColor}>{phase.count}</text>
              }
            </g>
          );
        })}

        {/* Final count label at tip */}
        {!loading && (
        <text x={xPts[4] - 4} y={cy - 10} textAnchor="end"
          fontSize={11} fill={`rgba(220,38,38,0.85)`} fontWeight="700">
          {phases[phases.length - 1]?.count ?? 0}
        </text>
        )}
        <text x={xPts[4] - 4} y={cy + 4} textAnchor="end"
          fontSize={9} fill={countColor}>
          critical
        </text>
      </svg>
    </div>
  );
}

// ── Asset Risk Scores ─────────────────────────────────────────────────────────

function AssetRiskBars({ assets, loading, isDark, text, textMuted, textFaint, border }: {
  assets: AssetRisk[]; loading?: boolean; isDark: boolean; text: string; textMuted: string; textFaint: string; border: string;
}) {
  const trackBg = dk(isDark, T.stone100, D.borderSub);

  const riskColor = (score: number) =>
    score >= 70 ? T.red : score >= 50 ? T.amber : T.green;

  const riskLabel = (score: number) =>
    score >= 70 ? 'High' : score >= 50 ? 'Medium' : 'Low';

  if (loading) {
    return (
      <div style={{ padding: '8px 0' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ padding: '10px 20px', borderBottom: i < 4 ? `1px solid ${border}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <Skeleton width={100} height={14} isDark={isDark} />
              <Skeleton width={40} height={20} borderRadius={4} isDark={isDark} />
            </div>
            <div style={{ height: 5, borderRadius: 99, background: trackBg, overflow: 'hidden' }}>
              <Skeleton width={`${40 + i * 12}%`} height={5} borderRadius={99} isDark={isDark} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {assets.map((a, i) => {
        const color = riskColor(a.score);
        const isLast = i === assets.length - 1;
        return (
          <div key={a.name} style={{
            padding: '10px 20px',
            borderBottom: isLast ? 'none' : `1px solid ${border}`,
          }}>
            {/* Name row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: textMuted, display: 'flex' }}>{a.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: text, fontFamily: 'monospace' }}>{a.name}</span>
                <span style={{ fontSize: 11, color: textFaint }}>{a.type}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color, padding: '1px 6px', borderRadius: 4, background: riskColor(a.score) === T.red ? dk(isDark, T.redLight, D.redLight) : riskColor(a.score) === T.amber ? dk(isDark, T.amberLight, D.amberLight) : dk(isDark, T.greenLight, D.greenLight) }}>
                  {riskLabel(a.score)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right' }}>
                  {a.score}
                </span>
              </div>
            </div>

            {/* Bar */}
            <div style={{ height: 5, borderRadius: 99, background: trackBg, overflow: 'hidden' }}>
              <div style={{
                width: `${a.score}%`, height: '100%',
                borderRadius: 99, background: color,
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function StatCard({
  isDark, cardBg, border, textMuted, textFaint,
  icon, iconColor, iconBg, label, value, valueColor, valueSuffix, badge, loading,
}: {
  isDark: boolean; cardBg: string; border: string; textMuted: string; textFaint: string;
  icon: React.ReactNode; iconColor: string; iconBg: string;
  label: string; value: number; valueColor: string; valueSuffix?: string; badge: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div style={{
      background: cardBg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '20px 20px 18px',
      boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(28,25,23,0.06), 0 1px 2px rgba(28,25,23,0.04)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: iconColor, flexShrink: 0 }}>
          {icon}
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: textMuted, letterSpacing: '0.01em' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {loading
          ? <Skeleton width={64} height={36} borderRadius={6} isDark={isDark} />
          : <>
              <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: valueColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {value.toLocaleString()}
              </span>
              {valueSuffix && <span style={{ fontSize: 16, fontWeight: 500, color: textFaint }}>{valueSuffix}</span>}
            </>
        }
      </div>
      <div style={{ minHeight: 24 }}>{badge}</div>
    </div>
  );
}

function DeltaBadge({ value, label, up, color, bg }: { value: string; label: string; up: boolean; color: string; bg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600, color, background: bg }}>
        {up ? <ArrowUpOutlined style={{ fontSize: 9 }} /> : <ArrowDownOutlined style={{ fontSize: 9 }} />}
        {value}
      </span>
      <span style={{ fontSize: 11, color: T.stone400 }}>{label}</span>
    </div>
  );
}

function ProgressBadge({ pct, isDark, textFaint }: { pct: number; isDark: boolean; textFaint: string }) {
  const trackBg = isDark ? D.borderSub : T.stone200;
  const fillColor = pct >= 80 ? T.green : pct >= 50 ? T.amber : T.red;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ height: 6, borderRadius: 99, background: trackBg, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: fillColor, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 11, color: textFaint, fontVariantNumeric: 'tabular-nums' }}>{pct}% scanned</span>
    </div>
  );
}
