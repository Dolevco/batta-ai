import { useState, useEffect } from 'react';
import { LoadingOutlined, ThunderboltOutlined, EyeOutlined, ExclamationCircleOutlined, SafetyOutlined } from '@ant-design/icons';
import type { BusinessFeatureSummary, ThreatSeverity } from '../../types/';
import { useFeatures } from '../../hooks/useFeatures';
import { useTheme } from '../../hooks/useTheme';
import { T as TC, D as DC } from '../../theme';

// ── Design tokens ──────────────────────────────────────────────────────────────

function makeTokens(isDark: boolean) {
  return {
    orange:      TC.orange,
    orangeLight: isDark ? DC.orangeLight : TC.orangeLight,
    stone50:  isDark ? DC.bg        : TC.stone50,
    stone100: isDark ? DC.bgCard    : TC.stone100,
    stone200: isDark ? DC.borderSub : TC.stone200,
    stone300: isDark ? TC.stone600  : TC.stone300,
    stone400: isDark ? TC.stone500  : TC.stone400,
    stone500: isDark ? TC.stone400  : TC.stone500,
    stone600: isDark ? TC.stone300  : TC.stone600,
    stone700: isDark ? TC.stone200  : TC.stone700,
    stone800: isDark ? DC.text      : TC.stone800,
    stone900: isDark ? TC.stone50   : TC.stone900,
    white:    isDark ? DC.bgSub     : TC.white,
    red:        TC.red,
    redLight:   isDark ? DC.redLight   : TC.redLight,
    green:      TC.green,
    greenLight: isDark ? DC.greenLight : TC.greenLight,
    blue:       TC.blue,
    blueLight:  isDark ? DC.blueLight  : TC.blueLight,
    amber:      TC.amber,
    amberLight: isDark ? DC.amberLight : TC.amberLight,
  };
}

type Tokens = ReturnType<typeof makeTokens>;

function makeSeverityConfig(T: Tokens): Record<ThreatSeverity, { color: string; bg: string; label: string }> {
  return {
    critical: { color: T.red,    bg: T.redLight,   label: 'Critical' },
    high:     { color: TC.orangeHigh, bg: T.orangeLight, label: 'High'     },
    medium:   { color: T.amber,  bg: T.amberLight,  label: 'Medium'   },
    low:      { color: T.green,  bg: T.greenLight,  label: 'Low'      },
    info:     { color: TC.gray,   bg: T.stone100,   label: 'Info'     },
  };
}

function SeverityPill({ value, T }: { value?: ThreatSeverity | null; T: Tokens }) {
  if (!value) return <span style={{ color: T.stone400, fontSize: 12 }}>—</span>;
  const severityConfig = makeSeverityConfig(T);
  const cfg = severityConfig[value] ?? { color: T.stone500, bg: T.stone100, label: value };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      color: cfg.color, background: cfg.bg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, display: 'inline-block', flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function RiskScoreBadge({ score, T }: { score?: number; T: Tokens }) {
  if (score === undefined || score === null) return <span style={{ color: T.stone400, fontSize: 12 }}>—</span>;
  const color = score > 70 ? T.red : score > 40 ? T.amber : T.green;
  const bg = score > 70 ? T.redLight : score > 40 ? T.amberLight : T.greenLight;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 56, height: 5, borderRadius: 99, background: T.stone100, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', borderRadius: 99, background: color }} />
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums',
        minWidth: 22, textAlign: 'right', padding: '1px 5px', borderRadius: 4, background: bg,
      }}>
        {score}
      </span>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  onSelect: (id: string) => void;
  /** If provided, only show features where sourceServiceIds includes this asset ID */
  filterByAssetId?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function FeatureListView({ onSelect, filterByAssetId }: Props) {
  const { listFeatures, loading } = useFeatures();
  const [features, setFeatures] = useState<BusinessFeatureSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { theme } = useTheme();
  const T = makeTokens(theme === 'dark');

  const load = async () => {
    setLoadError(null);
    try {
      const data = await listFeatures();
      setFeatures(filterByAssetId ? data.filter(f => f.sourceServiceIds?.includes(filterByAssetId)) : data);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load features');
    }
  };

  useEffect(() => { load(); }, [filterByAssetId]);

  // ── Loading state ──

  if (loading && features.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <LoadingOutlined style={{ fontSize: 24, color: T.orange }} />
      </div>
    );
  }

  // ── Error state ──

  if (loadError) {
    return (
      <div style={{ padding: '12px 16px', borderRadius: 10, background: T.redLight, color: T.red, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ExclamationCircleOutlined />
        <span>{loadError}</span>
        <button onClick={load} style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 6, border: `1px solid ${T.red}`, background: 'transparent', color: T.red, fontSize: 12, cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ──

  if (features.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 16 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: T.stone100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ThunderboltOutlined style={{ fontSize: 28, color: T.stone300 }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.stone800, marginBottom: 6 }}>
            {filterByAssetId ? 'No features linked to this asset' : 'No business features extracted yet'}
          </div>
          <div style={{ fontSize: 13, color: T.stone400, maxWidth: 400, lineHeight: 1.6 }}>
            {filterByAssetId
              ? 'Run an asset scan with Feature Extraction enabled to link features to this service.'
              : 'Run an asset scan with Feature Extraction enabled to automatically extract business features, data flow diagrams, and STRIDE threat models.'}
          </div>
        </div>
      </div>
    );
  }

  // ── Stats bar ──

  const total = features.length;
  const critical = features.filter(f => f.highestSeverity === 'critical').length;
  const high = features.filter(f => f.highestSeverity === 'high').length;
  const avgRisk = Math.round(features.reduce((s, f) => s + f.overallRiskScore, 0) / total);
  const avgRiskColor = avgRisk > 70 ? T.red : avgRisk > 40 ? T.amber : T.green;
  const avgRiskBg = avgRisk > 70 ? T.redLight : avgRisk > 40 ? T.amberLight : T.greenLight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Features', value: total, color: T.stone800, bg: T.stone100 },
          { label: 'Avg Risk', value: avgRisk, color: avgRiskColor, bg: avgRiskBg },
          { label: 'Critical', value: critical, color: critical > 0 ? T.red : T.stone500, bg: critical > 0 ? T.redLight : T.stone100, icon: <ExclamationCircleOutlined /> },
          { label: 'High', value: high, color: high > 0 ? TC.orangeHigh : T.stone500, bg: high > 0 ? TC.orangeHighLight : T.stone100, icon: <SafetyOutlined /> },
        ].map(stat => (
          <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, background: T.white, border: `1px solid ${T.stone200}` }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.stone400 }}>{stat.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: T.white, border: `1px solid ${T.stone200}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(28,25,23,0.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.stone100}` }}>
              {['Feature', 'Description', 'Risk Score', 'Severity', 'Threats', 'Compliance', ''].map((col, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, whiteSpace: 'nowrap' }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map(feature => (
              <tr
                key={feature.id}
                onClick={() => onSelect(feature.id)}
                style={{ borderBottom: `1px solid ${T.stone50}`, cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.stone50}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                {/* Feature name */}
                <td style={{ padding: '12px 16px', maxWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: T.orange, fontSize: 14, display: 'flex', flexShrink: 0 }}><ThunderboltOutlined /></span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.stone800 }}>{feature.name}</span>
                  </div>
                </td>

                {/* Description */}
                <td style={{ padding: '12px 16px', maxWidth: 260 }}>
                  <span style={{ fontSize: 12, color: T.stone500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {feature.description || '—'}
                  </span>
                </td>

                {/* Risk score */}
                <td style={{ padding: '12px 16px' }}>
                  <RiskScoreBadge score={feature.overallRiskScore} T={T} />
                </td>

                {/* Highest severity */}
                <td style={{ padding: '12px 16px' }}>
                  <SeverityPill value={feature.highestSeverity} T={T} />
                </td>

                {/* Threat count */}
                <td style={{ padding: '12px 16px' }}>
                  {feature.threatCount > 0 ? (
                    <span style={{
                      fontSize: 11, fontWeight: 700, borderRadius: 99, padding: '2px 8px',
                      color: feature.threatCount > 5 ? T.red : feature.threatCount > 2 ? T.amber : T.green,
                      background: feature.threatCount > 5 ? T.redLight : feature.threatCount > 2 ? T.amberLight : T.greenLight,
                    }}>
                      {feature.threatCount}
                    </span>
                  ) : (
                    <span style={{ color: T.stone300, fontSize: 12 }}>—</span>
                  )}
                </td>

                {/* Compliance */}
                <td style={{ padding: '12px 16px' }}>
                  {feature.complianceConsiderations?.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {feature.complianceConsiderations.slice(0, 2).map(c => (
                        <span key={c} style={{ fontSize: 10, fontWeight: 500, color: T.stone600, background: T.stone100, padding: '2px 7px', borderRadius: 6 }}>{c}</span>
                      ))}
                      {feature.complianceConsiderations.length > 2 && (
                        <span style={{ fontSize: 10, fontWeight: 500, color: T.stone500, background: T.stone100, padding: '2px 7px', borderRadius: 6 }}>
                          +{feature.complianceConsiderations.length - 2}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: T.stone300, fontSize: 12 }}>—</span>
                  )}
                </td>

                {/* View button */}
                <td style={{ padding: '12px 16px', width: 40 }}>
                  <button
                    onClick={e => { e.stopPropagation(); onSelect(feature.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.stone300, fontSize: 14, padding: '2px 4px', borderRadius: 4, display: 'flex', transition: 'color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.orange}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone300}
                  >
                    <EyeOutlined />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {features.length === 0 && (
          <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: T.stone300 }}>No features in this category.</div>
        )}
      </div>
    </div>
  );
}
