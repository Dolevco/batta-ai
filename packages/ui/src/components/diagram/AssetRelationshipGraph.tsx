/**
 * AssetRelationshipGraph — DFD-style ReactFlow graph for asset relationship visualization.
 *
 * Matches the look & feel of FeatureDiagram:
 * - DFDCompactNode circular icon nodes with DFD node type colours
 * - DFDDataFlowEdge styled edges with arrows
 * - DFDToolbar layer toggles
 * - Same Background, Controls, and Legend
 * - Group containers by entity category
 * - Right-side detail panel overlay on node click
 *
 * Receives a GraphProjection (same shape used by SecurityGraph) and converts
 * it to DFD-compatible ReactFlow nodes/edges.
 */
import React, { useMemo, useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Panel,
  type Node,
  type Edge,
  type NodeChange,
  applyNodeChanges,
  MarkerType,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { DFDCompactNode } from './DFDCompactNode';
import { DFDTrustBoundaryNode } from './DFDTrustBoundaryNode';
import { DFDDataFlowEdge } from './DFDDataFlowEdge';
import { DFDToolbar } from './DFDToolbar';
import { getNodeIcon } from '../../utils/nodeIcons';
import { T } from '../../theme';

// ── ReactFlow type registrations (stable references outside component) ─────────

const nodeTypes = { dfdCompact: DFDCompactNode, dfdBoundary: DFDTrustBoundaryNode };
const edgeTypes = { dfdFlow: DFDDataFlowEdge };

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  type: string;
  label: string;
  severity?: string;
  metadata?: Record<string, any>;
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

export interface AssetRelationshipGraphProps {
  graph: GraphProjection;
  onNodeClick?: (nodeId: string, nodeType: string) => void;
}

// ── Node type → DFD nodeType mapping ─────────────────────────────────────────

function mapToDfdNodeType(entityType: string, label?: string, id?: string): string {
  const t = entityType.toLowerCase();
  // Internet node — its own visual type so it gets a globe icon + blue border
  if (t === 'internetnode' || t === 'internet' || id === 'internet' || label?.toLowerCase() === 'internet') return 'internet';
  if (t.includes('data_store') || t.includes('datastore') || t.includes('database')) return 'data_store';
  // Identity nodes get their own group
  if (t === 'azureidentity' || t === 'azure_identity' || t === 'iamroleassignment' || t === 'iam_role_assignment' || t.includes('identity')) return 'identity';
  if (t.includes('external') || t.includes('user')) return 'external_entity';
  if (t.includes('trust_boundary') || t.includes('network') || t.includes('virtualnetwork') || t.includes('subnet')) return 'trust_boundary';
  // Azure Front Door and other ingress/CDN nodes — show as cloud services
  if (
    t.includes('frontdoor') || t.includes('front_door') ||
    t.includes('trafficmanager') || t.includes('traffic_manager') ||
    t.includes('apimanagement') || t.includes('apim') ||
    t.includes('appgateway') || t.includes('app_gateway') ||
    t.includes('containerapp') || t.includes('container_app') ||
    t.includes('webapp') || t.includes('web_app') ||
    t.includes('storageaccount') || t.includes('storage_account') ||
    t.includes('cloud') || t === 'cloudresource'
  ) return 'service';
  return 'process';
}

// ── Entity category grouping ──────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  internet:        'Internet',
  process:         'Services',
  data_store:      'Data Stores',
  external_entity: 'External',
  identity:        'Identity',
  service:         'Cloud',
  trust_boundary:  'Boundaries',
};

function getGroupKey(node: GraphNode): string {
  return mapToDfdNodeType(node.type, node.label, node.id);
}

// ── Edge type → colour ────────────────────────────────────────────────────────

function edgeColor(edgeType: string): string {
  const t = edgeType.toUpperCase();
  if (['READS_FROM', 'WRITES_TO', 'CONNECTS_TO'].includes(t)) return T.cyan;
  if (['AUTHENTICATES_WITH', 'AUTHORIZES_WITH', 'TRUSTS', 'ASSUMES_ROLE', 'EXPOSED_TO_INTERNET', 'CROSSES_BOUNDARY'].includes(t)) return T.red;
  // IAM / identity relationships
  if (['ASSIGNED_TO', 'HAS_ROLE', 'ASSIGNED_IDENTITY'].includes(t)) return T.purple;
  if (['DEPLOYED_TO', 'USES', 'CONTAINS', 'DEPLOYED_IN', 'PROTECTED_BY'].includes(t)) return T.amber;
  // Ingress/routing edges (AFD, Traffic Manager, APIM) — cyan to show traffic flow
  if (['ROUTES_TO', 'HAS_ENDPOINT', 'HAS_ROUTE', 'HAS_ORIGIN_GROUP', 'HAS_ORIGIN', 'RESOLVES_TO', 'EXPOSES_API', 'HAS_BACKEND'].includes(t)) return T.cyan;
  if (['DEPENDS_ON', 'CALLS', 'IMPORTS'].includes(t)) return T.stone500;
  return T.stone400;
}

function isSecurityEdge(edgeType: string): boolean {
  const t = edgeType.toUpperCase();
  return ['AUTHENTICATES_WITH', 'AUTHORIZES_WITH', 'TRUSTS', 'ASSUMES_ROLE', 'EXPOSED_TO_INTERNET', 'CROSSES_BOUNDARY', 'ASSIGNED_TO', 'HAS_ROLE'].includes(t);
}

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W     = 120;
const NODE_H     = 100;
const H_GAP      = 80;   // horizontal gap between nodes in the same rank
const ROW_H      = 180;  // vertical distance between rank centres
const BAND_PAD_X = 24;   // horizontal padding inside boundary band
const BAND_PAD_Y = 28;   // vertical padding above/below nodes inside band

// ── Rank assignment (edge-aware, Sugiyama-inspired) ───────────────────────────
//
// 1. Build an in-degree map from the edge list.
// 2. Seed the BFS with "root" nodes: nodes whose DFD type is external_entity,
//    nodes explicitly named 'internet', or (fallback) all zero-in-degree nodes.
// 3. BFS assigns rank = max(predecessor rank) + 1  (longest-path rank).
// 4. Nodes unreachable from any root fall back to a rank derived from GROUP_ORDER.

function assignRanks(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const inDegree  = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outEdges  = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const e of edges) {
    if (inDegree.has(e.to))   inDegree.set(e.to,   (inDegree.get(e.to)!   + 1));
    if (outEdges.has(e.from)) outEdges.get(e.from)!.push(e.to);
  }

  const rank = new Map<string, number>();

  // Prefer explicit internet/external nodes as roots; fall back to zero-in-degree
  const roots = nodes.filter((n) => {
    const dfdType = mapToDfdNodeType(n.type, n.label, n.id);
    return dfdType === 'external_entity' || dfdType === 'internet' || n.id.toLowerCase() === 'internet' || n.label.toLowerCase() === 'internet';
  });
  const seedIds = roots.length > 0
    ? roots.map((n) => n.id)
    : nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);

  // BFS — longest-path (use relaxation, not simple BFS, to handle multi-paths)
  for (const id of seedIds) rank.set(id, 0);

  // Topological relaxation: iterate until stable (handles DAG correctly)
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      const srcRank = rank.get(e.from);
      if (srcRank === undefined) continue;
      const newRank = srcRank + 1;
      if ((rank.get(e.to) ?? -1) < newRank) {
        rank.set(e.to, newRank);
        changed = true;
      }
    }
  }

  // Fallback for disconnected nodes: use GROUP_ORDER position as rank
  const GROUP_RANK: Record<string, number> = {
    internet:        0,
    external_entity: 0,
    identity:        1,
    process:         2,
    service:         3,
    data_store:      4,
    trust_boundary:  5,
  };
  for (const n of nodes) {
    if (!rank.has(n.id)) {
      rank.set(n.id, GROUP_RANK[mapToDfdNodeType(n.type, n.label, n.id)] ?? 3);
    }
  }

  return rank;
}

// ── Barycenter sort — reduce edge crossings within a rank ─────────────────────
//
// For each node in rank R, compute the average X of its already-placed
// neighbors in rank R-1. Sort by that average to minimise crossings.

function barycenterSort(
  rankNodes: GraphNode[],
  edges: GraphEdge[],
  placedX: Map<string, number>,
): GraphNode[] {
  const score = (n: GraphNode): number => {
    const neighborXs: number[] = [];
    for (const e of edges) {
      if (e.to === n.id && placedX.has(e.from))   neighborXs.push(placedX.get(e.from)!);
      if (e.from === n.id && placedX.has(e.to))   neighborXs.push(placedX.get(e.to)!);
    }
    if (neighborXs.length === 0) return Infinity; // no neighbors yet → stable sort to end
    return neighborXs.reduce((a, b) => a + b, 0) / neighborXs.length;
  };
  return [...rankNodes].sort((a, b) => score(a) - score(b));
}

// ── Layout builder ────────────────────────────────────────────────────────────

function buildLayout(
  inputNodes: GraphNode[],
  inputEdges: GraphEdge[],
  focusNodeId: string | undefined,
  showBoundaries: boolean,
  showProtocols: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

  // Filter out orphaned nodes (nodes not referenced by any edge)
  const connectedIds = new Set<string>();
  for (const e of inputEdges) {
    connectedIds.add(e.from);
    connectedIds.add(e.to);
  }
  inputNodes = inputNodes.filter((n) => connectedIds.has(n.id));

  // 1. Assign a rank (layer) to every node based on graph topology
  const rankMap = assignRanks(inputNodes, inputEdges);

  // 2. Group nodes by rank
  const byRank = new Map<number, GraphNode[]>();
  for (const n of inputNodes) {
    const r = rankMap.get(n.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(n);
  }

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);

  // 3. Place nodes rank by rank, top→bottom
  const placedX = new Map<string, number>(); // nodeId → final X centre (for barycenter)

  for (const r of sortedRanks) {
    const rankNodes = byRank.get(r)!;

    // Sort within rank to minimise crossings
    const sorted = barycenterSort(rankNodes, inputEdges, placedX);

    // Total row width
    const rowW = sorted.length * NODE_W + (sorted.length - 1) * H_GAP;
    const startX = -rowW / 2;
    const rowY   = r * ROW_H;

    sorted.forEach((n, i) => {
      const x = startX + i * (NODE_W + H_GAP);
      const y = rowY;
      placedX.set(n.id, x + NODE_W / 2);
      rfNodes.push(makeDfdNode(n, x, y, n.id === focusNodeId));
    });
  }

  // 4. Boundary bands — one horizontal band per rank (shown when showBoundaries=true)
  //    Each band spans the full width of its rank row.
  if (showBoundaries) {
    for (const r of sortedRanks) {
      const rankNodes = byRank.get(r)!;
      if (rankNodes.length === 0) continue;

      // Determine the dominant DFD group for label/theme
      const groupCounts = new Map<string, number>();
      for (const n of rankNodes) {
        const g = getGroupKey(n);
        groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
      }
      const dominantGroup = [...groupCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

      const rowW   = rankNodes.length * NODE_W + (rankNodes.length - 1) * H_GAP;
      const bandW  = rowW + BAND_PAD_X * 2;
      const bandX  = -rowW / 2 - BAND_PAD_X;
      const bandY  = r * ROW_H - BAND_PAD_Y;
      const bandH  = NODE_H + BAND_PAD_Y * 2;

      rfNodes.push({
        id: `group-rank-${r}`,
        type: 'dfdBoundary',
        position: { x: bandX, y: bandY },
        data: {
          label: GROUP_LABELS[dominantGroup] ?? dominantGroup,
          theme: groupTheme(dominantGroup),
          visible: true,
        },
        style: { width: bandW, height: bandH, zIndex: -1 },
        selectable: false,
      });
    }
  }

  // 5. Edges
  inputEdges.forEach((e, i) => {
    const color  = edgeColor(e.type);
    const isSec  = isSecurityEdge(e.type);
    const label  = e.label || formatEdgeType(e.type);

    rfEdges.push({
      id: e.id || `edge-${i}`,
      source: e.from,
      target: e.to,
      type: 'dfdFlow',
      label: showProtocols ? label : undefined,
      data: {
        protocol: label,
        encrypted: !isSec,
        crossesTrustBoundary: isSec,
        showProtocols,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      },
      style: {
        stroke: color,
        strokeWidth: isSec ? 2 : 1.5,
        strokeDasharray: isSec && e.confidence !== 'deterministic' ? '6 3' : undefined,
      },
    });
  });

  return { nodes: rfNodes, edges: rfEdges };
}

function groupTheme(groupKey: string): 'internal' | 'dmz' | 'external' | 'public' {
  if (groupKey === 'internet' || groupKey === 'external_entity') return 'external';
  if (groupKey === 'identity') return 'dmz';
  if (groupKey === 'data_store') return 'public';
  if (groupKey === 'trust_boundary') return 'dmz';
  return 'internal';
}

function makeDfdNode(n: GraphNode, x: number, y: number, isFocus: boolean): Node {
  const dfdType = mapToDfdNodeType(n.type, n.label, n.id);
  const iconUrl = getNodeIcon(n.type, { ...n.metadata, id: n.id, _label: n.label });
  return {
    id: n.id,
    type: 'dfdCompact',
    position: { x, y },
    data: {
      label: n.label,
      nodeType: dfdType,
      description: n.type.replace(/_/g, ' '),
      riskCount: n.severity === 'critical' || n.severity === 'high' ? 1 : 0,
      isFocus,
      iconUrl,
    },
    style: isFocus ? { filter: `drop-shadow(0 0 8px ${T.orange}80)` } : undefined,
  };
}

function formatEdgeType(t: string): string {
  if (t.toUpperCase() === 'HAS_ROLE') return 'Has Access to';
  return t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Legend ─────────────────────────────────────────────────────────────────────

function Legend() {
  const rows = [
    { color: T.cyan,    label: 'Data flow',        dash: false },
    { color: T.red,     label: 'Security boundary', dash: true  },
    { color: T.purple,  label: 'IAM / identity',    dash: false },
    { color: T.amber,   label: 'Infrastructure',    dash: false },
    { color: T.stone500,label: 'Dependency',        dash: false },
  ];
  return (
    <div style={{
      background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(6px)',
      border: `1px solid ${T.stone200}`, borderRadius: 10,
      padding: '8px 12px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', minWidth: 180,
    }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: T.stone400, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
        Legend
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <svg width="28" height="10" viewBox="0 0 28 10" style={{ flexShrink: 0 }}>
            <line x1="0" y1="5" x2="22" y2="5" stroke={r.color} strokeWidth="2" strokeDasharray={r.dash ? '4 2' : undefined} />
            <polygon points="22,2 28,5 22,8" fill={r.color} />
          </svg>
          <span style={{ fontSize: 9, color: T.stone500, lineHeight: 1.3 }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────────

function GraphBadge() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
      border: `1px solid ${T.stone200}`, borderRadius: 6,
      padding: '3px 8px', fontFamily: 'monospace',
      fontSize: 10, fontWeight: 700, color: T.stone500,
      letterSpacing: '0.06em', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      REL
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyGraph() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 12,
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={T.stone300} strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" />
      </svg>
      <span style={{ fontSize: 13, color: T.stone400 }}>No relationship data available</span>
    </div>
  );
}

// ── Node detail side panel ────────────────────────────────────────────────────

interface SelectedNodeInfo {
  id: string;
  label: string;
  type: string;
  dfdType: string;
  severity?: string;
  metadata?: Record<string, any>;
  link?: string;
  iconUrl: string;
}

function NodeDetailPanel({
  node,
  onClose,
}: {
  node: SelectedNodeInfo;
  onClose: () => void;
}) {
  const sev = node.severity?.toLowerCase() as 'critical' | 'high' | 'medium' | 'low' | undefined;
  const sevColors: Record<string, { color: string; bg: string; border: string }> = {
    critical: { color: T.red,        bg: T.redLight,        border: T.redBorder        },
    high:     { color: T.orangeHigh, bg: T.orangeHighLight, border: T.orangeHighBorder },
    medium:   { color: T.amber,      bg: T.amberLight,      border: T.amberBorder      },
    low:      { color: T.green,      bg: T.greenLight,      border: T.greenBorder      },
  };
  const sc = sev ? sevColors[sev] : null;

  const metaEntries = Object.entries(node.metadata ?? {}).filter(
    ([k]) => !['id', 'name', 'label', 'type'].includes(k),
  );

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 280, zIndex: 40,
      display: 'flex', flexDirection: 'column',
      background: T.white,
      borderLeft: `1px solid ${T.stone200}`,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: `1px solid ${T.stone200}`,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        flexShrink: 0,
      }}>
        <img
          src={node.iconUrl}
          alt=""
          style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0, marginTop: 2 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.stone900, lineHeight: 1.3, wordBreak: 'break-word' }}>
            {node.label}
          </div>
          <div style={{
            marginTop: 4, display: 'inline-block',
            fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
            background: T.stone100, color: T.stone600, border: `1px solid ${T.stone200}`,
            fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {node.type.replace(/_/g, ' ')}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, borderRadius: 6, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer', color: T.stone400,
            fontSize: 16, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Severity */}
        {sc && sev && (
          <div style={{
            padding: '8px 12px', borderRadius: 8,
            background: sc.bg, border: `1px solid ${sc.border}`,
            borderLeft: `3px solid ${sc.color}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc.color, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: sc.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {sev} severity
            </span>
          </div>
        )}

        {/* Link */}
        {node.link && (() => {
          const isIdentityType = node.type.toLowerCase().includes('identity') || node.type.toLowerCase().includes('iam');
          const isCloudType = node.type.toLowerCase().includes('cloud') || node.type.toLowerCase() === 'cloudresource';
          const linkLabel = isIdentityType
            ? 'Open in Entra ID'
            : isCloudType
            ? 'Azure Portal'
            : 'Repository';
          return (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.stone400, marginBottom: 6 }}>
                {linkLabel}
              </div>
              <a
                href={node.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: T.blue, wordBreak: 'break-all' }}
              >
                {node.link}
              </a>
            </div>
          );
        })()}

        {/* Metadata */}
        {metaEntries.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.stone400, marginBottom: 6 }}>
              Properties
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {metaEntries.map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '5px 0', borderBottom: `1px solid ${T.stone50}`,
                }}>
                  <span style={{ fontSize: 11, color: T.stone400, minWidth: 90, flexShrink: 0, lineHeight: 1.4 }}>
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: 11, color: T.stone700, flex: 1, wordBreak: 'break-word', lineHeight: 1.4 }}>
                    {typeof v === 'object' ? (
                      <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{JSON.stringify(v)}</span>
                    ) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node ID */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.stone400, marginBottom: 4 }}>
            ID
          </div>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: T.stone500, wordBreak: 'break-all' }}>
            {node.id}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AssetRelationshipGraph({ graph, onNodeClick }: AssetRelationshipGraphProps) {
  const [showProtocols,  setShowProtocols]  = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showRisks,      setShowRisks]      = useState(false);

  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);

  const { nodes: layoutNodes, edges } = useMemo(
    () => buildLayout(graph.nodes, graph.edges, graph.focusNodeId, showBoundaries, showProtocols),
    [graph.nodes, graph.edges, graph.focusNodeId, showBoundaries, showProtocols],
  );

  const [nodes, setNodes] = useState<Node[]>(layoutNodes);

  // Sync layout into state when it changes (e.g. toolbar toggles reset positions)
  const diagramKey = `${showBoundaries ? 'tb' : 'ntb'}-${showProtocols ? 'p' : 'np'}-${graph.nodes.length}`;
  const prevKeyRef = React.useRef(diagramKey);
  if (prevKeyRef.current !== diagramKey) {
    prevKeyRef.current = diagramKey;
    setNodes(layoutNodes);
  }

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const handleNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    // Skip group container clicks
    if (node.type === 'dfdBoundary') return;

    const srcNode = graph.nodes.find((n) => n.id === node.id);
    if (!srcNode) return;

    const dfdType = mapToDfdNodeType(srcNode.type, srcNode.label, srcNode.id);
    const iconUrl = getNodeIcon(srcNode.type, { ...srcNode.metadata, id: srcNode.id, _label: srcNode.label });

    setSelectedNode({
      id: srcNode.id,
      label: srcNode.label,
      type: srcNode.type,
      dfdType,
      severity: srcNode.severity,
      metadata: srcNode.metadata,
      link: srcNode.link,
      iconUrl,
    });

    onNodeClick?.(node.id, dfdType);
  }, [graph.nodes, onNodeClick]);

  const handlePaneClick = useCallback(() => setSelectedNode(null), []);

  if (!graph.nodes.length) return <EmptyGraph />;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        key={diagramKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={28} size={0.5} color="#EBEBEB" variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} style={{ bottom: 12, left: 12 }} />

        <Panel position="top-left">
          <DFDToolbar
            showBoundaries={showBoundaries}
            showRisks={showRisks}
            showProtocols={showProtocols}
            onToggleBoundaries={() => setShowBoundaries((v) => !v)}
            onToggleRisks={() => setShowRisks((v) => !v)}
            onToggleProtocols={() => setShowProtocols((v) => !v)}
          />
        </Panel>

        <Panel position="top-right">
          <GraphBadge />
        </Panel>

        <Panel position="bottom-right">
          {!selectedNode && <Legend />}
        </Panel>
      </ReactFlow>

      {/* Right-side node detail panel overlay */}
      {selectedNode && (
        <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}
    </div>
  );
}
