/**
 * DataFlowsPanel — lists all data flows from BusinessFeature.dataFlowDiagram.
 */
import type { BusinessFeature, DFDFlow } from '../../types';
import { T } from '../../theme';

const CLASSIFICATION_COLOR: Record<string, { color: string; bg: string }> = {
  restricted:   { color: T.red,        bg: T.redLight        },
  confidential: { color: T.orangeHigh, bg: T.orangeHighLight  },
  internal:     { color: T.blue,       bg: T.blueLight        },
  public:       { color: T.green,      bg: T.greenLight       },
};

function LockIcon({ locked }: { locked: boolean }) {
  return locked ? (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={locked ? T.green : T.orangeHigh} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.orangeHigh} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.orange} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

export function DataFlowsPanel({ feature }: { feature: BusinessFeature }) {
  const dfd = feature.dataFlowDiagram;
  const flows = dfd.flows;

  // Build a lookup from id to label
  const labelMap = new Map<string, string>();
  dfd.actors.forEach((a) => labelMap.set(a.id, a.label));
  dfd.processes.forEach((p) => labelMap.set(p.id, p.label));
  dfd.dataStores.forEach((d) => labelMap.set(d.id, d.label));

  if (flows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: T.stone400, fontSize: 13 }}>
        No data flows defined.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {flows.map((flow: DFDFlow) => {
        const cls = CLASSIFICATION_COLOR[flow.dataClassification] ?? CLASSIFICATION_COLOR.internal;
        const fromLabel = labelMap.get(flow.from) ?? flow.from;
        const toLabel   = labelMap.get(flow.to)   ?? flow.to;

        return (
          <div key={flow.id} style={{
            border: `1px solid ${T.stone200}`,
            borderRadius: 8, padding: '10px 12px',
            background: T.stone50,
            transition: 'border-color 0.15s',
          }}>
            {/* Source → Target */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.stone700 }}>{fromLabel}</span>
              <ArrowRight />
              <span style={{ fontSize: 12, fontWeight: 600, color: T.stone700 }}>{toLabel}</span>
            </div>

            {/* Flow label */}
            {flow.label && (
              <div style={{ fontSize: 11, color: T.stone500, marginBottom: 6, lineHeight: 1.5 }}>{flow.label}</div>
            )}

            {/* Meta row */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px',
                borderRadius: 4, background: T.stone100,
                color: T.stone600, border: `1px solid ${T.stone200}`, fontFamily: 'monospace',
              }}>
                {flow.protocol.toUpperCase()}
              </span>

              <span style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 9, fontWeight: 600,
                color: flow.encrypted ? T.green : T.orangeHigh,
              }}>
                <LockIcon locked={flow.encrypted} />
                {flow.encrypted ? 'Encrypted' : 'Plaintext'}
              </span>

              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px',
                borderRadius: 4,
                color: cls.color, background: cls.bg,
                border: `1px solid ${cls.color}33`,
              }}>
                {flow.dataClassification}
              </span>

              {flow.authenticationRequired && (
                <span style={{ fontSize: 9, fontWeight: 600, color: T.blue }}>🔑 Auth required</span>
              )}

              {flow.crossesTrustBoundary && (
                <span style={{ fontSize: 9, fontWeight: 600, color: T.orangeHigh }}>⚠ Trust boundary</span>
              )}
            </div>

            {/* Data types */}
            {flow.dataTypes.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {flow.dataTypes.map((dt) => (
                  <span key={dt} style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 4,
                    background: T.stone100, color: T.stone500, border: `1px solid ${T.stone200}`,
                  }}>
                    {dt}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
