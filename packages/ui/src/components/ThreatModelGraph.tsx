import { useEffect, useMemo, useState, useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  NodeMouseHandler,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { theme, Tag, Typography, Space, Tooltip, Collapse } from 'antd';
import {
  CloseOutlined,
  SafetyOutlined,
  WarningOutlined,
  GlobalOutlined,
  LockOutlined,
  NodeIndexOutlined,
  ApiOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { useTheme } from '../hooks';
import { getNodeIcon } from '../utils/nodeIcons';
import { T, D } from '../theme';
import type {
  ThreatModelGraph as ThreatModelGraphType,
  ThreatModelDiff,
  ThreatModelNode,
  ThreatModelEdge,
  DataFlowInfo,
  ExploitabilityResult,
} from '../types';

const { Text } = Typography;

// ── Severity helpers ──────────────────────────────────────────────────────────

function getSeverityColor(severity?: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return T.red;
    case 'high':     return T.orangeHigh;
    case 'medium':   return T.amber;
    case 'low':      return T.emerald;
    default:         return T.emerald;
  }
}

function getSeverityBg(severity?: string, dark = false): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return dark ? '#450a0a' : T.redLight;
    case 'high':     return dark ? '#431407' : T.orangeLight;
    case 'medium':   return dark ? '#422006' : T.amberLight;
    case 'low':      return dark ? '#052e16' : T.greenLight;
    default:         return dark ? '#064e3b' : T.greenLight;
  }
}

// ── Trust zone config ─────────────────────────────────────────────────────────

const TRUST_ZONE_CONFIG = {
  external: {
    label: 'External / Internet',
    icon: <GlobalOutlined />,
    border: T.red,
    bg: 'rgba(220, 38, 38, 0.06)',
    bgDark: 'rgba(220, 38, 38, 0.12)',
    headerBg: T.red,
    column: 0,
  },
  dmz: {
    label: 'DMZ / Edge',
    icon: <WarningOutlined />,
    border: T.orangeHigh,
    bg: 'rgba(234, 88, 12, 0.06)',
    bgDark: 'rgba(234, 88, 12, 0.12)',
    headerBg: T.orangeHigh,
    column: 1,
  },
  internal: {
    label: 'Internal Services',
    icon: <SafetyOutlined />,
    border: T.blue,
    bg: 'rgba(59, 130, 246, 0.06)',
    bgDark: 'rgba(59, 130, 246, 0.12)',
    headerBg: T.blue,
    column: 2,
  },
  trusted: {
    label: 'Trusted / Data Layer',
    icon: <LockOutlined />,
    border: T.emerald,
    bg: 'rgba(16, 185, 129, 0.06)',
    bgDark: 'rgba(16, 185, 129, 0.12)',
    headerBg: T.emerald,
    column: 3,
  },
} as const;

type TrustZone = keyof typeof TRUST_ZONE_CONFIG;
const ZONE_ORDER: TrustZone[] = ['external', 'dmz', 'internal', 'trusted'];

// ── Edge styling ──────────────────────────────────────────────────────────────

interface EdgeStyle {
  color: string;
  dashed: boolean;
  width: number;
  animated: boolean;
  category: string;
}

function getEdgeStyle(relType: string, dataFlow?: DataFlowInfo, confidence?: string): EdgeStyle {
  const t = relType.toUpperCase();

  // Security-critical relationship types drive color
  if (t === 'EXPOSED_TO_INTERNET' || t === 'CROSSES_BOUNDARY')
    return { color: T.red, dashed: true,  width: 2.5, animated: true,  category: 'boundary' };
  if (t === 'AUTHENTICATES_WITH' || t === 'AUTHORIZES_WITH' || t === 'ASSUMES_ROLE')
    return { color: T.purple, dashed: false, width: 2,   animated: false, category: 'auth' };
  if (t === 'TRUSTS')
    return { color: T.orangeHigh, dashed: true,  width: 2,   animated: false, category: 'trust' };

  // Data-flow relationship types
  if (t === 'READS_FROM' || t === 'WRITES_TO') {
    const encrypted = dataFlow?.encrypted ?? true;
    const classification = dataFlow?.dataClassification;
    if (classification === 'restricted' || classification === 'confidential')
      return { color: T.pink, dashed: false, width: 2.5, animated: false, category: 'data' };
    return {
      color: encrypted ? T.cyan : T.orange,
      dashed: !encrypted,
      width: 2,
      animated: false,
      category: 'data',
    };
  }

  if (t === 'CONNECTS_TO') {
    const encrypted = dataFlow?.encrypted ?? true;
    return {
      color: encrypted ? T.emerald : T.orange,
      dashed: !encrypted,
      width: 2,
      animated: false,
      category: 'flow',
    };
  }

  if (t === 'DEPLOYED_TO' || t === 'USES')
    return { color: T.amber, dashed: false, width: 1.5, animated: false, category: 'infra' };
  if (t === 'DEPENDS_ON')
    return { color: T.stone500, dashed: false, width: 1.5, animated: false, category: 'dep' };

  // Confidence-based fallback
  switch (confidence) {
    case 'deterministic': return { color: T.emerald, dashed: false, width: 2,   animated: false, category: 'other' };
    case 'manual':        return { color: T.blue,    dashed: false, width: 2,   animated: false, category: 'other' };
    case 'heuristic':     return { color: T.orange,  dashed: true,  width: 1.5, animated: false, category: 'other' };
    default:              return { color: T.stone500, dashed: false, width: 1.5, animated: false, category: 'other' };
  }
}

// Build the human-readable edge label shown on the graph
function renderEdgeLabel(edge: ThreatModelEdge): string {
  if (edge.label && !edge.label.includes('_')) return edge.label;

  const parts: string[] = [];
  const df = edge.dataFlow;

  if (df?.protocol) parts.push(df.protocol.toUpperCase());

  const dirArrow = df?.direction === 'inbound' ? '←' : df?.direction === 'outbound' ? '→' : df?.direction === 'bidirectional' ? '⇄' : '';
  if (dirArrow) parts.push(dirArrow);

  if (df?.dataTypes?.length) parts.push(df.dataTypes[0]);
  if (df && !df.encrypted) parts.push('⚠');

  if (parts.length) return parts.join(' ');

  // Readable fallback from relationship type
  const labels: Record<string, string> = {
    CONNECTS_TO: 'connects',
    EXPOSED_TO_INTERNET: 'internet',
    READS_FROM: 'reads',
    WRITES_TO: 'writes',
    AUTHENTICATES_WITH: 'auth',
    AUTHORIZES_WITH: 'authz',
    ASSUMES_ROLE: 'role',
    TRUSTS: 'trusts',
    CROSSES_BOUNDARY: 'boundary',
    DEPLOYED_TO: 'deployed',
    USES: 'uses',
    DEPENDS_ON: 'depends',
  };
  return labels[edge.type.toUpperCase()] ?? edge.type.toLowerCase().replace(/_/g, ' ');
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

function getDiffStatus(nodeId: string, diff?: ThreatModelDiff): DiffStatus {
  if (!diff) return 'unchanged';
  if (diff.addedNodes.some(n => n.id === nodeId)) return 'added';
  if (diff.removedNodes.some(n => n.id === nodeId)) return 'removed';
  if (diff.modifiedNodes.some(n => n.after.id === nodeId || n.before.id === nodeId)) return 'modified';
  return 'unchanged';
}

function getDiffRingStyle(status: DiffStatus): React.CSSProperties {
  switch (status) {
    case 'added':    return { outline: `3px solid ${T.green}`,     outlineOffset: '3px', boxShadow: '0 0 12px rgba(22,163,74,0.5)' };
    case 'removed':  return { outline: `3px solid ${T.red}`,      outlineOffset: '3px', boxShadow: '0 0 12px rgba(220,38,38,0.4)', opacity: 0.6 };
    case 'modified': return { outline: `3px solid ${T.amber}`,    outlineOffset: '3px', boxShadow: '0 0 12px rgba(217,119,6,0.4)' };
    default:         return {};
  }
}

function getDiffBadge(status: DiffStatus): React.ReactNode {
  if (status === 'unchanged') return null;
  const cfgs = {
    added:    { label: '+', color: T.green,     bg: T.greenLight },
    removed:  { label: '−', color: T.red,       bg: T.redLight },
    modified: { label: '~', color: T.amber,     bg: T.amberLight },
  };
  const cfg = cfgs[status];
  return (
    <div style={{
      position: 'absolute', top: -8, right: -8,
      width: 18, height: 18, borderRadius: '50%',
      background: cfg.bg, color: cfg.color,
      fontSize: 12, fontWeight: 800, lineHeight: '18px', textAlign: 'center',
      border: `1.5px solid ${cfg.color}`, zIndex: 20, pointerEvents: 'none',
    }}>
      {cfg.label}
    </div>
  );
}

// ── Custom node ───────────────────────────────────────────────────────────────

interface ThreatNodeData {
  node: ThreatModelNode;
  diffStatus: DiffStatus;
  isDark: boolean;
}

function ThreatModelNodeComponent({ data }: { data: ThreatNodeData }) {
  const { node, diffStatus, isDark } = data;
  const diffStyle   = getDiffRingStyle(diffStatus);
  const borderColor = node.severity ? getSeverityColor(node.severity) : T.emerald;
  const nodeBg      = node.severity ? getSeverityBg(node.severity, isDark) : (isDark ? D.bgCard : T.white);
  const labelColor  = isDark ? D.text : T.stone800;
  const typeColor   = isDark ? D.textMuted : T.stone500;
  const typeBg      = isDark ? D.bg : T.stone100;

  const handleStyle: React.CSSProperties = {
    opacity: 0, width: 1, height: 1, border: 'none',
    background: 'transparent', minWidth: 1, minHeight: 1,
  };

  return (
    <div style={{ position: 'relative' }}>
      <Handle type="target" position={Position.Top}    id="top-t"    style={handleStyle} />
      <Handle type="source" position={Position.Top}    id="top-s"    style={handleStyle} />
      <Handle type="target" position={Position.Bottom} id="bottom-t" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom-s" style={handleStyle} />
      <Handle type="target" position={Position.Left}   id="left-t"   style={handleStyle} />
      <Handle type="source" position={Position.Left}   id="left-s"   style={handleStyle} />
      <Handle type="target" position={Position.Right}  id="right-t"  style={handleStyle} />
      <Handle type="source" position={Position.Right}  id="right-s"  style={handleStyle} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
        {/* Icon circle — batta-ai style */}
        <div style={{
          position: 'relative',
          width: 52, height: 52, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: nodeBg,
          border: `2px solid ${borderColor}`,
          boxShadow: `0 2px 8px ${borderColor}28, 0 0 0 3px ${borderColor}12`,
          ...diffStyle,
        }}>
          <img src={getNodeIcon(node.type, node.metadata)} alt={node.type} style={{ width: 24, height: 24, flexShrink: 0 }} />
          {getDiffBadge(diffStatus)}
          {node.metadata?.encryptionAtRest === false && (
            <div title="Encryption at rest disabled" style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 14, height: 14, borderRadius: '50%',
              background: T.orange, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: T.white, fontWeight: 800, border: `1.5px solid ${T.white}`,
            }}>!</div>
          )}
        </div>

        {/* Label */}
        <div style={{
          marginTop: 7, fontSize: 11, fontWeight: 600,
          color: labelColor, textAlign: 'center', maxWidth: 110,
          wordBreak: 'break-word', lineHeight: 1.3,
        }}>
          {node.label}
        </div>

        {/* Type chip */}
        <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{
            fontSize: 8.5, padding: '1px 5px', borderRadius: 5,
            background: typeBg, color: typeColor,
            fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            {node.type.replace(/_/g, ' ')}
          </span>
          {node.severity && (
            <span style={{
              fontSize: 8.5, padding: '1px 5px', borderRadius: 5,
              background: getSeverityBg(node.severity, isDark),
              color: getSeverityColor(node.severity),
              fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              border: `1px solid ${getSeverityColor(node.severity)}35`,
            }}>
              {node.severity}
            </span>
          )}
          {node.metadata?.internetExposed && (
            <Tooltip title="Internet-exposed">
              <span style={{
                fontSize: 8.5, padding: '1px 5px', borderRadius: 5,
                background: isDark ? '#450a0a' : T.redLight, color: T.red,
                fontWeight: 700, letterSpacing: '0.04em',
              }}>
                ⚠ exposed
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = { threatModelNode: ThreatModelNodeComponent };

// ── Layout engine ─────────────────────────────────────────────────────────────

const ZONE_COLUMN_WIDTH  = 300;
const ZONE_COLUMN_GAP    = 80;
const NODE_Y_STEP        = 155;
const ZONE_PADDING_TOP   = 72;
const ZONE_PADDING_SIDES = 16;

function buildReactFlowElements(
  graph: ThreatModelGraphType,
  diff: ThreatModelDiff | undefined,
  isDark: boolean,
  hiddenCategories: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  // Merge ghost "removed" nodes
  const allNodes: ThreatModelNode[] = [...graph.nodes];
  if (diff) {
    for (const removed of diff.removedNodes) {
      if (!allNodes.some(n => n.id === removed.id)) allNodes.push(removed);
    }
  }

  // Group by trust zone
  const zoneMap = new Map<TrustZone, ThreatModelNode[]>();
  for (const z of ZONE_ORDER) zoneMap.set(z, []);
  for (const node of allNodes) {
    const z = node.trustZone as TrustZone | undefined;
    zoneMap.get(z && zoneMap.has(z) ? z : 'internal')!.push(node);
  }

  const rfNodes: Node[] = [];
  const nodeAbsPos = new Map<string, { x: number; y: number }>();
  const activeZones = ZONE_ORDER.filter(z => zoneMap.get(z)!.length > 0);

  let zoneX = 0;
  for (const zone of activeZones) {
    const zoneNodes = zoneMap.get(zone)!;
    const cfg        = TRUST_ZONE_CONFIG[zone];
    const zoneH      = ZONE_PADDING_TOP + zoneNodes.length * NODE_Y_STEP + 30;
    const cid        = `__zone_${zone}`;

    // Zone container
    rfNodes.push({
      id: cid, type: 'group',
      position: { x: zoneX, y: 0 },
      data: {},
      style: {
        width: ZONE_COLUMN_WIDTH, height: zoneH,
        background: isDark ? cfg.bgDark : cfg.bg,
        border: `2px solid ${cfg.border}`,
        borderRadius: 16,
      },
      zIndex: 0,
    });

    // Zone header
    rfNodes.push({
      id: `${cid}__header`,
      type: 'default',
      draggable: false, selectable: false,
      position: { x: ZONE_PADDING_SIDES, y: 12 },
      parentNode: cid,
      extent: 'parent' as const,
      data: {
        label: (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            color: T.white, fontSize: 10.5, fontWeight: 800,
            letterSpacing: '0.07em', textTransform: 'uppercase', pointerEvents: 'none',
          }}>
            {cfg.icon}
            {cfg.label}
            <span style={{
              marginLeft: 'auto', background: 'rgba(255,255,255,0.25)',
              borderRadius: 9, padding: '1px 7px', fontSize: 10, fontWeight: 700,
            }}>
              {zoneNodes.length}
            </span>
          </div>
        ),
      },
      style: {
        background: cfg.headerBg, border: 'none', borderRadius: 9,
        padding: '4px 12px', height: 30, pointerEvents: 'none',
        minWidth: 140, maxWidth: ZONE_COLUMN_WIDTH - ZONE_PADDING_SIDES * 2,
        width: ZONE_COLUMN_WIDTH - ZONE_PADDING_SIDES * 2,
      },
      zIndex: 1,
    });

    // Child nodes
    zoneNodes.forEach((node, idx) => {
      const localX = ZONE_COLUMN_WIDTH / 2 - 26;
      const localY = ZONE_PADDING_TOP + idx * NODE_Y_STEP;
      rfNodes.push({
        id: node.id,
        type: 'threatModelNode',
        position: { x: localX, y: localY },
        parentNode: cid,
        extent: 'parent' as const,
        data: {
          node,
          diffStatus: getDiffStatus(node.id, diff),
          isDark,
        } satisfies ThreatNodeData,
        zIndex: 2,
      });
      nodeAbsPos.set(node.id, { x: zoneX + localX + 26, y: localY + 26 });
    });

    zoneX += ZONE_COLUMN_WIDTH + ZONE_COLUMN_GAP;
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  const buildEdge = (
    edge: ThreatModelEdge,
    isAdded: boolean,
    isRemoved: boolean,
  ): Edge | null => {
    const baseStyle = getEdgeStyle(edge.type, edge.dataFlow, edge.confidence);
    const style = edge.isOnAttackPath
      ? { ...baseStyle, color: T.red, dashed: true, animated: true, width: 2.5, category: 'attackPath' }
      : baseStyle;

    // Apply category filter
    if (hiddenCategories.has(style.category)) return null;

    const color    = isAdded ? T.green : isRemoved ? T.red : style.color;
    const dashArr  = isRemoved ? '6,4' : style.dashed ? '7,4' : undefined;
    const label    = edge.isOnAttackPath ? `⚡ ${renderEdgeLabel(edge)}` : renderEdgeLabel(edge);
    const animated = isAdded ? true : style.animated;

    // Smart handle selection based on relative node positions
    const src = nodeAbsPos.get(edge.from);
    const tgt = nodeAbsPos.get(edge.to);
    let sh: string | undefined, th: string | undefined;
    if (src && tgt) {
      const dx = tgt.x - src.x, dy = tgt.y - src.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        sh = dx > 0 ? 'right-s' : 'left-s';
        th = dx > 0 ? 'left-t'  : 'right-t';
      } else {
        sh = dy > 0 ? 'bottom-s' : 'top-s';
        th = dy > 0 ? 'top-t'    : 'bottom-t';
      }
    }

    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: sh,
      targetHandle: th,
      type: 'smoothstep',
      animated,
      label,
      labelStyle: { fontSize: 9.5, fontWeight: 700, fill: color },
      labelBgStyle: { fill: isDark ? D.bgCard : T.white, fillOpacity: 0.95 },
      labelBgPadding: [5, 6] as [number, number],
      labelBgBorderRadius: 4,
      style: {
        strokeWidth: style.width,
        stroke: color,
        strokeDasharray: dashArr,
        opacity: isRemoved ? 0.4 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: { edgeType: edge.type, dataFlow: edge.dataFlow, category: style.category },
    };
  };

  const rfEdges: Edge[] = [];
  for (const edge of graph.edges) {
    const built = buildEdge(
      edge,
      diff?.addedEdges.some(e => e.id === edge.id) ?? false,
      diff?.removedEdges.some(e => e.id === edge.id) ?? false,
    );
    if (built) rfEdges.push(built);
  }
  if (diff) {
    for (const edge of diff.removedEdges) {
      if (!rfEdges.some(e => e.id === edge.id)) {
        const built = buildEdge(edge, false, true);
        if (built) rfEdges.push(built);
      }
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}

// ── Metadata formatter ────────────────────────────────────────────────────────

function formatMetaKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function renderMetaValue(v: any): React.ReactNode {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? '✓ Yes' : '✗ No';
  if (typeof v === 'object') {
    // Arrays of strings → tags
    if (Array.isArray(v) && v.every(x => typeof x === 'string')) {
      return (
        <Space size={3} wrap>
          {v.map((s, i) => <Tag key={i} style={{ fontSize: 10, margin: 0 }}>{s}</Tag>)}
        </Space>
      );
    }
    return <Text style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(v, null, 2)}</Text>;
  }
  const sv = String(v);
  const isUrl = sv.startsWith('http://') || sv.startsWith('https://');
  return isUrl
    ? <a href={sv} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.emerald, wordBreak: 'break-all' }}>{sv}</a>
    : <Text style={{ fontSize: 11, wordBreak: 'break-word' }}>{sv}</Text>;
}

// ── Node detail drawer ────────────────────────────────────────────────────────

// Keys to skip in the generic metadata dump (we surface them as dedicated fields)
const SKIP_META_KEYS = new Set([
  'extractedBy', 'sourceFile', 'sourceService', 'connectionString',
]);


interface NodeDrawerProps {
  node: ThreatModelNode | null;
  graph: ThreatModelGraphType;
  open: boolean;
  onClose: () => void;
  isDark: boolean;
}

function NodeDetailDrawer({ node, graph, open, onClose, isDark }: NodeDrawerProps) {
  if (!node || !open) return null;

  const bg      = isDark ? D.bg : T.white;
  const border  = isDark ? D.border : T.stone200;
  const text    = isDark ? D.text : T.stone900;
  const muted   = isDark ? D.textMuted : T.stone500;
  const cardBg  = isDark ? D.bg : T.stone50;

  const zoneConfig = node.trustZone ? TRUST_ZONE_CONFIG[node.trustZone as TrustZone] : null;
  const outgoing = graph.edges
    .filter(e => e.from === node.id)
    .map(e => ({ ...e, dir: 'out' as const, peer: graph.nodes.find(n => n.id === e.to) }))
    .filter(e => e.peer);
  const incoming = graph.edges
    .filter(e => e.to === node.id)
    .map(e => ({ ...e, dir: 'in' as const, peer: graph.nodes.find(n => n.id === e.from) }))
    .filter(e => e.peer);
  const allRels = [...incoming, ...outgoing];
  const m = node.metadata ?? {};

  const securityFields: Array<{ key: string; label: string; value: any; danger?: boolean }> = [
    { key: 'internetExposed',      label: 'Internet Exposed',      value: m.internetExposed,      danger: m.internetExposed },
    { key: 'authenticationMethod', label: 'Authentication',        value: m.authenticationMethod },
    { key: 'authorizationModel',   label: 'Authorization',         value: m.authorizationModel },
    { key: 'dataClassification',   label: 'Data Classification',   value: m.dataClassification },
    { key: 'encryptionAtRest',     label: 'Encryption at Rest',    value: m.encryptionAtRest,     danger: m.encryptionAtRest === false },
    { key: 'encryptionInTransit',  label: 'Encryption in Transit', value: m.encryptionInTransit,  danger: m.encryptionInTransit === false },
    { key: 'riskScore',            label: 'Risk Score',            value: m.riskScore },
    { key: 'isPublic',             label: 'Public',                value: m.isPublic,             danger: m.isPublic },
    { key: 'isThirdParty',         label: 'Third Party',           value: m.isThirdParty,         danger: m.isThirdParty },
    { key: 'cloudProvider',        label: 'Cloud Provider',        value: m.cloudProvider },
    { key: 'region',               label: 'Region',                value: m.region },
    { key: 'protocol',             label: 'Protocol',              value: m.protocol },
  ].filter(f => f.value !== undefined && f.value !== null && f.value !== '');

  const sensitiveDataTypes: string[] = m.sensitiveDataTypes ?? [];
  const entryPoints: any[] = m.entryPoints ?? [];
  const identifiedThreats: any[] = m.identifiedThreats ?? [];
  const attackSurface: any = m.attackSurface;
  const extraMeta = Object.entries(m).filter(([k]) =>
    !SKIP_META_KEYS.has(k) &&
    !securityFields.some(f => f.key === k) &&
    k !== 'sensitiveDataTypes' && k !== 'entryPoints' &&
    k !== 'identifiedThreats' && k !== 'attackSurface' && k !== 'businessImpact'
  );

  const SectionLabel = ({ label }: { label: string }) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: muted, marginBottom: 8, marginTop: 16 }}>
      {label}
    </div>
  );

  const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 12px', ...style }}>
      {children}
    </div>
  );

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 380,
      background: bg, borderLeft: `1px solid ${border}`,
      display: 'flex', flexDirection: 'column', zIndex: 20,
      boxShadow: isDark ? '-4px 0 20px rgba(0,0,0,0.4)' : '-4px 0 20px rgba(28,25,23,0.08)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src={getNodeIcon(node.type, node.metadata)} alt={node.type} style={{ width: 22, height: 22, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</div>
          <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>{node.type.replace(/_/g, ' ')}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, display: 'flex', padding: 4, borderRadius: 6, flexShrink: 0 }}>
          <CloseOutlined style={{ fontSize: 14 }} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 20px' }}>

        {/* Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12, marginBottom: 4 }}>
          {node.severity && (
            <span style={{ fontSize: 10, fontWeight: 700, color: getSeverityColor(node.severity), background: getSeverityBg(node.severity, isDark), padding: '2px 8px', borderRadius: 99, border: `1px solid ${getSeverityColor(node.severity)}35` }}>
              {node.severity.toUpperCase()}
            </span>
          )}
          {zoneConfig && (
            <span style={{ fontSize: 10, fontWeight: 600, color: T.white, background: zoneConfig.headerBg, padding: '2px 8px', borderRadius: 99 }}>
              {zoneConfig.label}
            </span>
          )}
          {m.internetExposed && (
            <span style={{ fontSize: 10, fontWeight: 700, color: T.red, background: T.redLight, padding: '2px 8px', borderRadius: 99 }}>
              ⚠ Internet Exposed
            </span>
          )}
          {node.link && (
            <a href={node.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 600, color: T.emerald, background: isDark ? 'rgba(16,185,129,0.1)' : T.greenLight, padding: '2px 8px', borderRadius: 99, textDecoration: 'none', border: `1px solid ${T.emeraldBorder}` }}>
              View Source ↗
            </a>
          )}
        </div>

        {/* Security Profile */}
        {securityFields.length > 0 && (
          <>
            <SectionLabel label="Security Profile" />
            <Card>
              {securityFields.map(({ key, label, value, danger }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7, gap: 8 }}>
                  <span style={{ fontSize: 11, color: muted, fontWeight: 600, flexShrink: 0, minWidth: 130 }}>{label}</span>
                  <span style={{ color: danger ? T.red : text, fontSize: 11, textAlign: 'right' }}>
                    {renderMetaValue(value)}
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}

        {/* Sensitive Data */}
        {sensitiveDataTypes.length > 0 && (
          <>
            <SectionLabel label="Sensitive Data" />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {sensitiveDataTypes.map(dt => (
                <span key={dt} style={{ fontSize: 10, fontWeight: 700, color: T.orangeHigh, background: T.orangeLight, padding: '2px 8px', borderRadius: 99 }}>
                  <WarningOutlined style={{ marginRight: 4, fontSize: 9 }} />{dt}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Attack Surface */}
        {attackSurface && (
          <>
            <SectionLabel label="Attack Surface" />
            <Card style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
              {Object.entries(attackSurface).map(([k, v]) =>
                typeof v === 'object' ? null : (
                  <div key={k}>
                    <div style={{ fontSize: 9.5, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: text }}>{String(v)}</div>
                  </div>
                )
              )}
            </Card>
          </>
        )}

        {/* Threats */}
        {identifiedThreats.length > 0 && (
          <>
            <SectionLabel label={`Identified Threats (${identifiedThreats.length})`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {identifiedThreats.map((t: any, i: number) => {
                const exp: ExploitabilityResult | undefined = t.exploitability;
                const displaySeverity = exp?.adjustedSeverity ?? t.severity;
                const wasAdjusted = exp && exp.originalSeverity !== exp.adjustedSeverity;
                return (
                  <div key={i} style={{ background: cardBg, border: `1px solid ${border}`, borderLeft: `3px solid ${getSeverityColor(displaySeverity)}`, borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: text }}>{t.id}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {wasAdjusted && (
                          <span style={{ fontSize: 9, color: muted, textDecoration: 'line-through' }}>{exp.originalSeverity}</span>
                        )}
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: getSeverityColor(displaySeverity), background: getSeverityBg(displaySeverity, isDark), padding: '1px 6px', borderRadius: 99 }}>
                          {wasAdjusted && (exp!.isExploitable ? '↑ ' : '↓ ')}{displaySeverity}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: muted }}>{t.description}</div>
                    {exp && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 10, color: muted, fontStyle: 'italic', marginBottom: 4 }}>{exp.adjustmentReason}</div>
                        {exp.isExploitable && exp.exploitationNarrative && (
                          <Collapse
                            ghost
                            size="small"
                            style={{ margin: 0 }}
                            items={[{
                              key: 'narrative',
                              label: <span style={{ fontSize: 10, fontWeight: 700, color: T.red }}>⚡ How it could be exploited</span>,
                              children: (
                                <div style={{ fontSize: 10.5, color: text, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                  {exp.exploitationNarrative}
                                  {exp.prerequisites.length > 0 && (
                                    <div style={{ marginTop: 8 }}>
                                      <div style={{ fontWeight: 700, color: muted, fontSize: 9.5, textTransform: 'uppercase', marginBottom: 3 }}>Prerequisites</div>
                                      {exp.prerequisites.map((p, pi) => (
                                        <div key={pi} style={{ marginBottom: 2 }}>• {p}</div>
                                      ))}
                                    </div>
                                  )}
                                  {exp.detectionOpportunities.length > 0 && (
                                    <div style={{ marginTop: 8 }}>
                                      <div style={{ fontWeight: 700, color: muted, fontSize: 9.5, textTransform: 'uppercase', marginBottom: 3 }}>Detection Opportunities</div>
                                      {exp.detectionOpportunities.map((d, di) => (
                                        <div key={di} style={{ marginBottom: 2 }}>• {d}</div>
                                      ))}
                                    </div>
                                  )}
                                  {exp.attackPaths.length > 0 && (
                                    <div style={{ marginTop: 8 }}>
                                      <div style={{ fontWeight: 700, color: muted, fontSize: 9.5, textTransform: 'uppercase', marginBottom: 4 }}>Attack Path (feasibility {exp.attackPaths[0].feasibilityScore}/100)</div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                                        {exp.attackPaths[0].hops.map((hop, hi) => (
                                          <span key={hi} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span style={{
                                              fontSize: 9.5, padding: '1px 6px', borderRadius: 4,
                                              background: hop.isWeakLink ? T.redLight : (isDark ? D.bgCard : T.stone100),
                                              color: hop.isWeakLink ? T.red : text,
                                              border: `1px solid ${hop.isWeakLink ? T.redBorder : border}`,
                                              fontWeight: 600,
                                            }}>
                                              {hop.entityLabel || hop.entityType}
                                              {hop.isWeakLink && ' ⚠'}
                                            </span>
                                            {hi < exp.attackPaths[0].hops.length - 1 && (
                                              <span style={{ fontSize: 9, color: muted }}>→</span>
                                            )}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ),
                            }]}
                          />
                        )}
                      </div>
                    )}
                    {t.status && !exp && <div style={{ marginTop: 4, fontSize: 10, color: muted }}>{t.status}</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Entry Points */}
        {entryPoints.length > 0 && (
          <>
            <SectionLabel label={`Entry Points (${entryPoints.length})`} />
            <Card>
              {entryPoints.map((ep: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: i < entryPoints.length - 1 ? 7 : 0 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: T.blue, background: T.blueLight, padding: '1px 6px', borderRadius: 5 }}>{(ep.method || ep.type || '').toUpperCase()}</span>
                  <span style={{ fontSize: 11, flex: 1, color: text, wordBreak: 'break-all' }}>{ep.path || ep.type}</span>
                  {!ep.authenticationRequired && (
                    <Tooltip title="No authentication required">
                      <WarningOutlined style={{ color: T.orangeHigh, fontSize: 11 }} />
                    </Tooltip>
                  )}
                </div>
              ))}
            </Card>
          </>
        )}

        {/* Extra Metadata */}
        {extraMeta.length > 0 && (
          <>
            <SectionLabel label="Details" />
            <Card>
              {extraMeta.map(([k, v]) => (
                <div key={k} style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{formatMetaKey(k)}</div>
                  <div style={{ fontSize: 11, color: text }}>{renderMetaValue(v)}</div>
                </div>
              ))}
            </Card>
          </>
        )}

        {/* Relationships */}
        {allRels.length > 0 && (
          <>
            <SectionLabel label={`Relationships (${allRels.length})`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allRels.map((rel, idx) => {
                const style = getEdgeStyle(rel.type, rel.dataFlow, rel.confidence);
                const isOut = rel.dir === 'out';
                const df    = rel.dataFlow;
                return (
                  <div key={idx} style={{ background: cardBg, border: `1px solid ${border}`, borderLeft: `3px solid ${style.color}`, borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <img src={getNodeIcon(rel.peer!.type, rel.peer!.metadata)} alt={rel.peer!.type} style={{ width: 16, height: 16, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, color: style.color, fontWeight: 800 }}>{isOut ? '→' : '←'} {renderEdgeLabel(rel)}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rel.peer!.label}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 5, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 9.5, color: muted }}>{isOut ? 'outgoing' : 'incoming'} · {rel.peer!.type.replace(/_/g, ' ')}</span>
                          {df?.protocol && <span style={{ fontSize: 9, fontWeight: 600, color: T.blue, background: T.blueLight, padding: '0 5px', borderRadius: 4 }}>{df.protocol.toUpperCase()}</span>}
                          {df?.dataClassification && <span style={{ fontSize: 9, color: muted, background: isDark ? D.bgCard : T.stone100, padding: '0 5px', borderRadius: 4 }}>{df.dataClassification}</span>}
                          {df && !df.encrypted && <span style={{ fontSize: 9, fontWeight: 700, color: T.orangeHigh, background: T.orangeLight, padding: '0 5px', borderRadius: 4 }}>⚠ unencrypted</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Edge category legend & filter panel ───────────────────────────────────────

const EDGE_CATEGORIES = [
  { id: 'attackPath', color: T.red,       label: 'Attack Path',       dashed: true,  icon: <WarningOutlined /> },
  { id: 'boundary',   color: T.red,       label: 'Boundary Crossing', dashed: true,  icon: <GlobalOutlined /> },
  { id: 'auth',       color: T.purple,    label: 'Auth / Identity',   dashed: false, icon: <LockOutlined /> },
  { id: 'trust',      color: T.orangeHigh,label: 'Trust',             dashed: true,  icon: <SafetyOutlined /> },
  { id: 'data',       color: T.cyan,      label: 'Data Flow',         dashed: false, icon: <ThunderboltOutlined /> },
  { id: 'flow',       color: T.emerald,   label: 'Network Connection',dashed: false, icon: <ApiOutlined /> },
  { id: 'infra',      color: T.amber,     label: 'Infrastructure',    dashed: false, icon: <NodeIndexOutlined /> },
  { id: 'dep',        color: T.stone500,  label: 'Dependency',        dashed: false, icon: <NodeIndexOutlined /> },
];

function LegendPanel({
  showDiff,
  isDark,
  token,
  hiddenCategories,
  onToggle,
  showFilters,
  onToggleFilters,
}: {
  showDiff: boolean;
  isDark: boolean;
  token: any;
  hiddenCategories: Set<string>;
  onToggle: (id: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
}) {
  return (
    <div style={{
      position: 'absolute', bottom: 52, left: 10, zIndex: 10,
      background: isDark ? 'rgba(28,25,23,0.95)' : 'rgba(255,255,255,0.97)',
      backdropFilter: 'blur(8px)',
      border: `1px solid ${token.colorBorder}`,
      borderRadius: 10, padding: '10px 13px', maxWidth: 230,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <Text style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: token.colorTextSecondary }}>
          Edge Types
        </Text>
        <Tooltip title={showFilters ? 'Hide filters' : 'Filter edges'}>
          <FilterOutlined
            onClick={onToggleFilters}
            style={{ fontSize: 11, cursor: 'pointer', color: showFilters ? token.colorPrimary : token.colorTextSecondary }}
          />
        </Tooltip>
      </div>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {EDGE_CATEGORIES.map(({ id, color, label, dashed }) => {
          const hidden = hiddenCategories.has(id);
          return (
            <div
              key={id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: hidden ? 0.35 : 1,
                cursor: showFilters ? 'pointer' : 'default',
                borderRadius: 4,
                padding: '1px 4px',
              }}
              onClick={() => showFilters && onToggle(id)}
              title={showFilters ? (hidden ? 'Show' : 'Hide') : undefined}
            >
              <svg width={28} height={8} style={{ flexShrink: 0 }}>
                <line
                  x1={0} y1={4} x2={22} y2={4}
                  stroke={color} strokeWidth={2.5}
                  strokeDasharray={dashed ? '5,3' : undefined}
                />
                <polygon points="20,1.5 27,4 20,6.5" fill={color} />
              </svg>
              <Text style={{ fontSize: 10, lineHeight: 1.3 }}>{label}</Text>
            </div>
          );
        })}
      </Space>

      {showDiff && (
        <>
          <div style={{ borderTop: `1px solid ${token.colorBorder}`, margin: '9px 0' }} />
          <Text style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: token.colorTextSecondary, display: 'block', marginBottom: 8 }}>
            Changes
          </Text>
          <Space direction="vertical" size={4}>
            {([
              { color: T.green,   label: 'Added' },
              { color: T.red,     label: 'Removed' },
              { color: T.amber,   label: 'Modified' },
            ] as { color: string; label: string }[]).map(({ color, label }) => (
              <Space key={label} size={8} align="center">
                <div style={{ width: 11, height: 11, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <Text style={{ fontSize: 10 }}>{label}</Text>
              </Space>
            ))}
          </Space>
        </>
      )}
    </div>
  );
}

// ── Graph stats bar ───────────────────────────────────────────────────────────

function StatsBar({ graph, isDark }: { graph: ThreatModelGraphType; isDark: boolean }) {
  const exposed = graph.nodes.filter(n => n.metadata?.internetExposed).length;
  const critical = graph.nodes.filter(n => n.severity === 'critical').length;
  const unencryptedEdges = graph.edges.filter(e => e.dataFlow && !e.dataFlow.encrypted).length;
  const exploitable = graph.nodes.reduce(
    (sum, n) => sum + (n.exploitabilityResults?.filter(r => r.isExploitable).length ?? 0), 0,
  );
  const attackPathEdges = graph.edges.filter(e => e.isOnAttackPath).length;

  const bg     = isDark ? 'rgba(28,25,23,0.95)' : 'rgba(255,255,255,0.97)';
  const border = isDark ? D.border : T.stone200;
  const text   = isDark ? D.text : T.stone900;
  const muted  = isDark ? D.textMuted : T.stone500;
  const divider = isDark ? D.border : T.stone100;

  const items = [
    { label: 'Assets',       value: graph.nodes.length, color: text },
    { label: 'Data Flows',   value: graph.edges.length, color: text },
    { label: 'Exposed',      value: exposed,            color: exposed > 0 ? T.red : T.green },
    { label: 'Critical',     value: critical,           color: critical > 0 ? T.red : T.green },
    { label: 'Exploitable',  value: exploitable,        color: exploitable > 0 ? T.red : T.green },
    { label: 'Attack Paths', value: attackPathEdges,    color: attackPathEdges > 0 ? T.orangeHigh : T.green },
    { label: 'Unencrypted',  value: unencryptedEdges,   color: unencryptedEdges > 0 ? T.orangeHigh : T.green },
  ];

  return (
    <div style={{
      display: 'flex', background: bg, backdropFilter: 'blur(8px)',
      border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(28,25,23,0.08)',
    }}>
      {items.map(({ label, value, color }, i) => (
        <div key={label} style={{
          padding: '7px 16px', textAlign: 'center',
          borderRight: i < items.length - 1 ? `1px solid ${divider}` : 'none',
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: 9, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ThreatModelGraphProps {
  graph: ThreatModelGraphType;
  diff?: ThreatModelDiff;
  height?: number;
}

export function ThreatModelGraph({ graph, diff, height = 660 }: ThreatModelGraphProps) {
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';

  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [hiddenCategories, setHiddenCats]   = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters]       = useState(false);

  const toggleCategory = useCallback((id: string) => {
    setHiddenCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildReactFlowElements(graph, diff, isDark, hiddenCategories),
    [graph, diff, isDark, hiddenCategories],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    const { nodes: n, edges: e } = buildReactFlowElements(graph, diff, isDark, hiddenCategories);
    setNodes(n);
    setEdges(e);
  }, [graph, diff, isDark, hiddenCategories, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = (_evt, rfNode) => {
    if (rfNode.type === 'group' || rfNode.type === 'default') return;
    setSelectedId(rfNode.id);
    setDrawerOpen(true);
  };

  const selectedNode =
    graph.nodes.find(n => n.id === selectedId) ??
    diff?.removedNodes.find(n => n.id === selectedId) ?? null;

  if (graph.nodes.length === 0 && !diff?.removedNodes.length) {
    return (
      <div style={{
        height,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
        border: `1px dashed ${token.colorBorder}`,
        borderRadius: 12, color: token.colorTextSecondary,
      }}>
        <SafetyOutlined style={{ fontSize: 40, opacity: 0.2 }} />
        <Text type="secondary" style={{ fontSize: 14 }}>No assets indexed — threat model graph is empty.</Text>
        <Text type="secondary" style={{ fontSize: 12, opacity: 0.7 }}>Run a scan to populate the asset inventory.</Text>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          position: 'relative', width: '100%', height,
          backgroundColor: isDark ? D.bg : T.stone50,
          border: `1px solid ${isDark ? D.border : T.stone200}`,
          borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(28,25,23,0.06)',
        }}
        className="tmg-container"
      >
        <style>{`
          .tmg-container .react-flow__handle {
            opacity: 0 !important; pointer-events: none !important;
            border: none !important; background: transparent !important;
          }
          .tmg-container .react-flow__node-default {
            border: none !important; background: transparent !important;
            box-shadow: none !important; padding: 0 !important;
          }
          .tmg-container .react-flow__edge-path {
            transition: stroke 0.15s ease, stroke-width 0.15s ease;
          }
          .tmg-container .react-flow__edge:hover .react-flow__edge-path {
            stroke-width: 3.5 !important;
          }
        `}</style>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodesDraggable
          fitView
          fitViewOptions={{ padding: 0.12, includeHiddenNodes: false }}
          attributionPosition="bottom-left"
          proOptions={{ hideAttribution: true }}
          minZoom={0.04}
          maxZoom={2.5}
          elevateEdgesOnSelect
        >
          {/* Stats bar */}
          <Panel position="top-center">
            <StatsBar graph={graph} isDark={isDark} />
          </Panel>

          {/* Explanation */}
          {graph.explanation && (
            <Panel position="top-right">
              <div style={{
                maxWidth: 320, fontSize: 11,
                color: isDark ? D.textMuted : T.stone500,
                background: isDark ? 'rgba(28,25,23,0.95)' : 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${isDark ? D.border : T.stone200}`,
                borderRadius: 9, padding: '6px 10px',
                boxShadow: '0 2px 8px rgba(28,25,23,0.08)',
              }}>
                <EyeOutlined style={{ marginRight: 5 }} />
                {graph.explanation}
              </div>
            </Panel>
          )}

          <Controls />
          <MiniMap
            nodeColor={n => {
              if (n.type === 'group' || n.type === 'default') return 'transparent';
              const d = n.data as ThreatNodeData | undefined;
              if (!d?.node) return T.emerald;
              return getSeverityColor(d.node.severity);
            }}
            style={{
              backgroundColor: isDark ? D.bg : T.white,
              border: `1px solid ${isDark ? D.border : T.stone200}`,
              borderRadius: 8,
            }}
            maskColor={isDark ? 'rgba(0,0,0,0.55)' : 'rgba(28,25,23,0.05)'}
          />
          <Background
            color={isDark ? D.border : T.stone200}
            gap={24}
            size={0.8}
          />
        </ReactFlow>

        <LegendPanel
          showDiff={!!diff}
          isDark={isDark}
          token={token}
          hiddenCategories={hiddenCategories}
          onToggle={toggleCategory}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(f => !f)}
        />

        <NodeDetailDrawer
          node={selectedNode}
          graph={graph}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          isDark={isDark}
        />
      </div>
    </>
  );
}
