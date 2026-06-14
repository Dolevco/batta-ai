/**
 * FeatureOverviewPanel — overview details shown in the right panel header.
 * Displays feature summary, risk score, compliance tags, and business value.
 */
import type { BusinessFeature, ThreatSeverity } from '../../types';
import { T } from '../../theme';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<ThreatSeverity, { color: string; bg: string }> = {
  critical: { color: T.red,        bg: T.redLight        },
  high:     { color: T.orangeHigh, bg: T.orangeHighLight },
  medium:   { color: T.amber,      bg: T.amberLight      },
  low:      { color: T.lime,       bg: T.limeLight       },
  info:     { color: T.gray,       bg: T.grayLight       },
};

function RiskScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? T.red : score >= 40 ? T.orangeHigh : score >= 20 ? T.amber : T.lime;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 6, borderRadius: 9999,
        background: T.stone100, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 9999,
          width: `${Math.min(100, score)}%`,
          background: color, transition: 'width 0.4s',
        }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color, minWidth: 28 }}>
        {score}
      </span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FeatureOverviewPanel({ feature }: { feature: BusinessFeature }) {
  const tm = feature.threatModel;
  const riskLevel: ThreatSeverity = tm.overallRiskScore >= 70 ? 'critical'
    : tm.overallRiskScore >= 40 ? 'high'
    : tm.overallRiskScore >= 20 ? 'medium' : 'low';
  const riskColors = SEVERITY_COLOR[riskLevel];

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Risk score */}
      <div style={{
        padding: '12px 14px',
        border: `1px solid ${riskColors.color}33`,
        borderLeft: `4px solid ${riskColors.color}`,
        borderRadius: 8,
        background: riskColors.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.stone500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Overall Risk Score
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
            background: riskColors.bg, color: riskColors.color,
            border: `1px solid ${riskColors.color}55`,
          }}>
            {riskLevel.toUpperCase()}
          </span>
        </div>
        <RiskScoreBar score={tm.overallRiskScore} />
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <Stat label="STRIDE Threats" value={tm.strideThreats.length} />
          <Stat label="Trust Boundaries" value={tm.trustBoundaryAnalysis.length} />
          <Stat label="Attack Vectors" value={tm.attackVectors.length} />
        </div>
      </div>

      {/* Description */}
      <Section title="Description">
        <p style={{ fontSize: 13, color: T.stone600, lineHeight: 1.65, margin: 0 }}>
          {feature.description}
        </p>
      </Section>

      {/* Business value */}
      {feature.businessValue && (
        <Section title="Business Value">
          <p style={{ fontSize: 12, color: T.stone500, lineHeight: 1.6, margin: 0 }}>
            {feature.businessValue}
          </p>
        </Section>
      )}

      {/* Compliance */}
      {tm.complianceConsiderations.length > 0 && (
        <Section title="Compliance">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tm.complianceConsiderations.map((c) => (
              <span key={c} style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                border: `1px solid ${T.blueBorder}`, background: T.blueLight,
                color: T.blue, borderRadius: 9999,
              }}>
                {c}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Attack vectors */}
      {tm.attackVectors.length > 0 && (
        <Section title="Attack Vectors">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tm.attackVectors.map((av) => (
              <span key={av} style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                border: `1px solid ${T.orangeHighBorder}`, background: T.orangeHighLight,
                color: T.orangeHigh, borderRadius: 9999,
              }}>
                {av}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Security recommendations */}
      {tm.securityRecommendations.length > 0 && (
        <Section title="Security Recommendations">
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tm.securityRecommendations.map((rec, i) => (
              <li key={i} style={{ fontSize: 12, color: T.stone600, lineHeight: 1.55 }}>{rec}</li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
        textTransform: 'uppercase', color: T.stone400, marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: T.stone900, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: T.stone400, marginTop: 2, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}
