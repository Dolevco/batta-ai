/**
 * DFDCompactNode — circular icon node for the data-flow diagram.
 * Adapted from batta-ai's CompactNode for reactflow v11 + inline styles.
 */
import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { NODE_COLORS, STRIDE_COLORS } from './constants';
import { T } from '../../theme';

// ── Icon components (simple SVG paths, no lucide dependency) ──────────────────

function IconCpu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M9 2v2M2 9h2M2 15h2M22 9h-2M22 15h-2M15 22v-2M9 22v-2" />
    </svg>
  );
}

function IconDatabase() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconServer() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  process:         <IconCpu />,
  data_store:      <IconDatabase />,
  external_entity: <IconUser />,
  internet:        <IconGlobe />,
  service:         <IconServer />,
  identity:        <IconShield />,
};

// ── Handle style (invisible anchors) ─────────────────────────────────────────

const HANDLE_STYLE: React.CSSProperties = {
  width: 1, height: 1, background: 'transparent',
  border: 'none', opacity: 0, minWidth: 0, minHeight: 0,
};

// ── Node data shape ───────────────────────────────────────────────────────────

export interface DFDNodeData {
  label: string;
  nodeType: string;
  description?: string;
  technology?: string;
  riskCount?: number;
  dataClassification?: string;
  risks?: Array<{ category: string; severity: string; status: string }>;
  showRiskOverlays?: boolean;
  iconUrl?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DFDCompactNode({ data }: NodeProps) {
  const d = data as DFDNodeData;
  const colors = NODE_COLORS[d.nodeType] ?? NODE_COLORS.process;
  const svgIcon = ICONS[d.nodeType] ?? <IconCpu />;

  const uniqueCategories = d.showRiskOverlays
    ? [...new Set((d.risks ?? []).map((r) => r.category))]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 120 }}>
      {/* Icon circle */}
      <div style={{
        position: 'relative',
        width: 52, height: 52,
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `2px solid ${colors.border}`,
        backgroundColor: colors.bg,
        boxShadow: `0 1px 4px ${colors.border}22`,
      }}>
        {d.iconUrl ? (
          <img
            src={d.iconUrl}
            alt=""
            style={{ width: 26, height: 26, objectFit: 'contain' }}
            onError={(e) => {
              // fallback to SVG icon on broken image
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.removeAttribute('style');
            }}
          />
        ) : null}
        <span style={{ color: colors.border, display: d.iconUrl ? 'none' : 'flex' }}>{svgIcon}</span>

        {/* Risk count badge */}
        {(d.riskCount ?? 0) > 0 && (
          <div style={{
            position: 'absolute', top: -6, right: -6,
            width: 18, height: 18, borderRadius: '50%',
            background: T.red, color: T.white,
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}>
            {d.riskCount}
          </div>
        )}
      </div>

      {/* Label */}
      <div style={{
        marginTop: 6, fontSize: 11, fontWeight: 600,
        textAlign: 'center', lineHeight: 1.35,
        maxWidth: 110, color: colors.text,
      }}>
        {d.label}
      </div>

      {/* Technology */}
      {d.technology && (
        <div style={{ fontSize: 9, color: T.stone400, textAlign: 'center', marginTop: 2, fontFamily: 'monospace' }}>
          {d.technology}
        </div>
      )}

      {/* STRIDE overlay badges */}
      {uniqueCategories.length > 0 && (
        <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
          {uniqueCategories.map((cat) => {
            const stride = STRIDE_COLORS[cat];
            if (!stride) return null;
            return (
              <span key={cat} title={stride.label} style={{
                width: 18, height: 18, borderRadius: '50%',
                fontSize: 8, fontWeight: 700, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: stride.color,
                boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              }}>
                {stride.letter}
              </span>
            );
          })}
        </div>
      )}

      {/* Invisible handles on all 4 sides */}
      <Handle type="target" position={Position.Top}    style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Left}   style={HANDLE_STYLE} id="left-target" />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  style={HANDLE_STYLE} id="right-source" />
    </div>
  );
}
