/**
 * TrustBoundariesPanel — trust boundaries + data classification summary.
 * Adapted from batta-ai's TrustBoundariesTab for the UI package's data model.
 */
import type { BusinessFeature, ThreatSeverity, TrustBoundaryType } from '../../types';
import { T } from '../../theme';

const SEVERITY_COLOR: Record<ThreatSeverity, { color: string; bg: string }> = {
  critical: { color: T.red,        bg: T.redLight        },
  high:     { color: T.orangeHigh, bg: T.orangeHighLight },
  medium:   { color: T.amber,      bg: T.amberLight      },
  low:      { color: T.lime,       bg: T.limeLight       },
  info:     { color: T.gray,       bg: T.grayLight       },
};

const CLASSIFICATION_COLOR: Record<string, { color: string; bg: string }> = {
  restricted:   { color: T.red,        bg: T.redLight        },
  confidential: { color: T.orangeHigh, bg: T.orangeHighLight },
  internal:     { color: T.blue,       bg: T.blueLight       },
  public:       { color: T.green,      bg: T.greenLight      },
};

/** Visual tokens for each canonical TrustBoundaryType */
const BOUNDARY_TYPE_META: Record<TrustBoundaryType, { color: string; bg: string; border: string; description: string }> = {
  INTERNET:  { color: T.grayBorder,   bg: T.grayLight,        border: T.grayBorder,        description: 'Public internet clients → system'    },
  IDENTITY:  { color: T.violet,       bg: T.purpleLight,      border: T.purpleBorder,      description: 'Authentication / identity validation' },
  SERVICE:   { color: T.indigo,       bg: T.purpleLight,      border: T.blueBorder,        description: 'Internal microservice boundary'       },
  DATA:      { color: T.green,        bg: T.greenLight,       border: T.greenBorder,       description: 'Persistent storage access'            },
  EXTERNAL:  { color: T.orangeHigh,   bg: T.orangeHighLight,  border: T.orangeHighBorder,  description: 'Third-party / SaaS services'          },
};

export function TrustBoundariesPanel({ feature }: { feature: BusinessFeature }) {
  const tm = feature.threatModel;

  if (tm.trustBoundaryAnalysis.length === 0 && tm.dataClassificationSummary.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: T.stone400, fontSize: 13 }}>
        No trust boundary data available.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Trust boundaries */}
      {tm.trustBoundaryAnalysis.length > 0 && (
        <Section title={`Trust Boundaries (${tm.trustBoundaryAnalysis.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tm.trustBoundaryAnalysis.map((tb) => {
              const sev = SEVERITY_COLOR[tb.riskRating] ?? SEVERITY_COLOR.low;
              const typeMeta = BOUNDARY_TYPE_META[tb.name as TrustBoundaryType];
              return (
                <div key={tb.name} style={{
                  border: `1px solid ${sev.color}33`,
                  borderLeft: `4px solid ${sev.color}`,
                  borderRadius: 8, background: sev.bg,
                  padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: typeMeta ? 4 : 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.stone900 }}>{tb.name}</span>
                      {typeMeta && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
                          color: typeMeta.color, background: typeMeta.bg, border: `1px solid ${typeMeta.border}`,
                        }}>
                          {typeMeta.description}
                        </span>
                      )}
                    </div>
                    <RiskBadge rating={tb.riskRating} />
                  </div>

                  {tb.controlsInPlace.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                        Controls in Place
                      </div>
                      {tb.controlsInPlace.map((c) => (
                        <div key={c} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 2 }}>
                          <span style={{ color: T.green, fontSize: 11, marginTop: 1, flexShrink: 0 }}>✓</span>
                          <span style={{ fontSize: 11, color: T.stone600 }}>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {tb.controlsRequired.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.orangeHigh, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                        Controls Required
                      </div>
                      {tb.controlsRequired.map((c) => (
                        <div key={c} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 2 }}>
                          <span style={{ color: T.orangeHigh, fontSize: 11, marginTop: 1, flexShrink: 0 }}>!</span>
                          <span style={{ fontSize: 11, color: T.stone600 }}>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {tb.crossingFlows.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.stone500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                        Crossing Flows
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {tb.crossingFlows.map((f) => (
                          <span key={f} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: T.stone100, color: T.stone600, border: `1px solid ${T.stone200}` }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Data classification summary */}
      {tm.dataClassificationSummary.length > 0 && (
        <Section title="Data Classification">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tm.dataClassificationSummary.map((dc) => {
              const cls = CLASSIFICATION_COLOR[dc.classification] ?? CLASSIFICATION_COLOR.internal;
              return (
                <div key={dc.classification} style={{
                  border: `1px solid ${cls.color}33`,
                  borderRadius: 8, padding: '10px 12px',
                  background: cls.bg,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 8px',
                      borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.08em',
                      color: cls.color, background: 'rgba(255,255,255,0.7)',
                      border: `1px solid ${cls.color}44`,
                    }}>
                      {dc.classification}
                    </span>
                  </div>
                  {dc.dataTypes.length > 0 && (
                    <LabelList label="Data Types" items={dc.dataTypes} />
                  )}
                  {dc.protectionMechanisms.length > 0 && (
                    <LabelList label="Protections" items={dc.protectionMechanisms} color="#16A34A" />
                  )}
                  {dc.storageLocations.length > 0 && (
                    <LabelList label="Storage" items={dc.storageLocations} />
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function RiskBadge({ rating }: { rating: ThreatSeverity }) {
  const cfg = SEVERITY_COLOR[rating] ?? SEVERITY_COLOR.low;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
      background: 'rgba(255,255,255,0.8)', color: cfg.color,
      border: `1px solid ${cfg.color}55`,
    }}>
      {rating.toUpperCase()}
    </span>
  );
}

function LabelList({ label, items, color }: { label: string; items: string[]; color?: string }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: color ?? T.stone500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}:
      </span>{' '}
      {items.map((item, i) => (
        <span key={item} style={{ fontSize: 10, color: T.stone600 }}>
          {item}{i < items.length - 1 ? ', ' : ''}
        </span>
      ))}
    </div>
  );
}
