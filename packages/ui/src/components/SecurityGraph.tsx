import { useState, useMemo, useCallback, useEffect } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { theme, Drawer, Typography, Tag, Space, Button } from 'antd';
import {
  CloseOutlined,
  ExpandOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { useTheme } from '../hooks';
import { getNodeIcon } from '../utils/nodeIcons';
import { T } from '../theme';

const { Title, Text } = Typography;

// ── Types ────────────────────────────────────────────────────────────────────

interface RelatedEntity {
  id: string;
  type: string;
  label: string;
  relationshipType: string;
  metadata?: Record<string, any>;
  link?: string;
}

interface GraphNode {
  id: string;
  type: string;
  label: string;
  severity?: string;
  metadata?: Record<string, any>;
  relatedEntities?: RelatedEntity[];
  link?: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: string;
  label?: string;
}

interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusNodeId?: string;
  explanation?: string;
}

export interface SecurityGraphProps {
  graph: GraphProjection;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ALWAYS_INDIVIDUAL_TYPES = new Set([
  'TrustBoundary', 'trust_boundary',
  'Threat', 'Vulnerability',
  'RiskLevel',
]);

const EDGE_CATEGORIES: Record<string, { label: string; color: string; types: string[] }> = {
  infrastructure: {
    label: 'Infrastructure',
    color: T.amber,
    types: ['DEPLOYED_TO', 'USES', 'CONTAINS'],
  },
  dependencies: {
    label: 'Dependencies',
    color: T.stone500,
    types: ['DEPENDS_ON', 'CALLS', 'IMPORTS', 'BUILT_BY'],
  },
  dataflow: {
    label: 'Data Flow',
    color: T.cyan,
    types: ['READS_FROM', 'WRITES_TO', 'CONNECTS_TO'],
  },
  security: {
    label: 'Security',
    color: T.red,
    types: ['AUTHENTICATES_WITH', 'AUTHORIZES_WITH', 'TRUSTS', 'ASSUMES_ROLE', 'EXPOSED_TO_INTERNET', 'CROSSES_BOUNDARY'],
  },
  features: {
    label: 'Features',
    color: T.purple,
    types: ['IMPLEMENTS_FEATURE'],
  },
};

// Reverse map: edge type → category key
const EDGE_TYPE_TO_CATEGORY = new Map<string, string>();
Object.entries(EDGE_CATEGORIES).forEach(([cat, { types }]) => {
  types.forEach(t => EDGE_TYPE_TO_CATEGORY.set(t, cat));
});

// Zone-based layout: features left, focus center, deps below, cloud+infra right
type NodeZone = 'left' | 'center' | 'right' | 'below';

// Node types whose peer nodes go below the focus (dependency lane)
const BELOW_TYPES = new Set([
  'CodeService', 'code_service', 'CodeModule', 'code_module',
  'Dependency', 'external_dependency',
]);

function getZoneForType(nodeType: string): NodeZone {
  return BELOW_TYPES.has(nodeType) ? 'below' : 'right';
}

// Build processed nodes for cloud resources: single group → expand → sub-type groups → expand → individuals
function buildCloudNodes(cloudNodes: GraphNode[], expandedGroups: Set<string>): ProcessedNode[] {
  if (cloudNodes.length === 0) return [];
  const TOP_KEY = 'group:cloud_resource';

  if (!expandedGroups.has(TOP_KEY)) {
    return [{
      id: `__group__${TOP_KEY}`,
      kind: 'group', rfType: 'groupNode', zone: 'right',
      groupKey: TOP_KEY,
      groupLabel: `${cloudNodes.length} Cloud Resource${cloudNodes.length !== 1 ? 's' : ''}`,
      groupMembers: cloudNodes,
      groupBaseType: 'CloudResource',
    }];
  }

  // Level 1 expanded → sub-type groups
  const subMap = new Map<string, GraphNode[]>();
  for (const node of cloudNodes) {
    const rt = node.metadata?.resourceType || node.metadata?.type || 'Cloud Resource';
    const sub = cleanResourceType(rt);
    const key = `group:cloud_resource:${sub}`;
    if (!subMap.has(key)) subMap.set(key, []);
    subMap.get(key)!.push(node);
  }

  const result: ProcessedNode[] = [];
  for (const [key, members] of subMap.entries()) {
    if (expandedGroups.has(key)) {
      for (const m of members) {
        result.push({ id: m.id, kind: 'individual', rfType: 'individualNode', zone: 'right', sourceNode: m, groupKey: key });
      }
    } else {
      result.push({
        id: `__group__${key}`, kind: 'group', rfType: 'groupNode', zone: 'right',
        groupKey: key, groupLabel: getGroupLabel(key, members.length),
        groupMembers: members, groupBaseType: 'CloudResource',
      });
    }
  }
  return result;
}

const TYPE_COLORS: Record<string, string> = {
  Feature: T.purple,
  CodeService: '#52c41a', code_service: '#52c41a',
  CodeModule: T.blue, code_module: T.blue,
  CloudResource: '#722ed1', cloud_resource: '#722ed1',
  Dependency: '#8c8c8c', external_dependency: '#8c8c8c',
  ApiEndpoint: '#13c2c2', api_endpoint: '#13c2c2',
  Identity: T.pink, identity: T.pink,
  NetworkSegment: '#faad14', network_segment: '#faad14',
  TrustBoundary: T.blue, trust_boundary: T.blue,
  Threat: T.red, Vulnerability: T.red, RiskLevel: T.red,
};

const NODE_COLORS = { border: T.emerald, background: T.greenLight, backgroundDark: '#064e3b' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSeverityColor(severity?: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return T.red;
    case 'high':     return T.orangeHigh;
    case 'medium':   return T.amber;
    case 'low':      return T.emerald;
    default:         return NODE_COLORS.border;
  }
}

function getNodeColorScheme(nodeType: string, metadata?: Record<string, any>) {
  if (nodeType === 'Threat' || nodeType === 'Vulnerability') {
    const s = metadata?.severity || 'medium';
    return {
      border: getSeverityColor(s),
      background: s === 'critical' ? T.redLight : s === 'high' ? T.orangeLight : T.amberLight,
      backgroundDark: s === 'critical' ? '#450a0a' : s === 'high' ? '#431407' : '#422006',
    };
  }
  if (nodeType === 'TrustBoundary' || nodeType === 'trust_boundary') {
    const bt = metadata?.type || metadata?.boundaryType;
    return {
      border: bt === 'external' ? T.red : bt === 'dmz' ? T.orangeHigh : T.blue,
      background: T.blueLight, backgroundDark: '#172554',
    };
  }
  const rs = metadata?.riskScore;
  if (rs !== undefined && rs >= 50) {
    const sev = rs >= 80 ? 'critical' : 'high';
    return {
      border: getSeverityColor(sev),
      background: sev === 'critical' ? T.redLight : T.orangeLight,
      backgroundDark: sev === 'critical' ? '#450a0a' : '#431407',
    };
  }
  if (metadata?.internetExposed === true) {
    return { border: T.orangeHigh, background: T.orangeLight, backgroundDark: '#431407' };
  }
  return NODE_COLORS;
}

function getEdgeCategoryStyle(edgeType: string): { color: string; dashed: boolean; animated: boolean } {
  const cat = EDGE_TYPE_TO_CATEGORY.get(edgeType) ?? 'other';
  const catCfg = EDGE_CATEGORIES[cat];
  return {
    color: catCfg?.color ?? T.emerald,
    dashed: cat === 'security',
    animated: cat === 'security',
  };
}

// ── Group key / label helpers ─────────────────────────────────────────────────

function cleanResourceType(rt: string): string {
  const lrt = rt.toLowerCase();
  if (lrt.includes('storageaccounts') || lrt.includes('storage/storage')) return 'Storage Accounts';
  if (lrt.includes('sites') || lrt.includes('webapps')) return 'App Services';
  if (lrt.includes('function')) return 'Function Apps';
  if (lrt.includes('managedclusters') || lrt.includes('kubernetes')) return 'Kubernetes';
  if (lrt.includes('containerregistries')) return 'Container Registries';
  if (lrt.includes('containerinstances')) return 'Container Instances';
  if (lrt.includes('virtualmachines')) return 'Virtual Machines';
  if (lrt.includes('sqlservers') || (lrt.includes('databases') && !lrt.includes('cosmos'))) return 'SQL Databases';
  if (lrt.includes('cosmosdb') || lrt.includes('documentdb')) return 'Cosmos DB';
  if (lrt.includes('mysql')) return 'MySQL';
  if (lrt.includes('postgresql')) return 'PostgreSQL';
  if (lrt.includes('vaults') || lrt.includes('keyvault')) return 'Key Vaults';
  if (lrt.includes('virtualnetworks')) return 'Virtual Networks';
  if (lrt.includes('networksecuritygroups')) return 'Network Security Groups';
  // Already a friendly name (no slashes/dots)
  if (!rt.includes('/') && !rt.includes('.')) return rt;
  // Extract last path segment, add spaces before capitals
  const last = rt.split(/[/.]/).pop() || rt;
  return last.replace(/([A-Z])/g, ' $1').trim();
}

function getGroupKey(node: GraphNode): string | null {
  if (ALWAYS_INDIVIDUAL_TYPES.has(node.type)) return null;
  const base = node.type.toLowerCase();
  if (base === 'cloudresource' || base === 'cloud_resource') {
    const rt = node.metadata?.resourceType || node.metadata?.type || 'Cloud Resource';
    return `group:cloud_resource:${cleanResourceType(rt)}`;
  }
  return `group:${base}`;
}

function getGroupBaseType(groupKey: string): string {
  if (groupKey === 'group:cloud_resource' || groupKey.startsWith('group:cloud_resource:')) return 'CloudResource';
  const base = groupKey.replace('group:', '');
  const map: Record<string, string> = {
    feature: 'Feature',
    code_service: 'CodeService', codeservice: 'CodeService',
    code_module: 'CodeModule', codemodule: 'CodeModule',
    external_dependency: 'Dependency', dependency: 'Dependency',
    api_endpoint: 'ApiEndpoint', apiendpoint: 'ApiEndpoint',
    identity: 'Identity',
    network_segment: 'NetworkSegment', networksegment: 'NetworkSegment',
  };
  return map[base] || 'Entity';
}

function getGroupLabel(groupKey: string, count: number): string {
  if (groupKey.startsWith('group:cloud_resource:')) {
    const sub = groupKey.replace('group:cloud_resource:', '');
    return `${count} ${sub}`;
  }
  const base = groupKey.replace('group:', '');
  const map: Record<string, string> = {
    feature: `${count} Feature${count !== 1 ? 's' : ''}`,
    code_service: `${count} Code Service${count !== 1 ? 's' : ''}`,
    codeservice: `${count} Code Service${count !== 1 ? 's' : ''}`,
    code_module: `${count} Module${count !== 1 ? 's' : ''}`,
    codemodule: `${count} Module${count !== 1 ? 's' : ''}`,
    external_dependency: `${count} Dependenc${count !== 1 ? 'ies' : 'y'}`,
    dependency: `${count} Dependenc${count !== 1 ? 'ies' : 'y'}`,
    api_endpoint: `${count} API Endpoint${count !== 1 ? 's' : ''}`,
    apiendpoint: `${count} API Endpoint${count !== 1 ? 's' : ''}`,
    identity: `${count} Identit${count !== 1 ? 'ies' : 'y'}`,
    network_segment: `${count} Network Segment${count !== 1 ? 's' : ''}`,
    networksegment: `${count} Network Segment${count !== 1 ? 's' : ''}`,
  };
  return map[base] || `${count} Nodes`;
}

// ── Processed node structure ──────────────────────────────────────────────────

interface ProcessedNode {
  id: string;
  kind: 'focus' | 'individual' | 'group';
  rfType: string;
  zone: NodeZone;
  sourceNode?: GraphNode;
  groupKey?: string;
  groupLabel?: string;
  groupMembers?: GraphNode[];
  groupBaseType?: string;
}

function buildProcessedNodes(
  graph: GraphProjection,
  expandedGroups: Set<string>,
): ProcessedNode[] {
  const focusId = graph.focusNodeId;

  // Feature nodes = targets of IMPLEMENTS_FEATURE edges (left zone, always individual)
  const featureNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'IMPLEMENTS_FEATURE') {
      if (edge.from === focusId) featureNodeIds.add(edge.to);
      else if (edge.to === focusId) featureNodeIds.add(edge.from);
      else { featureNodeIds.add(edge.to); }
    }
  }

  // Partition: always-individual, features (left-zone group), cloud (2-level), groupable others
  const individual: GraphNode[] = [];
  const featureNodes: GraphNode[] = [];
  const cloudNodes: GraphNode[] = [];
  const groupable: GraphNode[] = [];

  for (const node of graph.nodes) {
    const isCloud = node.type === 'CloudResource' || node.type === 'cloud_resource';
    const alwaysInd =
      node.id === focusId ||
      ALWAYS_INDIVIDUAL_TYPES.has(node.type) ||
      node.severity === 'critical';

    if (alwaysInd) individual.push(node);
    else if (featureNodeIds.has(node.id)) featureNodes.push(node);
    else if (isCloud) cloudNodes.push(node);
    else groupable.push(node);
  }

  // Non-cloud/non-feature groups — singletons stay individual (need ≥ 2)
  const groups = new Map<string, GraphNode[]>();
  for (const node of groupable) {
    const key = getGroupKey(node);
    if (!key) { individual.push(node); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }
  for (const [key, members] of groups.entries()) {
    if (members.length === 1) { individual.push(members[0]); groups.delete(key); }
  }

  const result: ProcessedNode[] = [];

  // Individual nodes (focus, always-individual types, promoted singletons)
  for (const node of individual) {
    const isFocus = node.id === focusId;
    result.push({ id: node.id, kind: isFocus ? 'focus' : 'individual', rfType: isFocus ? 'focusNode' : 'individualNode', zone: isFocus ? 'center' : getZoneForType(node.type), sourceNode: node });
  }

  // Features → single group in left zone (expand to show individual feature names)
  if (featureNodes.length > 0) {
    const FEAT_KEY = 'group:feature';
    if (expandedGroups.has(FEAT_KEY)) {
      for (const m of featureNodes) {
        result.push({ id: m.id, kind: 'individual', rfType: 'individualNode', zone: 'left', sourceNode: m, groupKey: FEAT_KEY });
      }
    } else {
      result.push({ id: `__group__${FEAT_KEY}`, kind: 'group', rfType: 'groupNode', zone: 'left', groupKey: FEAT_KEY, groupLabel: `${featureNodes.length} Feature${featureNodes.length !== 1 ? 's' : ''}`, groupMembers: featureNodes, groupBaseType: 'Feature' });
    }
  }

  // Cloud: 2-level grouping (all → sub-types → individuals)
  result.push(...buildCloudNodes(cloudNodes, expandedGroups));

  // Non-cloud/non-feature groups
  for (const [key, members] of groups.entries()) {
    const baseType = getGroupBaseType(key);
    const zone = getZoneForType(baseType);
    if (expandedGroups.has(key)) {
      for (const m of members) {
        result.push({ id: m.id, kind: 'individual', rfType: 'individualNode', zone, sourceNode: m, groupKey: key });
      }
    } else {
      result.push({ id: `__group__${key}`, kind: 'group', rfType: 'groupNode', zone, groupKey: key, groupLabel: getGroupLabel(key, members.length), groupMembers: members, groupBaseType: baseType });
    }
  }

  return result;
}

// ── ReactFlow node + edge builder ─────────────────────────────────────────────

function buildReactFlowGraph(
  processedNodes: ProcessedNode[],
  graph: GraphProjection,
  hiddenCategories: Set<string>,
  onGroupToggle: (key: string) => void,
  token: any,
  isDark: boolean,
): { nodes: Node[]; edges: Edge[] } {
  // Map original node id → rendered node id
  const origToRendered = new Map<string, string>();
  for (const pn of processedNodes) {
    if (pn.kind === 'group') {
      for (const m of pn.groupMembers!) origToRendered.set(m.id, pn.id);
    } else if (pn.sourceNode) {
      origToRendered.set(pn.sourceNode.id, pn.id);
    }
  }

  // Zone-based 2D layout: features LEFT · focus CENTER · deps BELOW · cloud+infra RIGHT
  const COL_W = 290;       // horizontal gap between zones
  const ROW_H = 130;       // vertical gap within a zone column
  const BELOW_Y = 240;     // y-offset below the focus node for the dependency lane
  const BELOW_X_GAP = 240; // horizontal spacing within the below lane
  const MAX_PER_ROW = 4;   // wrap deps into rows after this many

  const byZone: Record<NodeZone, ProcessedNode[]> = { left: [], center: [], right: [], below: [] };
  for (const pn of processedNodes) byZone[pn.zone].push(pn);

  const positions = new Map<string, { x: number; y: number }>();

  // Helper: stack nodes vertically centered on y=0 at a given x
  const stackAt = (pns: ProcessedNode[], x: number) => {
    const totalH = (pns.length - 1) * ROW_H;
    pns.forEach((pn, i) => positions.set(pn.id, { x, y: -totalH / 2 + i * ROW_H }));
  };

  byZone.center.forEach(pn => positions.set(pn.id, { x: 0, y: 0 }));
  stackAt(byZone.left, -COL_W);
  stackAt(byZone.right, COL_W);

  // Below zone: spread in rows, centered on x=0
  byZone.below.forEach((pn, i) => {
    const row = Math.floor(i / MAX_PER_ROW);
    const col = i % MAX_PER_ROW;
    const countInRow = Math.min(MAX_PER_ROW, byZone.below.length - row * MAX_PER_ROW);
    const x = -(countInRow - 1) / 2 * BELOW_X_GAP + col * BELOW_X_GAP;
    positions.set(pn.id, { x, y: BELOW_Y + row * ROW_H });
  });

  // Build ReactFlow nodes
  const rfNodes: Node[] = processedNodes.map(pn => {
    const pos = positions.get(pn.id) || { x: 0, y: 0 };
    const base = {
      id: pn.id,
      position: pos,
      style: { background: 'transparent', border: 'none', padding: 0 },
    };

    if (pn.kind === 'group') {
      return {
        ...base,
        type: 'groupNode',
        data: {
          groupKey: pn.groupKey,
          label: pn.groupLabel,
          count: pn.groupMembers!.length,
          baseType: pn.groupBaseType,
          onToggle: onGroupToggle,
          isDark,
          token,
        },
      };
    }
    if (pn.kind === 'focus') {
      return {
        ...base,
        type: 'focusNode',
        data: { label: pn.sourceNode!.label, nodeType: pn.sourceNode!.type, metadata: pn.sourceNode!.metadata, isDark, token },
      };
    }
    // individual
    return {
      ...base,
      type: 'individualNode',
      data: { label: pn.sourceNode!.label, nodeType: pn.sourceNode!.type, severity: pn.sourceNode!.severity, metadata: pn.sourceNode!.metadata, isDark, token },
    };
  });

  // Build edges with remapping + filtering + dedup
  const seen = new Set<string>();
  const rfEdges: Edge[] = [];

  for (const edge of graph.edges) {
    const cat = EDGE_TYPE_TO_CATEGORY.get(edge.type) ?? 'other';
    if (hiddenCategories.has(cat)) continue;

    const src = origToRendered.get(edge.from);
    const tgt = origToRendered.get(edge.to);
    if (!src || !tgt || src === tgt) continue;

    const dedupeKey = `${src}→${tgt}:${edge.type}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { color, dashed, animated } = getEdgeCategoryStyle(edge.type);
    const sp = positions.get(src);
    const tp = positions.get(tgt);
    let sourceHandle: string | undefined;
    let targetHandle: string | undefined;

    if (sp && tp) {
      const dx = tp.x - sp.x;
      const dy = tp.y - sp.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        sourceHandle = dx >= 0 ? 'right-source' : 'left-source';
        targetHandle = dx >= 0 ? 'left-target' : 'right-target';
      } else {
        sourceHandle = dy >= 0 ? 'bottom-source' : 'top-source';
        targetHandle = dy >= 0 ? 'top-target' : 'bottom-target';
      }
    }

    rfEdges.push({
      id: `e-${rfEdges.length}-${dedupeKey}`,
      source: src,
      target: tgt,
      sourceHandle,
      targetHandle,
      type: 'smoothstep',
      animated,
      label: edge.label || edge.type.replace(/_/g, ' '),
      labelStyle: { fontSize: 10, fontWeight: 600, fill: color },
      labelBgStyle: { fill: isDark ? '#1f2937' : T.white, fillOpacity: 0.95 },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 3,
      style: { stroke: color, strokeWidth: 2, strokeDasharray: dashed ? '6,3' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    });
  }

  // Remove nodes that have no visible edges (except the focus node, which always stays)
  const connectedIds = new Set(rfEdges.flatMap(e => [e.source, e.target]));
  const visibleNodes = rfNodes.filter(n => n.type === 'focusNode' || connectedIds.has(n.id));

  return { nodes: visibleNodes, edges: rfEdges };
}

// ── Custom ReactFlow node components ──────────────────────────────────────────

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0, width: 1, height: 1, border: 'none',
  background: 'transparent', minWidth: 1, minHeight: 1,
};

function AllHandles() {
  return (
    <>
      <Handle type="target"  position={Position.Top}    id="top-target"    style={HANDLE_STYLE} />
      <Handle type="source"  position={Position.Top}    id="top-source"    style={HANDLE_STYLE} />
      <Handle type="target"  position={Position.Bottom} id="bottom-target" style={HANDLE_STYLE} />
      <Handle type="source"  position={Position.Bottom} id="bottom-source" style={HANDLE_STYLE} />
      <Handle type="target"  position={Position.Left}   id="left-target"   style={HANDLE_STYLE} />
      <Handle type="source"  position={Position.Left}   id="left-source"   style={HANDLE_STYLE} />
      <Handle type="target"  position={Position.Right}  id="right-target"  style={HANDLE_STYLE} />
      <Handle type="source"  position={Position.Right}  id="right-source"  style={HANDLE_STYLE} />
    </>
  );
}

function GroupNodeComponent({ data }: { data: any }) {
  const color = TYPE_COLORS[data.baseType] || T.stone500;
  const icon = getNodeIcon(data.baseType);

  return (
    <div style={{ position: 'relative' }}>
      <AllHandles />
      <div
        onClick={() => data.onToggle(data.groupKey)}
        style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: data.isDark ? `${color}18` : `${color}10`,
          border: `2px dashed ${color}`,
          minWidth: 165,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={icon} alt={data.baseType} style={{ width: 18, height: 18 }} />
          <span style={{ fontWeight: 600, fontSize: 12, color: data.isDark ? '#e5e7eb' : T.stone900, flex: 1 }}>
            {data.label}
          </span>
          <span style={{ fontSize: 14, color, lineHeight: 1, flexShrink: 0 }}>⊕</span>
        </div>
        <div style={{ fontSize: 10, color: data.isDark ? '#9ca3af' : T.gray, marginTop: 4 }}>
          Click to expand
        </div>
      </div>
    </div>
  );
}

function FocusNodeComponent({ data }: { data: any }) {
  const color = T.emerald;
  const icon = getNodeIcon(data.nodeType, data.metadata);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
      <AllHandles />
      <div style={{
        fontSize: 9, fontWeight: 700, color: T.white, background: color,
        borderRadius: 4, padding: '1px 8px', marginBottom: 6,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        FOCUS
      </div>
      <div style={{
        width: 68, height: 68, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: data.isDark ? '#064e3b' : T.greenLight,
        border: `3px solid ${color}`,
        boxShadow: `0 0 0 6px ${color}1a, 0 4px 16px ${color}30`,
      }}>
        <img src={icon} alt={data.nodeType} style={{ width: 34, height: 34 }} />
      </div>
      <div style={{
        marginTop: 10, fontSize: 13, fontWeight: 700,
        color: data.isDark ? '#e5e7eb' : '#111827',
        textAlign: 'center', maxWidth: 200,
        wordBreak: 'break-word', lineHeight: 1.3,
      }}>
        {data.label}
      </div>
    </div>
  );
}

function IndividualNodeComponent({ data }: { data: any }) {
  const cs = getNodeColorScheme(data.nodeType, data.metadata);
  const icon = getNodeIcon(data.nodeType, data.metadata);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
      <AllHandles />
      <div style={{
        width: 50, height: 50, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: data.isDark ? cs.backgroundDark : cs.background,
        border: `2px solid ${cs.border}`,
        boxShadow: data.isDark
          ? `0 4px 12px rgba(0,0,0,0.4), 0 0 0 3px ${cs.border}18`
          : `0 4px 10px ${cs.border}18, 0 0 0 3px ${cs.border}0d`,
      }}>
        <img src={icon} alt={data.nodeType} style={{ width: 24, height: 24 }} />
      </div>
      <div style={{
        marginTop: 9, fontSize: 11, fontWeight: 600,
        color: data.isDark ? '#e5e7eb' : '#1f2937',
        textAlign: 'center', maxWidth: 150,
        wordBreak: 'break-word', lineHeight: 1.3,
      }}>
        {data.label}
      </div>
    </div>
  );
}

const RF_NODE_TYPES = {
  groupNode: GroupNodeComponent,
  focusNode: FocusNodeComponent,
  individualNode: IndividualNodeComponent,
};

// ── Main component ────────────────────────────────────────────────────────────

export function SecurityGraph({ graph }: SecurityGraphProps) {
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const handleGroupToggle = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const processedNodes = useMemo(
    () => buildProcessedNodes(graph, expandedGroups),
    [graph, expandedGroups],
  );

  const { nodes: rfNodes, edges: rfEdges } = useMemo(
    () => buildReactFlowGraph(processedNodes, graph, hiddenCategories, handleGroupToggle, token, isDark),
    [processedNodes, graph, hiddenCategories, handleGroupToggle, token, isDark],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  // Stats
  const groupedCount = processedNodes
    .filter(pn => pn.kind === 'group')
    .reduce((s, pn) => s + (pn.groupMembers?.length || 0), 0);
  const groupCount = processedNodes.filter(pn => pn.kind === 'group').length;

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (node.type === 'groupNode') {
      setSelectedGroupKey(node.data.groupKey);
      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(node.id);
      setSelectedGroupKey(null);
    }
    setDrawerOpen(true);
  }, []);

  const selectedNode = selectedNodeId ? graph.nodes.find(n => n.id === selectedNodeId) ?? null : null;
  const selectedGroup = selectedGroupKey
    ? processedNodes.find(pn => pn.kind === 'group' && pn.groupKey === selectedGroupKey) ?? null
    : null;

  const toggleCategory = (cat: string) => {
    setHiddenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <>
      {/* Filter bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: token.colorTextSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
            <FilterOutlined style={{ fontSize: 11 }} /> Relationships:
          </span>
          {Object.entries(EDGE_CATEGORIES).map(([cat, { label, color }]) => {
            const hidden = hiddenCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                style={{
                  padding: '3px 12px',
                  borderRadius: 20,
                  border: `1.5px solid ${hidden ? token.colorBorder : color}`,
                  background: hidden ? 'transparent' : `${color}18`,
                  color: hidden ? token.colorTextSecondary : color,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: hidden ? token.colorTextSecondary : color,
                  display: 'inline-block',
                }} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
            <span style={{ fontWeight: 600, color: token.colorText }}>{graph.nodes.length}</span> assets
          </span>
          {groupedCount > 0 && (
            <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
              <span style={{ fontWeight: 600, color: token.colorText }}>{groupedCount}</span> in <span style={{ fontWeight: 600, color: token.colorText }}>{groupCount}</span> group{groupCount !== 1 ? 's' : ''}
            </span>
          )}
          <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
            <span style={{ fontWeight: 600, color: token.colorText }}>{rfEdges.length}</span> relationships
          </span>
          {expandedGroups.size > 0 && (
            <button
              onClick={() => setExpandedGroups(new Set())}
              style={{
                padding: '2px 10px', border: `1px solid ${token.colorBorder}`,
                borderRadius: 6, background: 'transparent', fontSize: 11,
                cursor: 'pointer', color: token.colorTextSecondary,
              }}
            >
              Collapse all
            </button>
          )}
        </div>
      </div>

      {/* Graph canvas */}
      <div style={{
        width: '100%', height: 560,
        backgroundColor: isDark ? '#0a0e1a' : '#fafbfc',
        border: `1px solid ${token.colorBorder}`,
        borderRadius: 8, overflow: 'hidden',
      }}>
        <style>{`.react-flow__handle { opacity: 0 !important; pointer-events: none !important; border: none !important; background: transparent !important; }`}</style>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={RF_NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodesDraggable
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.08}
          maxZoom={2}
          elevateEdgesOnSelect
        >
          <Controls style={{
            backgroundColor: token.colorBgContainer,
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 6,
            boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.1)',
          }} />
          <MiniMap
            style={{
              backgroundColor: token.colorBgContainer,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: 6,
            }}
            nodeColor={() => NODE_COLORS.border}
            maskColor={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.05)'}
          />
          <Background color={isDark ? '#1a1f2e' : '#e5e7eb'} gap={20} size={1} />
        </ReactFlow>
      </div>

      {/* Detail drawer */}
      <Drawer
        title={
          selectedGroup
            ? `${selectedGroup.groupLabel}`
            : selectedNode?.label || ''
        }
        placement="right"
        width={480}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen && (!!selectedGroup || !!selectedNode)}
        closeIcon={<CloseOutlined />}
        styles={{
          header: { borderBottom: `1px solid ${token.colorBorder}`, padding: '16px 24px' },
          body: { padding: 0 },
        }}
      >
        {selectedGroup && (
          <GroupDrawer
            group={selectedGroup}
            onExpandInGraph={() => { handleGroupToggle(selectedGroup.groupKey!); setDrawerOpen(false); }}
            token={token}
            isDark={isDark}
          />
        )}
        {selectedNode && !selectedGroup && (
          <IndividualNodeDrawer
            node={selectedNode}
            graph={graph}
            token={token}
            isDark={isDark}
          />
        )}
      </Drawer>
    </>
  );
}

// ── Group Drawer ──────────────────────────────────────────────────────────────

function GroupDrawer({
  group,
  onExpandInGraph,
  token,
  isDark,
}: {
  group: ProcessedNode;
  onExpandInGraph: () => void;
  token: any;
  isDark: boolean;
}) {
  const members = group.groupMembers || [];
  const color = TYPE_COLORS[group.groupBaseType!] || T.stone500;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <Tag style={{ marginBottom: 8 }}>{group.groupBaseType}</Tag>
        <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 16 }}>
          {members.length} asset{members.length !== 1 ? 's' : ''} grouped.{' '}
          {group.groupKey === 'group:cloud_resource'
            ? 'Expand to see a breakdown by resource type.'
            : 'Expand to see individual nodes in the graph.'}
        </div>
        <Button
          icon={<ExpandOutlined />}
          onClick={onExpandInGraph}
          style={{ borderColor: color, color }}
        >
          {group.groupKey === 'group:cloud_resource' ? 'Expand by Resource Type' : 'Expand in Graph'}
        </Button>
      </div>

      <Title level={5} style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        Assets in this group
      </Title>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {members.map(m => (
          <div
            key={m.id}
            style={{
              background: isDark ? '#0a0e1a' : T.grayLight,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: 8,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <img src={getNodeIcon(m.type, m.metadata)} alt="" style={{ width: 16, height: 16 }} />
              <Text strong style={{ fontSize: 12 }}>{m.label}</Text>
              {m.severity && (
                <Tag color={getSeverityColor(m.severity)} style={{ fontSize: 10, margin: 0 }}>
                  {m.severity.toUpperCase()}
                </Tag>
              )}
              {m.metadata?.riskScore !== undefined && (
                <Tag
                  color={m.metadata.riskScore >= 70 ? 'red' : m.metadata.riskScore >= 40 ? 'orange' : 'green'}
                  style={{ fontSize: 10, margin: 0 }}
                >
                  Risk {m.metadata.riskScore}
                </Tag>
              )}
              {m.metadata?.internetExposed && (
                <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>Internet</Tag>
              )}
            </div>
            {m.metadata?.resourceType && (
              <div style={{ fontSize: 10, color: token.colorTextSecondary, marginTop: 4 }}>
                {m.metadata.resourceType}
              </div>
            )}
            {m.link && (
              <a href={m.link} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: NODE_COLORS.border, display: 'block', marginTop: 6 }}>
                View Resource →
              </a>
            )}
          </div>
        ))}
      </Space>
    </div>
  );
}

// ── Individual Node Drawer ────────────────────────────────────────────────────

function IndividualNodeDrawer({
  node,
  graph,
  token,
  isDark,
}: {
  node: GraphNode;
  graph: GraphProjection;
  token: any;
  isDark: boolean;
}) {
  const relationships = graph.edges
    .filter(e => e.from === node.id || e.to === node.id)
    .map(e => {
      const out = e.from === node.id;
      const otherId = out ? e.to : e.from;
      const other = graph.nodes.find(n => n.id === otherId);
      return { edge: e, isOutgoing: out, other };
    })
    .filter(r => r.other);

  return (
    <div style={{ padding: 24 }}>
      <Space size={6} wrap style={{ marginBottom: 20 }}>
        <Tag style={{ fontWeight: 600, fontSize: 11 }}>{node.type}</Tag>
        {node.severity && (
          <Tag color={getSeverityColor(node.severity)} style={{ fontWeight: 600, fontSize: 11 }}>
            {node.severity.toUpperCase()}
          </Tag>
        )}
        {node.link && (
          <a href={node.link} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: NODE_COLORS.border, padding: '2px 8px', border: `1px solid ${NODE_COLORS.border}`, borderRadius: 4 }}>
            View Source →
          </a>
        )}
      </Space>

      {/* Metadata */}
      {node.metadata && Object.keys(node.metadata).length > 0 && (
        <>
          <Title level={5} style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {node.type === 'Threat' ? 'Threat Details' : 'Resource Information'}
          </Title>
          <div style={{
            background: isDark ? '#0a0e1a' : T.grayLight,
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 8, padding: 16, marginBottom: 20,
          }}>
            {node.metadata.riskScore !== undefined && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Risk Score</Text>
                <div style={{ marginTop: 4 }}>
                  <Tag
                    color={node.metadata.riskScore >= 70 ? 'red' : node.metadata.riskScore >= 40 ? 'orange' : 'green'}
                    style={{ fontSize: 13, fontWeight: 700, padding: '2px 10px' }}
                  >
                    {node.metadata.riskScore}/100
                  </Tag>
                </div>
              </div>
            )}
            {node.metadata.internetExposed !== undefined && (
              <div style={{
                marginBottom: 12, padding: '6px 10px', borderRadius: 4,
                background: node.metadata.internetExposed
                  ? (isDark ? '#431407' : T.orangeLight)
                  : (isDark ? '#064e3b' : T.greenLight),
              }}>
                <Text style={{
                  fontSize: 12, fontWeight: 600,
                  color: node.metadata.internetExposed ? T.orangeHigh : T.emerald,
                }}>
                  {node.metadata.internetExposed ? '🌐 Internet Exposed' : '🔒 Internal Only'}
                </Text>
              </div>
            )}
            {Object.entries(node.metadata)
              .filter(([k]) => !['riskScore', 'internetExposed'].includes(k))
              .map(([key, value]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </Text>
                  <div style={{ marginTop: 2 }}>
                    {typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))
                      ? (
                        <a href={value} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 12, color: NODE_COLORS.border, wordBreak: 'break-all' }}>
                          {value}
                        </a>
                      )
                      : (
                        <Text style={{ fontSize: 12, wordBreak: 'break-word' }}>
                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                        </Text>
                      )
                    }
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {/* Relationships */}
      {relationships.length > 0 && (
        <>
          <Title level={5} style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            Relationships ({relationships.length})
          </Title>
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 20 }}>
            {relationships.map((r, i) => {
              const { color } = getEdgeCategoryStyle(r.edge.type);
              return (
                <div key={i} style={{
                  background: isDark ? '#0a0e1a' : T.grayLight,
                  border: `1px solid ${token.colorBorder}`,
                  borderRadius: 6, padding: '10px 12px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <img src={getNodeIcon(r.other!.type, r.other!.metadata)} alt="" style={{ width: 14, height: 14 }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, color,
                    background: `${color}18`, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                  }}>
                    {r.isOutgoing ? '→' : '←'} {r.edge.type.replace(/_/g, ' ')}
                  </span>
                  <Text style={{ fontSize: 12 }}>{r.other!.label}</Text>
                </div>
              );
            })}
          </Space>
        </>
      )}

      {/* Related Entities */}
      {node.relatedEntities && node.relatedEntities.length > 0 && (
        <>
          <Title level={5} style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            Connected Artifacts
          </Title>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {node.relatedEntities.map(entity => (
              <div
                key={entity.id}
                style={{
                  background: isDark ? '#0a0e1a' : T.grayLight,
                  border: `1px solid ${token.colorBorder}`,
                  borderRadius: 8, padding: 14,
                  cursor: entity.link ? 'pointer' : 'default',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => entity.link && window.open(entity.link, '_blank')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: entity.metadata?.description ? 6 : 0 }}>
                  <img src={getNodeIcon(entity.type, entity.metadata)} alt="" style={{ width: 14, height: 14 }} />
                  <Text strong style={{ fontSize: 12 }}>{entity.label}</Text>
                  <Tag style={{ fontSize: 10, margin: 0 }}>{entity.type}</Tag>
                  <Tag style={{ fontSize: 10, margin: '0 0 0 auto' }}>{entity.relationshipType}</Tag>
                </div>
                {entity.metadata?.description && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{entity.metadata.description}</Text>
                )}
                {entity.link && (
                  <a href={entity.link} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 11, color: NODE_COLORS.border, display: 'block', marginTop: 4 }}>
                    View Resource →
                  </a>
                )}
              </div>
            ))}
          </Space>
        </>
      )}
    </div>
  );
}
