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

export interface GraphProjection {
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

function mapToDfdNodeType(entityType: string): string {
  const t = entityType.toLowerCase();
  if (t.includes('data_store') || t.includes('datastore') || t.includes('database')) return 'data_store';
  // Identity nodes get their own group
  if (t === 'azureidentity' || t === 'azure_identity' || t === 'iamroleassignment' || t === 'iam_role_assignment' || t.includes('identity')) return 'identity';
  if (t.includes('external') || t.includes('user')) return 'external_entity';
  if (t.includes('trust_boundary') || t.includes('network')) return 'trust_boundary';
  if (t.includes('cloud') || t === 'cloudresource') return 'service';
  return 'process';
}

// ── Entity category grouping ──────────────────────────────────────────────────

const GROUP_ORDER = [
  'external_entity',
  'identity',
  'process',
  'service',
  'data_store',
  'trust_boundary',
];

const GROUP_LABELS: Record<string, string> = {
  process:         'Services',
  data_store:      'Data Stores',
  external_entity: 'External',
  identity:        'Identity',
  service:         'Cloud',
  trust_boundary:  'Boundaries',
};

function getGroupKey(node: GraphNode): string {
  return mapToDfdNodeType(node.type);
}

// ── Edge type → colour ────────────────────────────────────────────────────────

function edgeColor(edgeType: string): string {
  const t = edgeType.toUpperCase();
  if (['READS_FROM', 'WRITES_TO', 'CONNECTS_TO'].includes(t)) return T.cyan;
  if (['AUTHENTICATES_WITH', 'AUTHORIZES_WITH', 'TRUSTS', 'ASSUMES_ROLE', 'EXPOSED_TO_INTERNET', 'CROSSES_BOUNDARY'].includes(t)) return T.red;
  // IAM / identity relationships — amber to distinguish from pure security violations
  if (['ASSIGNED_TO', 'HAS_ROLE'].includes(t)) return T.purple;
  if (['DEPLOYED_TO', 'USES', 'CONTAINS'].includes(t)) return T.amber;
  if (['DEPENDS_ON', 'CALLS', 'IMPORTS'].includes(t)) return T.stone500;
  return T.stone400;
}

function isSecurityEdge(edgeType: string): boolean {
  const t = edgeType.toUpperCase();
  return ['AUTHENTICATES_WITH', 'AUTHORIZES_WITH', 'TRUSTS', 'ASSUMES_ROLE', 'EXPOSED_TO_INTERNET', 'CROSSES_BOUNDARY', 'ASSIGNED_TO', 'HAS_ROLE'].includes(t);
}

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W    = 120;
const NODE_H    = 100;
const V_GAP     = 48;
const H_GAP     = 100;
const TB_PAD_X  = 32;
const TB_PAD_TOP = 52;
const TB_PAD_BOT = 28;

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

  // Group nodes by category
  const groups = new Map<string, GraphNode[]>();
  for (const n of inputNodes) {
    const key = getGroupKey(n);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  // Sort groups by preferred order; focus node's group goes first if focus exists
  const focusGroup = focusNodeId
    ? getGroupKey(inputNodes.find((n) => n.id === focusNodeId) ?? inputNodes[0])
    : null;

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === focusGroup) return -1;
    if (b === focusGroup) return 1;
    return GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b);
  });

  // Compute canvas height so all columns can be vertically centred
  const groupHeights = sortedGroups.map(([, gnodes]) => {
    const innerH = gnodes.length * NODE_H + (gnodes.length - 1) * V_GAP;
    return innerH + TB_PAD_TOP + TB_PAD_BOT;
  });
  const canvasH = Math.max(...groupHeights, 200) + 80;

  // Layout: columns of group containers, left→right
  let cursorX = 0;

  sortedGroups.forEach(([groupKey, gnodes], idx) => {
    const innerH = gnodes.length * NODE_H + (gnodes.length - 1) * V_GAP;
    const boxW = NODE_W + TB_PAD_X * 2;
    const boxH = innerH + TB_PAD_TOP + TB_PAD_BOT;
    const boxY = Math.round((canvasH - boxH) / 2);

    const groupId = `group-${groupKey}`;
    rfNodes.push({
      id: groupId,
      type: 'dfdBoundary',
      position: { x: cursorX, y: boxY },
      data: { label: GROUP_LABELS[groupKey] ?? groupKey, theme: groupTheme(groupKey), visible: showBoundaries },
      style: { width: boxW, height: boxH, zIndex: -1 },
      selectable: false,
    });

    gnodes.forEach((n, i) => {
      const isFocus = n.id === focusNodeId;
      // Absolute positions (no parent constraint so nodes can be dragged freely)
      rfNodes.push(
        makeDfdNode(n, cursorX + TB_PAD_X, boxY + TB_PAD_TOP + i * (NODE_H + V_GAP), isFocus),
      );
    });

    cursorX += boxW + H_GAP;
    void idx; // suppress unused warning
  });

  // Edges
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
  if (groupKey === 'external_entity') return 'external';
  if (groupKey === 'identity') return 'dmz';
  if (groupKey === 'data_store') return 'public';
  if (groupKey === 'trust_boundary') return 'dmz';
  return 'internal';
}

function makeDfdNode(n: GraphNode, x: number, y: number, isFocus: boolean): Node {
  const dfdType = mapToDfdNodeType(n.type);
  const iconUrl = getNodeIcon(n.type, n.metadata);
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

    const dfdType = mapToDfdNodeType(srcNode.type);
    const iconUrl = getNodeIcon(srcNode.type, srcNode.metadata);

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
