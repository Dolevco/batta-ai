import { useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { StoredPlan } from '../types';
import { theme } from 'antd';
import { useTheme } from '../hooks';

interface TaskGraphProps {
  plan: StoredPlan;
  onNodeClick?: (stepId: string) => void;
}

export function TaskGraph({ plan, onNodeClick }: TaskGraphProps) {
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();

  const { nodes: initialNodes, edges: initialEdges } = planToGraph(plan, onNodeClick, token, appTheme);
  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Update nodes and edges when plan changes
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = planToGraph(plan, onNodeClick, token, appTheme);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [plan, onNodeClick, setNodes, setEdges, token, appTheme]);

  return (
    <div style={{ ...styles.container, backgroundColor: token.colorBgLayout, border: `1px solid ${token.colorBorder}` }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        attributionPosition="bottom-left"
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { stroke: token.colorPrimary, strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Controls style={{ ...styles.controls, backgroundColor: token.colorBgContainer, border: `1px solid ${token.colorBorder}` }} />
        <MiniMap
          style={{ ...styles.miniMap, backgroundColor: token.colorBgContainer, border: `1px solid ${token.colorBorder}` }}
          nodeColor={token.colorPrimary}
          maskColor={token.colorBorder}
        />
        <Background color={token.colorBorder} gap={16} />
      </ReactFlow>
    </div>
  );
}

function planToGraph(plan: StoredPlan, onNodeClick: ((stepId: string) => void) | undefined, token: any, appTheme: string): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = plan.subTasks.map((subTask, index) => ({
    id: subTask.id,
    type: 'default',
    position: { x: 300, y: index * 180 },
    data: {
      label: (
        <div
          style={onNodeClick ? { ...styles.nodeContent, cursor: 'pointer' } : styles.nodeContent}
          onClick={() => onNodeClick?.(subTask.id)}
        >
          <div style={{ ...styles.nodeHeader, backgroundColor: token.colorBgElevated, borderBottom: `1px solid ${token.colorBorder}` }}>
            <div style={{ ...styles.nodeIndex, backgroundColor: token.colorPrimary }}>{index + 1}</div>
            <div style={{ ...styles.nodeTitle, color: token.colorText }}>{subTask.name}</div>
          </div>
          {/* body and footer could be added here if needed */}
        </div>
      ),
    },
    style: { ...styles.node, background: token.colorBgContainer, border: `2px solid ${token.colorPrimary}`, boxShadow: appTheme === 'dark' ? '0 2px 8px rgba(0,0,0,0.6)' : styles.node.boxShadow },
  }));

  const edges: Edge[] = [];
  plan.subTasks.forEach((subTask) => {
    subTask.dependsOn?.forEach((depIndex) => {
      if (depIndex < plan.subTasks.length) {
        const depId = plan.subTasks[depIndex].id;
        edges.push({
          id: `${depId}-${subTask.id}`,
          source: depId,
          target: subTask.id,
          animated: false,
          type: 'smoothstep',
          markerEnd: {
            type: 'arrowclosed',
            color: token.colorPrimary,
          } as any,
        });
      }
    });
  });

  return { nodes, edges };
}

const styles = {
  container: {
    width: '100%',
    height: '73vh',
    backgroundColor: '#f5f5f5',
    border: '1px solid #d9d9d9',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  controls: {
    backgroundColor: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '4px',
  },
  miniMap: {
    backgroundColor: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '4px',
    height: 75,
    width: 100
  },
  node: {
    background: '#fff',
    border: '2px solid #1890ff',
    borderRadius: '8px',
    padding: '0',
    width: '380px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
    overflow: 'hidden',
  },
  nodeContent: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  nodeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#e6f7ff',
    borderBottom: '1px solid #91d5ff',
  },
  nodeIndex: {
    width: '32px',
    height: '32px',
    borderRadius: '4px',
    backgroundColor: '#1890ff',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700' as const,
    fontSize: '14px',
    flexShrink: 0,
  },
  nodeTitle: {
    fontWeight: '600' as const,
    fontSize: '15px',
    color: '#262626',
    lineHeight: '1.4',
  },
  nodeBody: {
    padding: '16px',
  },
  reasonLabel: {
    fontSize: '11px',
    color: '#8c8c8c',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    fontWeight: '600' as const,
    marginBottom: '8px',
  },
  nodeReason: {
    fontSize: '13px',
    color: '#595959',
    lineHeight: '1.6',
    fontStyle: 'italic' as const,
  },
  nodeFooter: {
    padding: '12px 16px',
    backgroundColor: '#fafafa',
    borderTop: '1px solid #f0f0f0',
  },
  nodeTool: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#1890ff',
    fontWeight: '600' as const,
  },
  toolIcon: {
    fontSize: '14px',
  },
};
