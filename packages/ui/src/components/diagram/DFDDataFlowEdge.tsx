/**
 * DFDDataFlowEdge — smooth bezier edge with protocol/payload label.
 * - When showProtocols is true: renders an inline label pill showing protocol + data types.
 * - Always shows encryption status via stroke colour (green = encrypted, warm grey = plain).
 * - Cross-trust-boundary flows get a warning badge.
 */
import { getBezierPath, EdgeLabelRenderer, BaseEdge, type EdgeProps } from 'reactflow';
import { T } from '../../theme';

export interface DFDFlowEdgeData {
  protocol?: string;
  encrypted?: boolean;
  dataTypes?: string[];
  authenticationRequired?: boolean;
  crossesTrustBoundary?: boolean;
  showProtocols?: boolean;
  // Playback overlay
  playbackActive?: boolean;
  playbackStep?: number;      // 1-based display number
  playbackMode?: boolean;     // true when any playback is active (to dim non-active edges)
}

export function DFDDataFlowEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  label, data, style,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.25,
  });

  const d = (data ?? {}) as DFDFlowEdgeData;
  const isEncrypted      = d.encrypted ?? false;
  const crossesBoundary  = d.crossesTrustBoundary ?? false;
  const showProtocols    = d.showProtocols ?? false;
  const playbackActive   = d.playbackActive ?? false;
  const playbackStep     = d.playbackStep;
  const playbackMode     = d.playbackMode ?? false;

  // Stroke: in playback mode the style prop from FeatureDiagram handles color/opacity;
  // we just derive the base color for label rendering.
  const strokeColor = isEncrypted
    ? T.emerald
    : crossesBoundary ? T.orangeHigh : T.stone300;

  const strokeDash = crossesBoundary && !isEncrypted ? '6 3' : undefined;

  const labelText = label as string | undefined;
  const protocol  = d.protocol ? d.protocol.toUpperCase() : undefined;
  const dataTypes = d.dataTypes ?? [];

  const hasLabel = !!(labelText || protocol);

  // Active playback badge color — light-mode vibrant
  const activeBadgeColor = isEncrypted ? T.emerald : crossesBoundary ? T.orangeHigh : T.orange;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: crossesBoundary ? 2 : 1.5,
          strokeDasharray: strokeDash,
          ...style,
        }}
        markerEnd="url(#dfd-arrowhead)"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            zIndex: playbackActive ? 20 : 10,
          }}
        >
          {/* ── Playback mode: numbered step badge ──────────────────────── */}
          {playbackMode && playbackStep !== undefined ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {/* Pulse ring (active only) */}
              {playbackActive && (
                <div style={{
                  position: 'absolute',
                  width: 40, height: 40,
                  borderRadius: '50%',
                  border: `2px solid ${activeBadgeColor}`,
                  animation: 'fp-pulse-ring 1.4s ease-in-out infinite',
                  pointerEvents: 'none',
                  top: -6, left: -6,
                  opacity: 0.5,
                }} />
              )}

              {/* Step number badge */}
              <div style={{
                width: 28, height: 28,
                borderRadius: '50%',
                background: playbackActive
                  ? activeBadgeColor
                  : T.white,
                border: `2px solid ${playbackActive ? activeBadgeColor : T.stone300}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 900,
                color: playbackActive ? T.white : T.stone400,
                boxShadow: playbackActive
                  ? `0 2px 10px ${activeBadgeColor}44, 0 0 0 3px ${activeBadgeColor}18`
                  : '0 1px 4px rgba(0,0,0,0.12)',
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                animation: playbackActive ? 'fp-badge-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
                flexShrink: 0,
              }}>
                {playbackStep}
              </div>

              {/* Flow label pill (active only) */}
              {playbackActive && labelText && (
                <div style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: '#fff',
                  border: `1px solid ${activeBadgeColor}55`,
                  fontSize: 9, fontWeight: 700,
                  color: activeBadgeColor,
                  whiteSpace: 'nowrap',
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  boxShadow: `0 2px 8px rgba(0,0,0,0.10)`,
                  letterSpacing: '0.02em',
                  animation: 'fp-slide-up 0.25s ease',
                }}>
                  {labelText}
                </div>
              )}
            </div>
          ) : showProtocols && hasLabel ? (
            /* ── Visible protocol/payload pill ─────────────────────────── */
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}>
              {/* Protocol badge */}
              {protocol && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: T.stone900,
                  border: `1px solid ${isEncrypted ? T.emerald : crossesBoundary ? T.orangeHigh : T.stone700}`,
                  fontSize: 9, fontWeight: 700,
                  color: isEncrypted ? '#6EE7B7' : crossesBoundary ? '#FCA280' : T.stone300,
                  letterSpacing: '0.05em',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                }}>
                  {/* Encryption indicator dot */}
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: isEncrypted ? T.emerald : crossesBoundary ? T.orangeHigh : T.stone500,
                    flexShrink: 0,
                  }} />
                  {protocol}
                  {crossesBoundary && (
                    <span style={{ color: T.orange, fontSize: 9 }} title="Crosses trust boundary">⚠</span>
                  )}
                </div>
              )}

              {/* Flow label */}
              {labelText && (
                <div style={{
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.92)',
                  border: `1px solid ${T.stone200}`,
                  fontSize: 9, color: T.stone600,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  {labelText}
                </div>
              )}

              {/* Data types chips */}
              {dataTypes.length > 0 && (
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 160 }}>
                  {dataTypes.slice(0, 3).map((dt) => (
                    <span key={dt} style={{
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: 'rgba(255,255,255,0.88)',
                      border: `1px solid ${T.stone200}`,
                      fontSize: 8, color: T.stone500,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}>
                      {dt}
                    </span>
                  ))}
                  {dataTypes.length > 3 && (
                    <span style={{
                      padding: '1px 4px', borderRadius: 3,
                      background: T.stone100, border: `1px solid ${T.stone200}`,
                      fontSize: 8, color: T.stone400,
                    }}>
                      +{dataTypes.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ── Minimal dot (protocols hidden) ────────────────────────── */
            <div className="dfd-edge-label">
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: isEncrypted ? T.emerald : crossesBoundary ? T.orangeHigh : T.stone300,
                border: `1.5px solid ${isEncrypted ? T.emeraldLight : crossesBoundary ? T.orangeLight : T.white}`,
                margin: '0 auto',
                boxShadow: isEncrypted ? '0 0 4px #05966944' : 'none',
              }} />

              {/* Hover tooltip (CSS :hover via parent class) */}
              {hasLabel && (
                <div className="dfd-edge-tooltip">
                  {protocol && (
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{protocol}</span>
                  )}
                  {labelText && (
                    <span style={{ opacity: 0.75, marginLeft: protocol ? 6 : 0 }}>{labelText}</span>
                  )}
                  {isEncrypted && (
                    <span style={{ marginLeft: 6, color: '#6EE7B7' }}>🔒</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
