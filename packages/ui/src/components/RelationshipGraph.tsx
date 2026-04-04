import { useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  ConnectionLineType,
  MarkerType,
  NodeTypes,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { RelationshipGraph as RelationshipGraphData } from '../types';
import { T } from '../theme';
import {
  DatabaseOutlined,
  CloudOutlined,
  ApiOutlined,
  UserOutlined,
  GlobalOutlined,
  CodeOutlined,
  SafetyOutlined,
} from '@ant-design/icons';

interface RelationshipGraphProps {
  data: RelationshipGraphData;
  centerNodeId?: string;
}

const typeIcons: Record<string, any> = {
  code_repository: <CodeOutlined style={{ fontSize: 20 }} />,
  code_service: <ApiOutlined style={{ fontSize: 20 }} />,
  cloud_resource: <CloudOutlined style={{ fontSize: 20 }} />,
  data_store: <DatabaseOutlined style={{ fontSize: 20 }} />,
  api_endpoint: <GlobalOutlined style={{ fontSize: 20 }} />,
  identity: <UserOutlined style={{ fontSize: 20 }} />,
  network_segment: <SafetyOutlined style={{ fontSize: 20 }} />,
  external_dependency: <GlobalOutlined style={{ fontSize: 20 }} />,
};

const typeColors: Record<string, string> = {
  code_repository: T.blue,
  code_service: '#52c41a',
  cloud_resource: '#722ed1',
  data_store: '#fa8c16',
  api_endpoint: '#13c2c2',
  identity: T.pink,
  network_segment: '#faad14',
  external_dependency: T.stone500,
};

// Custom node component
function CustomNode({ data }: any) {
  const icon = typeIcons[data.type] || <CodeOutlined style={{ fontSize: 20 }} />;
  const color = typeColors[data.type] || '#8c8c8c';
  const isCenterNode = data.isCenterNode;

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        background: isCenterNode ? color : T.white,
        color: isCenterNode ? T.white : '#262626',
        border: isCenterNode ? 'none' : `2px solid ${color}`,
        minWidth: 150,
        boxShadow: isCenterNode
          ? '0 4px 12px rgba(0, 0, 0, 0.2)'
          : '0 2px 8px rgba(0, 0, 0, 0.1)',
        transition: 'all 0.3s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: isCenterNode ? '#fff' : color }}>{icon}</span>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{data.label}</div>
      </div>
      <div
        style={{
          fontSize: 11,
          opacity: 0.8,
          marginTop: 4,
        }}
      >
        {data.type.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

// Layout algorithm - circular layout with center node
function calculateLayout(
  nodes: RelationshipGraphData['nodes'],
  centerNodeId?: string
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const centerX = 400;
  const centerY = 300;
  const radius = 250;

  if (centerNodeId) {
    // Find center node index
    const centerIndex = nodes.findIndex(n => n.id === centerNodeId);
    
    nodes.forEach((_, index) => {
      if (index === centerIndex) {
        // Center node
        positions.push({ x: centerX, y: centerY });
      } else {
        // Arrange other nodes in a circle
        const adjustedIndex = index > centerIndex ? index - 1 : index;
        const totalNodes = nodes.length - 1;
        const angle = (adjustedIndex / totalNodes) * 2 * Math.PI;
        positions.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
    });
  } else {
    // Simple circular layout for all nodes
    nodes.forEach((_, index) => {
      const angle = (index / nodes.length) * 2 * Math.PI;
      positions.push({
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });
  }

  return positions;
}

export function RelationshipGraph({ data, centerNodeId }: RelationshipGraphProps) {
  const positions = useMemo(
    () => calculateLayout(data.nodes, centerNodeId),
    [data.nodes, centerNodeId]
  );

  const nodes: Node[] = useMemo(
    () =>
      data.nodes.map((node, index) => ({
        id: node.id,
        type: 'custom',
        position: positions[index],
        data: {
          label: node.name,
          type: node.type,
          isCenterNode: node.id === centerNodeId,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })),
    [data.nodes, positions, centerNodeId]
  );

  const edges: Edge[] = useMemo(
    () =>
      data.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.type.replace(/_/g, ' '),
        type: ConnectionLineType.SmoothStep,
        animated: false,
        style: { stroke: T.stone500, strokeWidth: 2 },
        labelStyle: {
          fontSize: 11,
          fill: '#595959',
          background: T.white,
          padding: 4,
        },
        labelBgStyle: {
          fill: T.white,
          fillOpacity: 0.9,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: T.stone500,
        },
      })),
    [data.edges]
  );

  return (
    <div style={{ width: '100%', height: 600 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={1.5}
        defaultEdgeOptions={{
          type: ConnectionLineType.SmoothStep,
        }}
      >
        <Background color="#f0f0f0" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const type = node.data.type;
            return typeColors[type] || T.stone500;
          }}
          style={{
            background: T.white,
            border: '1px solid #d9d9d9',
          }}
        />
      </ReactFlow>
    </div>
  );
}
