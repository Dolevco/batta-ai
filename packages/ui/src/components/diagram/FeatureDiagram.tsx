/**
 * FeatureDiagram — ReactFlow data-flow diagram for a BusinessFeature.
 *
 * Layout model (left → right):
 *   [External Actors] │ [Trust Boundary zone 1] │ [Trust Boundary zone 2…] │ [Data Stores]
 *
 * Design decisions:
 * - dfd.trustBoundaries is the AUTHORITATIVE list; every name always gets a container node.
 * - DFDProcess.trustBoundary assigns processes to zones (required).
 * - DFDActor.trustBoundary assigns actors to zones (optional; new field).
 * - DFDDataStore.trustBoundary assigns stores to zones (optional; new field).
 * - Semantic fallback: untrusted actors → "internet"/"external" boundary if present.
 * - Semantic fallback: data stores → "data"/"storage"/"db" boundary if present.
 * - inferBoundary() checks the full node→boundary map so stores/actors connected
 *   exclusively to one zone's nodes are placed inside it.
 * - showBoundaries / showProtocols / showRisks all force a full remount via `key`.
 * - We pass nodes/edges directly to ReactFlow (no useNodesState) so updates are instant.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Panel,
  type Node,
  type Edge,
  MarkerType,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { DFDCompactNode } from './DFDCompactNode';
import { DFDTrustBoundaryNode } from './DFDTrustBoundaryNode';
import { DFDDataFlowEdge } from './DFDDataFlowEdge';
import { DFDToolbar } from './DFDToolbar';
import { FlowPlaybackControls } from './FlowPlaybackControls';
import type { BusinessFeature, FeatureDataFlowDiagram, DFDFlow } from '../../types';
import { T } from '../../theme';

// ── Playback auto-advance interval (ms) ──────────────────────────────────────
const PLAYBACK_INTERVAL_MS = 2400;

// ── ReactFlow registrations (MUST be stable references outside component) ────

const nodeTypes = {
  dfdCompact:  DFDCompactNode,
  dfdBoundary: DFDTrustBoundaryNode,
};

const edgeTypes = {
  dfdFlow: DFDDataFlowEdge,
};

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W     = 120;  // width of a compact node
const NODE_H     = 100;  // height of a compact node
const V_GAP      = 36;   // vertical gap between sibling nodes
const H_GAP      = 100;  // horizontal gap between columns / groups
const TB_PAD_X   = 36;   // horizontal inner padding inside a boundary box
const TB_PAD_TOP = 52;   // top padding (space for the label tab)
const TB_PAD_BOT = 32;   // bottom padding

// ── Colour theme helper ───────────────────────────────────────────────────────

function boundaryTheme(name: string): 'internal' | 'dmz' | 'external' | 'public' | 'identity' | 'service' {
  switch (name.toUpperCase()) {
    case 'INTERNET':  return 'external';
    case 'IDENTITY':  return 'identity';
    case 'SERVICE':   return 'service';
    case 'DATA':      return 'public';
    case 'EXTERNAL':  return 'dmz';
    // Legacy fallback for any old free-form names still in the DB
    default: {
      const n = name.toLowerCase();
      if (n.includes('dmz') || n.includes('perimeter') || n.includes('edge')) return 'dmz';
      if (n.includes('internet') || n.includes('external') || n.includes('client') || n.includes('public')) return 'external';
      if (n.includes('data') || n.includes('storage') || n.includes('db') || n.includes('persist')) return 'public';
      if (n.includes('identity') || n.includes('auth') || n.includes('sso')) return 'identity';
      if (n.includes('service') || n.includes('internal')) return 'service';
      return 'internal';
    }
  }
}

// ── Node boundary inference ───────────────────────────────────────────────────
// Returns the single trust boundary ALL connections of nodeId belong to,
// or null if connections span multiple boundaries (or there are none).
// allNodeBoundaryMap covers actors + processes + data stores.

function inferBoundary(
  nodeId: string,
  allNodeBoundaryMap: Map<string, string>,
  flows: DFDFlow[],
): string | null {
  const connectedBoundaries = new Set<string>();
  for (const f of flows) {
    const peer = f.from === nodeId ? f.to : f.to === nodeId ? f.from : null;
    if (!peer) continue;
    const tb = allNodeBoundaryMap.get(peer);
    if (tb) connectedBoundaries.add(tb);
  }
  return connectedBoundaries.size === 1 ? [...connectedBoundaries][0] : null;
}

// ── Semantic boundary name matching ──────────────────────────────────────────
// Finds the best-matching boundary name for a given semantic zone type.
// Returns null if no matching boundary is found.

function findSemanticBoundary(
  type: 'internet' | 'data',
  boundaryNames: string[],
): string | null {
  // Primary: canonical enum values
  if (type === 'internet') {
    if (boundaryNames.includes('INTERNET')) return 'INTERNET';
    if (boundaryNames.includes('EXTERNAL')) return 'EXTERNAL';
  } else {
    if (boundaryNames.includes('DATA')) return 'DATA';
  }

  // Legacy fallback for old free-form names still in the DB
  const internetKeywords = ['internet', 'external', 'client', 'public', 'untrusted'];
  const dataKeywords     = ['data', 'storage', 'db', 'persist', 'database', 'store'];
  const keywords = type === 'internet' ? internetKeywords : dataKeywords;

  for (const name of boundaryNames) {
    const n = name.toLowerCase();
    if (keywords.some((k) => n === k || n.includes(k))) return name;
  }
  return null;
}

// ── Layout builder ────────────────────────────────────────────────────────────

function buildLayout(
  dfd: FeatureDataFlowDiagram,
  showBoundaries: boolean,
  showProtocols: boolean,
  playbackStep: number | null,   // null = no playback; number = 0-based active flow index
): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

  // ── 1. Build comprehensive node → boundary map ───────────────────────────
  // Priority: explicit trustBoundary field > process assignment.
  // This covers actors, processes, AND data stores so that inferBoundary()
  // can trace connections across all node types.
  const allNodeBoundaryMap = new Map<string, string>();
  for (const p of dfd.processes) {
    if (p.trustBoundary) allNodeBoundaryMap.set(p.id, p.trustBoundary);
  }
  for (const a of dfd.actors) {
    if (a.trustBoundary) {
      allNodeBoundaryMap.set(a.id, a.trustBoundary);
    }
  }
  for (const ds of dfd.dataStores) {
    if (ds.trustBoundary) {
      allNodeBoundaryMap.set(ds.id, ds.trustBoundary);
    }
  }

  // ── 2. Canonical boundary list (from dfd.trustBoundaries + any orphan refs) ──
  const allBoundaryNames: string[] = [];
  const seenBoundaries = new Set<string>();
  for (const tb of (dfd.trustBoundaries ?? [])) {
    if (tb && !seenBoundaries.has(tb)) { seenBoundaries.add(tb); allBoundaryNames.push(tb); }
  }
  // Also pick up any boundary names referenced on processes/actors/stores not in the list
  for (const p of dfd.processes) {
    if (p.trustBoundary && !seenBoundaries.has(p.trustBoundary)) {
      seenBoundaries.add(p.trustBoundary); allBoundaryNames.push(p.trustBoundary);
    }
  }
  for (const a of dfd.actors) {
    const tb = a.trustBoundary;
    if (tb && !seenBoundaries.has(tb)) { seenBoundaries.add(tb); allBoundaryNames.push(tb); }
  }
  for (const ds of dfd.dataStores) {
    const tb = ds.trustBoundary;
    if (tb && !seenBoundaries.has(tb)) { seenBoundaries.add(tb); allBoundaryNames.push(tb); }
  }

  // ── 3. Assign processes to boundaries ────────────────────────────────────
  const procsByBoundary = new Map<string, typeof dfd.processes>();
  for (const tb of allBoundaryNames) procsByBoundary.set(tb, []);
  const unassignedProcs: typeof dfd.processes = [];
  for (const p of dfd.processes) {
    const tb = p.trustBoundary ?? '';
    if (tb && procsByBoundary.has(tb)) procsByBoundary.get(tb)!.push(p);
    else unassignedProcs.push(p);
  }

  // ── 4. Assign actors ─────────────────────────────────────────────────────
  // Priority order:
  //   1. actor.trustBoundary (explicit) → place inside that boundary.
  //   2. inferBoundary (all connections to one zone) → place inside that zone.
  //   3. Semantic fallback for untrusted actors → "internet"/"external" boundary.
  //   4. Otherwise → left external column.
  const externalActors: typeof dfd.actors = [];
  const actorBoundaryMap = new Map<string, string>();

  // Pre-compute the semantic internet boundary (if any) for the fallback
  const internetBoundary = findSemanticBoundary('internet', allBoundaryNames);

  for (const actor of dfd.actors) {
    // 1. Explicit trustBoundary field
    const explicitTB = actor.trustBoundary;
    if (explicitTB && seenBoundaries.has(explicitTB)) {
      actorBoundaryMap.set(actor.id, explicitTB);
      continue;
    }

    // 2. Infer from connections (works for trusted internal actors that connect to one zone)
    const inferred = inferBoundary(actor.id, allNodeBoundaryMap, dfd.flows);
    if (inferred && seenBoundaries.has(inferred)) {
      actorBoundaryMap.set(actor.id, inferred);
      continue;
    }

    // 3. Semantic fallback: untrusted actors → internet boundary
    if (!actor.trusted && internetBoundary) {
      actorBoundaryMap.set(actor.id, internetBoundary);
      continue;
    }

    // 4. Fallback → external column
    externalActors.push(actor);
  }

  // ── 5. Assign data stores ─────────────────────────────────────────────────
  // Priority order:
  //   1. ds.trustBoundary (explicit) → place inside that boundary.
  //   2. inferBoundary (all connections to one zone) → place inside that zone.
  //   3. Semantic fallback → "data"/"storage"/"db" boundary if present.
  //   4. Otherwise → standalone right column.
  const standaloneStores: typeof dfd.dataStores = [];
  const storeBoundaryMap = new Map<string, string>();

  // Pre-compute the semantic data boundary (if any)
  const dataBoundary = findSemanticBoundary('data', allBoundaryNames);

  for (const ds of dfd.dataStores) {
    // 1. Explicit trustBoundary field
    const explicitTB = ds.trustBoundary;
    if (explicitTB && seenBoundaries.has(explicitTB)) {
      storeBoundaryMap.set(ds.id, explicitTB);
      continue;
    }

    // 2. Infer from connections
    const inferred = inferBoundary(ds.id, allNodeBoundaryMap, dfd.flows);
    if (inferred && seenBoundaries.has(inferred)) {
      storeBoundaryMap.set(ds.id, inferred);
      continue;
    }

    // 3. Semantic fallback: data stores → data/storage boundary
    if (dataBoundary) {
      storeBoundaryMap.set(ds.id, dataBoundary);
      continue;
    }

    // 4. Fallback → standalone column
    standaloneStores.push(ds);
  }

  // ── 6. Compute heights ───────────────────────────────────────────────────
  function colHeight(count: number) {
    if (count === 0) return 0;
    return count * NODE_H + (count - 1) * V_GAP;
  }

  // Per-boundary: collect all nodes that will go inside
  const boundaryContents = new Map<string, Array<{ id: string; label: string; nodeType: string; extra: Record<string, unknown> }>>(); 
  for (const tb of allBoundaryNames) {
    const nodes: Array<{ id: string; label: string; nodeType: string; extra: Record<string, unknown> }> = [];
    // Trusted actors first
    for (const a of dfd.actors) {
      if (actorBoundaryMap.get(a.id) === tb) {
        nodes.push({ id: a.id, label: a.label, nodeType: a.trusted ? 'service' : 'external_entity', extra: { description: a.type } });
      }
    }
    // Processes
    for (const p of (procsByBoundary.get(tb) ?? [])) {
      nodes.push({ id: p.id, label: p.label, nodeType: 'process', extra: { description: p.type } });
    }
    // Data stores
    for (const ds of dfd.dataStores) {
      if (storeBoundaryMap.get(ds.id) === tb) {
        nodes.push({ id: ds.id, label: ds.label, nodeType: 'data_store', extra: { description: ds.type, dataClassification: ds.dataClassification } });
      }
    }
    boundaryContents.set(tb, nodes);
  }

  const groupTotalHeights = allBoundaryNames.map((tb) => {
    const n = (boundaryContents.get(tb) ?? []).length;
    const inner = n > 0 ? colHeight(n) : NODE_H;
    return inner + TB_PAD_TOP + TB_PAD_BOT;
  });

  const extActorH = colHeight(externalActors.length);
  const standaloneH = colHeight(standaloneStores.length);
  const unassignedH = colHeight(unassignedProcs.length);
  const canvasH = Math.max(extActorH, standaloneH, unassignedH, ...groupTotalHeights, 200) + 80;

  // ── 7. Place nodes ───────────────────────────────────────────────────────
  let curX = 0;

  // External actors (left column)
  if (externalActors.length > 0) {
    const startY = Math.round((canvasH - extActorH) / 2);
    externalActors.forEach((actor, i) => {
      rfNodes.push({
        id: actor.id,
        type: 'dfdCompact',
        position: { x: curX, y: startY + i * (NODE_H + V_GAP) },
        data: { label: actor.label, nodeType: actor.trusted ? 'service' : 'external_entity', description: actor.type, riskCount: 0 },
      });
    });
    curX += NODE_W + H_GAP;
  }

  // Trust boundary groups
  allBoundaryNames.forEach((tbName, tbIdx) => {
    const contents = boundaryContents.get(tbName) ?? [];
    const totalH = groupTotalHeights[tbIdx];
    const groupW = NODE_W + TB_PAD_X * 2;
    const groupY = Math.round((canvasH - totalH) / 2);
    const groupId = `tb-group-${tbIdx}`;

    // Parent boundary node
    rfNodes.push({
      id: groupId,
      type: 'dfdBoundary',
      position: { x: curX, y: groupY },
      data: {
        label: tbName,
        theme: boundaryTheme(tbName),
        visible: showBoundaries,
      },
      style: { width: groupW, height: totalH, zIndex: -1 },
      selectable: false,
      draggable: false,
    });

    // Child nodes — positions are RELATIVE to parent
    contents.forEach((node, i) => {
      rfNodes.push({
        id: node.id,
        type: 'dfdCompact',
        position: {
          x: TB_PAD_X,
          y: TB_PAD_TOP + i * (NODE_H + V_GAP),
        },
        data: {
          label: node.label,
          nodeType: node.nodeType,
          riskCount: 0,
          ...node.extra,
        },
        parentNode: groupId,
        extent: 'parent' as const,
      });
    });

    curX += groupW + H_GAP;
  });

  // Unassigned processes (no boundary at all)
  if (unassignedProcs.length > 0) {
    const startY = Math.round((canvasH - unassignedH) / 2);
    unassignedProcs.forEach((p, i) => {
      rfNodes.push({
        id: p.id,
        type: 'dfdCompact',
        position: { x: curX, y: startY + i * (NODE_H + V_GAP) },
        data: { label: p.label, nodeType: 'process', description: p.type, riskCount: 0 },
      });
    });
    curX += NODE_W + H_GAP;
  }

  // Standalone data stores (right column)
  if (standaloneStores.length > 0) {
    const startY = Math.round((canvasH - standaloneH) / 2);
    standaloneStores.forEach((ds, i) => {
      rfNodes.push({
        id: ds.id,
        type: 'dfdCompact',
        position: { x: curX, y: startY + i * (NODE_H + V_GAP) },
        data: { label: ds.label, nodeType: 'data_store', description: ds.type, dataClassification: ds.dataClassification, riskCount: 0 },
      });
    });
  }

  // ── 8. Edges ──────────────────────────────────────────────────────────────
  const isPlaybackMode = playbackStep !== null;

  dfd.flows.forEach((flow: DFDFlow, i) => {
    const isActive    = isPlaybackMode && i === playbackStep;
    const isPast      = isPlaybackMode && i < (playbackStep ?? 0);
    const isFuture    = isPlaybackMode && i > (playbackStep ?? 0);
    const isEncrypted = flow.encrypted;
    const crossesTB   = flow.crossesTrustBoundary;

    // In playback mode: active = vivid brand colors, past = muted, future = very light
    let strokeColor: string;
    if (!isPlaybackMode) {
      strokeColor = isEncrypted ? T.emerald : crossesTB ? T.orangeHigh : T.stone400;
    } else if (isActive) {
      strokeColor = isEncrypted ? T.emerald : crossesTB ? T.orangeHigh : T.orange;
    } else if (isPast) {
      strokeColor = T.stone300;
    } else {
      strokeColor = T.stone300;
    }

    const strokeWidth = isPlaybackMode
      ? isActive ? 2.5 : isPast ? 1.5 : 1
      : crossesTB ? 2 : 1.5;

    const opacity = isPlaybackMode
      ? isActive ? 1 : isFuture ? 0.25 : 0.5
      : 1;

    rfEdges.push({
      id: flow.id ?? `flow-${i}`,
      source: flow.from,
      target: flow.to,
      type: 'dfdFlow',
      label: flow.label || undefined,
      data: {
        protocol: flow.protocol,
        encrypted: isEncrypted,
        dataTypes: flow.dataTypes,
        authenticationRequired: flow.authenticationRequired,
        crossesTrustBoundary: crossesTB,
        showProtocols,
        // Playback overlay data
        playbackActive: isActive,
        playbackStep: isPlaybackMode ? i + 1 : undefined,
        playbackMode: isPlaybackMode,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: isActive ? 16 : 14,
        height: isActive ? 16 : 14,
      },
      style: {
        stroke: strokeColor,
        strokeWidth,
        strokeDasharray: !isPlaybackMode && crossesTB && !isEncrypted ? '6 3' : undefined,
        opacity,
        transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        filter: isActive ? `drop-shadow(0 0 5px ${strokeColor}55)` : undefined,
      },
      animated: isActive,
      zIndex: isActive ? 10 : undefined,
    });
  });

  return { nodes: rfNodes, edges: rfEdges };
}

// ── Legend ────────────────────────────────────────────────────────────────────

export function DiagramLegend() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.94)',
      backdropFilter: 'blur(6px)',
      border: `1px solid ${T.stone200}`,
      borderRadius: 10,
      padding: '8px 12px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
      minWidth: 160,
    }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: T.stone400, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
        Legend
      </div>
      <LegendRow color={T.emerald}    label="Encrypted flow"               dash={false} />
      <LegendRow color={T.orangeHigh} label="Unencrypted boundary crossing" dash />
      <LegendRow color={T.stone400}   label="Internal flow"                 dash={false} />
    </div>
  );
}

function LegendRow({ color, label, dash }: { color: string; label: string; dash: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <svg width="28" height="10" viewBox="0 0 28 10" style={{ flexShrink: 0 }}>
        <line x1="0" y1="5" x2="22" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash ? '4 2' : undefined} />
        <polygon points="22,2 28,5 22,8" fill={color} />
      </svg>
      <span style={{ fontSize: 9, color: T.stone500, lineHeight: 1.3 }}>{label}</span>
    </div>
  );
}

// ── DFD badge (top-right) ─────────────────────────────────────────────────────

export function DFDBadge() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(4px)',
      border: `1px solid ${T.stone200}`,
      borderRadius: 6,
      padding: '3px 8px',
      fontFamily: 'monospace',
      fontSize: 10,
      fontWeight: 700,
      color: T.stone500,
      letterSpacing: '0.06em',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      DFD
    </div>
  );
}

// ── Inner diagram (receives all layer props) ──────────────────────────────────
// Separated so we can key it independently to force a clean ReactFlow remount.

interface InnerDiagramProps {
  nodes: Node[];
  edges: Edge[];
  showBoundaries: boolean;
  showRisks: boolean;
  showProtocols: boolean;
  onToggleBoundaries: () => void;
  onToggleRisks: () => void;
  onToggleProtocols: () => void;
  onNodeMouseEnter: (e: React.MouseEvent, node: Node) => void;
  onNodeMouseLeave: () => void;
  isPlaybackActive: boolean;
  onTogglePlayback: () => void;
  flowCount: number;
}

function InnerDiagram({
  nodes, edges,
  showBoundaries, showRisks, showProtocols,
  onToggleBoundaries, onToggleRisks, onToggleProtocols,
  onNodeMouseEnter, onNodeMouseLeave,
  isPlaybackActive, onTogglePlayback, flowCount,
}: InnerDiagramProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.15}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={28} size={0.5} color="#EBEBEB" variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} style={{ bottom: 12, left: 12 }} />

      {/* Top-left: layer toggles */}
      <Panel position="top-left">
        <DFDToolbar
          showBoundaries={showBoundaries}
          showRisks={showRisks}
          showProtocols={showProtocols}
          onToggleBoundaries={onToggleBoundaries}
          onToggleRisks={onToggleRisks}
          onToggleProtocols={onToggleProtocols}
          isPlaybackActive={isPlaybackActive}
          onTogglePlayback={onTogglePlayback}
          flowCount={flowCount}
        />
      </Panel>

      {/* Top-right: DFD badge */}
      <Panel position="top-right">
        <DFDBadge />
      </Panel>

      {/* Bottom-right: legend (hide during playback) */}
      {!isPlaybackActive && (
        <Panel position="bottom-right">
          <DiagramLegend />
        </Panel>
      )}
    </ReactFlow>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface FeatureDiagramProps {
  feature: BusinessFeature;
}

export function FeatureDiagram({ feature }: FeatureDiagramProps) {
  const dfd = feature.dataFlowDiagram;

  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showRisks,      setShowRisks]      = useState(false);
  const [showProtocols,  setShowProtocols]  = useState(false);

  // ── Playback state ──────────────────────────────────────────────────────────
  const [playbackActive, setPlaybackActive] = useState(false);
  const [playbackStep,   setPlaybackStep]   = useState(0);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flows = dfd.flows;

  // Auto-advance timer
  useEffect(() => {
    if (!playbackActive || !isPlaying) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      return;
    }
    playIntervalRef.current = setInterval(() => {
      setPlaybackStep((prev) => {
        if (prev >= flows.length - 1) {
          // Reached end — pause
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [playbackActive, isPlaying, flows.length]);

  const handleTogglePlayback = useCallback(() => {
    setPlaybackActive((v) => {
      if (v) {
        // Turning off — reset
        setIsPlaying(false);
        setPlaybackStep(0);
        if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      } else {
        // Turning on — auto-start playing
        setPlaybackStep(0);
        setIsPlaying(true);
      }
      return !v;
    });
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((v) => !v);
  }, []);

  const handleStepChange = useCallback((step: number) => {
    setPlaybackStep(step);
  }, []);

  const [tooltip, setTooltip] = useState<{ label: string; description: string; technology?: string } | null>(null);

  // Recompute the full node/edge set whenever any layer toggle or playback step changes.
  const { nodes, edges } = useMemo(
    () => buildLayout(dfd, showBoundaries, showProtocols, playbackActive ? playbackStep : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dfd, showBoundaries, showProtocols, playbackActive, playbackStep],
  );

  // Key forces a full ReactFlow unmount+remount when layout changes,
  // which is necessary because ReactFlow caches internal node positions.
  const diagramKey = `${showBoundaries ? 'tb' : 'no-tb'}-${showProtocols ? 'proto' : 'no-proto'}`;

  const onNodeMouseEnter = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type === 'dfdBoundary') return;
    setTooltip({
      label:       (node.data as Record<string, unknown>).label as string,
      description: ((node.data as Record<string, unknown>).description as string) ?? '',
      technology:  (node.data as Record<string, unknown>).technology as string | undefined,
    });
  }, []);

  const onNodeMouseLeave = useCallback(() => setTooltip(null), []);

  const hasData = dfd.actors.length + dfd.processes.length + dfd.dataStores.length > 0;

  if (!hasData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.stone400, fontSize: 14 }}>
        No data flow diagram available for this feature.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <InnerDiagram
        key={diagramKey}
        nodes={nodes}
        edges={edges}
        showBoundaries={showBoundaries}
        showRisks={showRisks}
        showProtocols={showProtocols}
        onToggleBoundaries={() => setShowBoundaries((v) => !v)}
        onToggleRisks={() => setShowRisks((v) => !v)}
        onToggleProtocols={() => setShowProtocols((v) => !v)}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        isPlaybackActive={playbackActive}
        onTogglePlayback={handleTogglePlayback}
        flowCount={flows.length}
      />

      {/* Playback HUD */}
      {playbackActive && flows.length > 0 && (
        <FlowPlaybackControls
          flows={flows}
          actors={dfd.actors}
          processes={dfd.processes}
          dataStores={dfd.dataStores}
          currentStep={playbackStep}
          isPlaying={isPlaying}
          onStepChange={handleStepChange}
          onPlayPause={handlePlayPause}
          onClose={handleTogglePlayback}
        />
      )}

      {/* Hover tooltip — hidden during playback to keep focus clean */}
      {tooltip && !playbackActive && (
        <div style={{
          position: 'absolute', top: 52, right: 16,
          background: T.white,
          border: `1px solid ${T.stone200}`,
          borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
          padding: '10px 14px',
          maxWidth: 220,
          zIndex: 50,
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.stone900, marginBottom: 2 }}>{tooltip.label}</div>
          {tooltip.description && (
            <div style={{ fontSize: 11, color: T.stone500, lineHeight: 1.5 }}>{tooltip.description}</div>
          )}
          {tooltip.technology && (
            <div style={{ fontSize: 10, color: T.stone400, marginTop: 4, fontFamily: 'monospace' }}>{tooltip.technology}</div>
          )}
        </div>
      )}

      {/* Shared CSS: edge tooltip + playback keyframes */}
      <style>{`
        .dfd-edge-label { position: relative; }
        .dfd-edge-tooltip {
          display: none;
          position: absolute;
          bottom: 18px;
          left: 50%;
          transform: translateX(-50%);
          background: #1C1917;
          color: #fff;
          font-size: 9px;
          padding: 3px 8px;
          border-radius: 4px;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          z-index: 200;
          gap: 4px;
          pointer-events: none;
        }
        .dfd-edge-label:hover .dfd-edge-tooltip { display: flex; align-items: center; }

        @keyframes fp-pulse-ring {
          0%   { transform: scale(0.85); opacity: 0.8; }
          50%  { transform: scale(1.15); opacity: 0.4; }
          100% { transform: scale(0.85); opacity: 0.8; }
        }
        @keyframes fp-badge-pop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes fp-slide-up {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        @keyframes fp-flow-arrow {
          0%   { opacity: 0.3; transform: translateX(-4px); }
          50%  { opacity: 1;   transform: translateX(0); }
          100% { opacity: 0.3; transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
