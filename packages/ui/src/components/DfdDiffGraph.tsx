/**
 * DfdDiffGraph
 *
 * Renders a DFD-style diff graph for an ArchitectureDiff.
 * Layout: Actor (left) → Service (center) → External deps (right)
 *
 * Diff overlays:
 *  - Nodes get a colored glowing ring + badge (+ / − / ~) based on change type
 *  - Edges use diff-colored strokes (green=added, red=removed dashed, orange=changed)
 *
 * Dark mode: auto-detected via antd theme token.
 */
import { useMemo, useState } from 'react';
import { theme as antdTheme } from 'antd';
import ReactFlow, {
  type Node,
  type Edge,
  Controls,
  Background,
  MiniMap,
  MarkerType,
  BackgroundVariant,
  Panel,
  Handle,
  Position,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { DFDBadge } from './diagram/FeatureDiagram';
import { DFDDataFlowEdge } from './diagram/DFDDataFlowEdge';
import { NODE_COLORS } from './diagram/constants';
import { T, D } from '../theme';
import type { ArchitectureDiff, DataFlowDiffEntry } from '../types';

// ── Change-type config ────────────────────────────────────────────────────────

type ChangeType = 'added' | 'removed' | 'changed' | 'unchanged';

const DIFF: Record<ChangeType, { ring: string; edge: string; badge: string; label: string }> = {
  added:     { ring: T.green,   edge: '#52c41a', badge: '+', label: 'Added'     },
  removed:   { ring: T.red,     edge: '#ff4d4f', badge: '−', label: 'Removed'   },
  changed:   { ring: T.amber,   edge: '#fa8c16', badge: '~', label: 'Changed'   },
  unchanged: { ring: '',        edge: '',        badge: '',  label: 'Unchanged' },
};

const STATUS_ORDER: ChangeType[] = ['removed', 'added', 'changed', 'unchanged'];

// ── Node icons ────────────────────────────────────────────────────────────────

const ICON_USER = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ICON_SERVICE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

const ICON_EXTERNAL = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

function nodeIcon(role: 'actor' | 'service' | 'external') {
  if (role === 'actor')    return ICON_USER;
  if (role === 'external') return ICON_EXTERNAL;
  return ICON_SERVICE;
}

// ── Custom node: DFD-style circular icon + diff ring ─────────────────────────

interface DiffNodeData {
  label: string;
  role: 'actor' | 'service' | 'external';
  diffStatus: ChangeType;
  isDark: boolean;
}

const HANDLE_STYLE: React.CSSProperties = {
  width: 1, height: 1, background: 'transparent', border: 'none', opacity: 0, minWidth: 0, minHeight: 0,
};

// Dark-mode node color overrides (dimmer bg, lighter border to show on dark canvas)
const NODE_COLORS_DARK: Record<string, { bg: string; border: string; text: string }> = {
  external_entity: { bg: '#1e293b', border: '#60a5fa', text: '#93c5fd' },
  service:         { bg: '#1c1917', border: '#fb923c', text: '#fdba74' },
  data_store:      { bg: '#162032', border: '#67e8f9', text: '#a5f3fc' },
  process:         { bg: '#1a1a2e', border: '#a78bfa', text: '#c4b5fd' },
};

function DiffNode({ data }: NodeProps) {
  const d = data as DiffNodeData;
  const nodeType = d.role === 'actor' ? 'external_entity' : d.role === 'external' ? 'data_store' : 'service';
  const colors = d.isDark
    ? (NODE_COLORS_DARK[nodeType] ?? NODE_COLORS_DARK.service)
    : (NODE_COLORS[nodeType] ?? NODE_COLORS.service);
  const diff = DIFF[d.diffStatus ?? 'unchanged'];
  const hasRing = d.diffStatus !== 'unchanged';

  return (
    <>
      <Handle type="target" position={Position.Left}   style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="target" position={Position.Top}    style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Right}  style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 120 }}>
        <div style={{
          position: 'relative',
          width: 52, height: 52,
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${colors.border}`,
          backgroundColor: colors.bg,
          boxShadow: hasRing
            ? `0 0 0 3px ${diff.ring}44, 0 0 14px ${diff.ring}33, 0 1px 4px ${colors.border}22`
            : `0 1px 4px ${colors.border}22`,
          outline: hasRing ? `2.5px solid ${diff.ring}` : undefined,
          outlineOffset: hasRing ? '3px' : undefined,
        }}>
          <span style={{ color: colors.border, display: 'flex' }}>{nodeIcon(d.role)}</span>

          {hasRing && (
            <div style={{
              position: 'absolute', top: -8, right: -8,
              width: 18, height: 18, borderRadius: '50%',
              background: diff.ring, color: '#fff',
              fontSize: 12, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 1px 4px ${diff.ring}66`,
              zIndex: 10,
            }}>
              {diff.badge}
            </div>
          )}
        </div>

        <div style={{
          marginTop: 6, fontSize: 11, fontWeight: 600,
          textAlign: 'center', lineHeight: 1.35,
          maxWidth: 110,
          color: colors.text,
          wordBreak: 'break-word',
        }}>
          {d.label}
        </div>
      </div>
    </>
  );
}

const NODE_TYPES = { dfdDiff: DiffNode };
const EDGE_TYPES = { dfdFlow: DFDDataFlowEdge };

// ── Layout builder ────────────────────────────────────────────────────────────

const NODE_W = 120;
const NODE_H = 100;
const V_GAP  = 44;
const H_GAP  = 180;

function buildGraph(
  entries: DataFlowDiffEntry[],
  isDark: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodeStatus = new Map<string, ChangeType>();

  function mergeStatus(name: string, incoming: ChangeType) {
    const current = nodeStatus.get(name) ?? 'unchanged';
    if (STATUS_ORDER.indexOf(incoming) < STATUS_ORDER.indexOf(current)) {
      nodeStatus.set(name, incoming);
    } else if (!nodeStatus.has(name)) {
      nodeStatus.set(name, 'unchanged');
    }
  }

  for (const e of entries) {
    const entry = e.updated ?? e.baseline!;
    mergeStatus(entry.from, e.changeType as ChangeType);
    mergeStatus(entry.to,   e.changeType as ChangeType);
  }

  const allSources = new Set(entries.map(e => (e.updated ?? e.baseline!).from));
  const allTargets = new Set(entries.map(e => (e.updated ?? e.baseline!).to));

  const actorNames    = [...nodeStatus.keys()].filter(n =>  allSources.has(n) && !allTargets.has(n));
  const externalNames = [...nodeStatus.keys()].filter(n => !allSources.has(n) &&  allTargets.has(n));
  const serviceNames  = [...nodeStatus.keys()].filter(n =>  allSources.has(n) &&  allTargets.has(n));

  function makeNodes(names: string[], x: number, role: 'actor' | 'service' | 'external'): Node[] {
    return names.map((name, i) => ({
      id: name,
      type: 'dfdDiff',
      position: { x, y: 40 + i * (NODE_H + V_GAP) },
      data: { label: name, role, diffStatus: nodeStatus.get(name) ?? 'unchanged', isDark },
    }));
  }

  let x = 0;
  const nodes: Node[] = [];

  if (actorNames.length > 0) {
    nodes.push(...makeNodes(actorNames, x, 'actor'));
    x += NODE_W + H_GAP;
  }

  nodes.push(...makeNodes(serviceNames, x, 'service'));
  if (serviceNames.length > 0) x += NODE_W + H_GAP;

  if (externalNames.length > 0) {
    nodes.push(...makeNodes(externalNames, x, 'external'));
  }

  const edges: Edge[] = entries.map((e, idx) => {
    const entry = e.updated ?? e.baseline!;
    const ct = e.changeType as ChangeType;

    let strokeColor: string;
    let strokeDash: string | undefined;
    let animated = false;

    if (ct === 'added') {
      strokeColor = DIFF.added.edge;
      animated = true;
    } else if (ct === 'removed') {
      strokeColor = DIFF.removed.edge;
      strokeDash = '5 4';
    } else if (ct === 'changed') {
      strokeColor = DIFF.changed.edge;
      animated = true;
    } else {
      strokeColor = entry.encrypted ? T.emerald : (isDark ? '#6b7280' : T.stone400);
    }

    return {
      id: `edge-${idx}-${entry.from}-${entry.to}`,
      source: entry.from,
      target: entry.to,
      type: 'dfdFlow',
      data: {
        protocol: entry.protocol,
        encrypted: entry.encrypted,
        dataTypes: entry.dataTypes,
        authenticationRequired: entry.authRequired,
        crossesTrustBoundary: false,
        showProtocols: true,
      },
      animated,
      markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 14, height: 14 },
      style: {
        stroke: strokeColor,
        strokeWidth: ct === 'removed' ? 1.5 : 2,
        strokeDasharray: strokeDash,
        opacity: ct === 'removed' ? 0.65 : 1,
        filter: ct !== 'unchanged' ? `drop-shadow(0 0 3px ${strokeColor}66)` : undefined,
      },
    };
  });

  return { nodes, edges };
}

// ── Toolbar / Legend helpers ──────────────────────────────────────────────────

function glassPanel(isDark: boolean): React.CSSProperties {
  return {
    background: isDark ? 'rgba(28,25,23,0.92)' : 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(6px)',
    border: `1px solid ${isDark ? D.borderSub : T.stone200}`,
    borderRadius: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
  };
}

function labelColor(isDark: boolean) {
  return isDark ? D.textMuted : T.stone400;
}

function ToolbarPill({
  active, onClick, label, icon, isDark,
}: {
  active: boolean; onClick: () => void; label: string; icon: React.ReactNode; isDark: boolean;
}) {
  const activeColor  = T.indigo;
  const activeBg     = isDark ? D.purpleLight : T.purpleLight;
  const activeBorder = isDark ? D.purpleBorder : T.purpleBorder;
  const inactiveBg   = isDark ? D.bgCard : T.stone50;
  const inactiveBdr  = isDark ? D.borderSub : T.stone200;
  const inactiveClr  = isDark ? D.textFaint : T.stone400;

  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', borderRadius: 6,
        fontSize: 10, fontWeight: 600,
        border: `1px solid ${active ? activeBorder : inactiveBdr}`,
        background: active ? activeBg : inactiveBg,
        color: active ? activeColor : inactiveClr,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: active ? `0 1px 3px ${activeColor}22` : 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: active ? activeColor : inactiveClr, display: 'flex', alignItems: 'center' }}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function DiffToolbar({
  showUnchanged, onToggle, showProtocols, onToggleProtocols, isDark,
}: {
  showUnchanged: boolean; onToggle: () => void;
  showProtocols: boolean; onToggleProtocols: () => void;
  isDark: boolean;
}) {
  return (
    <div style={{ ...glassPanel(isDark), display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: labelColor(isDark), textTransform: 'uppercase', letterSpacing: '0.06em', paddingRight: 4 }}>
        Diff
      </span>
      <div style={{ width: 1, height: 14, background: isDark ? D.borderSub : T.stone200 }} />
      <ToolbarPill
        active={showUnchanged} onClick={onToggle} label="Show Unchanged" isDark={isDark}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
          </svg>
        }
      />
      <ToolbarPill
        active={showProtocols} onClick={onToggleProtocols} label="Protocols & Payload" isDark={isDark}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 9h8M8 13h6M3 5l1-1h16l1 1v14l-1 1H4l-1-1V5z"/>
          </svg>
        }
      />
    </div>
  );
}

function DiffLegend({ isDark }: { isDark: boolean }) {
  const rows: Array<{ color: string; label: string; dash?: boolean; glow?: boolean }> = [
    { color: DIFF.added.edge,   label: 'Added',     glow: true },
    { color: DIFF.removed.edge, label: 'Removed',   dash: true },
    { color: DIFF.changed.edge, label: 'Changed',   glow: true },
    { color: T.emerald,         label: 'Encrypted' },
    { color: isDark ? '#6b7280' : T.stone400, label: 'Unchanged' },
  ];

  return (
    <div style={{ ...glassPanel(isDark), padding: '8px 12px', minWidth: 160 }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: labelColor(isDark), letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
        Legend
      </div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <svg width="28" height="10" viewBox="0 0 28 10" style={{ flexShrink: 0 }}>
            <line
              x1="0" y1="5" x2="22" y2="5"
              stroke={r.color} strokeWidth="2"
              strokeDasharray={r.dash ? '4 2' : undefined}
              style={r.glow ? { filter: `drop-shadow(0 0 2px ${r.color})` } : undefined}
            />
            <polygon points="22,2 28,5 22,8" fill={r.color} />
          </svg>
          <span style={{ fontSize: 9, color: isDark ? D.textMuted : T.stone500, lineHeight: 1.3 }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function RoleLegend({ isDark }: { isDark: boolean }) {
  const rows: Array<{ nodeType: string; label: string }> = [
    { nodeType: 'external_entity', label: 'Actor / Client' },
    { nodeType: 'service',         label: 'Service'        },
    { nodeType: 'data_store',      label: 'External Dep'   },
  ];
  return (
    <div style={{ ...glassPanel(isDark), padding: '8px 12px', minWidth: 140 }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: labelColor(isDark), letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
        Node Types
      </div>
      {rows.map(r => {
        const c = isDark
          ? (NODE_COLORS_DARK[r.nodeType] ?? NODE_COLORS_DARK.service)
          : (NODE_COLORS[r.nodeType] ?? NODE_COLORS.service);
        return (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: c.bg, border: `1.5px solid ${c.border}`,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 9, color: isDark ? D.textMuted : T.stone500 }}>{r.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface DfdDiffGraphProps {
  diff: ArchitectureDiff;
  height?: number;
  showUnchanged?: boolean;
  onShowUnchangedChange?: (v: boolean) => void;
}

export function DfdDiffGraph({
  diff,
  height = 460,
  showUnchanged: showUnchangedProp,
  onShowUnchangedChange,
}: DfdDiffGraphProps) {
  const { token } = antdTheme.useToken();
  const isDark = token.colorBgBase === '#000' || token.colorBgContainer === '#141414';

  const [internalShow, setInternalShow] = useState(showUnchangedProp ?? true);
  const showUnchanged = showUnchangedProp !== undefined ? showUnchangedProp : internalShow;
  const setShowUnchanged = onShowUnchangedChange ?? setInternalShow;

  const [showProtocols, setShowProtocols] = useState(true);

  const filteredEntries = useMemo(
    () => showUnchanged
      ? diff.dataFlowDiff
      : diff.dataFlowDiff.filter(e => e.changeType !== 'unchanged'),
    [diff.dataFlowDiff, showUnchanged],
  );

  const { nodes, edges: baseEdges } = useMemo(
    () => buildGraph(filteredEntries, isDark),
    [filteredEntries, isDark],
  );

  const edges = useMemo(
    () => baseEdges.map(e => ({ ...e, data: { ...e.data, showProtocols } })),
    [baseEdges, showProtocols],
  );

  const diagramKey = `dfd-diff-${diff.featureId}-${showUnchanged}-${showProtocols}-${isDark}`;

  if (diff.dataFlowDiff.length === 0) {
    return (
      <div style={{
        height,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px dashed ${isDark ? D.borderSub : T.stone200}`,
        borderRadius: 8,
        color: isDark ? D.textFaint : T.stone400,
        fontSize: 13,
        background: isDark ? D.bgSub : undefined,
      }}>
        No data flows recorded for this feature
      </div>
    );
  }

  return (
    <div style={{
      height,
      border: `1px solid ${isDark ? D.borderSub : T.stone200}`,
      borderRadius: 8,
      overflow: 'hidden',
      background: isDark ? D.bg : '#ffffff',
    }}>
      <ReactFlow
        key={diagramKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          gap={28}
          size={0.5}
          color={isDark ? '#3c3836' : '#EBEBEB'}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          showInteractive={false}
          style={{ bottom: 12, left: 12 }}
        />

        <Panel position="top-left">
          <DiffToolbar
            showUnchanged={showUnchanged}
            onToggle={() => setShowUnchanged(!showUnchanged)}
            showProtocols={showProtocols}
            onToggleProtocols={() => setShowProtocols(v => !v)}
            isDark={isDark}
          />
        </Panel>

        <Panel position="top-right">
          <DFDBadge />
        </Panel>

        <Panel position="bottom-left">
          <RoleLegend isDark={isDark} />
        </Panel>

        <Panel position="bottom-right">
          <DiffLegend isDark={isDark} />
        </Panel>

        <MiniMap
          nodeColor={(n) => {
            const s = (n.data?.diffStatus ?? 'unchanged') as ChangeType;
            return s === 'unchanged' ? (isDark ? '#57534e' : '#aaa') : DIFF[s].ring;
          }}
          maskColor={isDark ? 'rgba(28,25,23,0.7)' : 'rgba(255,255,255,0.6)'}
          style={{ background: isDark ? D.bgCard : '#f5f5f5' }}
        />
      </ReactFlow>
    </div>
  );
}
