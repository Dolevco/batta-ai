/**
 * ThreatModelPanel — STRIDE threat list grouped by category.
 * Adapted from batta-ai's RisksTab for the UI package's data model.
 */
import { useState } from 'react';
import type { STRIDEThreat, StrideCategory, ThreatSeverity } from '../../types';
import { T, D } from '../../theme';

// ── Constants ─────────────────────────────────────────────────────────────────

function makeSeverityConfig(isDark: boolean): Record<string, { color: string; bg: string; border: string }> {
  return {
    critical: { color: T.red,          bg: isDark ? D.redLight          : T.redLight,          border: isDark ? D.redBorder          : T.redBorder          },
    high:     { color: T.orangeHigh,   bg: isDark ? D.orangeHighLight   : T.orangeHighLight,   border: isDark ? D.orangeHighBorder   : T.orangeHighBorder   },
    medium:   { color: T.amber,        bg: isDark ? D.amberLight        : T.amberLight,        border: isDark ? D.amberBorder        : T.amberBorder        },
    low:      { color: T.lime,         bg: isDark ? D.limeLight         : T.limeLight,         border: isDark ? D.limeBorder         : T.limeBorder         },
  };
}

const STRIDE_CONFIG: Record<StrideCategory, { color: string; letter: string; label: string }> = {
  Spoofing:              { color: T.red,         letter: 'S', label: 'Spoofing'               },
  Tampering:             { color: T.orangeHigh,  letter: 'T', label: 'Tampering'              },
  Repudiation:           { color: T.amber,       letter: 'R', label: 'Repudiation'            },
  InformationDisclosure: { color: T.blue,        letter: 'I', label: 'Information Disclosure' },
  DenialOfService:       { color: T.purple,      letter: 'D', label: 'Denial of Service'      },
  ElevationOfPrivilege:  { color: T.pink,        letter: 'E', label: 'Elevation of Privilege' },
};

const SEVERITY_ORDER: ThreatSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

const STRIDE_ORDER: StrideCategory[] = [
  'Spoofing', 'Tampering', 'Repudiation',
  'InformationDisclosure', 'DenialOfService', 'ElevationOfPrivilege',
];

const STATUS_COLOR: Record<string, string> = {
  identified:  T.amber,
  mitigated:   T.green,
  accepted:    T.gray,
  transferred: T.blue,
};

// ── Main component ────────────────────────────────────────────────────────────

export function ThreatModelPanel({ threats, isDark = false }: { threats: STRIDEThreat[]; isDark?: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const SEVERITY_CONFIG = makeSeverityConfig(isDark);
  const textPrimary  = isDark ? D.text      : T.stone900;
  const textMuted    = isDark ? T.stone500  : T.stone400;
  const textBody     = isDark ? T.stone300  : T.stone500;
  const tagBg        = isDark ? D.bgCard    : T.stone100;
  const tagColor     = isDark ? T.stone400  : T.stone600;
  const tagBorder    = isDark ? D.borderSub : T.stone200;
  const dividerColor = isDark ? D.border    : T.stone200;

  const grouped = STRIDE_ORDER
    .map((cat) => ({
      cat,
      threats: threats.filter((t) => t.category === cat),
    }))
    .filter((g) => g.threats.length > 0);

  if (threats.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: textMuted, fontSize: 13 }}>
        No STRIDE threats identified yet.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {grouped.map(({ cat, threats: groupThreats }) => {
        const cfg = STRIDE_CONFIG[cat];
        return (
          <div key={cat}>
            {/* Group header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: cfg.color, color: T.white,
                fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {cfg.letter}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? T.stone300 : T.stone700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {cfg.label}
              </span>
              <span style={{
                marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                padding: '1px 7px', borderRadius: 9999,
                background: `${cfg.color}18`, color: cfg.color,
                border: `1px solid ${cfg.color}33`,
              }}>
                {groupThreats.length}
              </span>
            </div>

            {/* Threat cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupThreats.map((threat) => {
                const sev = SEVERITY_CONFIG[threat.severity] ?? SEVERITY_CONFIG.medium;
                const isExpanded = expandedId === threat.id;
                return (
                  <div
                    key={threat.id}
                    style={{
                      border: `1px solid ${sev.border}`,
                      borderLeft: `3px solid ${sev.color}`,
                      borderRadius: 6, background: sev.bg,
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : threat.id)}
                      style={{
                        width: '100%', textAlign: 'left', background: 'none',
                        border: 'none', cursor: 'pointer', padding: '8px 10px',
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary, lineHeight: 1.3 }}>
                            {threat.title}
                          </span>
                          {threat.originalSeverity && threat.originalSeverity !== threat.severity ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ fontSize: 9, color: textMuted, textDecoration: 'line-through' }}>
                                {threat.originalSeverity.toUpperCase()}
                              </span>
                              <span style={{ fontSize: 9, color: threat.severity === 'critical' ? T.red : T.green }}>
                                {SEVERITY_ORDER.indexOf(threat.severity as ThreatSeverity) > SEVERITY_ORDER.indexOf(threat.originalSeverity as ThreatSeverity) ? '↑' : '↓'}
                              </span>
                              <SeverityBadge severity={threat.severity} isDark={isDark} />
                            </span>
                          ) : (
                            <SeverityBadge severity={threat.severity} isDark={isDark} />
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 600,
                            color: STATUS_COLOR[threat.status] ?? T.gray,
                          }}>
                            ● {threat.status.charAt(0).toUpperCase() + threat.status.slice(1)}
                          </span>
                          <span style={{ fontSize: 9, color: textMuted }}>
                            L:{threat.likelihoodScore} · I:{threat.impactScore}
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: textMuted, flexShrink: 0, marginTop: 2 }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '0 10px 10px', borderTop: `1px solid ${dividerColor}` }}>
                        <p style={{ fontSize: 11, color: textBody, lineHeight: 1.6, margin: '8px 0' }}>
                          {threat.description}
                        </p>
                        {threat.affectedComponents.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              Affected Components
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {threat.affectedComponents.map((c) => (
                                <span key={c} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: tagBg, color: tagColor, border: `1px solid ${tagBorder}` }}>
                                  {c}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {threat.mitigations.length > 0 && (
                          <div>
                            <span style={{ fontSize: 9, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              Mitigations
                            </span>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {threat.mitigations.map((m, i) => (
                                <li key={i} style={{ fontSize: 11, color: textBody }}>{m}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SeverityBadge({ severity, isDark = false }: { severity: string; isDark?: boolean }) {
  const SEVERITY_CONFIG = makeSeverityConfig(isDark);
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.medium;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      {severity.toUpperCase()}
    </span>
  );
}
